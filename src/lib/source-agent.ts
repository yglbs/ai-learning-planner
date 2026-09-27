import fs from "fs";
import path from "path";
import {
  buildBookPlanPrompt,
  buildCodePlanPrompt,
  generateStageGuide,
  parsePlanSkeleton,
  type GeneratedPlan,
  type StageGuide,
} from "@/lib/ai";
import { agentLoopBudget, runLocalAgent } from "@/lib/pi-agent";
import { isSensitiveFileName, resolveInsideRoot } from "@/lib/local-source";

const PLAN_SYSTEM_PROMPT = `你是学习规划师。先用工具阅读本地材料，再制定计划。
最终回复只能是计划骨架 JSON：标题、阶段名、天数、知识点和对应文件。不要写导读。`;

export class StageGuideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageGuideError";
  }
}

export interface CodePlanAgentParams {
  project_path: string;
  project_name: string;
  file_tree: string;
  duration_weeks: number;
  daily_hours: number;
  skill_level: string;
  motivation?: string;
  background?: string;
  expected_outcome?: string;
  learning_mode?: string;
  career_identity?: string;
  focus?: string;
  onTrace?: (text: string) => void;
}

export async function generateCodePlanByReading(
  params: CodePlanAgentParams
): Promise<{ plan: GeneratedPlan; filesRead: string[] }> {
  const prompt = buildCodePlanPrompt({
    ...params,
    read_with_tools: true,
    skeleton_only: true,
  });

  const budget = agentLoopBudget("code");
  const result = await runLocalAgent({
    root: params.project_path,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    prompt,
    maxToolCalls: budget.maxToolCalls,
    maxTurns: budget.maxTurns,
    onTrace: params.onTrace,
  });
  if (result.filesRead.length === 0) {
    throw new Error("模型没有读取任何源码文件");
  }
  const skeleton = parsePlanSkeleton(result.text);
  params.onTrace?.(`计划骨架已生成，共 ${skeleton.stages.length} 个阶段。开始按阶段写导读。`);
  const stages = [];
  for (let i = 0; i < skeleton.stages.length; i++) {
    const stage = skeleton.stages[i];
    const files = pickStageFiles(stage.source_files, result.filesRead);
    const excerpt = readSourceExcerpts(params.project_path, files);
    params.onTrace?.(`正在写阶段 ${i + 1}/${skeleton.stages.length}：${stage.title}`);
    const guide = await writeStageGuide({
      label: stage.title,
      excerpt,
      requirePaths: files,
      prompt: codeStagePrompt({ ...params, stage, files, excerpt, totalStages: skeleton.stages.length }),
      onTrace: params.onTrace,
    });
    stages.push({ ...guide, title: stage.title, key_topics: stage.key_topics, estimated_days: stage.estimated_days });
  }
  return { plan: { plan_title: skeleton.plan_title, stages }, filesRead: result.filesRead };
}

export interface BookPlanAgentParams {
  book_root: string;
  book_title?: string;
  duration_weeks: number;
  daily_hours: number;
  skill_level: string;
  motivation?: string;
  background?: string;
  expected_outcome?: string;
  learning_mode?: string;
  career_identity?: string;
  focus?: string;
  onTrace?: (text: string) => void;
}

export async function generateBookPlanByReading(
  params: BookPlanAgentParams
): Promise<{ plan: GeneratedPlan; filesRead: string[] }> {
  const prompt = buildBookPlanPrompt({
    ...params,
    read_with_tools: true,
    skeleton_only: true,
  });

  const budget = agentLoopBudget("book");
  const result = await runLocalAgent({
    root: params.book_root,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    prompt,
    maxToolCalls: budget.maxToolCalls,
    maxTurns: budget.maxTurns,
    onTrace: params.onTrace,
  });
  if (!result.filesRead.some((file) => file.endsWith("book.txt"))) {
    throw new Error("模型没有阅读书籍正文");
  }
  const skeleton = parsePlanSkeleton(result.text);
  params.onTrace?.(`计划骨架已生成，共 ${skeleton.stages.length} 个阶段。开始按阶段写导读。`);
  const stages = [];
  for (let i = 0; i < skeleton.stages.length; i++) {
    const stage = skeleton.stages[i];
    const excerpt = excerptBook(params.book_root, stage.key_topics);
    params.onTrace?.(`正在写阶段 ${i + 1}/${skeleton.stages.length}：${stage.title}`);
    const guide = await writeStageGuide({
      label: stage.title,
      excerpt,
      requirePaths: [],
      requireTopics: stage.key_topics,
      prompt: bookStagePrompt({ ...params, stage, excerpt, totalStages: skeleton.stages.length }),
      onTrace: params.onTrace,
    });
    stages.push({ ...guide, title: stage.title, key_topics: stage.key_topics, estimated_days: stage.estimated_days });
  }
  return { plan: { plan_title: skeleton.plan_title, stages }, filesRead: result.filesRead };
}

