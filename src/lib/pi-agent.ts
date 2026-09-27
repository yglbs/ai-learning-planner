import fs from "fs";
import path from "path";
import { Type } from "typebox";
import { Agent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAI } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { getConfig } from "@/db/queries";
import { PROVIDER_DEFAULT_BASE_URLS, type LlmConnection } from "@/lib/llm";
import {
  canSearchFile,
  isIgnoredDirName,
  isSensitiveFileName,
  resolveInsideRoot,
} from "@/lib/local-source";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const TOOL_GUIDE = `
## 本地读取
材料就在当前目录。需要原文或源码时调用 list_dir、read_file、grep，路径用相对路径。
只根据读到的内容下结论。没打开的文件不要假装读过。`;

export type AgentLoopKind = "code" | "book" | "chat";

/** Read cap from settings. Conversation turns stay four above that cap. */
export function agentLoopBudget(kind: AgentLoopKind): { maxToolCalls: number; maxTurns: number } {
  const config = getConfig();
  const maxToolCalls =
    kind === "code"
      ? config.pi_code_max_tool_calls
      : kind === "book"
        ? config.pi_book_max_tool_calls
        : config.pi_chat_max_tool_calls;
  return { maxToolCalls, maxTurns: maxToolCalls + 4 };
}

export interface LocalAgentRun {
  text: string;
  filesRead: string[];
  toolCalls: number;
}

export interface LocalAgentParams {
  root: string;
  systemPrompt: string;
  prompt: string;
  history?: { role: "user" | "assistant"; content: string }[];
  maxToolCalls?: number;
  maxTurns?: number;
  onTrace?: (text: string) => void;
}

function defaultModelId(provider: string): string {
  if (provider === "anthropic") return "claude-sonnet-4-20250514";
  if (provider === "deepseek") return "deepseek-v4-flash";
  if (provider === "kimi") return "kimi-k2-0711-preview";
  return "gpt-4o-mini";
}

function resolveBaseUrl(config: LlmConnection): string {
  const custom = config.llm_base_url.trim().replace(/\/$/, "");
  if (custom) return custom;
  if (config.llm_provider === "anthropic") return PROVIDER_DEFAULT_BASE_URLS.anthropic;
  if (config.llm_provider === "deepseek") return `${PROVIDER_DEFAULT_BASE_URLS.deepseek}/v1`;
  if (config.llm_provider === "kimi") return PROVIDER_DEFAULT_BASE_URLS.kimi;
  return PROVIDER_DEFAULT_BASE_URLS.openai;
}

