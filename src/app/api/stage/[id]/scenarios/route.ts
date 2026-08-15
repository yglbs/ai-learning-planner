import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/llm";
import {
  getStage,
  getPlan,
  getScenariosByStage,
  getScenario,
  updateScenario,
  markLearningItemComplete,
  syncScenariosFromOutline,
} from "@/db/queries";
import { composeScenarioConclusionPrompt } from "@/lib/prompt-composer";
import { buildSourceBundle, parseStoredOutline } from "@/lib/teach-chat-handler";
import { extractCitedSourcePaths } from "@/lib/evidence-extract";
import { loadOutlineFromJson } from "@/lib/outline-load";
import { z } from "zod";

const concludeSchema = z.object({
  scenario_id: z.string().uuid(),
  user_response: z.string().min(10).max(10000),
});

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

    let scenarios = getScenariosByStage(id);
    if (scenarios.length === 0) {
      const outline = loadOutlineFromJson(stage.outline_json);
      if (stage.outline_status === "confirmed" && outline?.sections.scenarios.length) {
        syncScenariosFromOutline(id, outline.sections.scenarios);
      } else if (stage.real_world_cases?.length) {
        syncScenariosFromOutline(id, stage.real_world_cases);
      }
      scenarios = getScenariosByStage(id);
    }

    return NextResponse.json(scenarios);
  } catch (e) {
    console.error("[stage/scenarios] GET failed:", e);
    return NextResponse.json({ error: "获取场景失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stageId } = await params;
    const stage = getStage(stageId);
    if (!stage) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const parsed = concludeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "场景结论字段无效" }, { status: 400 });
    }

    const scenario = getScenario(parsed.data.scenario_id);
    if (!scenario || scenario.stage_id !== stageId) {
      return NextResponse.json({ error: "场景不存在" }, { status: 404 });
    }

    const plan = getPlan(stage.plan_id);
    const outline = parseStoredOutline(stage);
    const sourceBundle = buildSourceBundle({ plan, stage, outline });

    const systemPrompt = composeScenarioConclusionPrompt({
      plan,
      stage,
      scenarioTitle: scenario.title,
      scenarioPrompt: scenario.prompt,
      userResponse: parsed.data.user_response,
      sourceBundle,
    });

    const model = getModel();
    const { text } = await generateText({
      model,
      prompt: systemPrompt,
    });

    const evidenceRefs = extractCitedSourcePaths(text, sourceBundle);

    updateScenario(scenario.id, {
      user_response: parsed.data.user_response,
      conclusion: text,
      conclusion_evidence: evidenceRefs,
      status: "completed",
      completed_at: new Date().toISOString(),
    });

    markLearningItemComplete(stageId, "scenario_complete", String(scenario.order_index));

    return NextResponse.json({
      scenario_id: scenario.id,
      conclusion: text,
      conclusion_evidence: evidenceRefs,
      status: "completed",
    });
  } catch (e) {
    console.error("[stage/scenarios] POST conclude failed:", e);
    return NextResponse.json({ error: "生成场景结论失败" }, { status: 500 });
  }
}