function pickStageFiles(named: string[], filesRead: string[]): string[] {
  const uniqueRead = [...new Set(filesRead.map(normalizePath))];
  const picked = named
    .map(normalizePath)
    .filter((file) => uniqueRead.some((read) => read === file || read.endsWith(`/${file}`) || file.endsWith(`/${read}`)));
  const unique = [...new Set(picked)].slice(0, 6);
  if (unique.length > 0) return unique;
  return uniqueRead.slice(0, 6);
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function readSourceExcerpts(root: string, files: string[]): string {
  const parts: string[] = [];
  for (const file of files) {
    const excerpt = readOneFile(root, file);
    if (excerpt) parts.push(excerpt);
    if (parts.join("\n").length > 28000) break;
  }
  return parts.join("\n\n");
}

function readOneFile(root: string, relativePath: string): string | null {
  try {
    const fullPath = resolveInsideRoot(root, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    if (isSensitiveFileName(path.basename(fullPath))) return null;
    const raw = fs.readFileSync(fullPath, "utf-8");
    const clipped = raw.split(/\r?\n/).slice(0, 220).join("\n").slice(0, 8000);
    return `=== ${normalizePath(relativePath)} ===\n${clipped}`;
  } catch {
    return null;
  }
}

function excerptBook(root: string, topics: string[]): string {
  const bookPath = path.join(root, "book.txt");
  if (!fs.existsSync(bookPath)) return "";
  const raw = fs.readFileSync(bookPath, "utf-8").slice(0, 1_500_000);
  const windows: string[] = [];
  const lower = raw.toLowerCase();
  for (const topic of topics) {
    const needle = topic.trim().toLowerCase();
    if (needle.length < 2) continue;
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - 600);
    windows.push(raw.slice(start, at + 2200));
    if (windows.join("\n").length > 12000) break;
  }
  return windows.join("\n\n---\n\n").slice(0, 12000);
}

async function writeStageGuide(params: {
  label: string;
  excerpt: string;
  prompt: string;
  requirePaths: string[];
  requireTopics?: string[];
  onTrace?: (text: string) => void;
}): Promise<StageGuide> {
  if (!params.excerpt.trim()) {
    throw new StageGuideError(`阶段「${params.label}」没有对上已读材料，没有生成导读`);
  }
  let lastError = "阶段导读生成失败";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const guide = await generateStageGuide(attempt === 1 ? params.prompt : `${params.prompt}\n\n上一次不合格：${lastError}。请重写这一阶段。`);
      const problem = guideProblem(guide, params.excerpt, params.requirePaths, params.requireTopics || []);
      if (problem) {
        lastError = problem;
        params.onTrace?.(`阶段「${params.label}」需要重写：${problem}`);
        continue;
      }
      return guide;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "阶段导读生成失败";
      params.onTrace?.(`阶段「${params.label}」第 ${attempt} 次没有写完：${lastError}`);
    }
  }
  throw new StageGuideError(`阶段「${params.label}」的导读没有生成成功：${lastError}`);
}

function guideProblem(guide: StageGuide, excerpt: string, files: string[], topics: string[]): string | null {
  const summary = guide.summary_text.replace(/\s/g, "");
  if (!excerpt.trim()) return "没有对上原文，不能编造导读";
  if (summary.length < 500) return "导读不足 500 字";
  const haystack = guide.summary_text.toLowerCase();
  if (files.length > 0) {
    const mentioned = files.some((file) => {
      const base = path.posix.basename(file).toLowerCase();
      return haystack.includes(file.toLowerCase()) || (base.length > 3 && haystack.includes(base));
    });
    if (!mentioned) return "导读没有写到指定的源码文件";
  }
  if (topics.length > 0 && files.length === 0) {
    const mentioned = topics.some((topic) => topic.trim().length > 1 && haystack.includes(topic.trim().toLowerCase()));
    if (!mentioned) return "导读没有写到本阶段的知识点";
  }
  return null;
}

function codeStagePrompt(params: {
  project_name: string;
  duration_weeks: number;
  daily_hours: number;
  stage: { title: string; estimated_days: number; key_topics: string[] };
  files: string[];
  excerpt: string;
  totalStages: number;
  focus?: string;
}): string {
  return `你在为项目「${params.project_name}」写其中一个阶段的学习导读。计划共 ${params.totalStages} 个阶段，每天 ${params.daily_hours} 小时。
阶段名：${params.stage.title}
天数：${params.stage.estimated_days}
知识点：${params.stage.key_topics.join("、")}
必须阅读的文件：${params.files.join("、") || "（无）"}
${params.focus?.trim() ? `学员提示：${params.focus.trim().slice(0, 500)}` : ""}

下面是这些文件的摘录。导读只能根据摘录里真实出现的文件、函数、类型、路由来写。摘录里没有的符号不要编。
${params.excerpt || "（没有读到文件内容。请不要编造导读。）"}

summary_text 写 700 到 900 字，并包含这四小节：【精读文件】【调用链路】【设计取舍】【动手检查】。
【精读文件】里要出现上面列出的相对路径。用普通句子写路径和函数名，不要用代码块。
assessment_questions 只考本阶段的知识点。`;
}

function bookStagePrompt(params: {
  book_title?: string;
  stage: { title: string; estimated_days: number; key_topics: string[] };
  excerpt: string;
  totalStages: number;
  focus?: string;
}): string {
  return `你在为《${params.book_title || "这本书"}》写其中一个阶段的学习导读。全书共 ${params.totalStages} 个阶段。
阶段名：${params.stage.title}
天数：${params.stage.estimated_days}
知识点：${params.stage.key_topics.join("、")}
${params.focus?.trim() ? `学员提示：${params.focus.trim().slice(0, 500)}` : ""}

下面是按这些知识点从 book.txt 里截出的原文。导读只能解读这些原文。原文里没有的章节、情节、概念不要写。
${params.excerpt || "（没有在书里定位到这些知识点。请不要编造导读。）"}

summary_text 写 700 到 900 字，用自己的话解读原文中的观点和关系。不要用代码块。
assessment_questions 只考上面列出的知识点。`;
}
