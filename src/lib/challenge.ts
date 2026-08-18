import type { LearningPlan, Stage } from "@/db/queries";
import {
  clampAnswerSeconds,
  DEFAULT_COUNTDOWN_SECONDS,
  type PostReviewStatus,
} from "@/lib/learning-types";

export function parseChallengeSettings(input: {
  post_stage_review_enabled?: unknown;
  answer_time_limit_enabled?: unknown;
  answer_time_limit_seconds?: unknown;
}): {
  post_stage_review_enabled: boolean;
  answer_time_limit_enabled: boolean;
  answer_time_limit_seconds: number;
} {
  const enabledRaw = input.post_stage_review_enabled;
  const postEnabled = enabledRaw === false || enabledRaw === 0 || enabledRaw === "false" || enabledRaw === "0"
    ? false
    : true;
  const timeRaw = input.answer_time_limit_enabled;
  const timeEnabled = timeRaw === false || timeRaw === 0 || timeRaw === "false" || timeRaw === "0"
    ? false
    : true;
  return {
    post_stage_review_enabled: postEnabled,
    answer_time_limit_enabled: timeEnabled,
    answer_time_limit_seconds: clampAnswerSeconds(input.answer_time_limit_seconds, DEFAULT_COUNTDOWN_SECONDS),
  };
}

export function parsePostReviewStatus(value: unknown): PostReviewStatus {
  if (value === "pending" || value === "passed" || value === "skipped") return value;
  return "none";
}

export function isPostReviewBlocking(stage: Pick<Stage, "status" | "post_review_status">, plan: Pick<LearningPlan, "post_stage_review_enabled">): boolean {
  if (!plan.post_stage_review_enabled) return false;
  if (stage.status !== "completed") return false;
  return parsePostReviewStatus(stage.post_review_status) === "pending";
}

export function resolvePlanTimeLimit(plan: Pick<LearningPlan, "answer_time_limit_enabled" | "answer_time_limit_seconds">): {
  enabled: boolean;
  seconds: number;
} {
  return {
    enabled: plan.answer_time_limit_enabled === true,
    seconds: clampAnswerSeconds(plan.answer_time_limit_seconds, DEFAULT_COUNTDOWN_SECONDS),
  };
}

export function isOverTimeLimit(params: {
  enabled: boolean;
  limitSeconds: number;
  elapsedSeconds?: number | null;
  timedOut?: boolean;
}): boolean {
  if (!params.enabled) return false;
  if (params.timedOut) return true;
  if (typeof params.elapsedSeconds === "number" && params.elapsedSeconds > params.limitSeconds) {
    return true;
  }
  return false;
}
