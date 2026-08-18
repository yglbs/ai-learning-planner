import type { StageOutline } from "@/lib/learning-types";
import { POST_STAGE_REVIEW_PASS_SCORE } from "@/lib/learning-types";

import { getDb } from "./schema";
import { v4 as uuidv4 } from "uuid";

export interface SystemConfig {
  llm_provider: string;
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  search_api_key: string;
  proxy_enabled: boolean;
  proxy_type: string;
  proxy_host: string;
  proxy_port: number;
  proxy_username: string;
  proxy_password: string;
  tavily_api_key: string;
  quality_sites: string[];
  search_region: string;
  review_notifications: boolean;
  default_review_interval_preset: string;
  validator_enabled: boolean;
  validator_llm_provider: string;
  validator_llm_api_key: string;
  validator_llm_base_url: string;
  validator_llm_model: string;
  default_post_stage_review_enabled: boolean;
  default_answer_time_limit_enabled: boolean;
  default_answer_time_limit_seconds: number;
}

export type LearningMode = "business" | "technical" | "business_through_tech";
export type CareerIdentity = "" | "junior" | "senior" | "staff";
export type OutlineStatus = "pending" | "draft" | "confirmed";

export interface LearningPlan {
  id: string;
  title: string;
  goal_description: string;
  duration_weeks: number;
  daily_hours: number;
  skill_level: string;
  status: string;
  total_stages: number;
  current_stage_index: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  user_motivation: string;
  user_background: string;
  expected_outcome: string;
  review_enabled: boolean;
  adaptive_enabled: boolean;
  analytics_enabled: boolean;
  review_interval_preset: string;
  source_type: string;
  source_path: string;
  source_file_tree: string;
  source_files: string[];
  learning_mode: LearningMode;
  career_identity: CareerIdentity;
  architecture_snapshot: string;
  architecture_generated_at: string | null;
  post_stage_review_enabled: boolean;
  answer_time_limit_enabled: boolean;
  answer_time_limit_seconds: number;
}

export interface Stage {
  id: string;
  plan_id: string;
  order_index: number;
  title: string;
  description: string;
  key_topics: string[];
  estimated_days: number;
  status: string;
  summary_text: string;
  resource_completion_rate: number;
  unlocked_at: string | null;
  completed_at: string | null;
  created_at: string;
  real_world_cases: string[];
  assessment_questions: string[];
  core_output: string;
  learning_objectives: string[];
  outline_status: OutlineStatus;
  outline_json: string;
  outline_confirmed_at: string | null;
  learning_started_at: string | null;
  post_review_status: string;
}

export interface Resource {
  id: string;
  stage_id: string;
  title: string;
  url: string;
  source: string;
  type: string;
  reason: string;
  estimated_minutes: number;
  region_tag: string;
  is_manual: boolean;
  is_completed: boolean;
  is_skipped: boolean;
  sort_order: number;
  search_source: string;
  verified: boolean;
}

export interface AssessmentSuggestion {
  title: string;
  url: string;
  description: string;
}

export interface PerQuestionResult {
  question_index: number;
  question_text: string;
  is_correct: boolean;
  score: number;
  feedback: string;
  user_answer?: string;
  correct_answer?: string;
  question_type?: string;
}

export interface Assessment {
  id: string;
  stage_id: string;
  type: string;
  input_text: string;
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  score_accuracy: number;
  passed: boolean;
  feedback: string;
  missing_topics: string[];
  suggestions: (string | AssessmentSuggestion)[];
  per_question_results: PerQuestionResult[];
  attempt_number: number;
  created_at: string;
  validator_score_overall: number | null;
  validator_passed: boolean | null;
  validator_feedback: string;
  cross_check_agreed: boolean | null;
  timed_out: boolean;
  elapsed_seconds: number | null;
}

export interface SearchCacheEntry {
  id: string;
  query: string;
  results: unknown[];
  source: string;
  created_at: string;
  expires_at: string;
}

function parseJsonField(value: unknown, fallback: unknown[] = []): unknown[] {
  if (!value || value === "") return fallback;
  try {
    return JSON.parse(value as string);
  } catch {
    return fallback;
  }
}

const PLAN_UPDATE_WHITELIST = new Set([
  "title", "goal_description", "duration_weeks", "daily_hours", "skill_level", "status",
  "total_stages", "current_stage_index", "started_at", "completed_at",
  "user_motivation", "user_background", "expected_outcome",
  "review_enabled", "adaptive_enabled", "analytics_enabled", "review_interval_preset",
  "source_type", "source_path", "source_file_tree", "source_files",
  "learning_mode", "career_identity", "architecture_snapshot", "architecture_generated_at",
  "post_stage_review_enabled", "answer_time_limit_enabled", "answer_time_limit_seconds",
]);

const STAGE_UPDATE_WHITELIST = new Set([
  "order_index", "title", "description", "key_topics", "estimated_days", "status",
  "summary_text", "resource_completion_rate", "unlocked_at", "completed_at",
  "real_world_cases", "assessment_questions", "core_output", "learning_objectives",
  "outline_status", "outline_json", "outline_confirmed_at", "learning_started_at",
  "post_review_status",
]);

export function getConfig(): SystemConfig {
  const db = getDb();
  const row = db.prepare("SELECT * FROM system_config WHERE id = 1").get() as Record<string, unknown>;
  return {
    llm_provider: row.llm_provider as string,
    llm_api_key: row.llm_api_key as string,
    llm_base_url: (row.llm_base_url as string) || "",
    llm_model: row.llm_model as string,
    search_api_key: (row.search_api_key as string) || "",
    proxy_enabled: row.proxy_enabled === 1,
    proxy_type: (row.proxy_type as string) || "http",
    proxy_host: (row.proxy_host as string) || "",
    proxy_port: (row.proxy_port as number) || 0,
    proxy_username: (row.proxy_username as string) || "",
    proxy_password: (row.proxy_password as string) || "",
    tavily_api_key: (row.tavily_api_key as string) || "",
    quality_sites: parseJsonField(row.quality_sites) as string[],
    search_region: (row.search_region as string) || "global",
    review_notifications: row.review_notifications !== 0,
    default_review_interval_preset: (row.default_review_interval_preset as string) || "standard",
    validator_enabled: row.validator_enabled !== 0,
    validator_llm_provider: (row.validator_llm_provider as string) || "",
    validator_llm_api_key: (row.validator_llm_api_key as string) || "",
    validator_llm_base_url: (row.validator_llm_base_url as string) || "",
    validator_llm_model: (row.validator_llm_model as string) || "",
    default_post_stage_review_enabled: row.default_post_stage_review_enabled !== 0,
    default_answer_time_limit_enabled: row.default_answer_time_limit_enabled !== 0,
    default_answer_time_limit_seconds: (row.default_answer_time_limit_seconds as number) || 120,
  };
}

