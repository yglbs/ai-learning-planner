import { NextResponse } from "next/server";
import {
  getStage,
  computeStageProgress,
  ensureDefaultLearningItems,
  getLearningItemById,
  getLearningItem,
  updateLearningItemById,
  isManualProgressItemType,
} from "@/db/queries";
import { MANUAL_PROGRESS_ITEM_TYPES } from "@/lib/learning-types";
import { z } from "zod";

const manualStatusSchema = z.enum(["pending", "in_progress", "completed", "skipped"]);

const progressByIdSchema = z.object({
  item_id: z.string().uuid(),
  status: manualStatusSchema,
  metadata: z.record(z.string(), z.string()).optional(),
});

const progressByKeySchema = z.object({
  item_type: z.enum(MANUAL_PROGRESS_ITEM_TYPES),
  item_key: z.string().max(128).default(""),
  status: manualStatusSchema,
  metadata: z.record(z.string(), z.string()).optional(),
});

const progressPatchSchema = z.union([progressByIdSchema, progressByKeySchema]);

function applyManualProgressUpdate(
  stageId: string,
  parsed: z.infer<typeof progressPatchSchema>
): { ok: true } | { ok: false; error: string; status: number } {
  let item;

  if ("item_id" in parsed) {
    item = getLearningItemById(parsed.item_id, stageId);
    if (!item) {
      return { ok: false, error: "进度项不存在", status: 404 };
    }
  } else {
    item = getLearningItem(stageId, parsed.item_type, parsed.item_key);
    if (!item) {
      return { ok: false, error: "进度项不存在", status: 404 };
    }
  }

  if (!isManualProgressItemType(item.item_type)) {
    return { ok: false, error: "该进度项不可手动更新", status: 403 };
  }

  const completed_at =
    parsed.status === "completed" || parsed.status === "skipped"
      ? new Date().toISOString()
      : null;

  updateLearningItemById(item.id, stageId, {
    status: parsed.status,
    metadata: parsed.metadata,
    completed_at,
  });

  return { ok: true };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stage = getStage(id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    ensureDefaultLearningItems(id);
    const progress = computeStageProgress(id);
    return NextResponse.json(progress);
  } catch (e) {
    console.error("[stage/progress] GET failed:", e);
    return NextResponse.json({ error: "获取进度失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stage = getStage(id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const parsed = progressPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "进度字段无效" }, { status: 400 });
    }

    const result = applyManualProgressUpdate(id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const progress = computeStageProgress(id);
    return NextResponse.json(progress);
  } catch (e) {
    console.error("[stage/progress] PATCH failed:", e);
    return NextResponse.json({ error: "更新进度失败" }, { status: 500 });
  }
}
