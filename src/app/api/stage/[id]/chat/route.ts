import { NextResponse } from "next/server";
import { getStage, getPlan, getChatHistory } from "@/db/queries";
import {
  handleTeachChatPost,
  TeachChatValidationError,
} from "@/lib/teach-chat-handler";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const history = getChatHistory(id);
    return NextResponse.json(history);
  } catch (e) {
    console.error("[stage/chat] GET failed:", e);
    return NextResponse.json({ error: "获取对话失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const stage = getStage(id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    const plan = getPlan(stage.plan_id);
    let body: { message?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const result = await handleTeachChatPost({
      stageId: id,
      stage,
      plan,
      message: body.message || "",
    });

    return NextResponse.json({
      role: result.role,
      content: result.content,
    });
  } catch (e) {
    if (e instanceof TeachChatValidationError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[stage/chat] POST failed:", e);
    return NextResponse.json({ error: (e as Error).message || "对话失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stage = getStage(id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }
    const { clearChatHistory } = await import("@/db/queries");
    clearChatHistory(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[stage/chat] DELETE failed:", e);
    return NextResponse.json({ error: "清空对话失败" }, { status: 500 });
  }
}
