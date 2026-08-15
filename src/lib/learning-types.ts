import { z } from "zod";

/** Shared with interview UI; keep in this client-safe module (no DB imports). */
export const DEFAULT_COUNTDOWN_SECONDS = 120;

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
