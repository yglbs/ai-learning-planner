import { NextResponse } from "next/server";
import { getPlan, updatePlan } from "@/db/queries";
import { scanRepositoryArchitecture } from "@/lib/architecture-scanner";
import { architectureSnapshotSchema } from "@/lib/learning-types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: planId } = await params;
    const plan = getPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (plan.source_type !== "code" || !plan.source_path) {
      return NextResponse.json(
        { error: "仅代码类学习计划支持架构扫描" },
        { status: 400 }
      );
    }

    if (plan.architecture_snapshot) {
      try {
        const cached = architectureSnapshotSchema.parse(JSON.parse(plan.architecture_snapshot));
        return NextResponse.json({
          cached: true,
          generated_at: plan.architecture_generated_at,
          snapshot: cached,
        });
      } catch {
        // regenerate below
      }
    }

    const snapshot = scanRepositoryArchitecture(plan);
    if (!snapshot) {
      return NextResponse.json({ error: "无法扫描架构" }, { status: 400 });
    }

    const now = new Date().toISOString();
    updatePlan(planId, {
      architecture_snapshot: JSON.stringify(snapshot),
      architecture_generated_at: now,
    });

    return NextResponse.json({
      cached: false,
      generated_at: now,
      snapshot,
    });
  } catch (e) {
    console.error("[plan/architecture] GET failed:", e);
    return NextResponse.json({ error: "架构扫描失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: planId } = await params;
    const plan = getPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    let body: { refresh?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // empty ok
    }

    if (plan.source_type !== "code" || !plan.source_path) {
      return NextResponse.json(
        { error: "仅代码类学习计划支持架构扫描" },
        { status: 400 }
      );
    }

    if (!body.refresh && plan.architecture_snapshot) {
      const cached = architectureSnapshotSchema.parse(JSON.parse(plan.architecture_snapshot));
      return NextResponse.json({
        cached: true,
        generated_at: plan.architecture_generated_at,
        snapshot: cached,
      });
    }

    const snapshot = scanRepositoryArchitecture(plan);
    if (!snapshot) {
      return NextResponse.json({ error: "无法扫描架构" }, { status: 400 });
    }

    const now = new Date().toISOString();
    updatePlan(planId, {
      architecture_snapshot: JSON.stringify(snapshot),
      architecture_generated_at: now,
    });

    return NextResponse.json({
      cached: false,
      generated_at: now,
      snapshot,
    });
  } catch (e) {
    console.error("[plan/architecture] POST failed:", e);
    return NextResponse.json({ error: "架构扫描失败" }, { status: 500 });
  }
}
