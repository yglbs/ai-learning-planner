import { NextResponse } from "next/server";
import { getActivePlan, getAllPlans, getPlan, getStagesByPlan, syncStageUnlockState, updatePlan, deletePlan } from "@/db/queries";
import { isManagedBookDir, removeSourceDir } from "@/lib/local-source";
import {
  defaultLearningMode,
  parseCareerIdentity,
  parseLearningMode,
  type CareerIdentity,
  type LearningMode,
} from "@/lib/learning-types";
import { parseChallengeSettings } from "@/lib/challenge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = searchParams.get("all");
  const id = searchParams.get("id");

  if (all === "true") {
    const plans = getAllPlans();
    return NextResponse.json(plans);
  }

  if (id) {
    const plan = getPlan(id);
    if (!plan) return NextResponse.json(null);
    syncStageUnlockState(plan.id);
    const stages = getStagesByPlan(plan.id);
    return NextResponse.json({ plan, stages });
  }

  const plan = getActivePlan();
  if (!plan) {
    return NextResponse.json(null);
  }

  syncStageUnlockState(plan.id);
  const stages = getStagesByPlan(plan.id);
  return NextResponse.json({ plan, stages });
}

export async function PATCH(request: Request) {
  try {
    let body: {
      id?: string;
      learning_mode?: unknown;
      career_identity?: unknown;
      post_stage_review_enabled?: unknown;
      answer_time_limit_enabled?: unknown;
      answer_time_limit_seconds?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "缺少计划 id" }, { status: 400 });
    }

    const plan = getPlan(body.id);
    if (!plan) {
      return NextResponse.json({ error: "计划不存在" }, { status: 404 });
    }

    const updates: {
      learning_mode?: LearningMode;
      career_identity?: CareerIdentity;
      post_stage_review_enabled?: boolean;
      answer_time_limit_enabled?: boolean;
      answer_time_limit_seconds?: number;
    } = {};

    if (body.learning_mode !== undefined) {
      updates.learning_mode = parseLearningMode(
        body.learning_mode,
        defaultLearningMode(plan.source_type || "goal")
      );
    }
    if (body.career_identity !== undefined) {
      updates.career_identity = parseCareerIdentity(body.career_identity);
    }
    if (
      body.post_stage_review_enabled !== undefined
      || body.answer_time_limit_enabled !== undefined
      || body.answer_time_limit_seconds !== undefined
    ) {
      const challenge = parseChallengeSettings({
        post_stage_review_enabled: body.post_stage_review_enabled ?? plan.post_stage_review_enabled,
        answer_time_limit_enabled: body.answer_time_limit_enabled ?? plan.answer_time_limit_enabled,
        answer_time_limit_seconds: body.answer_time_limit_seconds ?? plan.answer_time_limit_seconds,
      });
      Object.assign(updates, challenge);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }

    updatePlan(body.id, updates);
    const updated = getPlan(body.id);
    return NextResponse.json({ plan: updated });
  } catch (e) {
    console.error("[plan] PATCH failed:", e);
    return NextResponse.json({ error: "更新计划失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少计划 id" }, { status: 400 });
    }
    const plan = getPlan(id);
    if (!plan) {
      return NextResponse.json({ error: "计划不存在" }, { status: 404 });
    }
    deletePlan(id);
    if (plan.source_type === "book" && isManagedBookDir(plan.source_path || "")) {
      try {
        removeSourceDir(plan.source_path);
      } catch (e) {
        console.error("[plan] book files cleanup failed:", e);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[plan] DELETE failed:", e);
    return NextResponse.json({ error: "删除计划失败" }, { status: 500 });
  }
}