const CONFIG_BOOL_KEYS = new Set([
  "proxy_enabled",
  "review_notifications",
  "validator_enabled",
  "default_post_stage_review_enabled",
  "default_answer_time_limit_enabled",
]);

export function updateConfig(config: Partial<SystemConfig>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (CONFIG_BOOL_KEYS.has(key)) {
      fields.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else if (key === "quality_sites") {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE system_config SET ${fields.join(", ")} WHERE id = 1`).run(...values);
}

export function createPlan(plan: {
  title: string;
  goal_description: string;
  duration_weeks: number;
  daily_hours: number;
  skill_level: string;
  user_motivation?: string;
  user_background?: string;
  expected_outcome?: string;
  source_type?: string;
  source_path?: string;
  source_file_tree?: string;
  source_files?: string[];
  learning_mode?: LearningMode;
  career_identity?: CareerIdentity;
}): string {
  const db = getDb();
  const id = uuidv4();
  const defaultMode = plan.source_type === "code" ? "business_through_tech" : "business";
  db.prepare(
    `INSERT INTO learning_plan (
      id, title, goal_description, duration_weeks, daily_hours, skill_level, status,
      user_motivation, user_background, expected_outcome,
      source_type, source_path, source_file_tree, source_files,
      learning_mode, career_identity
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, plan.title, plan.goal_description, plan.duration_weeks, plan.daily_hours, plan.skill_level,
    plan.user_motivation || "", plan.user_background || "", plan.expected_outcome || "",
    plan.source_type || "goal",
    plan.source_path || "",
    plan.source_file_tree || "",
    JSON.stringify(plan.source_files || []),
    plan.learning_mode || defaultMode,
    plan.career_identity || ""
  );
  return id;
}

function mapPlanRow(row: Record<string, unknown>): LearningPlan {
  const sourceType = (row.source_type as string) || "goal";
  return {
    ...(row as unknown as LearningPlan),
    review_enabled: row.review_enabled !== 0,
    adaptive_enabled: row.adaptive_enabled !== 0,
    analytics_enabled: row.analytics_enabled !== 0,
    source_type: sourceType,
    source_path: (row.source_path as string) || "",
    source_file_tree: (row.source_file_tree as string) || "",
    source_files: parseJsonField(row.source_files) as string[],
    learning_mode: ((row.learning_mode as string) ||
      (sourceType === "code" ? "business_through_tech" : "business")) as LearningMode,
    career_identity: ((row.career_identity as string) || "") as CareerIdentity,
    architecture_snapshot: (row.architecture_snapshot as string) || "",
    architecture_generated_at: (row.architecture_generated_at as string) || null,
    post_stage_review_enabled: row.post_stage_review_enabled !== 0,
    answer_time_limit_enabled: row.answer_time_limit_enabled !== 0,
    answer_time_limit_seconds: (row.answer_time_limit_seconds as number) || 120,
  };
}

export function getPlan(id: string): LearningPlan | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM learning_plan WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapPlanRow(row);
}

export function getActivePlan(): LearningPlan | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM learning_plan WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapPlanRow(row);
}

export function getAllPlans(): LearningPlan[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM learning_plan ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(mapPlanRow);
}