export function createPiModel(config: LlmConnection = getConfig()): Model<string> {
  if (!config.llm_api_key) {
    throw new Error("请先在设置页面配置 API Key");
  }
  const provider = config.llm_provider || "openai";
  const id = config.llm_model || defaultModelId(provider);
  const anthropic = provider === "anthropic";
  return {
    id,
    name: id,
    api: anthropic ? "anthropic-messages" : "openai-completions",
    provider,
    baseUrl: resolveBaseUrl(config),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}

const streamFn: StreamFn = (model, context, options) => {
  if (model.api === "anthropic-messages") {
    return streamAnthropic(model as Model<"anthropic-messages">, context, options);
  }
  return streamOpenAI(model as Model<"openai-completions">, context, options);
};

function toolArgs(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" ? params as Record<string, unknown> : {};
}

function textResult(text: string, details: Record<string, string | number | boolean> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function createLocalReadTools(root: string, filesRead: string[]): AgentTool[] {
  const readTool: AgentTool = {
    name: "read_file",
    label: "读取文件",
    description: "读取材料目录中的文本文件。offset 为起始行（从 1 开始），limit 为行数，最大 400。",
    parameters: Type.Object({
      path: Type.String({ description: "相对路径，例如 src/main.ts 或 book.txt" }),
      offset: Type.Optional(Type.Number({ description: "起始行，从 1 开始" })),
      limit: Type.Optional(Type.Number({ description: "读取行数，最大 400" })),
    }),
    async execute(_toolCallId, params) {
      const args = toolArgs(params);
      const relativePath = String(args.path || "");
      const offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.min(400, Math.max(1, Number(args.limit) || 200));
      const fullPath = resolveInsideRoot(root, relativePath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        throw new Error(`文件不存在: ${relativePath}`);
      }
      if (isSensitiveFileName(path.basename(fullPath))) {
        throw new Error("不能读取敏感文件");
      }
      const stat = fs.statSync(fullPath);
      if (stat.size > 1_000_000) {
        throw new Error("文件过大，请用 grep 定位后再分段读取");
      }
      const raw = fs.readFileSync(fullPath, "utf-8");
      const lines = raw.split(/\r?\n/);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = slice.map((line, index) => `${offset + index}|${line}`).join("\n");
      const clipped = numbered.length > 20_000 ? numbered.slice(0, 20_000) + "\n…[truncated]" : numbered;
      const displayPath = path.relative(root, fullPath).replace(/\\/g, "/") || relativePath;
      filesRead.push(displayPath);
      return textResult(clipped || "(空文件)", {
        path: displayPath,
        start_line: offset,
        line_count: slice.length,
        total_lines: lines.length,
      });
    },
  };

  const listTool: AgentTool = {
    name: "list_dir",
    label: "列出目录",
    description: "列出材料目录中的一层文件和子目录。path 省略或为 . 时列出根目录。",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "相对目录，默认 ." })),
    }),
    async execute(_toolCallId, params) {
      const relativePath = String(toolArgs(params).path || ".");
      const fullPath = resolveInsideRoot(root, relativePath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        throw new Error(`目录不存在: ${relativePath}`);
      }
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
        .filter((entry) => !isSensitiveFileName(entry.name))
        .filter((entry) => !(entry.isDirectory() && isIgnoredDirName(entry.name)))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 200);
      const lines = entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
      const displayPath = path.relative(root, fullPath).replace(/\\/g, "/") || ".";
      return textResult(lines.join("\n") || "(空目录)", { path: displayPath, count: lines.length });
    },
  };

  const grepTool: AgentTool = {
    name: "grep",
    label: "搜索文本",
    description: "在材料目录中按字面量搜索文本（不区分大小写）。可指定子目录。",
    parameters: Type.Object({
      pattern: Type.String({ description: "要搜索的文字" }),
      path: Type.Optional(Type.String({ description: "相对目录，默认整个材料根目录" })),
    }),
    async execute(_toolCallId, params) {
      const args = toolArgs(params);
      const pattern = String(args.pattern || "").trim();
      if (pattern.length < 2) throw new Error("搜索词至少 2 个字符");
      const relativePath = String(args.path || ".");
      const start = resolveInsideRoot(root, relativePath);
      if (!fs.existsSync(start)) throw new Error(`路径不存在: ${relativePath}`);
      const needle = pattern.toLowerCase();
      const matches: string[] = [];
      let scanned = 0;

      const visit = (current: string) => {
        if (matches.length >= 40 || scanned >= 400) return;
        const stat = fs.statSync(current);
        if (stat.isDirectory()) {
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (matches.length >= 40 || scanned >= 400) return;
            if (entry.isDirectory()) {
              if (isIgnoredDirName(entry.name)) continue;
              visit(path.join(current, entry.name));
            } else if (entry.isFile() && canSearchFile(entry.name)) {
              visit(path.join(current, entry.name));
            }
          }
          return;
        }
        if (!stat.isFile() || stat.size > 200_000 || stat.size === 0) return;
        scanned += 1;
        const relative = path.relative(root, current).replace(/\\/g, "/");
        const content = fs.readFileSync(current, "utf-8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= 40) return;
          if (lines[i].toLowerCase().includes(needle)) {
            matches.push(`${relative}:${i + 1}:${lines[i].slice(0, 240)}`);
          }
        }
      };

      visit(start);
      return textResult(matches.join("\n") || "没有匹配", { matches: matches.length, scanned });
    },
  };

  return [listTool, readTool, grepTool];
}

