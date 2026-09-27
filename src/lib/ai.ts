import { generateObject, generateText } from "ai";
import { z } from "zod";
import { extractJson } from "@/lib/extract-json";
import { getModel, isOpenAICompatibleStructuredFallback, isStructuredFallbackProvider } from "@/lib/llm";
import type { LanguageModel } from "ai";

function useStructuredTextFallback(providerOverride?: string) {
  if (providerOverride) return isStructuredFallbackProvider(providerOverride);
  return isOpenAICompatibleStructuredFallback();
}

async function deepSeekGenerateObject<T>(
  prompt: string,
  schemaDescription: string,
  model: LanguageModel = getModel()
): Promise<T> {
  const { text } = await generateText({
    model,
    prompt: `${prompt}\n\n请严格按照以下 JSON 格式输出，不要输出任何其他内容：\n${schemaDescription}`,
  });
  return extractJson(text) as T;
}

const planSchema = z.object({
  plan_title: z.string(),
  stages: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      key_topics: z.array(z.string()),
      estimated_days: z.number(),
      learning_objectives: z.array(z.string()),
      summary_text: z.string().describe("800字左右的学习导读，包含核心概念和学习顺序建议"),
      core_output: z.string().describe("完成本阶段后的具体产出物，如'搭建完成一个能跑通的chatbot demo'"),
      real_world_cases: z.array(z.string()).describe("1-2个现实案例，说明这个技术在真实世界中如何被使用"),
      assessment_questions: z.array(z.string()).describe("3-5个苏格拉底式思考题，用来检验学习成果"),
    })
  ),
});

export type GeneratedPlan = z.infer<typeof planSchema>;

export function parseGeneratedPlan(text: string): GeneratedPlan {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new Error("模型没有返回可解析的学习计划 JSON");
  }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("模型返回的学习计划格式不正确");
  }
  return parsed.data;
}

export const PLAN_SKELETON_SCHEMA = `{
  "plan_title": "计划标题",
  "stages": [
    {
      "title": "具体到模块或业务能力的阶段名",
      "estimated_days": 7,
      "key_topics": ["知识点1", "知识点2", "知识点3"],
      "source_files": ["相对路径1", "相对路径2"]
    }
  ]
}`;

const stageGuideSchema = z.object({
  description: z.string(),
  learning_objectives: z.array(z.string()).min(1),
  summary_text: z.string(),
  core_output: z.string(),
  real_world_cases: z.array(z.string()).min(1),
  assessment_questions: z.array(z.string()).min(1),
});

export type StageGuide = z.infer<typeof stageGuideSchema>;

const STAGE_GUIDE_SCHEMA = `{
  "description": "一两句说明这个阶段学什么",
  "learning_objectives": ["能指着材料说明的目标"],
  "summary_text": "700到900字导读",
  "core_output": "学完后的具体产出",
  "real_world_cases": ["一个和本阶段材料对应的案例"],
  "assessment_questions": ["只考本阶段知识点的问题"]
}`;

export function parsePlanSkeleton(text: string): {
  plan_title: string;
  stages: { title: string; estimated_days: number; key_topics: string[]; source_files: string[] }[];
} {
  const raw = extractJson(text);
  const parsed = z.object({
    plan_title: z.string().min(1),
    stages: z.array(z.object({
      title: z.string().min(1),
      estimated_days: z.number(),
      key_topics: z.array(z.string().min(1)).min(1),
      source_files: z.array(z.string()).optional(),
    })).min(1),
  }).safeParse(raw);
  if (!parsed.success) {
    throw new Error("模型没有返回可解析的计划骨架 JSON");
  }
  return {
    plan_title: parsed.data.plan_title,
    stages: parsed.data.stages.map((stage) => ({
      title: stage.title,
      estimated_days: Math.max(1, Math.round(stage.estimated_days) || 1),
      key_topics: stage.key_topics,
      source_files: stage.source_files || [],
    })),
  };
}

/** One stage's long fields. The caller retries when the guide is too short or ungrounded. */
export async function generateStageGuide(prompt: string): Promise<StageGuide> {
  const { text } = await generateText({
    model: getModel(),
    maxOutputTokens: 16384,
    prompt: `${prompt}\n\n只输出一个 JSON 对象，不要用 Markdown 代码块。summary_text 里不要出现三个反引号：\n${STAGE_GUIDE_SCHEMA}`,
  });
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (error) {
    console.error(
      "[stage-guide] JSON parse failed",
      `len=${text.length}`,
      `head=${text.slice(0, 120).replace(/\s+/g, " ")}`,
      `tail=${text.slice(-120).replace(/\s+/g, " ")}`,
      error,
    );
    throw new Error("阶段导读不是可解析的 JSON");
  }
  const parsed = stageGuideSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("阶段导读格式不正确");
  }
  return parsed.data;
}

export const PLAN_SCHEMA_DESC = `{
  "plan_title": "计划标题",
  "stages": [
    {
      "title": "阶段标题",
      "description": "阶段描述",
      "key_topics": ["知识点1", "知识点2"],
      "estimated_days": 7,
      "learning_objectives": ["目标1", "目标2"],
      "summary_text": "800字左右的学习导读",
      "core_output": "完成本阶段后你会做出什么，如'一个能运行的API调用demo'",
      "real_world_cases": ["案例1: 某公司如何用此技术解决X问题", "案例2: ..."],
      "assessment_questions": ["为什么X要这样设计？", "如果遇到Y情况你会怎么处理？", "请解释Z的工作原理"]
    }
  ]
}`;