export function updatePlan(id: string, updates: Partial<LearningPlan>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!PLAN_UPDATE_WHITELIST.has(key)) continue;
    if (key === "source_files") {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value || []));
      continue;
    }
    if (key === "review_enabled" || key === "adaptive_enabled" || key === "analytics_enabled"
      || key === "post_stage_review_enabled" || key === "answer_time_limit_enabled") {
      fields.push(`${key} = ?`);
      values.push(value ? 1 : 0);
      continue;
    }
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE learning_plan SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function createStage(stage: {
  plan_id: string;
  order_index: number;
  title: string;
  description: string;
  key_topics: string[];
  estimated_days: number;
  status?: string;
  summary_text?: string;
  learning_objectives?: string[];
  core_output?: string;
  real_world_cases?: string[];
  assessment_questions?: string[];
  outline_status?: OutlineStatus;
}): string {
  const db = getDb();
  const id = uuidv4();
  const outlineStatus = stage.outline_status ?? "pending";
  db.prepare(
    `INSERT INTO stage (id, plan_id, order_index, title, description, key_topics, estimated_days, status, summary_text, unlocked_at, learning_objectives, core_output, real_world_cases, assessment_questions, outline_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    stage.plan_id,
    stage.order_index,
    stage.title,
    stage.description,
    JSON.stringify(stage.key_topics),
    stage.estimated_days,
    stage.status || (stage.order_index === 0 ? "active" : "locked"),
    stage.summary_text || "",
    stage.order_index === 0 ? new Date().toISOString() : null,
    JSON.stringify(stage.learning_objectives || []),
    stage.core_output || "",
    JSON.stringify(stage.real_world_cases || []),
    JSON.stringify(stage.assessment_questions || []),
    outlineStatus
  );

  ensureDefaultLearningItems(id);

  return id;
}

function mapStageRow(row: Record<string, unknown>): Stage {
  return {
    ...row,
    key_topics: parseJsonField(row.key_topics) as string[],
    learning_objectives: parseJsonField(row.learning_objectives) as string[],
    real_world_cases: parseJsonField(row.real_world_cases) as string[],
    assessment_questions: parseJsonField(row.assessment_questions) as string[],
    resource_completion_rate: row.resource_completion_rate as number,
    core_output: (row.core_output as string) || "",
    outline_status: ((row.outline_status as string) || "confirmed") as OutlineStatus,
    outline_json: (row.outline_json as string) || "",
    outline_confirmed_at: (row.outline_confirmed_at as string) || null,
    learning_started_at: (row.learning_started_at as string) || null,
    post_review_status: (row.post_review_status as string) || "none",
  } as unknown as Stage;
}

export function getStagesByPlan(planId: string): Stage[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM stage WHERE plan_id = ? ORDER BY order_index").all(planId) as Record<string, unknown>[];
  return rows.map(mapStageRow);
}

export function getStage(id: string): Stage | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapStageRow(row);
}

export function updateStage(id: string, updates: Partial<Stage & { key_topics: string[] }>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  const jsonFields = ["key_topics", "learning_objectives", "real_world_cases", "assessment_questions"];

  for (const [key, value] of Object.entries(updates)) {
    if (!STAGE_UPDATE_WHITELIST.has(key)) continue;
    if (jsonFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE stage SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function unlockNextStage(planId: string, currentIndex: number): boolean {
  const db = getDb();
  const next = db.prepare(
    "SELECT id FROM stage WHERE plan_id = ? AND order_index = ?"
  ).get(planId, currentIndex + 1) as { id: string } | undefined;

  if (!next) return false;

  db.prepare(
    "UPDATE stage SET status = 'active', unlocked_at = datetime('now'), outline_status = 'pending' WHERE id = ?"
  ).run(next.id);

  db.prepare(
    "UPDATE learning_plan SET current_stage_index = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(currentIndex + 1, planId);

  return true;
}

export function syncStageUnlockState(planId: string): void {
  const db = getDb();
  const stages = getStagesByPlan(planId).sort((a, b) => a.order_index - b.order_index);
  if (stages.length === 0) return;

  const lastCompleted = [...stages].reverse().find((s) => s.status === "completed");
  if (lastCompleted) {
    const next = stages.find((s) => s.order_index === lastCompleted.order_index + 1);
    if (next?.status === "locked") {
      unlockNextStage(planId, lastCompleted.order_index);
    }
  }

  let activeAssigned = false;
  for (const stage of stages) {
    if (stage.status === "completed") continue;

    if (!activeAssigned) {
      if (stage.status !== "active") {
        db.prepare(
          "UPDATE stage SET status = 'active', unlocked_at = COALESCE(unlocked_at, datetime('now')) WHERE id = ?"
        ).run(stage.id);
      }
      db.prepare(
        "UPDATE learning_plan SET current_stage_index = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(stage.order_index, planId);
      activeAssigned = true;
    } else if (stage.status === "active") {
      db.prepare("UPDATE stage SET status = 'locked' WHERE id = ?").run(stage.id);
    }
  }
}

export interface StageNote {
  id: string;
  stage_id: string;
  ai_summary: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
}

export function getStageNote(stageId: string): StageNote | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM stage_note WHERE stage_id = ?").get(stageId) as StageNote | undefined;
  return row || null;
}

export function upsertStageNote(
  stageId: string,
  updates: { ai_summary?: string; user_notes?: string }
): string {
  const db = getDb();
  const existing = getStageNote(stageId);

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.ai_summary !== undefined) {
      fields.push("ai_summary = ?");
      values.push(updates.ai_summary);
    }
    if (updates.user_notes !== undefined) {
      fields.push("user_notes = ?");
      values.push(updates.user_notes);
    }
    if (fields.length === 0) return existing.id;
    fields.push("updated_at = datetime('now')");
    values.push(stageId);
    db.prepare(`UPDATE stage_note SET ${fields.join(", ")} WHERE stage_id = ?`).run(...values);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(
    "INSERT INTO stage_note (id, stage_id, ai_summary, user_notes) VALUES (?, ?, ?, ?)"
  ).run(id, stageId, updates.ai_summary || "", updates.user_notes || "");
  return id;
}

export function createResource(resource: {
  stage_id: string;
  title: string;
  url: string;
  source: string;
  type: string;
  reason: string;
  estimated_minutes?: number;
  region_tag?: string;
  sort_order?: number;
  search_source?: string;
  verified?: boolean;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO resource (id, stage_id, title, url, source, type, reason, estimated_minutes, region_tag, sort_order, search_source, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    resource.stage_id,
    resource.title,
    resource.url,
    resource.source,
    resource.type,
    resource.reason,
    resource.estimated_minutes || 30,
    resource.region_tag || "domestic",
    resource.sort_order || 0,
    resource.search_source || "llm",
    resource.verified ? 1 : 0
  );
  return id;
}

export function getResourcesByStage(stageId: string): Resource[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM resource WHERE stage_id = ? ORDER BY sort_order").all(stageId) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    is_manual: row.is_manual === 1,
    is_completed: row.is_completed === 1,
    is_skipped: row.is_skipped === 1,
    verified: row.verified === 1,
    search_source: (row.search_source as string) || "llm",
  })) as unknown as Resource[];
}

export function toggleResourceComplete(id: string, completed: boolean) {
  const db = getDb();
  db.prepare("UPDATE resource SET is_completed = ? WHERE id = ?").run(completed ? 1 : 0, id);

  const resource = db.prepare("SELECT stage_id FROM resource WHERE id = ?").get(id) as { stage_id: string };
  if (resource) {
    const total = db.prepare("SELECT COUNT(*) as count FROM resource WHERE stage_id = ?").get(resource.stage_id) as { count: number };
    const done = db.prepare("SELECT COUNT(*) as count FROM resource WHERE stage_id = ? AND is_completed = 1").get(resource.stage_id) as { count: number };
    const rate = total.count > 0 ? done.count / total.count : 0;
    db.prepare("UPDATE stage SET resource_completion_rate = ? WHERE id = ?").run(rate, resource.stage_id);
  }
}

export function createAssessment(assessment: {
  stage_id: string;
  type: string;
  input_text: string;
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  score_accuracy: number;
  passed: boolean;
  feedback: string;
  missing_topics: string[];
  suggestions: (string | AssessmentSuggestion)[];
  per_question_results?: PerQuestionResult[];
  validator_score_overall?: number | null;
  validator_passed?: boolean | null;
  validator_feedback?: string;
  cross_check_agreed?: boolean | null;
  timed_out?: boolean;
  elapsed_seconds?: number | null;
}): string {
  const db = getDb();
  const existing = db.prepare(
    "SELECT MAX(attempt_number) as max_attempt FROM assessment WHERE stage_id = ?"
  ).get(assessment.stage_id) as { max_attempt: number | null };

  const attemptNumber = (existing?.max_attempt || 0) + 1;
  const id = uuidv4();

  db.prepare(
    `INSERT INTO assessment (
      id, stage_id, type, input_text, score_overall, score_coverage, score_depth, score_accuracy,
      passed, feedback, missing_topics, suggestions, per_question_results, attempt_number,
      validator_score_overall, validator_passed, validator_feedback, cross_check_agreed, timed_out, elapsed_seconds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    assessment.stage_id,
    assessment.type,
    assessment.input_text,
    assessment.score_overall,
    assessment.score_coverage,
    assessment.score_depth,
    assessment.score_accuracy,
    assessment.passed ? 1 : 0,
    assessment.feedback,
    JSON.stringify(assessment.missing_topics),
    JSON.stringify(assessment.suggestions),
    JSON.stringify(assessment.per_question_results || []),
    attemptNumber,
    assessment.validator_score_overall ?? null,
    assessment.validator_passed == null ? null : (assessment.validator_passed ? 1 : 0),
    assessment.validator_feedback || "",
    assessment.cross_check_agreed == null ? null : (assessment.cross_check_agreed ? 1 : 0),
    assessment.timed_out ? 1 : 0,
    assessment.elapsed_seconds ?? null
  );
  return id;
}

export function getAssessmentsByStage(stageId: string): Assessment[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM assessment WHERE stage_id = ? ORDER BY attempt_number DESC"
  ).all(stageId) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...row,
    passed: row.passed === 1,
    missing_topics: parseJsonField(row.missing_topics) as string[],
    suggestions: parseJsonField(row.suggestions) as (string | AssessmentSuggestion)[],
    per_question_results: parseJsonField(row.per_question_results) as PerQuestionResult[],
    validator_score_overall: (row.validator_score_overall as number) ?? null,
    validator_passed: row.validator_passed == null ? null : row.validator_passed === 1,
    validator_feedback: (row.validator_feedback as string) || "",
    cross_check_agreed: row.cross_check_agreed == null ? null : row.cross_check_agreed === 1,
    timed_out: row.timed_out === 1,
    elapsed_seconds: (row.elapsed_seconds as number) ?? null,
  })) as unknown as Assessment[];
}

