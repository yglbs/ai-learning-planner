import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getStage, type ReviewSchedule } from "@/db/queries";
import { getDb } from "@/db/schema";
import { getModel } from "@/lib/llm";

interface ReviewQuestion {
  question: string;
  type: "choice" | "fill" | "short_answer";
  options?: string[];
  answer: string;
}

function extractJsonArray(text: string): ReviewQuestion[] {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : text.trim();
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed : parsed.questions ?? [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const schedule = db
      .prepare("SELECT * FROM review_schedule WHERE id = ?")
      .get(id) as ReviewSchedule | undefined;

    if (!schedule) {
      return NextResponse.json({ error: "Review schedule not found" }, { status: 404 });
    }

    const stage = getStage(schedule.stage_id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const prompt = `你是一位学习复习出题专家。请根据以下阶段内容生成 ${schedule.review_kind === "post_stage" ? "5-7" : "3-5"} 道复习题。

## 阶段信息
- 阶段名称: ${stage.title}
- 核心知识点: ${stage.key_topics.join("、")}
- 学习目标: ${(stage.learning_objectives || []).join("；")}

## 出题要求
${schedule.review_kind === "post_stage"
  ? `1. 这是阶段刚结束后的即时巩固复习，题目要覆盖本阶段核心知识点
2. 生成 5-7 道题，题型多样化：choice（选择题）、fill（填空题）、short_answer（简答题）
3. 至少包含 2 道简答题，考察「为什么」和「怎么做」
4. 选择题需提供 4 个选项（options 数组）
5. 每道题必须包含标准答案（answer 字段）
6. 难度略高于间隔复习，要求能讲清楚原理而不是只记名词`
  : `1. 生成 3-5 道题，覆盖核心知识点
2. 题型多样化，包含 choice（选择题）、fill（填空题）、short_answer（简答题）
3. 选择题需提供 4 个选项（options 数组）
4. 每道题必须包含标准答案（answer 字段）
5. 题目难度适中，用于间隔复习巩固记忆`}

请严格以 JSON 数组格式输出，不要输出其他内容：
[
  {
    "question": "题目内容",
    "type": "choice",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "answer": "正确答案"
  }
]`;

    const model = getModel();
    const { text } = await generateText({ model, prompt });
    const questions = extractJsonArray(text);

    return NextResponse.json({ questions });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