function focusInstruction(focus?: string): string {
  const text = focus?.trim();
  if (!text) return "";
  return `\n## 学员补充提示\n${text.slice(0, 2000)}\n优先按这条提示决定先读哪里、阶段怎么拆。材料里没有的内容仍然不要编造。`;
}

export async function generatePlan(params: {
  goal: string;
  duration_weeks: number;
  daily_hours: number;
  skill_level: string;
  motivation?: string;
  background?: string;
  expected_outcome?: string;
  constraints?: string[];
  learning_mode?: string;
  career_identity?: string;
}): Promise<GeneratedPlan> {
  const levelMap: Record<string, string> = {
    beginner: "零基础入门",
    intermediate: "有一定基础",
    advanced: "有经验想进阶",
  };

  const contextBlock = [
    params.motivation ? `学习动机: ${params.motivation}` : "",
    params.background ? `当前背景: ${params.background}` : "",
    params.expected_outcome ? `期望成果: ${params.expected_outcome}` : "",
    params.learning_mode ? `学习模式: ${params.learning_mode}` : "",
    params.career_identity ? `职业定位: ${params.career_identity}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `你是一位全能学习规划师。你可以为任何领域制定学习计划（技术、投资、商业、语言、艺术、人文等）。

## 第一步：判断学习类型

根据学习目标，判断属于以下哪种类型，并采用对应的教学策略：

**类型A - 操作上手型**（如学编程、学做菜、学乐器、学设计）
→ 策略：先动手做出东西 → 遇到问题再学理论 → 边做边学
→ 第一阶段：让学习者直接上手完成一个最小可用的作品

**类型B - 知识链路型**（如行业研究、投资分析、历史研究、学科理论）
→ 策略：先建立全局地图 → 逐个维度深入 → 形成完整认知框架
→ 第一阶段：鸟瞰全局，理解这个领域的完整链路（起源 → 发展 → 现状 → 趋势）
→ 知识链路必须覆盖：历史演化、核心参与者、产业链/知识结构、经济/数据维度、竞争/对比分析、未来趋势

**类型C - 混合型**（如产品经理、数据分析、商务英语）
→ 策略：理论和实践交替进行

## 教学理念
- **连接现实**：所有知识都和真实场景挂钩，学习者随时感受到"我学的这个有什么用"
- **苏格拉底式引导**：通过提问激发思考，而不是灌输知识
- **以学习者的真实动机为中心**：围绕用户最终想达成的目标来规划

请根据以下信息生成一个详细的学习计划。

## 学习者画像
学习目标: ${params.goal}
计划周期: ${params.duration_weeks} 周
每日可用学习时间: ${params.daily_hours} 小时
当前水平: ${levelMap[params.skill_level] || params.skill_level}
${contextBlock}
${params.constraints?.length ? `额外要求: ${params.constraints.join("、")}` : ""}

## 核心要求
1. 首先判断学习类型（A/B/C），然后采用对应策略
2. 将学习计划拆分为 4-6 个阶段，每个阶段有明确的主题和目标
3. 阶段之间循序渐进，前一阶段是后一阶段的基础
4. 根据每日可用时间合理分配每个阶段的天数，总天数 = ${params.duration_weeks * 7} 天
5. 每个阶段的核心知识点（key_topics）列出 3-6 个
6. 每个阶段的学习目标（learning_objectives）列出 2-4 个可验证的目标
7. 每个阶段写一段 800 字左右的学习导读（summary_text），包含核心概念解释和推荐的学习顺序
8. 每个阶段的 core_output 描述完成后的具体产出物：
   - 操作型：做出了什么（如"一个能运行的demo"）
   - 知识型：产出了什么（如"一份存储行业产业链分析笔记"或"一张竞争格局地图"）
9. 每个阶段提供 1-2 个 real_world_cases（真实世界中的案例）
10. 每个阶段设计 3-5 个 assessment_questions（思考题），用来检验本阶段的学习成果:
    - 【极其重要】检测题必须且只能考察本阶段的 key_topics 内容，绝对不能提前考察后续阶段的知识点！
    - 检测题的核心逻辑：学生只学了本阶段内容就应该能答出来
    - 类型包含: 为什么（原理）、怎么做（分析/实操）、如果...会怎样（推理）
    - 问题要有深度，不能是简单的定义复述
    - 错误示例：阶段2讲"基础Prompt"，检测题却问"Chain-of-Thought"（这是阶段3的内容）
11. 如果学习者有明确的动机（如找工作、投资赚钱、考试），优先安排与该目标最相关的内容`;

  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject<GeneratedPlan>(prompt, PLAN_SCHEMA_DESC);
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: planSchema,
    prompt,
  });
  return object;
}

export function buildBookPlanPrompt(params: {
  book_content?: string;
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
  /** When true, the book is on disk and the agent must read it with tools. */
  read_with_tools?: boolean;
  /** When true, the reply is only the short plan skeleton. Guides are generated later. */
  skeleton_only?: boolean;
}): string {
  const levelMap: Record<string, string> = {
    beginner: "零基础入门",
    intermediate: "有一定基础",
    advanced: "有经验想进阶",
  };

  const contextBlock = [
    params.motivation ? `学习动机: ${params.motivation}` : "",
    params.background ? `当前背景: ${params.background}` : "",
    params.expected_outcome ? `期望成果: ${params.expected_outcome}` : "",
    params.learning_mode ? `学习模式: ${params.learning_mode}` : "",
    params.career_identity ? `职业定位: ${params.career_identity}` : "",
  ].filter(Boolean).join("\n");

  const bookBody = params.book_content || "";
  const bookContentTruncated = params.read_with_tools
    ? "正文没有预先塞进提示词。当前目录里的 book.txt 就是这本书的全文。制定计划前必须用 read_file 和 grep 分段阅读，禁止只凭书名编造章节。"
    : bookBody.length > 50000
      ? bookBody.slice(0, 50000) + "\n\n[... 内容过长已截断 ...]"
      : bookBody;

  const prompt = `你是一位学习规划师。用户上传了一本书，请你基于这本书的实际内容，制定一个阶段化的学习计划。

## 书籍信息
${params.book_title ? `书名: ${params.book_title}` : ""}

### 书籍内容
${bookContentTruncated}

## 学习者画像
计划周期: ${params.duration_weeks} 周
每日可用学习时间: ${params.daily_hours} 小时
当前水平: ${levelMap[params.skill_level] || params.skill_level}
${contextBlock}
${focusInstruction(params.focus)}

## 核心要求
1. **基于书的实际内容来规划**：阶段划分必须对应书中的实际章节/内容，不要凭空添加书中没有的内容
2. 将整本书拆分为 4-6 个学习阶段，每个阶段覆盖书中的某几个章节或主题
3. 阶段之间循序渐进，按照书的逻辑顺序安排
4. 根据每日可用时间合理分配每个阶段的天数，总天数 = ${params.duration_weeks * 7} 天
5. 每个阶段的核心知识点（key_topics）必须来自书中实际讲述的概念，列出 3-6 个
6. 每个阶段的学习目标（learning_objectives）列出 2-4 个可验证的目标
7. 每个阶段写一段 800 字左右的学习导读（summary_text）：
   - 必须基于书中的实际内容来写，用你自己的语言解读书中的核心观点
   - 包含这部分内容的核心概念、逻辑关系、和学习要点
   - 帮助学习者在阅读前建立框架，阅读后加深理解
8. 每个阶段的 core_output 描述学完后的具体产出（如"用自己的话总结XX理论并给出一个应用案例"）
9. 每个阶段提供 1-2 个 real_world_cases（书中提到的案例 或 基于书的内容联想的现实案例）
10. 每个阶段设计 3 个 assessment_questions（思考题）：
    - 题目必须基于书中这部分内容来出，学完对应章节就能回答
    - 类型：一道"为什么"（理解作者的论点），一道"怎么用"（应用层面），一道"如果…会怎样"（延伸思考）
    - 不能出超出对应阶段书本内容的题`;

  if (!params.skeleton_only) return prompt;
  return `${prompt}

## 这次只输出计划骨架
上面关于 800 字导读、学习目标、案例和思考题的要求不要写进这次回复。那些内容会按阶段另一次生成。
最终只输出这个 JSON：
${PLAN_SKELETON_SCHEMA}
- 4-6 个阶段，总天数 = ${params.duration_weeks * 7}
- key_topics 必须是你在 book.txt 里读到的原概念，每阶段 3-6 个
- source_files 填 ["book.txt"]
- 不要写 summary_text`;
}

export async function generatePlanFromBook(params: {
  book_content: string;
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
}): Promise<GeneratedPlan> {
  const prompt = buildBookPlanPrompt(params);
  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject<GeneratedPlan>(prompt, PLAN_SCHEMA_DESC);
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: planSchema,
    prompt,
  });
  return object;
}

export function buildCodePlanPrompt(params: {
  code_content?: string;
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
  /** When true, the repo is on disk and the agent must read it with tools. */
  read_with_tools?: boolean;
  /** When true, the reply is only the short plan skeleton. Guides are generated later. */
  skeleton_only?: boolean;
}): string {
  const levelMap: Record<string, string> = {
    beginner: "零基础入门",
    intermediate: "有一定基础",
    advanced: "有经验想进阶",
  };

  const mode = params.learning_mode || "business_through_tech";
  const career = params.career_identity || "";
  const isExperienced =
    career === "senior" ||
    career === "staff" ||
    params.skill_level === "advanced" ||
    params.skill_level === "intermediate";

  const modeLabelMap: Record<string, string> = {
    business: "业务优先",
    technical: "技术优先",
    business_through_tech: "业务穿透技术",
  };
  const careerLabelMap: Record<string, string> = {
    junior: "初级工程师",
    senior: "高级工程师",
    staff: "资深/Staff 工程师",
  };

  const contextBlock = [
    params.motivation ? `学习动机: ${params.motivation}` : "",
    params.background ? `当前背景: ${params.background}` : "",
    params.expected_outcome ? `期望成果: ${params.expected_outcome}` : "",
    `学习模式: ${modeLabelMap[mode] || mode}`,
    career ? `职业定位: ${careerLabelMap[career] || career}` : "",
  ].filter(Boolean).join("\n");

  const codeBody = params.code_content || "";
  const codeContentTruncated = params.read_with_tools
    ? "源码没有预先塞进提示词。当前目录就是这个仓库。制定计划前必须用 list_dir、read_file、grep 阅读真实文件。禁止只凭文件名或目录名编造类、函数或框架能力。"
    : codeBody.length > 80000
      ? codeBody.slice(0, 80000) + "\n\n[... 代码内容过长已截断 ...]"
      : codeBody;

  const pathStrategy = (() => {
    if (mode === "business" || mode === "business_through_tech") {
      if (isExperienced) {
        return `学习路径必须按「业务接口优先」编排（禁止把第一阶段做成 main/启动琐事）：
   - 阶段1：对外接口与路由盘点（HTTP/gRPC/Handler/Controller：有哪些业务能力、路径如何映射到方法）
   - 阶段2：选 1-2 个核心业务场景，沿 Handler → Service → Repo/依赖 完整走通
   - 阶段3：关键模块实现与数据模型/表设计（仅当代码中真实存在）
   - 阶段4：并发/异步/边界与可观测性（按代码实际有的再写）
   - 阶段5：设计取舍、可改进点与面试深挖
   第一阶段标题/导读必须围绕「接口清单、路由表、Handler 职责」，不要以「认识 main 函数」为主题。
   main/cmd 启动链最多作为接口阶段的附录，不可成为第一阶段主线。`;
      }
      return `学习路径按「业务场景 → 代码落点」编排：
   - 先识别对外接口与核心业务 Handler
   - 再沿一条请求链路走完
   - 然后看存储/依赖与边界情况
   - 最后做设计取舍与面试深挖
   可以简要提及启动入口，但不要把「读懂 main」当成第一阶段核心目标。`;
    }
    if (isExperienced) {
      return `学习路径按「架构与关键链路」编排：
   - 服务边界与模块职责（含入口，但跳过保姆式解释）
   - 核心请求/数据流
   - 关键实现与权衡
   - 并发/可观测性
   - 改进与面试深挖`;
    }
    return `学习路径可以包含：
   - 入口与启动链路
   - 核心数据流/请求链路
   - 关键模块实现
   - 并发/边界与可观测性
   - 可改进点与面试深挖`;
  })();

  const difficultyRules = isExperienced
    ? `难度与提问口径（学习者已有基础/高级）：
- 禁止初级盘问：不要问「main 里第一个调用的是什么函数」「端口从哪里读」这类语法级问题
- 第一阶段就要做接口分析：列出关键路由/RPC、对应 Handler、输入输出与业务含义
- assessment_questions 考察：接口设计、调用链权衡、改需求动哪里、边界失败怎么处理`
    : `难度与提问口径（学习者偏入门）：
- 可从更具体的文件/函数切入，但仍要落到业务含义
- 避免只背概念，必须指到真实代码`;

  const prompt = `你是一位资深技术导师和代码教练。用户提供了一个真实代码仓库，请制定「对着源码学」的阶段计划。
注意：你不是在带零基础新人认识语法；必须严格服从学习者画像与学习模式。

## 项目信息
项目名称: ${params.project_name}

### 项目文件结构
${params.file_tree}

### 代码内容
${codeContentTruncated}

## 学习者画像
计划周期: ${params.duration_weeks} 周
每日可用学习时间: ${params.daily_hours} 小时
当前水平: ${levelMap[params.skill_level] || params.skill_level}
${contextBlock}
${focusInstruction(params.focus)}

## 核心要求（必须严格执行）
1. **只讲仓库里真实存在的代码**：阶段划分必须对应实际目录/模块/入口文件，禁止编造不存在的类、接口或框架能力
2. ${pathStrategy}
3. ${difficultyRules}
4. 每个阶段的 key_topics 必须能在代码中找到落点（技术名 + 对应模块）
5. 每个阶段 learning_objectives 写 2-4 个「能指着代码说明」的目标；业务×技术模式下目标要同时包含业务能力与代码落点
6. summary_text（约 800 字）必须包含固定小节：
   - 【精读文件】列出本阶段要打开的 3-8 个具体相对路径（业务×技术/高级时优先 Handler、router、service，而不是只列 main）
   - 【调用链路】用「文件A.函数X → 文件B.函数Y」描述主路径
   - 【设计取舍】指出至少 1 个真实设计决策及其利弊
   - 【动手检查】给 1 个小实验（改一处/打日志/画图/补接口说明）
7. core_output 必须是可验证产物（如「整理本服务对外接口清单并标注 Handler」或「画出某业务从接口到存储的序列图」）
8. assessment_questions 必须是代码题：定位某文件函数、解释分支、改需求你会动哪里；禁止空泛概念题
9. 总天数 = ${params.duration_weeks * 7} 天，按每日 ${params.daily_hours} 小时分配 estimated_days
10. 标题要具体到模块/业务能力，避免「基础入门」「进阶提升」这类空标题`;

  if (!params.skeleton_only) return prompt;
  return `${prompt}

## 这次只输出计划骨架
上面关于 800 字导读、学习目标、产出、案例和检测题的要求不要写进这次回复。那些内容会按阶段另一次生成，并且会重新打开 source_files 里的源码。
最终只输出这个 JSON：
${PLAN_SKELETON_SCHEMA}
- 阶段数量和顺序仍按上面的学习路径，总天数 = ${params.duration_weeks * 7}
- 每个阶段 key_topics 3-6 个，必须能落到你读过的文件
- source_files 只能填这次 read_file 成功打开过的相对路径，3-8 个，禁止填没打开的文件
- 标题具体到模块或业务能力，不要用「基础入门」`;
}

export async function generatePlanFromCode(params: {
  code_content: string;
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
}): Promise<GeneratedPlan> {
  const prompt = buildCodePlanPrompt(params);
  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject<GeneratedPlan>(prompt, PLAN_SCHEMA_DESC);
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: planSchema,
    prompt,
  });
  return object;
}

const perQuestionResultSchema = z.object({
  question_index: z.number(),
  question_text: z.string(),
  is_correct: z.boolean(),
  score: z.number().min(0).max(100),
  feedback: z.string().describe("针对这道题的反馈"),
});

const suggestionSchema = z.object({
  title: z.string().describe("资料标题"),
  url: z.string().describe("可访问的链接URL"),
  description: z.string().describe("简短推荐理由"),
});

const assessmentSchema = z.object({
  score_overall: z.number().min(0).max(100),
  score_coverage: z.number().min(0).max(100).describe("知识覆盖度"),
  score_depth: z.number().min(0).max(100).describe("理解深度"),
  score_accuracy: z.number().min(0).max(100).describe("表达准确性"),
  passed: z.boolean(),
  missing_topics: z.array(z.string()).describe("未覆盖或理解不足的知识点"),
  feedback: z.string().describe("总体反馈，说明优点和不足，但不直接给出答案"),
  suggestions: z.array(suggestionSchema).describe("推荐的学习资料，必须包含可访问的URL"),
  per_question_results: z.array(perQuestionResultSchema).describe("每道题的独立评分和反馈"),
});

export type AssessmentResult = z.infer<typeof assessmentSchema>;

const ASSESS_SCHEMA_DESC = `{
  "score_overall": 75,
  "score_coverage": 80,
  "score_depth": 70,
  "score_accuracy": 75,
  "passed": true,
  "missing_topics": ["未覆盖的知识点"],
  "feedback": "总体评估反馈",
  "suggestions": [
    { "title": "资料标题", "url": "https://example.com/article", "description": "推荐理由" }
  ],
  "per_question_results": [
    { "question_index": 0, "question_text": "题目文本", "is_correct": true, "score": 85, "feedback": "回答准确，但可以补充..." }
  ]
}`;

export interface AssessmentQuestionInput {
  type: "choice" | "fill" | "true_false" | "short_answer";
  question: string;
  options?: string[];
  correct_answer?: string;
  user_answer: string;
}

export async function assessLearning(params: {
  stage_title: string;
  key_topics: string[];
  learning_objectives: string[];
  user_input: string;
  questions?: string[];
  structured_questions?: AssessmentQuestionInput[];
  answers?: { question: string; answer: string }[];
  model?: LanguageModel;
  structuredFallbackProvider?: string;
}): Promise<AssessmentResult> {
  let answerBlock: string;

  if (params.structured_questions?.length) {
    answerBlock = params.structured_questions.map((q, i) => {
      let typeLabel = "简答题";
      if (q.type === "choice") typeLabel = "选择题";
      else if (q.type === "fill") typeLabel = "填空题";
      else if (q.type === "true_false") typeLabel = "判断题";

      let block = `问题${i + 1} [${typeLabel}]: ${q.question}`;
      if (q.type === "choice" && q.options?.length) {
        block += `\n选项: ${q.options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join(" | ")}`;
      }
      if (q.correct_answer) {
        block += `\n标准答案: ${q.correct_answer}`;
      }
      block += `\n学生回答: ${q.user_answer}`;
      return block;
    }).join("\n\n");
  } else if (params.answers?.length) {
    answerBlock = params.answers.map((a, i) => `问题${i + 1}: ${a.question}\n回答: ${a.answer}`).join("\n\n");
  } else {
    answerBlock = params.user_input;
  }

  const prompt = `你是一位严格但公正的学习评估专家。请评估以下学习者的阶段性学习成果。

## 阶段信息
- 阶段名称: ${params.stage_title}
- 核心知识点: ${params.key_topics.join("、")}
- 学习目标: ${params.learning_objectives.join("；")}

## 学习者的回答
${answerBlock}

## 评估要求
1. **逐题评估**（per_question_results）:
   - 为每一道题给出独立的评分（0-100）和反馈
   - 选择题/填空题/判断题: 对比标准答案判对错，is_correct 直接判定，正确得100分，错误得0分
   - 简答题: 根据内容质量打分（0-100），is_correct 在 score ≥ 60 时为 true
   - 每题的 feedback 要具体指出这道题答得好/不好在哪里
2. **总体三维评分**（0-100）:
   - 知识覆盖度（score_coverage）: 是否涵盖了核心知识点
   - 理解深度（score_depth）: 是否真正理解而非表面复述
   - 表达准确性（score_accuracy）: 术语使用是否准确
3. 综合评分 = 覆盖度 × 0.4 + 深度 × 0.35 + 准确性 × 0.25
4. 通过标准: 综合分 ≥ 70 且覆盖度 ≥ 80%
5. 如果发现学习者直接复制粘贴资料原文，降低深度分
6. feedback 是总体反馈，说明整体不足之处，但【绝对不要直接给出答案】
7. suggestions 中推荐具体的学习资料，每条必须包含:
   - title: 资料标题（如论文名/文章名/文档名）
   - url: 真实可访问的链接URL（如 https://python.langchain.com/docs/... 或 https://arxiv.org/abs/...）
   - description: 推荐理由（一句话）
8. missing_topics 列出未覆盖或理解不足的知识点`;

  if (useStructuredTextFallback(params.structuredFallbackProvider)) {
    return deepSeekGenerateObject<AssessmentResult>(prompt, ASSESS_SCHEMA_DESC, params.model ?? getModel());
  }

  const model = params.model ?? getModel();
  const { object } = await generateObject({
    model,
    schema: assessmentSchema,
    prompt,
  });
  return object;
}

const RESOURCE_SCHEMA_DESC = `{
  "resources": [
    {
      "title": "资源标题",
      "url": "https://example.com",
      "source": "来源网站",
      "type": "article",
      "reason": "推荐理由（100字内）",
      "estimated_minutes": 30,
      "region_tag": "domestic"
    }
  ]
}
type 可选值: article, video, doc, book, repo, paper
region_tag 可选值: domestic, overseas`;

export async function generateResources(params: {
  stage_title: string;
  key_topics: string[];
  goal: string;
  skill_level: string;
}) {
  const resourceSchema = z.object({
    resources: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        source: z.string(),
        type: z.enum(["article", "video", "doc", "book", "repo", "paper"]),
        reason: z.string().max(100),
        estimated_minutes: z.number(),
        region_tag: z.enum(["domestic", "overseas"]),
      })
    ),
  });

  const prompt = `你是一位学习资源推荐专家。请为以下学习阶段推荐 5-8 条最权威的学习资源。

## 阶段信息
- 学习目标: ${params.goal}
- 阶段: ${params.stage_title}
- 核心知识点: ${params.key_topics.join("、")}
- 学习者水平: ${params.skill_level}

## 推荐要求
1. 覆盖国内和国外资源，标注 region_tag
2. 资源类型多样：至少包含文章、视频中的 2 种
3. **实操类资源优先**：优先推荐可以动手练习的教程和案例
4. 根据学习领域推荐对应的权威来源（如技术领域推荐官方文档和GitHub，投资领域推荐研报和数据平台，语言学习推荐课程和练习平台等）
5. URL 必须是真实可访问的链接
6. 每条资源给出推荐理由（≤100字）和预估学习时长
7. 国内资源标记为 domestic，国外资源标记为 overseas`;

  if (useStructuredTextFallback()) {
    const result = await deepSeekGenerateObject<{ resources: z.infer<typeof resourceSchema>["resources"] }>(prompt, RESOURCE_SCHEMA_DESC);
    return result.resources;
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: resourceSchema,
    prompt,
  });
  return object.resources;
}

// ==================== Knowledge Concept Extraction ====================

const CONCEPT_SCHEMA_DESC = `{
  "concepts": [
    {
      "name": "概念名称",
      "definition": "简短定义（1-2句话）",
      "stage_index": 0
    }
  ],
  "relations": [
    {
      "from": "概念A名称",
      "to": "概念B名称",
      "type": "prerequisite"
    }
  ]
}
type 可选值: prerequisite（前置依赖）, contains（包含）, related（相关）, applied_in（应用于）`;

export async function extractConcepts(params: {
  plan_title: string;
  stages: { title: string; key_topics: string[]; learning_objectives: string[]; order_index: number }[];
}): Promise<{
  concepts: { name: string; definition: string; stage_index: number }[];
  relations: { from: string; to: string; type: string }[];
}> {
  const stageInfo = params.stages.map(s =>
    `阶段${s.order_index + 1}: ${s.title}\n  知识点: ${s.key_topics.join("、")}\n  目标: ${s.learning_objectives.join("；")}`
  ).join("\n\n");

  const prompt = `你是一位知识架构师。请从以下学习计划中提取核心概念节点和概念间关系，用于构建知识图谱。

## 学习计划: ${params.plan_title}

${stageInfo}

## 要求
1. 从每个阶段的知识点和学习目标中提取 3-8 个核心概念
2. 去重：如果同一概念在多个阶段出现，只保留一次，stage_index 设为最早出现的阶段
3. 每个概念给出简短定义（1-2句话），让学习者快速理解
4. 识别概念间的关系：
   - prerequisite: A 是学习 B 的前置条件
   - contains: A 包含 B
   - related: A 和 B 相关但无前后依赖
   - applied_in: A 被应用在 B 中
5. 关系要有实际意义，不要为了凑数
6. 概念名称保持简洁（2-6个字）`;

  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject(prompt, CONCEPT_SCHEMA_DESC);
  }

  const conceptSchema = z.object({
    concepts: z.array(z.object({
      name: z.string(),
      definition: z.string(),
      stage_index: z.number(),
    })),
    relations: z.array(z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum(["prerequisite", "contains", "related", "applied_in"]),
    })),
  });

  const model = getModel();
  const { object } = await generateObject({ model, schema: conceptSchema, prompt });
  return object;
}

// ==================== Mastery Level Analysis ====================

const MASTERY_SCHEMA_DESC = `{
  "overall_level": "on_track",
  "weak_topics": ["薄弱知识点1", "薄弱知识点2"],
  "analysis": "一段简短分析",
  "recommended_actions": ["建议1", "建议2"]
}
overall_level 可选值: struggling（困难）, on_track（正常）, advanced（优秀）`;

export interface GeneratedQuestion {
  type: "choice" | "fill" | "true_false" | "short_answer";
  question: string;
  options?: string[];
  correct_answer?: string;
}

const generatedQuestionSchema = z.object({
  type: z.enum(["choice", "fill", "true_false", "short_answer"]),
  question: z.string(),
  options: z.array(z.string()).optional().describe("选择题的4个选项"),
  correct_answer: z.string().optional().describe("选择题/填空题/判断题的标准答案。选择题填选项内容，判断题填'对'或'错'"),
});

const QUESTION_SCHEMA_DESC = `[
  {
    "type": "choice",
    "question": "以下哪个是...",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "correct_answer": "选项A"
  },
  {
    "type": "true_false",
    "question": "XXX是否正确？",
    "correct_answer": "对"
  },
  {
    "type": "fill",
    "question": "在LangChain中，用于管理提示词模板的类叫___",
    "correct_answer": "PromptTemplate"
  },
  {
    "type": "short_answer",
    "question": "请解释XXX的工作原理"
  }
]`;

export async function regenerateAssessmentQuestions(params: {
  stage_title: string;
  key_topics: string[];
  learning_objectives: string[];
  stage_description: string;
  summary_text?: string;
  chat_history?: { role: string; content: string }[];
}): Promise<GeneratedQuestion[]> {
  const hasChatHistory = params.chat_history && params.chat_history.length > 0;

  let contentBlock: string;
  if (hasChatHistory) {
    const chatSnippet = params.chat_history!
      .filter(m => m.content !== "开始学习")
      .slice(-30)
      .map(m => `${m.role === "user" ? "学生" : "AI导师"}: ${m.content}`)
      .join("\n\n");
    contentBlock = `\n## 学生的实际学习对话记录（出题的主要依据）\n${chatSnippet}\n`;
    if (params.summary_text) {
      contentBlock += `\n## 本阶段学习导读（辅助参考）\n${params.summary_text}\n`;
    }
  } else {
    contentBlock = params.summary_text
      ? `\n## 本阶段学习导读内容（学生实际学习的材料）\n${params.summary_text}\n`
      : "";
  }

  const prompt = `你是一位学习评估设计专家。请为以下学习阶段设计 4 道检测题，要求**题型多样化**。

## 阶段信息
- 阶段名称: ${params.stage_title}
- 阶段描述: ${params.stage_description}
- 核心知识点: ${params.key_topics.join("、")}
- 学习目标: ${params.learning_objectives.join("；")}
${contentBlock}
## 出题规则（必须严格遵守）

### 内容来源规则
${hasChatHistory
    ? `1. 【最重要】题目必须基于"学生的实际学习对话记录"中讨论过的内容出题
2. 优先考察对话中AI导师讲解过的核心概念、学生回答过的问题、讨论过的案例
3. 不能出对话中完全没涉及过的知识点
4. 对话中学生理解薄弱的地方，可以适当加强考察`
    : `1. 【最重要】题目的考察范围必须严格匹配学习导读中实际教授的内容
2. 绝对不能出学生仅凭导读答不出来的题
3. 禁止出需要额外查资料才能回答的题`}

### 题型要求（4题混合出题）
- 必须包含 1 道**选择题**（choice）: 4个选项，有且只有1个正确答案
- 必须包含 1 道**判断题**（true_false）: correct_answer 填"对"或"错"
- 必须包含 1 道**填空题**（fill）: 题目中用___标记空白处，correct_answer 填答案
- 必须包含 1 道**简答题**（short_answer）: 开放性问题，不需要 correct_answer

### 难度控制
- 选择题/判断题/填空题: 考察知识点记忆和基本理解
- 简答题: 考察深层理解和应用能力
- 所有题目不超纲：学完本阶段内容就应该能答出来`;

  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject<GeneratedQuestion[]>(prompt, QUESTION_SCHEMA_DESC);
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: z.array(generatedQuestionSchema),
    prompt,
  });
  return object as GeneratedQuestion[];
}