export function checkPlanCompletion(planId: string): boolean {
  const db = getDb();
  const total = db.prepare("SELECT COUNT(*) as count FROM stage WHERE plan_id = ?").get(planId) as { count: number };
  const completed = db.prepare("SELECT COUNT(*) as count FROM stage WHERE plan_id = ? AND status = 'completed'").get(planId) as { count: number };

  if (total.count > 0 && total.count === completed.count) {
    db.prepare("UPDATE learning_plan SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(planId);
    return true;
  }
  return false;
}

export function getCachedSearch(query: string): SearchCacheEntry | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM search_cache WHERE query = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).get(query) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    results: parseJsonField(row.results),
  } as unknown as SearchCacheEntry;
}

export interface ChatMessage {
  id: string;
  stage_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function getChatHistory(stageId: string): ChatMessage[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM teaching_chat WHERE stage_id = ? ORDER BY created_at ASC"
  ).all(stageId) as unknown as ChatMessage[];
}

export function addChatMessage(stageId: string, role: "user" | "assistant", content: string): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO teaching_chat (id, stage_id, role, content) VALUES (?, ?, ?, ?)"
  ).run(id, stageId, role, content);
  return id;
}

export function clearChatHistory(stageId: string) {
  const db = getDb();
  db.prepare("DELETE FROM teaching_chat WHERE stage_id = ?").run(stageId);
}

export function setCachedSearch(query: string, results: unknown[], source: string, ttlHours: number = 24) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO search_cache (id, query, results, source, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+${ttlHours} hours'))`
  ).run(id, query, JSON.stringify(results), source);
}

// ==================== Review Schedule ====================

export interface ReviewSchedule {
  id: string;
  stage_id: string;
  plan_id: string;
  interval_days: number;
  scheduled_at: string;
  status: string;
  completed_at: string | null;
  score: number | null;
  created_at: string;
  review_kind: string;
}

const REVIEW_INTERVALS: Record<string, number[]> = {
  compact: [1, 2, 4, 7, 14],
  standard: [1, 3, 7, 14, 30],
  relaxed: [2, 5, 10, 21, 45],
};

export function createReviewSchedulesForStage(stageId: string, planId: string, preset: string = "standard"): string[] {
  const db = getDb();
  const intervals = REVIEW_INTERVALS[preset] || REVIEW_INTERVALS.standard;
  const ids: string[] = [];
  const now = new Date();

  for (const days of intervals) {
    const id = uuidv4();
    const scheduled = new Date(now.getTime() + days * 86400000);
    db.prepare(
      `INSERT INTO review_schedule (id, stage_id, plan_id, interval_days, scheduled_at, status, review_kind)
       VALUES (?, ?, ?, ?, ?, 'pending', 'spaced')`
    ).run(id, stageId, planId, days, scheduled.toISOString());
    ids.push(id);
  }
  return ids;
}

export function createPostStageReviewSchedule(stageId: string, planId: string): string {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id FROM review_schedule
     WHERE stage_id = ? AND review_kind = 'post_stage' AND status IN ('pending', 'expired')
     ORDER BY created_at DESC LIMIT 1`
  ).get(stageId) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = uuidv4();
  db.prepare(
    `INSERT INTO review_schedule (id, stage_id, plan_id, interval_days, scheduled_at, status, review_kind)
     VALUES (?, ?, ?, 0, ?, 'pending', 'post_stage')`
  ).run(id, stageId, planId, new Date().toISOString());
  return id;
}

export function getReviewScheduleById(id: string): ReviewSchedule | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM review_schedule WHERE id = ?").get(id) as ReviewSchedule | undefined;
  return row || null;
}

export function getPendingPostStageReview(stageId: string): ReviewSchedule | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM review_schedule
     WHERE stage_id = ? AND review_kind = 'post_stage' AND status IN ('pending', 'expired')
     ORDER BY created_at DESC LIMIT 1`
  ).get(stageId) as ReviewSchedule | undefined;
  return row || null;
}

export function getReviewSchedulesByPlan(planId: string): ReviewSchedule[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM review_schedule WHERE plan_id = ? ORDER BY scheduled_at ASC"
  ).all(planId) as unknown as ReviewSchedule[];
}

export function getPendingReviews(planId?: string): ReviewSchedule[] {
  const db = getDb();
  if (planId) {
    return db.prepare(
      "SELECT * FROM review_schedule WHERE plan_id = ? AND (status = 'pending' OR status = 'expired') AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"
    ).all(planId) as unknown as ReviewSchedule[];
  }
  return db.prepare(
    "SELECT * FROM review_schedule WHERE (status = 'pending' OR status = 'expired') AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"
  ).all() as unknown as ReviewSchedule[];
}

export function getAllDueReviewCount(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM review_schedule WHERE (status = 'pending' OR status = 'expired') AND scheduled_at <= datetime('now')"
  ).get() as { count: number };
  return row.count;
}

