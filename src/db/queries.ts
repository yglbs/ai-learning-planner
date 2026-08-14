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
}

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
  };
}

export function updateConfig(config: Partial<SystemConfig>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (key === "proxy_enabled") {
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
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO learning_plan (
      id, title, goal_description, duration_weeks, daily_hours, skill_level, status,
      user_motivation, user_background, expected_outcome,
      source_type, source_path, source_file_tree, source_files
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, plan.title, plan.goal_description, plan.duration_weeks, plan.daily_hours, plan.skill_level,
    plan.user_motivation || "", plan.user_background || "", plan.expected_outcome || "",
    plan.source_type || "goal",
    plan.source_path || "",
    plan.source_file_tree || "",
    JSON.stringify(plan.source_files || [])
  );
  return id;
}

function mapPlanRow(row: Record<string, unknown>): LearningPlan {
  return {
    ...(row as unknown as LearningPlan),
    review_enabled: row.review_enabled !== 0,
    adaptive_enabled: row.adaptive_enabled !== 0,
    analytics_enabled: row.analytics_enabled !== 0,
    source_type: (row.source_type as string) || "goal",
    source_path: (row.source_path as string) || "",
    source_file_tree: (row.source_file_tree as string) || "",
    source_files: parseJsonField(row.source_files) as string[],
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
    if (key === "source_files") {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value || []));
      continue;
    }
    fields.push(`${key} = ?`);
    values.push(value);
  }

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
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO stage (id, plan_id, order_index, title, description, key_topics, estimated_days, status, summary_text, unlocked_at, learning_objectives, core_output, real_world_cases, assessment_questions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    JSON.stringify(stage.assessment_questions || [])
  );
  return id;
}

export function getStagesByPlan(planId: string): Stage[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM stage WHERE plan_id = ? ORDER BY order_index").all(planId) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    key_topics: parseJsonField(row.key_topics) as string[],
    learning_objectives: parseJsonField(row.learning_objectives) as string[],
    real_world_cases: parseJsonField(row.real_world_cases) as string[],
    assessment_questions: parseJsonField(row.assessment_questions) as string[],
    resource_completion_rate: row.resource_completion_rate as number,
    core_output: (row.core_output as string) || "",
  })) as unknown as Stage[];
}

export function getStage(id: string): Stage | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM stage WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    key_topics: parseJsonField(row.key_topics) as string[],
    learning_objectives: parseJsonField(row.learning_objectives) as string[],
    real_world_cases: parseJsonField(row.real_world_cases) as string[],
    assessment_questions: parseJsonField(row.assessment_questions) as string[],
    core_output: (row.core_output as string) || "",
  } as unknown as Stage;
}

export function updateStage(id: string, updates: Partial<Stage & { key_topics: string[] }>) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  const jsonFields = ["key_topics", "learning_objectives", "real_world_cases", "assessment_questions"];

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
  db.prepare(`UPDATE stage SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function unlockNextStage(planId: string, currentIndex: number): boolean {
  const db = getDb();
  const next = db.prepare(
    "SELECT id FROM stage WHERE plan_id = ? AND order_index = ?"
  ).get(planId, currentIndex + 1) as { id: string } | undefined;

  if (!next) return false;

  db.prepare(
    "UPDATE stage SET status = 'active', unlocked_at = datetime('now') WHERE id = ?"
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
}): string {
  const db = getDb();
  const existing = db.prepare(
    "SELECT MAX(attempt_number) as max_attempt FROM assessment WHERE stage_id = ?"
  ).get(assessment.stage_id) as { max_attempt: number | null };

  const attemptNumber = (existing?.max_attempt || 0) + 1;
  const id = uuidv4();

  db.prepare(
    `INSERT INTO assessment (id, stage_id, type, input_text, score_overall, score_coverage, score_depth, score_accuracy, passed, feedback, missing_topics, suggestions, per_question_results, attempt_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    attemptNumber
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
      `INSERT INTO review_schedule (id, stage_id, plan_id, interval_days, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(id, stageId, planId, days, scheduled.toISOString());
    ids.push(id);
  }
  return ids;
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
    "UPDATE review_schedule SET status = 'expired' WHERE status = 'pending' AND scheduled_at < datetime('now', '-3 days')"
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
}): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO review_session (id, review_schedule_id, questions, score, duration_minutes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, session.review_schedule_id, JSON.stringify(session.questions), session.score, session.duration_minutes);

  db.prepare(
    "UPDATE review_schedule SET status = 'completed', completed_at = datetime('now'), score = ? WHERE id = ?"
  ).run(session.score, session.review_schedule_id);

  return id;
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