export async function analyzeMastery(params: {
  stage_title: string;
  key_topics: string[];
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  missing_topics: string[];
  attempt_number: number;
  previous_levels?: string[];
}): Promise<{
  overall_level: string;
  weak_topics: string[];
  analysis: string;
  recommended_actions: string[];
}> {
  const prompt = `你是一位学习诊断专家。根据以下评估数据判断学习者的掌握水平。

## 评估结果
- 阶段: ${params.stage_title}
- 知识点: ${params.key_topics.join("、")}
- 综合分: ${params.score_overall}
- 覆盖度: ${params.score_coverage}
- 深度: ${params.score_depth}
- 未掌握知识点: ${params.missing_topics.join("、") || "无"}
- 第 ${params.attempt_number} 次尝试
${params.previous_levels?.length ? `- 历史表现: ${params.previous_levels.join(" → ")}` : ""}

## 判断标准
- struggling: 综合分 < 60，或覆盖度 < 50%，或多次尝试仍不通过
- on_track: 综合分 60-85，覆盖度 ≥ 80%
- advanced: 综合分 > 85，覆盖度和深度都 ≥ 85%

## 输出
1. overall_level: 掌握水平
2. weak_topics: 需要重点补强的知识点
3. analysis: 简短分析（2-3句话）
4. recommended_actions: 2-3个具体建议`;

  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject(prompt, MASTERY_SCHEMA_DESC);
  }

  const masterySchema = z.object({
    overall_level: z.enum(["struggling", "on_track", "advanced"]),
    weak_topics: z.array(z.string()),
    analysis: z.string(),
    recommended_actions: z.array(z.string()),
  });

  const model = getModel();
  const { object } = await generateObject({ model, schema: masterySchema, prompt });
  return object;
}