export function updateReviewSchedule(id: string, updates: Partial<ReviewSchedule>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  db.prepare(`UPDATE review_schedule SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function expireOverdueReviews() {
  const db = getDb();
  db.prepare(
    `UPDATE review_schedule SET status = 'expired'
     WHERE status = 'pending'
       AND scheduled_at < datetime('now', '-3 days')
       AND (review_kind IS NULL OR review_kind = 'spaced')`
  ).run();
}

// ==================== Review Session ====================

export interface ReviewSession {
  id: string;
  review_schedule_id: string;
  questions: unknown[];
  score: number;
  duration_minutes: number;
  created_at: string;
}

export function createReviewSession(session: {
  review_schedule_id: string;
  questions: unknown[];
  score: number;
  duration_minutes: number;
  timed_out?: boolean;
}): { id: string; unlockedNext: boolean; postReviewPassed: boolean | null; currentIndex?: number; planId?: string } {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO review_session (id, review_schedule_id, questions, score, duration_minutes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, session.review_schedule_id, JSON.stringify(session.questions), session.score, session.duration_minutes);

  const schedule = getReviewScheduleById(session.review_schedule_id);
  if (!schedule) {
    return { id, unlockedNext: false, postReviewPassed: null };
  }

  const isPostStage = schedule.review_kind === "post_stage";

  if (isPostStage && session.timed_out) {
    db.prepare(
      "UPDATE review_schedule SET status = 'pending', score = ? WHERE id = ?"
    ).run(session.score, session.review_schedule_id);
    return { id, unlockedNext: false, postReviewPassed: false };
  }

  db.prepare(
    "UPDATE review_schedule SET status = 'completed', completed_at = datetime('now'), score = ? WHERE id = ?"
  ).run(session.score, session.review_schedule_id);

  if (!isPostStage) {
    return { id, unlockedNext: false, postReviewPassed: null };
  }

  const stage = getStage(schedule.stage_id);
  if (stage) {
    const passed = session.score >= POST_STAGE_REVIEW_PASS_SCORE;
    updateStage(stage.id, { post_review_status: passed ? "passed" : "skipped" } as unknown as Stage);
  }
  return { id, unlockedNext: false, postReviewPassed: session.score >= POST_STAGE_REVIEW_PASS_SCORE };
}

export function getReviewSessionsBySchedule(scheduleId: string): ReviewSession[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM review_session WHERE review_schedule_id = ? ORDER BY created_at DESC"
  ).all(scheduleId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    questions: parseJsonField(r.questions),
  })) as unknown as ReviewSession[];
}

// ==================== Knowledge Concept ====================

export interface KnowledgeConcept {
  id: string;
  plan_id: string;
  name: string;
  definition: string;
  mastery_status: string;
  source_stage_ids: string[];
  created_at: string;
  updated_at: string;
}

export function createConcept(concept: {
  plan_id: string;
  name: string;
  definition?: string;
  mastery_status?: string;
  source_stage_ids?: string[];
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO knowledge_concept (id, plan_id, name, definition, mastery_status, source_stage_ids)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id, concept.plan_id, concept.name,
    concept.definition || "", concept.mastery_status || "untouched",
    JSON.stringify(concept.source_stage_ids || [])
  );
  return id;
}

export function getConceptsByPlan(planId: string): KnowledgeConcept[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM knowledge_concept WHERE plan_id = ? ORDER BY name"
  ).all(planId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    source_stage_ids: parseJsonField(r.source_stage_ids) as string[],
  })) as unknown as KnowledgeConcept[];
}

export function updateConcept(id: string, updates: Partial<KnowledgeConcept>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "source_stage_ids") {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE knowledge_concept SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteConcept(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM knowledge_concept WHERE id = ?").run(id);
}

// ==================== Knowledge Relation ====================

export interface KnowledgeRelation {
  id: string;
  plan_id: string;
  from_concept_id: string;
  to_concept_id: string;
  relation_type: string;
  source: string;
  created_at: string;
}

export function createRelation(relation: {
  plan_id: string;
  from_concept_id: string;
  to_concept_id: string;
  relation_type: string;
  source?: string;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO knowledge_relation (id, plan_id, from_concept_id, to_concept_id, relation_type, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, relation.plan_id, relation.from_concept_id, relation.to_concept_id, relation.relation_type, relation.source || "ai");
  return id;
}

export function getRelationsByPlan(planId: string): KnowledgeRelation[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM knowledge_relation WHERE plan_id = ?"
  ).all(planId) as unknown as KnowledgeRelation[];
}

export function deleteRelation(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM knowledge_relation WHERE id = ?").run(id);
}

// ==================== Stage Project ====================

export interface StageProject {
  id: string;
  stage_id: string;
  title: string;
  description: string;
  expected_output: string;
  checklist: { item: string; completed: boolean }[];
  output_notes: string;
  attachment_paths: string[];
  difficulty: string;
  estimated_minutes: number;
  status: string;
  completed_at: string | null;
  created_at: string;
}

export function createStageProject(project: {
  stage_id: string;
  title: string;
  description?: string;
  expected_output?: string;
  checklist?: { item: string; completed: boolean }[];
  difficulty?: string;
  estimated_minutes?: number;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO stage_project (id, stage_id, title, description, expected_output, checklist, difficulty, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, project.stage_id, project.title,
    project.description || "", project.expected_output || "",
    JSON.stringify(project.checklist || []),
    project.difficulty || "medium",
    project.estimated_minutes || 60
  );
  return id;
}

export function getProjectByStage(stageId: string): StageProject | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM stage_project WHERE stage_id = ? LIMIT 1"
  ).get(stageId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    checklist: parseJsonField(row.checklist) as { item: string; completed: boolean }[],
    attachment_paths: parseJsonField(row.attachment_paths) as string[],
  } as unknown as StageProject;
}

export function getProjectsByPlan(planId: string): (StageProject & { stage_title: string; stage_order: number })[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT sp.*, s.title as stage_title, s.order_index as stage_order
     FROM stage_project sp
     JOIN stage s ON sp.stage_id = s.id
     WHERE s.plan_id = ?
     ORDER BY s.order_index`
  ).all(planId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    checklist: parseJsonField(r.checklist) as { item: string; completed: boolean }[],
    attachment_paths: parseJsonField(r.attachment_paths) as string[],
  })) as unknown as (StageProject & { stage_title: string; stage_order: number })[];
}

export function updateStageProject(id: string, updates: Partial<StageProject>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  const jsonFields = ["checklist", "attachment_paths"];

  for (const [key, value] of Object.entries(updates)) {
    if (jsonFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  values.push(id);
  db.prepare(`UPDATE stage_project SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

// ==================== Learning Session ====================

export interface LearningSessionRecord {
  id: string;
  plan_id: string;
  stage_id: string | null;
  activity_type: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  is_manual: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function startLearningSession(planId: string, stageId: string | null, activityType: string): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO learning_session (id, plan_id, stage_id, activity_type, started_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(id, planId, stageId, activityType);
  return id;
}

export function endLearningSession(id: string) {
  const db = getDb();
  db.prepare(
    `UPDATE learning_session SET ended_at = datetime('now'),
     duration_minutes = CAST((julianday(datetime('now')) - julianday(started_at)) * 1440 AS INTEGER)
     WHERE id = ? AND ended_at IS NULL`
  ).run(id);
}

export function addManualSession(params: {
  plan_id: string;
  stage_id?: string;
  activity_type: string;
  date: string;
  duration_minutes: number;
  notes?: string;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO learning_session (id, plan_id, stage_id, activity_type, started_at, ended_at, duration_minutes, is_manual, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id, params.plan_id, params.stage_id || null, params.activity_type,
    params.date, params.date, params.duration_minutes,
    JSON.stringify({ notes: params.notes || "" })
  );
  return id;
}

export function getSessionsByPlan(planId: string, days: number = 30): LearningSessionRecord[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM learning_session WHERE plan_id = ? AND started_at >= datetime('now', '-${days} days') ORDER BY started_at DESC`
  ).all(planId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    is_manual: r.is_manual === 1,
    metadata: parseJsonObj(r.metadata),
  })) as unknown as LearningSessionRecord[];
}

