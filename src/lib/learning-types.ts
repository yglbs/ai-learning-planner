import { z } from "zod";

/** Shared with interview UI; keep in this client-safe module (no DB imports). */
export const DEFAULT_COUNTDOWN_SECONDS = 120;
export const MIN_ANSWER_SECONDS = 10;
export const MAX_ANSWER_SECONDS = 3600;
export const POST_STAGE_REVIEW_PASS_SCORE = 60;

export const INTERVIEW_STYLE_IDS = ["friendly", "standard", "tough", "ultimate"] as const;
export type InterviewStyleId = (typeof INTERVIEW_STYLE_IDS)[number];

export const INTERVIEW_STYLE_OPTIONS: { id: InterviewStyleId; icon: string; name: string; desc: string }[] = [
  { id: "friendly", icon: "😊", name: "友善引导", desc: "像和同事聊天，轻松愉快" },
  { id: "standard", icon: "👔", name: "标准技术面", desc: "模拟真实面试流程" },
  { id: "tough", icon: "🔥", name: "压力面试", desc: "深挖细节，持续追问" },
  { id: "ultimate", icon: "💀", name: "终极难度", desc: "Staff 级事故决策与权衡，默认高压" },
];

export const POST_REVIEW_STATUSES = ["none", "pending", "passed", "skipped"] as const;
export type PostReviewStatus = (typeof POST_REVIEW_STATUSES)[number];

export function clampAnswerSeconds(value: unknown, fallback: number = DEFAULT_COUNTDOWN_SECONDS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ANSWER_SECONDS, Math.max(MIN_ANSWER_SECONDS, Math.round(n)));
}

export const LEARNING_MODES = ["business", "technical", "business_through_tech"] as const;
export type LearningMode = (typeof LEARNING_MODES)[number];

export const CAREER_IDENTITIES = ["", "junior", "senior", "staff"] as const;
export type CareerIdentity = (typeof CAREER_IDENTITIES)[number];

export const OUTLINE_STATUSES = ["pending", "draft", "confirmed"] as const;
export type OutlineStatus = (typeof OUTLINE_STATUSES)[number];

export const LEARNING_ITEM_TYPES = [
  "outline_confirm",
  "objective",
  "scenario_complete",
  "file_read",
  "architecture_review",
  "resource_complete",
  "chat_checkpoint",
  "assessment_pass",
  "assessment_skip",
] as const;
/** User-markable via progress PATCH (must pre-exist; no forging system checkpoints). */
export const MANUAL_PROGRESS_ITEM_TYPES = [
  "resource_complete",
  "chat_checkpoint",
  "objective",
  "file_read",
  "architecture_review",
] as const;

export const SYSTEM_PROGRESS_ITEM_TYPES = [
  "outline_confirm",
  "scenario_complete",
  "assessment_pass",
  "assessment_skip",
] as const;
export type LearningItemType = (typeof LEARNING_ITEM_TYPES)[number];
export type ManualProgressItemType = (typeof MANUAL_PROGRESS_ITEM_TYPES)[number];

export const LEARNING_ITEM_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export type LearningItemStatus = (typeof LEARNING_ITEM_STATUSES)[number];

export const outlineFileSchema = z.object({
  path: z.string().min(1).max(512),
  reason: z.string().max(500),
  symbols: z.array(z.string().max(128)).max(20).optional(),
});

export const stageOutlineSchema = z.object({
  version: z.number().int().min(1).max(10).default(1),
  generated_at: z.string(),
  learning_mode: z.enum(LEARNING_MODES),
  sections: z.object({
    objectives: z.array(z.string().max(500)).max(20),
    scenarios: z.array(z.string().max(500)).max(10),
    files_to_read: z.array(outlineFileSchema).max(20),
    call_chain: z.string().max(2000),
    architecture_focus: z.string().max(1000),
    estimated_minutes: z.number().int().min(1).max(10000),
    out_of_scope: z.array(z.string().max(300)).max(10),
  }),
  user_adjustments: z.string().max(2000).optional(),
});

export type StageOutline = z.infer<typeof stageOutlineSchema>;

export const groundedSourceFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  source: z.enum(["outline", "summary_path", "keyword"]),
  char_count: z.number(),
});

export const groundedSourceBundleSchema = z.object({
  files: z.array(groundedSourceFileSchema),
  missing_paths: z.array(z.string()),
  total_chars: z.number(),
  capped: z.boolean(),
});

export type GroundedSourceFile = z.infer<typeof groundedSourceFileSchema>;
export type GroundedSourceBundle = z.infer<typeof groundedSourceBundleSchema>;

export const architectureComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["module", "service", "entry", "config", "data", "other"]),
  paths: z.array(z.string()),
  evidence: z.enum(["verified", "inferred"]),
});

export const architectureEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
  evidence: z.enum(["verified", "inferred"]),
});

export const architectureSnapshotSchema = z.object({
  version: z.number().int().default(1),
  generated_at: z.string(),
  components: z.array(architectureComponentSchema),
  edges: z.array(architectureEdgeSchema),
  source_refs: z.array(z.string()),
  notes: z.string().optional(),
});

export type ArchitectureSnapshot = z.infer<typeof architectureSnapshotSchema>;

export function defaultLearningMode(sourceType: string): LearningMode {
  return sourceType === "code" ? "business_through_tech" : "business";
}

export function parseLearningMode(value: unknown, fallback: LearningMode): LearningMode {
  if (typeof value === "string" && (LEARNING_MODES as readonly string[]).includes(value)) {
    return value as LearningMode;
  }
  return fallback;
}

export function parseCareerIdentity(value: unknown): CareerIdentity {
  if (typeof value === "string" && (CAREER_IDENTITIES as readonly string[]).includes(value)) {
    return value as CareerIdentity;
  }
  return "";
}