// ==================== Stage Project Generation ====================

const PROJECT_SCHEMA_DESC = `{
  "title": "项目标题",
  "description": "项目描述（100-200字）",
  "expected_output": "预期产出物描述",
  "checklist": [
    { "item": "步骤1描述", "completed": false },
    { "item": "步骤2描述", "completed": false }
  ],
  "difficulty": "medium",
  "estimated_minutes": 60
}
difficulty 可选值: easy, medium, hard`;

export async function generateStageProject(params: {
  stage_title: string;
  key_topics: string[];
  core_output: string;
  real_world_cases: string[];
  goal: string;
  skill_level: string;
}): Promise<{
  title: string;
  description: string;
  expected_output: string;
  checklist: { item: string; completed: boolean }[];
  difficulty: string;
  estimated_minutes: number;
}> {
  const prompt = `你是一位实战教练。请为以下学习阶段设计一个可动手完成的实战小项目。

## 阶段信息
- 阶段: ${params.stage_title}
- 知识点: ${params.key_topics.join("、")}
- 阶段产出: ${params.core_output}
- 真实案例: ${params.real_world_cases.join("；")}
- 总学习目标: ${params.goal}
- 学习者水平: ${params.skill_level}

## 设计原则
1. 项目必须可以在 30-120 分钟内完成
2. 项目产出物是具体可见的（代码、文档、分析报告、设计稿等，根据学科类型决定）
3. checklist 拆分为 4-8 个步骤，每步可独立完成和验证
4. 与真实场景挂钩，学完后能直接用于实际工作/生活
5. 难度匹配学习者水平：
   - beginner: 按步骤走就能完成
   - intermediate: 需要一定思考和查资料
   - advanced: 需要综合多个知识点解决问题`;

  if (useStructuredTextFallback()) {
    return deepSeekGenerateObject(prompt, PROJECT_SCHEMA_DESC);
  }

  const projectSchema = z.object({
    title: z.string(),
    description: z.string(),
    expected_output: z.string(),
    checklist: z.array(z.object({ item: z.string(), completed: z.boolean() })),
    difficulty: z.enum(["easy", "medium", "hard"]),
    estimated_minutes: z.number(),
  });

  const model = getModel();
  const { object } = await generateObject({ model, schema: projectSchema, prompt });
  return object;
}