export function getDailyStudyTime(planId: string, days: number = 7): { date: string; minutes: number }[] {
  const db = getDb();
  return db.prepare(
    `SELECT date(started_at) as date, SUM(duration_minutes) as minutes
     FROM learning_session
     WHERE plan_id = ? AND started_at >= datetime('now', '-${days} days')
     GROUP BY date(started_at)
     ORDER BY date ASC`
  ).all(planId) as { date: string; minutes: number }[];
}

export function getHourlyDistribution(planId: string): { hour: number; total_minutes: number; avg_score: number | null }[] {
  const db = getDb();
  return db.prepare(
    `SELECT CAST(strftime('%H', started_at) AS INTEGER) as hour,
     SUM(duration_minutes) as total_minutes,
     NULL as avg_score
     FROM learning_session
     WHERE plan_id = ? AND duration_minutes > 0
     GROUP BY hour
     ORDER BY hour`
  ).all(planId) as { hour: number; total_minutes: number; avg_score: number | null }[];
}

export function getTotalStudyTime(planId: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM learning_session WHERE plan_id = ?"
  ).get(planId) as { total: number };
  return row.total;
}

// ==================== Mastery Profile ====================

export interface MasteryProfile {
  id: string;
  stage_id: string;
  plan_id: string;
  overall_level: string;
  weak_topics: string[];
  assessment_id: string | null;
  created_at: string;
}

export function createMasteryProfile(profile: {
  stage_id: string;
  plan_id: string;
  overall_level: string;
  weak_topics: string[];
  assessment_id?: string;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO mastery_profile (id, stage_id, plan_id, overall_level, weak_topics, assessment_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, profile.stage_id, profile.plan_id, profile.overall_level, JSON.stringify(profile.weak_topics), profile.assessment_id || null);
  return id;
}

export function getLatestMasteryProfile(planId: string): MasteryProfile | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM mastery_profile WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(planId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...row, weak_topics: parseJsonField(row.weak_topics) as string[] } as unknown as MasteryProfile;
}

export function getMasteryProfilesByPlan(planId: string): MasteryProfile[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM mastery_profile WHERE plan_id = ? ORDER BY created_at ASC"
  ).all(planId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    weak_topics: parseJsonField(r.weak_topics) as string[],
  })) as unknown as MasteryProfile[];
}

// ==================== Adaptive Adjustment ====================

export interface AdaptiveAdjustment {
  id: string;
  plan_id: string;
  stage_id: string | null;
  trigger_reason: string;
  adjustment_type: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  user_accepted: boolean | null;
  created_at: string;
}

export function createAdaptiveAdjustment(adj: {
  plan_id: string;
  stage_id?: string;
  trigger_reason: string;
  adjustment_type: string;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO adaptive_adjustment (id, plan_id, stage_id, trigger_reason, adjustment_type, before_snapshot, after_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, adj.plan_id, adj.stage_id || null, adj.trigger_reason, adj.adjustment_type,
    JSON.stringify(adj.before_snapshot), JSON.stringify(adj.after_snapshot)
  );
  return id;
}

export function getAdjustmentsByPlan(planId: string): AdaptiveAdjustment[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM adaptive_adjustment WHERE plan_id = ? ORDER BY created_at DESC"
  ).all(planId) as Record<string, unknown>[];
  return rows.map(r => ({
    ...r,
    before_snapshot: parseJsonObj(r.before_snapshot),
    after_snapshot: parseJsonObj(r.after_snapshot),
    user_accepted: r.user_accepted === null ? null : r.user_accepted === 1,
  })) as unknown as AdaptiveAdjustment[];
}

export function acceptAdjustment(id: string, accepted: boolean) {
  const db = getDb();
  db.prepare("UPDATE adaptive_adjustment SET user_accepted = ? WHERE id = ?").run(accepted ? 1 : 0, id);
}

// ==================== Export Record ====================

export interface ExportRecord {
  id: string;
  plan_id: string;
  export_type: string;
  file_path: string;
  created_at: string;
}

export function createExportRecord(planId: string, exportType: string, filePath: string): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO export_record (id, plan_id, export_type, file_path) VALUES (?, ?, ?, ?)"
  ).run(id, planId, exportType, filePath);
  return id;
}

export function getExportsByPlan(planId: string): ExportRecord[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM export_record WHERE plan_id = ? ORDER BY created_at DESC"
  ).all(planId) as unknown as ExportRecord[];
}

// ==================== Analytics Helpers ====================

export function getPlanStats(planId: string) {
  const db = getDb();
  const totalStages = db.prepare("SELECT COUNT(*) as c FROM stage WHERE plan_id = ?").get(planId) as { c: number };
  const completedStages = db.prepare("SELECT COUNT(*) as c FROM stage WHERE plan_id = ? AND status = 'completed'").get(planId) as { c: number };
  const totalAssessments = db.prepare(
    "SELECT COUNT(DISTINCT a.stage_id) as c FROM assessment a JOIN stage s ON a.stage_id = s.id WHERE s.plan_id = ? AND a.type != 'skipped'"
  ).get(planId) as { c: number };
  const firstPassAssessments = db.prepare(
    `SELECT COUNT(*) as c FROM (
       SELECT stage_id, MIN(attempt_number) as first_attempt, passed
       FROM assessment a JOIN stage s ON a.stage_id = s.id
       WHERE s.plan_id = ? AND passed = 1 AND a.type != 'skipped'
       GROUP BY stage_id
       HAVING first_attempt = 1
     )`
  ).get(planId) as { c: number };
  const dueReviews = db.prepare(
    "SELECT COUNT(*) as c FROM review_schedule WHERE plan_id = ? AND (status = 'pending' OR status = 'expired') AND scheduled_at <= datetime('now')"
  ).get(planId) as { c: number };
  const completedReviews = db.prepare(
    "SELECT COUNT(*) as c FROM review_schedule WHERE plan_id = ? AND status = 'completed'"
  ).get(planId) as { c: number };
  const totalReviews = db.prepare(
    "SELECT COUNT(*) as c FROM review_schedule WHERE plan_id = ? AND scheduled_at <= datetime('now')"
  ).get(planId) as { c: number };
  const completedProjects = db.prepare(
    "SELECT COUNT(*) as c FROM stage_project sp JOIN stage s ON sp.stage_id = s.id WHERE s.plan_id = ? AND sp.status = 'completed'"
  ).get(planId) as { c: number };
  const totalProjects = db.prepare(
    "SELECT COUNT(*) as c FROM stage_project sp JOIN stage s ON sp.stage_id = s.id WHERE s.plan_id = ?"
  ).get(planId) as { c: number };

  return {
    stageProgress: totalStages.c > 0 ? completedStages.c / totalStages.c : 0,
    completedStages: completedStages.c,
    totalStages: totalStages.c,
    assessmentPassRate: totalAssessments.c > 0 ? firstPassAssessments.c / totalAssessments.c : 0,
    reviewCompletionRate: totalReviews.c > 0 ? completedReviews.c / totalReviews.c : 0,
    dueReviewCount: dueReviews.c,
    projectCompletionRate: totalProjects.c > 0 ? completedProjects.c / totalProjects.c : 0,
    completedProjects: completedProjects.c,
    totalProjects: totalProjects.c,
    totalStudyMinutes: getTotalStudyTime(planId),
  };
}

