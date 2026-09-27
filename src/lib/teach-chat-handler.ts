import { generateText } from "ai";
import { getModel } from "@/lib/llm";
import { readableSourceRoot } from "@/lib/local-source";
import { agentLoopBudget, runLocalAgent } from "@/lib/pi-agent";
import {
  getChatHistory,
  addChatMessage,
  isOutlineConfirmed,
  stageRequiresOutlineConfirmation,
  markLearningItemComplete,
  updateStage,
  type LearningPlan,
  type Stage,
} from "@/db/queries";
import { composeTeachingSystemPrompt } from "@/lib/prompt-composer";
import { selectGroundedSources } from "@/lib/source-selector";
import type { GroundedSourceBundle, LearningMode, StageOutline } from "@/lib/learning-types";
import { stageOutlineSchema } from "@/lib/learning-types";

export class TeachChatValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseStoredOutline(stage: Stage): StageOutline | null {
  if (!stage.outline_json) return null;
  try {
    const parsed = JSON.parse(stage.outline_json);
    const result = stageOutlineSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function validateTeachChatRequest(params: {
  stage: Stage;
  message: string | undefined;
}): void {
  const { stage, message } = params;
  if (!message?.trim()) {
    throw new TeachChatValidationError("消息不能为空", 400);
  }
  if (stage.status === "locked") {
    throw new TeachChatValidationError("该阶段尚未解锁", 403);
  }
  if (stageRequiresOutlineConfirmation(stage) && !isOutlineConfirmed(stage)) {
    throw new TeachChatValidationError(
      "请先确认本阶段学习大纲后再开始教学对话",
      403
    );
  }
}

export function buildSourceBundle(params: {
  plan: LearningPlan | null;
  stage: Stage;
  outline: StageOutline | null;
}): GroundedSourceBundle | null {
  if (!params.plan || params.plan.source_type !== "code" || !params.plan.source_path) {
    return null;
  }
  return selectGroundedSources({
    sourceRoot: params.plan.source_path,
    allFilePaths: params.plan.source_files || [],
    outline: params.outline,
    summaryText: params.stage.summary_text,
    keywords: [...params.stage.key_topics, ...params.stage.title.split(/[\s:：\-_/]+/)],
  });
}

export async function handleTeachChatPost(params: {
  stageId: string;
  stage: Stage;
  plan: LearningPlan | null;
  message: string;
  mode?: "agent" | "chat";
  onTrace?: (text: string) => void;
}): Promise<{ role: "assistant"; content: string; sources?: GroundedSourceBundle }> {
  validateTeachChatRequest({ stage: params.stage, message: params.message });

  const learningMode = (params.plan?.learning_mode || "business") as LearningMode;
  const outline = parseStoredOutline(params.stage);
  const sourceBundle = buildSourceBundle({
    plan: params.plan,
    stage: params.stage,
    outline,
  });

  const systemPrompt = composeTeachingSystemPrompt({
    plan: params.plan,
    stage: params.stage,
    learningMode,
    outline,
    sourceBundle,
  });

  // Persist user message only after validation passed
  addChatMessage(params.stageId, "user", params.message);

  const history = getChatHistory(params.stageId);
  const chatMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const sourceRoot = readableSourceRoot(params.plan);
  const materialNote = params.plan?.source_type === "book"
    ? "\n本地书籍全文在 book.txt。讲解前用工具分段阅读，不要只凭书名发挥。"
    : params.plan?.source_type === "code"
      ? "\n当前目录就是学员的代码仓库。材料里没出现的文件，用工具打开后再讲。"
      : "";
  const priorMessages = chatMessages.slice(0, -1);
  const latestMessage = chatMessages[chatMessages.length - 1]?.content || params.message;

  let text: string;
  const useAgent = params.mode === "agent" && !!sourceRoot;
  if (useAgent && sourceRoot) {
    try {
      const result = await runLocalAgent({
        root: sourceRoot,
        systemPrompt: systemPrompt + materialNote,
        prompt: latestMessage,
        history: priorMessages,
        ...agentLoopBudget("chat"),
        onTrace: params.onTrace,
      });
      text = result.text;
    } catch (agentError) {
      console.error("Teach chat agent loop failed, falling back:", agentError);
      params.onTrace?.("未走完 agent loop，已改用一次性回复");
      const model = getModel();
      const fallback = await generateText({
        model,
        system: systemPrompt,
        messages: chatMessages,
      });
      text = fallback.text;
    }
  } else {
    if (params.mode === "agent" && !sourceRoot) {
      params.onTrace?.("当前计划没有可读取的本地代码或书籍，已改用一次性回复");
    }
    const model = getModel();
    const fallback = await generateText({
      model,
      system: systemPrompt,
      messages: chatMessages,
    });
    text = fallback.text;
  }

  addChatMessage(params.stageId, "assistant", text);

  if (!params.stage.learning_started_at) {
    updateStage(params.stage.id, { learning_started_at: new Date().toISOString() });
  }

  return {
    role: "assistant",
    content: text,
    sources: sourceBundle ?? undefined,
  };
}

export function markAssessmentCheckpoint(stageId: string, passed: boolean, skipped: boolean) {
  if (skipped) {
    markLearningItemComplete(stageId, "assessment_skip");
  } else if (passed) {
    markLearningItemComplete(stageId, "assessment_pass");
  }
}