// ==================== Resume Generation ====================

export async function generateResumeBullets(params: {
  plan_title: string;
  goal: string;
  stages_completed: number;
  total_stages: number;
  study_hours: number;
  key_skills: string[];
  projects: { title: string; output: string }[];
  motivation?: string;
}): Promise<string> {
  const projectInfo = params.projects.length > 0
    ? params.projects.map(p => `- ${p.title}: ${p.output}`).join("\n")
    : "暂无已完成项目";

  const prompt = `你是一位简历优化专家。请根据以下学习经历生成适合简历的描述。

## 学习经历
- 学习主题: ${params.plan_title}
- 目标: ${params.goal}
- 完成进度: ${params.stages_completed}/${params.total_stages} 阶段
- 累计学习: ${params.study_hours} 小时
- 核心技能: ${params.key_skills.join("、")}
${params.motivation ? `- 学习动机: ${params.motivation}` : ""}

## 项目成果
${projectInfo}

## 要求
1. 生成 2-3 段 STAR 格式的简历描述（中文）
2. 强调实际产出和技能掌握
3. 用量化数据（时长、阶段数、项目数）增强说服力
4. 如果是非职业类学习（兴趣、个人成长），改为个人成长描述风格
5. 直接输出纯文本，不要 JSON 包装`;

  const model = getModel();
  const { text } = await generateText({ model, prompt });
  return text;
}