function parseJsonObj(value: unknown): Record<string, unknown> {
  if (!value || value === "" || value === "{}") return {};
  try {
    return JSON.parse(value as string);
  } catch {
    return {};
  }
}

// ==================== Stage Learning Items ====================

export interface StageLearningItem {
  id: string;
  stage_id: string;
  item_type: string;
  item_key: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
}

export function ensureDefaultLearningItems(stageId: string) {
  const db = getDb();
  const defaults: { item_type: string; item_key: string; title: string }[] = [
    { item_type: "outline_confirm", item_key: "", title: "确认学习大纲" },
    { item_type: "assessment_pass", item_key: "", title: "通过阶段检测" },
  ];
  for (const d of defaults) {
    const existing = db.prepare(
      "SELECT id FROM stage_learning_item WHERE stage_id = ? AND item_type = ? AND item_key = ?"
    ).get(stageId, d.item_type, d.item_key);
    if (!existing) {
      db.prepare(
        `INSERT INTO stage_learning_item (id, stage_id, item_type, item_key, title, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      ).run(uuidv4(), stageId, d.item_type, d.item_key, d.title);
    }
  }
}

export function getLearningItemsByStage(stageId: string): StageLearningItem[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM stage_learning_item WHERE stage_id = ? ORDER BY created_at ASC"
  ).all(stageId) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    metadata: parseJsonObj(r.metadata),
  })) as unknown as StageLearningItem[];
}

export function upsertLearningItem(
  stageId: string,
  itemType: string,
  itemKey: string,
  updates: { title?: string; status?: string; metadata?: Record<string, unknown>; completed_at?: string | null }
): string {
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM stage_learning_item WHERE stage_id = ? AND item_type = ? AND item_key = ?"
  ).get(stageId, itemType, itemKey) as { id: string } | undefined;

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.completed_at !== undefined) {
      fields.push("completed_at = ?");
      values.push(updates.completed_at);
    }
    if (fields.length > 0) {
      values.push(existing.id);
      db.prepare(`UPDATE stage_learning_item SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO stage_learning_item (id, stage_id, item_type, item_key, title, status, metadata, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    stageId,
    itemType,
    itemKey,
    updates.title || itemType,
    updates.status || "pending",
    JSON.stringify(updates.metadata || {}),
    updates.completed_at ?? null
  );
  return id;
}

export function getLearningItemById(itemId: string, stageId: string): StageLearningItem | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM stage_learning_item WHERE id = ? AND stage_id = ?"
  ).get(itemId, stageId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    metadata: parseJsonObj(row.metadata),
  } as unknown as StageLearningItem;
}

export function getLearningItem(
  stageId: string,
  itemType: string,
  itemKey: string
): StageLearningItem | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM stage_learning_item WHERE stage_id = ? AND item_type = ? AND item_key = ?"
  ).get(stageId, itemType, itemKey) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    metadata: parseJsonObj(row.metadata),
  } as unknown as StageLearningItem;
}

export function updateLearningItemById(
  itemId: string,
  stageId: string,
  updates: { status?: string; metadata?: Record<string, unknown>; completed_at?: string | null }
): boolean {
  const existing = getLearningItemById(itemId, stageId);
  if (!existing) return false;
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.metadata !== undefined) {
    fields.push("metadata = ?");
    values.push(JSON.stringify(updates.metadata));
  }
  if (updates.completed_at !== undefined) {
    fields.push("completed_at = ?");
    values.push(updates.completed_at);
  }
  if (fields.length === 0) return true;
  values.push(itemId);
  db.prepare(`UPDATE stage_learning_item SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return true;
}

function fileReadItemKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").slice(0, 128);
}

export function syncScenariosFromOutline(stageId: string, scenarios: string[]) {
  const db = getDb();
  db.prepare("DELETE FROM stage_scenario WHERE stage_id = ?").run(stageId);
  scenarios.forEach((title, i) => {
    db.prepare(
      `INSERT INTO stage_scenario (id, stage_id, order_index, title, prompt, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(uuidv4(), stageId, i, title.slice(0, 200), `请结合本阶段所学，完成场景：${title}`);
  });
}

/** Idempotently seed fine-grained progress from a confirmed outline. */
export function seedProgressFromConfirmedOutline(
  stageId: string,
  outline: StageOutline,
  plan: LearningPlan | null
) {
  markLearningItemComplete(stageId, "outline_confirm");

  outline.sections.objectives.forEach((obj, i) => {
    const existing = getLearningItem(stageId, "objective", String(i));
    if (!existing) {
      upsertLearningItem(stageId, "objective", String(i), {
        title: obj.slice(0, 200),
        status: "pending",
      });
    }
  });

  syncScenariosFromOutline(stageId, outline.sections.scenarios);
  outline.sections.scenarios.forEach((sc, i) => {
    const existing = getLearningItem(stageId, "scenario_complete", String(i));
    if (!existing) {
      upsertLearningItem(stageId, "scenario_complete", String(i), {
        title: `完成场景：${sc.slice(0, 80)}`,
        status: "pending",
      });
    }
  });

  outline.sections.files_to_read.forEach((f) => {
    const key = fileReadItemKey(f.path);
    const existing = getLearningItem(stageId, "file_read", key);
    if (!existing) {
      upsertLearningItem(stageId, "file_read", key, {
        title: `阅读：${f.path}`,
        status: "pending",
        metadata: { path: f.path },
      });
    }
  });

  if (plan?.source_type === "code" && outline.sections.architecture_focus.trim()) {
    const existing = getLearningItem(stageId, "architecture_review", "");
    if (!existing) {
      upsertLearningItem(stageId, "architecture_review", "", {
        title: "架构焦点复习",
        status: "pending",
        metadata: { focus: outline.sections.architecture_focus.slice(0, 500) },
      });
    }
  }

  const assessExisting = getLearningItem(stageId, "assessment_pass", "");
  if (!assessExisting) {
    upsertLearningItem(stageId, "assessment_pass", "", {
      title: "通过阶段检测",
      status: "pending",
    });
  }
}