function toTranscript(
  history: { role: "user" | "assistant"; content: string }[],
  model: Model<string>
): AgentMessage[] {
  return history.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: message.content, timestamp: Date.now() };
    }
    const assistant: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_USAGE,
      stopReason: "stop",
      timestamp: Date.now(),
    };
    return assistant;
  });
}

function trace(onTrace: ((text: string) => void) | undefined, text: string) {
  console.log(`[pi-agent] ${text}`);
  onTrace?.(text);
}

function formatToolStart(name: string, args: unknown): string {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : {};
  if (name === "list_dir") return `列出目录 ${String(record.path || ".")}`;
  if (name === "read_file") return `读取 ${String(record.path || "文件")}`;
  if (name === "grep") return `搜索「${String(record.pattern || "")}」`;
  return `调用 ${name}`;
}

function formatToolEnd(name: string, isError: boolean, result: { details?: Record<string, unknown>; content?: { type: string; text?: string }[] }): string {
  if (isError) {
    const message = result.content?.find((block) => block.type === "text")?.text || "失败";
    return `${name} 失败：${message.slice(0, 80)}`;
  }
  const details = result.details || {};
  if (name === "read_file") return `已读 ${String(details.path || "文件")}（${String(details.line_count ?? "?")} 行）`;
  if (name === "list_dir") return `已列出 ${String(details.path || ".")}（${String(details.count ?? "?")} 项）`;
  if (name === "grep") return `搜索完成，${String(details.matches ?? 0)} 处匹配`;
  return `${name} 完成`;
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new Error(message.errorMessage || "模型调用失败");
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("模型没有返回内容");
}

/** Run Pi's agent loop with read-only tools rooted at a local directory. */
export async function runLocalAgent(params: LocalAgentParams): Promise<LocalAgentRun> {
  const root = fs.realpathSync(params.root);
  const config = getConfig();
  const model = createPiModel(config);
  const filesRead: string[] = [];
  const tools = createLocalReadTools(root, filesRead);
  let turns = 0;
  let toolCalls = 0;
  const maxToolCalls = params.maxToolCalls ?? 16;
  const maxTurns = params.maxTurns ?? maxToolCalls + 4;

  const agent = new Agent({
    streamFn,
    getApiKey: () => config.llm_api_key,
    toolExecution: "sequential",
    initialState: {
      model,
      thinkingLevel: "off",
      systemPrompt: `${params.systemPrompt.trim()}\n${TOOL_GUIDE}`,
      tools,
      messages: toTranscript(params.history || [], model),
    },
    beforeToolCall: async () => {
      toolCalls += 1;
      if (toolCalls > maxToolCalls) {
        return {
          block: true,
          reason: "读取次数已达上限。不要再调用工具，直接根据已经读到的内容给出最终回答。",
        };
      }
    },
    finishTurn: async (turn) => {
      if (turn.message.stopReason === "error" || turn.message.stopReason === "aborted") return;
      turns += 1;
      if (turns >= maxTurns) return { action: "end" };
    },
  });

  agent.subscribe((event) => {
    if (event.type === "agent_start") {
      trace(params.onTrace, "Pi agent loop 已启动");
    } else if (event.type === "tool_execution_start") {
      trace(params.onTrace, formatToolStart(event.toolName, event.args));
    } else if (event.type === "tool_execution_end") {
      trace(params.onTrace, formatToolEnd(event.toolName, event.isError, event.result));
    }
  });

  await agent.prompt(params.prompt);
  trace(params.onTrace, `Pi agent loop 结束，读取了 ${filesRead.length} 个文件`);
  return {
    text: lastAssistantText(agent.state.messages),
    filesRead,
    toolCalls,
  };
}
