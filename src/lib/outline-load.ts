import type { Stage, LearningPlan } from "@/db/queries";
import { generateStageOutline } from "@/lib/outline-generator";
import { stageOutlineSchema, type StageOutline } from "@/lib/learning-types";

/** Safely load outline from stage JSON; returns null if malformed. */
export function loadOutlineFromJson(raw: string | null | undefined): StageOutline | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = stageOutlineSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function resolveStageOutline(
  stage: Stage,
  plan: LearningPlan | null
): StageOutline {
  const stored = loadOutlineFromJson(stage.outline_json);
  if (stored) return stored;
  return generateStageOutline({
    stage,
    learningMode: plan?.learning_mode || "business",
    sourcePath: plan?.source_path,
    sourceFiles: plan?.source_files,
  });
}