export interface StructuredSummary {
  core_concepts: { name: string; explanation: string; mastery: "solid" | "partial" | "weak" }[];
  key_takeaways: string[];
  open_questions: string[];
  next_actions: string[];
  one_line_summary: string;
}

const structuredSummarySchema = z.object({
  core_concepts: z.array(z.object({
    name: z.string().describe("概念名称，2-6个字"),
    explanation: z.string().describe("一句话解释"),
    mastery: z.enum(["solid", "partial", "weak"]).describe("学生对该概念的掌握程度"),
  })),
  key_takeaways: z.array(z.string()).describe("关键收获，3-5条"),
  open_questions: z.array(z.string()).describe("待深入的问题，1-3条"),
  next_actions: z.array(z.string()).describe("下一步行动建议，2-3条"),
  one_line_summary: z.string().describe("一句话总结本阶段学习成果"),
});

const STRUCTURED_SUMMARY_SCHEMA_DESC = `{
  "core_concepts": [
    { "name": "概念名", "explanation": "一句话解释", "mastery": "solid" }
  ],
  "key_takeaways": ["收获1", "收获2"],
  "open_questions": ["待深入问题1"],
  "next_actions": ["行动1", "行动2"],
  "one_line_summary": "一句话总结"
}
mastery 可选值: solid（掌握扎实）, partial（部分理解）, weak（需加强）`;

