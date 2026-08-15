import type { LearningPlan, Stage } from "@/db/queries";
import { getPlan, getStagesByPlan } from "@/db/queries";
import { selectGroundedSources, groundedSourcesToContext } from "@/lib/source-selector";
import { parseStoredOutline } from "@/lib/teach-chat-handler";
import type { StageOutline } from "@/lib/learning-types";

export const MULTI_PLAN_CONTEXT_BUDGET = 2500;

export interface MultiPlanContextBlock {
  planId: string;
  title: string;
  goal: string;
  isCodePlan: boolean;
  stagesSummary: string;
  verifiedSourcePaths: string[];
  codeContext: string;
}

function pickStagesForContext(stages: Stage[]): Stage[] {
  const activeOrDone = stages.filter((s) => s.status === "active" || s.status === "completed");
  return activeOrDone.length > 0 ? activeOrDone : stages.slice(0, 3);
}

function stageOutlineForContext(stage: Stage): StageOutline | null {
  if (stage.outline_status === "confirmed") {
    return parseStoredOutline(stage);
  }
  return null;
}

function buildCodeContextForPlan(plan: LearningPlan, stages: Stage[], budget: number): {
  codeContext: string;
  verifiedSourcePaths: string[];
} {
  const picked = pickStagesForContext(stages);
  const perStageBudget = Math.max(400, Math.floor(budget / Math.max(1, picked.length)));

  const paths: string[] = [];
  const chunks: string[] = [];
  let used = 0;

  for (const stage of picked) {
    if (used >= budget) break;
    const outline = stageOutlineForContext(stage);
    const remaining = budget - used;
    const bundle = selectGroundedSources({
      sourceRoot: plan.source_path,
      allFilePaths: plan.source_files || [],
      outline,
      summaryText: stage.summary_text,
      keywords: [...stage.key_topics, ...stage.title.split(/[\s:：\-_/]+/)],
      maxFiles: 4,
      maxChars: Math.min(perStageBudget, remaining),
    });
    for (const f of bundle.files) {
      paths.push(f.path);
    }
    if (bundle.files.length > 0) {
      const ctx = groundedSourcesToContext(bundle);
      chunks.push(`#### 阶段：${stage.title}\n${ctx}`);
      used += bundle.total_chars;
    }
  }

  return {
    codeContext: chunks.join("\n\n").slice(0, budget),
    verifiedSourcePaths: [...new Set(paths)],
  };
}

export function buildMultiPlanContext(planId: string, budget = MULTI_PLAN_CONTEXT_BUDGET): MultiPlanContextBlock | null {
  const plan = getPlan(planId);
  if (!plan) return null;

  const stages = getStagesByPlan(planId);
  const picked = pickStagesForContext(stages);
  const stagesSummary = picked
    .map((s) => {
      const outline = stageOutlineForContext(s);
      const files = outline?.sections.files_to_read.map((f) => f.path).slice(0, 4).join("、");
      return `阶段${s.order_index + 1}: ${s.title} [${s.status}] — ${s.key_topics.slice(0, 4).join("、")}${files ? `\n  精读: ${files}` : ""}`;
    })
    .join("\n")
    .slice(0, Math.floor(budget * 0.35));

  const isCodePlan = plan.source_type === "code" && !!plan.source_path;

  if (isCodePlan) {
    const { codeContext, verifiedSourcePaths } = buildCodeContextForPlan(plan, stages, budget);
    return {
      planId,
      title: plan.title,
      goal: plan.goal_description,
      isCodePlan: true,
      stagesSummary,
      verifiedSourcePaths,
      codeContext,
    };
  }

  return {
    planId,
    title: plan.title,
    goal: plan.goal_description,
    isCodePlan: false,
    stagesSummary,
    verifiedSourcePaths: [],
    codeContext: "",
  };
}

export function buildMultiPlanContexts(planIds: string[]): {
  blocks: MultiPlanContextBlock[];
  missingPlanIds: string[];
} {
  const blocks: MultiPlanContextBlock[] = [];
  const missingPlanIds: string[] = [];

  for (const id of planIds) {
    const block = buildMultiPlanContext(id);
    if (!block) {
      missingPlanIds.push(id);
    } else {
      blocks.push(block);
    }
  }

  return { blocks, missingPlanIds };
}
