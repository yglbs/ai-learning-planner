import { NextResponse } from "next/server";
import { getStage, getPlan, deleteInterviewSessionByKey } from "@/db/queries";
import { getDb } from "@/db/schema";
import {
  getStageInterviewChatId,
  getInterviewHistory,
  handleStageInterviewPost,
} from "@/lib/interview-handler";
import { buildSourceBundle, parseStoredOutline } from "@/lib/teach-chat-handler";
import type { LearningMode } from "@/lib/learning-types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stageId } = await params;
    const style = new URL(request.url).searchParams.get("style") || "standard";
    const chatId = getStageInterviewChatId(stageId, style);
    const history = getInterviewHistory(chatId);
    return NextResponse.json(history);
  } catch (e) {
    console.error("[stage/interview] GET failed:", e);
    return NextResponse.json({ error: "获取面试记录失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: stageId } = await params;

  try {
    const stage = getStage(stageId);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }
    if (stage.status === "locked") {
      return NextResponse.json({ error: "请先解锁该阶段后再进行面试模拟" }, { status: 403 });
    }

    const plan = getPlan(stage.plan_id);
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
    const chatId = getStageInterviewChatId(stageId, style);
    const outline = parseStoredOutline(stage);
    const sourceBundle = buildSourceBundle({ plan, stage, outline });

    const result = await handleStageInterviewPost({
      stage,
      plan,
      body,
      learningMode: plan.learning_mode as LearningMode,
      sourceBundle,
      legacyChatId: chatId,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[stage/interview] POST failed:", e);
    return NextResponse.json({ error: (e as Error).message || "面试失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stageId } = await params;
    const style = new URL(request.url).searchParams.get("style") || "standard";
    const chatId = getStageInterviewChatId(stageId, style);

    deleteInterviewSessionByKey(chatId);

    const db = getDb();
    db.prepare("DELETE FROM teaching_chat WHERE stage_id = ?").run(chatId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[stage/interview] DELETE failed:", e);
    return NextResponse.json({ error: "删除面试记录失败" }, { status: 500 });
  }
}
