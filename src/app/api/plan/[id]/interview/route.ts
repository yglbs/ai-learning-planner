import { NextResponse } from "next/server";
import { getPlan, getStagesByPlan, deleteInterviewSessionByKey } from "@/db/queries";
import { getDb } from "@/db/schema";
import {
  getPlanInterviewChatId,
  getInterviewHistory,
  handlePlanInterviewPost,
} from "@/lib/interview-handler";
import type { LearningMode } from "@/lib/learning-types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: planId } = await params;
    const style = new URL(request.url).searchParams.get("style") || "standard";
    const stageId = getPlanInterviewChatId(planId, style);
    const history = getInterviewHistory(stageId);
    return NextResponse.json(history);
  } catch (e) {
    console.error("[plan/interview] GET failed:", e);
    return NextResponse.json({ error: "获取面试记录失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: planId } = await params;

  try {
    const plan = getPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    let body: {
      message?: string;
      style?: string;
      countdown_enabled?: boolean;
      countdown_seconds?: number;
      elapsed_seconds?: number;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const style = body.style || "standard";
    const chatId = getPlanInterviewChatId(planId, style);

    const stages = getStagesByPlan(planId);
    const stagesSummary = stages
      .map(
        (s) =>
          `阶段${s.order_index + 1}: ${s.title}\n  知识点: ${s.key_topics.join("、")}\n  描述: ${s.description}`
      )
      .join("\n\n");

    const result = await handlePlanInterviewPost({
      plan,
      stagesSummary,
      body,
      learningMode: plan.learning_mode as LearningMode,
      legacyChatId: chatId,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[plan/interview] POST failed:", e);
    return NextResponse.json({ error: (e as Error).message || "面试失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: planId } = await params;
    const style = new URL(request.url).searchParams.get("style") || "standard";
    const chatId = getPlanInterviewChatId(planId, style);

    deleteInterviewSessionByKey(chatId);

    const db = getDb();
    db.prepare("DELETE FROM teaching_chat WHERE stage_id = ?").run(chatId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[plan/interview] DELETE failed:", e);
    return NextResponse.json({ error: "删除面试记录失败" }, { status: 500 });
  }
}
