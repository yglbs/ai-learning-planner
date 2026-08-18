import {
  checkPlanCompletion,
  createPostStageReviewSchedule,
  createReviewSchedulesForStage,
  createStageProject,
  getPlan,
  getProjectByStage,
  getStagesByPlan,
  unlockNextStage,
  updateStage,
  type LearningPlan,
  type Stage,
} from "@/db/queries";
import { generateStageProject } from "@/lib/ai";

export interface StageCompleteResult {
  hasNext: boolean;
  postReviewAvailable: boolean;
  postReviewId: string | null;
}

async function generateNextStageProject(plan: LearningPlan | null, nextStage: Stage) {
  if (getProjectByStage(nextStage.id)) return;
  const project = await generateStageProject({
    stage_title: nextStage.title,
    key_topics: nextStage.key_topics,
    core_output: nextStage.core_output || "",
    real_world_cases: nextStage.real_world_cases || [],
    goal: plan?.goal_description || "",
    skill_level: plan?.skill_level || "beginner",
  });
  createStageProject({
    stage_id: nextStage.id,
    title: project.title,
    description: project.description,
    expected_output: project.expected_output,
    checklist: project.checklist,
    difficulty: project.difficulty,
    estimated_minutes: project.estimated_minutes,
  });
}

export async function completeStageAndUnlockNext(stage: Stage): Promise<StageCompleteResult> {
  updateStage(stage.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
  } as unknown as Stage);

  const plan = getPlan(stage.plan_id);

  try {
    if (plan && plan.review_enabled !== false) {
      const preset = plan.review_interval_preset || "standard";
      createReviewSchedulesForStage(stage.id, stage.plan_id, preset);
    }
  } catch (e) {
    console.error("Review schedule creation failed (non-fatal):", e);
  }

  let postReviewId: string | null = null;
  const postReviewAvailable = !!plan?.post_stage_review_enabled;
  if (postReviewAvailable) {
    updateStage(stage.id, { post_review_status: "pending" } as unknown as Stage);
    postReviewId = createPostStageReviewSchedule(stage.id, stage.plan_id);
  } else {
    updateStage(stage.id, { post_review_status: "none" } as unknown as Stage);
  }

  const hasNext = unlockNextStage(stage.plan_id, stage.order_index);
  if (hasNext) {
    try {
      const stages = getStagesByPlan(stage.plan_id);
      const nextStage = stages.find((s) => s.order_index === stage.order_index + 1);
      if (nextStage) {
        await generateNextStageProject(plan, nextStage);
      }
    } catch (e) {
      console.error("Next stage project generation failed (non-fatal):", e);
    }
  } else {
    checkPlanCompletion(stage.plan_id);
  }

  return { hasNext, postReviewAvailable, postReviewId };
}

export async function generateProjectForUnlockedStage(planId: string, currentIndex: number) {
  const plan = getPlan(planId);
  const stages = getStagesByPlan(planId);
  const nextStage = stages.find((s) => s.order_index === currentIndex + 1);
  if (!nextStage) return;
  try {
    await generateNextStageProject(plan, nextStage);
  } catch (e) {
    console.error("Next stage project generation failed (non-fatal):", e);
  }
}