export function markLearningItemComplete(stageId: string, itemType: string, itemKey: string = "") {
  upsertLearningItem(stageId, itemType, itemKey, {
    status: itemType === "assessment_skip" ? "skipped" : "completed",
    completed_at: new Date().toISOString(),
  });
}

export function isManualProgressItemType(itemType: string): boolean {
  return (["resource_complete", "chat_checkpoint", "objective", "file_read", "architecture_review"] as string[]).includes(itemType);
}

export function computeStageProgress(stageId: string): {
  total: number;
  completed: number;
  percent: number;
  items: StageLearningItem[];
} {
  const items = getLearningItemsByStage(stageId);
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "skipped").length;
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    items,
  };
}

// ==================== Stage Scenarios ====================

export interface StageScenario {
  id: string;
  stage_id: string;
  order_index: number;
  title: string;
  prompt: string;
  status: string;
  user_response: string;
  conclusion: string;
  conclusion_evidence: unknown[];
  completed_at: string | null;
  created_at: string;
}

export function seedScenariosFromStage(stageId: string, cases: string[], stageTitle: string) {
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) as c FROM stage_scenario WHERE stage_id = ?").get(stageId) as { c: number };
  if (existing.c > 0) return;

  const scenarios = cases.length > 0 ? cases : [`在「${stageTitle}」场景下完成一次结构化分析`];
  scenarios.forEach((title, i) => {
    db.prepare(
      `INSERT INTO stage_scenario (id, stage_id, order_index, title, prompt, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(uuidv4(), stageId, i, title.slice(0, 200), `请结合本阶段所学，完成场景：${title}`, "pending");
    upsertLearningItem(stageId, "scenario_complete", String(i), {
      title: `完成场景：${title.slice(0, 80)}`,
      status: "pending",
    });
  });
}

export function getScenariosByStage(stageId: string): StageScenario[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM stage_scenario WHERE stage_id = ? ORDER BY order_index ASC"
  ).all(stageId) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    conclusion_evidence: parseJsonField(r.conclusion_evidence),
  })) as unknown as StageScenario[];
}

export function getScenario(id: string): StageScenario | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM stage_scenario WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    conclusion_evidence: parseJsonField(row.conclusion_evidence),
  } as unknown as StageScenario;
}

const SCENARIO_UPDATE_WHITELIST = new Set([
  "title", "prompt", "status", "user_response", "conclusion", "conclusion_evidence", "completed_at",
]);

export function updateScenario(id: string, updates: Partial<StageScenario>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!SCENARIO_UPDATE_WHITELIST.has(key)) continue;
    if (key === "conclusion_evidence") {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value || []));
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE stage_scenario SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

// ==================== Interview Session / Turn ====================

export interface InterviewSession {
  id: string;
  session_key: string;
  scope_type: string;
  plan_id: string | null;
  stage_id: string | null;
  plan_ids: string[];
  style: string;
  countdown_enabled: boolean;
  countdown_seconds: number;
  fail_on_timeout: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface InterviewTurn {
  id: string;
  session_id: string;
  turn_index: number;
  role: string;
  content: string;
  is_late: boolean;
  elapsed_seconds: number | null;
  answer_deadline_at: string | null;
  answered_at: string | null;
  created_at: string;
}

export function getInterviewSessionByKey(sessionKey: string): InterviewSession | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM interview_session WHERE session_key = ?").get(sessionKey) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    plan_ids: parseJsonField(row.plan_ids) as string[],
    countdown_enabled: row.countdown_enabled === 1,
    fail_on_timeout: row.fail_on_timeout === 1,
  } as unknown as InterviewSession;
}

export function createInterviewSession(session: {
  session_key: string;
  scope_type: string;
  plan_id?: string | null;
  stage_id?: string | null;
  plan_ids?: string[];
  style?: string;
  countdown_enabled?: boolean;
  countdown_seconds?: number;
  fail_on_timeout?: boolean;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO interview_session (id, session_key, scope_type, plan_id, stage_id, plan_ids, style, countdown_enabled, countdown_seconds, fail_on_timeout)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    session.session_key,
    session.scope_type,
    session.plan_id ?? null,
    session.stage_id ?? null,
    JSON.stringify(session.plan_ids || []),
    session.style || "standard",
    session.countdown_enabled ? 1 : 0,
    session.countdown_seconds ?? 120,
    session.fail_on_timeout ? 1 : 0
  );
  return id;
}

export function getOrCreateInterviewSession(params: {
  session_key: string;
  scope_type: string;
  plan_id?: string | null;
  stage_id?: string | null;
  plan_ids?: string[];
  style?: string;
  countdown_enabled?: boolean;
  countdown_seconds?: number;
  fail_on_timeout?: boolean;
}): InterviewSession {
  const existing = getInterviewSessionByKey(params.session_key);
  if (existing) return existing;
  const id = createInterviewSession(params);
  return getInterviewSessionByKey(params.session_key)!;
}

export function getInterviewTurns(sessionId: string): InterviewTurn[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM interview_turn WHERE session_id = ? ORDER BY turn_index ASC"
  ).all(sessionId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      is_late: row.is_late === 1,
      answer_deadline_at: (row.answer_deadline_at as string) || null,
      answered_at: (row.answered_at as string) || null,
    };
  }) as unknown as InterviewTurn[];
}

export function addInterviewTurn(turn: {
  session_id: string;
  turn_index: number;
  role: string;
  content: string;
  is_late?: boolean;
  elapsed_seconds?: number | null;
  answer_deadline_at?: string | null;
  answered_at?: string | null;
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO interview_turn (id, session_id, turn_index, role, content, is_late, elapsed_seconds, answer_deadline_at, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    turn.session_id,
    turn.turn_index,
    turn.role,
    turn.content,
    turn.is_late ? 1 : 0,
    turn.elapsed_seconds ?? null,
    turn.answer_deadline_at ?? null,
    turn.answered_at ?? null
  );
  db.prepare("UPDATE interview_session SET updated_at = datetime('now') WHERE id = ?").run(turn.session_id);
  return id;
}

export function deleteInterviewSessionByKey(sessionKey: string) {
  const db = getDb();
  const session = getInterviewSessionByKey(sessionKey);
  if (!session) return;
  db.prepare("DELETE FROM interview_turn WHERE session_id = ?").run(session.id);
  db.prepare("DELETE FROM interview_session WHERE id = ?").run(session.id);
}

export function isOutlineConfirmed(stage: Stage): boolean {
  return stage.outline_status === "confirmed";
}

export function stageRequiresOutlineConfirmation(stage: Stage): boolean {
  return stage.outline_status === "pending" || stage.outline_status === "draft";
}
