import { NextResponse } from "next/server";
import {
  getStage,
  getPlan,
  updateStage,
  seedProgressFromConfirmedOutline,
} from "@/db/queries";
import { generateStageOutline, mergeOutlineAdjustments } from "@/lib/outline-generator";
import { stageOutlineSchema } from "@/lib/learning-types";
import { loadOutlineFromJson, resolveStageOutline } from "@/lib/outline-load";
import { validateOutlineFiles, outlineFileErrorMessage } from "@/lib/outline-validation";
import { z } from "zod";

const outlinePatchSchema = z.object({
  objectives: z.array(z.string().max(500)).max(20).optional(),
  scenarios: z.array(z.string().max(500)).max(10).optional(),
  files_to_read: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        reason: z.string().max(500),
        symbols: z.array(z.string().max(128)).max(20).optional(),
      })
    )
    .max(20)
    .optional(),
  call_chain: z.string().max(2000).optional(),
  architecture_focus: z.string().max(1000).optional(),
  estimated_minutes: z.number().int().min(1).max(10000).optional(),
  out_of_scope: z.array(z.string().max(300)).max(10).optional(),
  user_adjustments: z.string().max(2000).optional(),
});

function validateFilesForDraft(
  outline: z.infer<typeof stageOutlineSchema>,
  plan: ReturnType<typeof getPlan>
): string | null {
  if (!plan?.source_path || outline.sections.files_to_read.length === 0) return null;
  const result = validateOutlineFiles(outline, plan.source_path, false);
  if (!result.valid) {
    const hasSecurityIssue = result.errors.some((e) =>
      ["invalid_path", "path_escape", "symlink_escape", "not_code_file"].includes(e.reason)
    );
    if (hasSecurityIssue) return outlineFileErrorMessage(result.errors);
  }
  return null;
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

    const plan = getPlan(stage.plan_id);
    let outlineStatus = stage.outline_status;
    let outline = loadOutlineFromJson(stage.outline_json);

    if (!outline && (stage.outline_status === "pending" || stage.outline_status === "draft")) {
      outline = generateStageOutline({
        stage,
        learningMode: plan?.learning_mode || "business",
        sourcePath: plan?.source_path,
        sourceFiles: plan?.source_files,
      });
      updateStage(id, {
        outline_json: JSON.stringify(outline),
        outline_status: "draft",
      });
      outlineStatus = "draft";
    }

    return NextResponse.json({
      outline_status: outlineStatus,
      outline_confirmed_at: stage.outline_confirmed_at,
      outline,
    });
  } catch (e) {
    console.error("[stage/outline] GET failed:", e);
    return NextResponse.json({ error: "获取大纲失败" }, { status: 500 });
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

    const patchResult = outlinePatchSchema.safeParse(body);
    if (!patchResult.success) {
      return NextResponse.json({ error: "大纲字段无效" }, { status: 400 });
    }

    const plan = getPlan(stage.plan_id);
    const current = resolveStageOutline(stage, plan);
    const merged = mergeOutlineAdjustments(current, patchResult.data);
    const validated = stageOutlineSchema.safeParse(merged);
    if (!validated.success) {
      return NextResponse.json({ error: "大纲结构无效" }, { status: 400 });
    }

    const fileError = validateFilesForDraft(validated.data, plan);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    updateStage(id, {
      outline_json: JSON.stringify(validated.data),
      outline_status: "draft",
    });

    return NextResponse.json({ outline_status: "draft", outline: validated.data });
  } catch (e) {
    console.error("[stage/outline] PATCH failed:", e);
    return NextResponse.json({ error: "更新大纲失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stage = getStage(id);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    let body: { confirm?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // empty body ok for confirm
    }

    if (body.confirm !== true) {
      return NextResponse.json({ error: "请设置 confirm: true 以确认大纲" }, { status: 400 });
    }

    const plan = getPlan(stage.plan_id);
    const outline = resolveStageOutline(stage, plan);
    const parsed = stageOutlineSchema.safeParse(outline);
    if (!parsed.success) {
      return NextResponse.json({ error: "大纲结构无效，请重新编辑" }, { status: 400 });
    }

    if (plan?.source_path && parsed.data.sections.files_to_read.length > 0) {
      const fileCheck = validateOutlineFiles(parsed.data, plan.source_path, true);
      if (!fileCheck.valid) {
        return NextResponse.json({ error: outlineFileErrorMessage(fileCheck.errors) }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    updateStage(id, {
      outline_json: JSON.stringify(parsed.data),
      outline_status: "confirmed",
      outline_confirmed_at: now,
    });

    seedProgressFromConfirmedOutline(id, parsed.data, plan);

    return NextResponse.json({
      outline_status: "confirmed",
      outline_confirmed_at: now,
      outline: parsed.data,
    });
  } catch (e) {
    console.error("[stage/outline] POST confirm failed:", e);
    return NextResponse.json({ error: "确认大纲失败" }, { status: 500 });
  }
}