export async function generateStageSummary(params: {
  stage_title: string;
  key_topics: string[];
  learning_objectives: string[];
  chat_history: { role: string; content: string }[];
  user_notes?: string;
}): Promise<string> {
  const chatSnippet = params.chat_history
    .filter((m) => m.content !== "开始学习")
    .slice(-24)
    .map((m) => `${m.role === "user" ? "学员" : "AI"}: ${m.content}`)
    .join("\n\n");

  const prompt = `你是一位学习笔记助手。请根据以下阶段学习内容，生成一份结构化的阶段学习总结。

## 阶段: ${params.stage_title}
## 知识点: ${params.key_topics.join("、")}
## 学习目标: ${params.learning_objectives.join("；")}

## 对话记录摘录
${chatSnippet || "（暂无对话）"}

${params.user_notes ? `## 学员已有笔记\n${params.user_notes}` : ""}

## 要求
1. core_concepts: 从对话中提取 3-6 个核心概念，每个包含名称、一句话解释、和学生掌握程度
   - solid: 学生在对话中展示了正确理解
   - partial: 学生有基本概念但不够深入
   - weak: 学生理解有偏差或对话中没怎么涉及
2. key_takeaways: 3-5 条关键收获（从对话中学到的最重要的东西）
3. open_questions: 1-3 个待深入的问题（对话中没完全解决的、或学生表现出困惑的）
4. next_actions: 2-3 条下一步行动建议
5. one_line_summary: 一句话概括本阶段学习成果
6. 必须基于实际对话内容，不要编造`;

  if (useStructuredTextFallback()) {
    const result = await deepSeekGenerateObject<StructuredSummary>(prompt, STRUCTURED_SUMMARY_SCHEMA_DESC);
    return JSON.stringify(result);
  }

  const model = getModel();
  const { object } = await generateObject({
    model,
    schema: structuredSummarySchema,
    prompt,
  });
  return JSON.stringify(object);
}
