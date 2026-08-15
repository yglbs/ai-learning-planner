import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR =
  process.env.APP_DATA_DIR ||
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "learning-planner.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function safeAddColumn(db: Database.Database, table: string, column: string, definition: string) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { ok: number } | undefined;
  return !!row;
}

/** teaching_chat.stage_id is used as a chat thread key (incl. interview_* ids), not always a real stage FK. */
function migrateTeachingChatDropStageFk(db: Database.Database) {
  if (!tableExists(db, "teaching_chat")) return;

  const fks = db.prepare("PRAGMA foreign_key_list(teaching_chat)").all() as { table: string }[];
  if (!fks.some((fk) => fk.table === "stage")) return;

  db.pragma("foreign_keys = OFF");
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE teaching_chat_new (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO teaching_chat_new (id, stage_id, role, content, created_at)
        SELECT id, stage_id, role, content, created_at FROM teaching_chat;
      DROP TABLE teaching_chat;
      ALTER TABLE teaching_chat_new RENAME TO teaching_chat;
      CREATE INDEX IF NOT EXISTS idx_teaching_chat_stage ON teaching_chat(stage_id);
    `);
  });
  migrate();
  db.pragma("foreign_keys = ON");
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      llm_provider TEXT NOT NULL DEFAULT 'openai',
      llm_api_key TEXT NOT NULL DEFAULT '',
      llm_base_url TEXT DEFAULT '',
      llm_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      search_api_key TEXT DEFAULT '',
      proxy_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_type TEXT DEFAULT 'http',
      proxy_host TEXT DEFAULT '',
      proxy_port INTEGER DEFAULT 0,
      proxy_username TEXT DEFAULT '',
      proxy_password TEXT DEFAULT '',
      schema_version INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO system_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS learning_plan (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal_description TEXT NOT NULL,
      duration_weeks INTEGER NOT NULL,
      daily_hours REAL NOT NULL,
      skill_level TEXT NOT NULL DEFAULT 'beginner',
      status TEXT NOT NULL DEFAULT 'draft',
      total_stages INTEGER NOT NULL DEFAULT 0,
      current_stage_index INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stage (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      key_topics TEXT NOT NULL DEFAULT '[]',
      estimated_days INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'locked',
      summary_text TEXT DEFAULT '',
      resource_completion_rate REAL NOT NULL DEFAULT 0,
      unlocked_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'article',
      reason TEXT NOT NULL DEFAULT '',
      estimated_minutes INTEGER DEFAULT 30,
      region_tag TEXT NOT NULL DEFAULT 'domestic',
      is_manual INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0,
      is_skipped INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      input_text TEXT NOT NULL DEFAULT '',
      score_overall REAL NOT NULL DEFAULT 0,
      score_coverage REAL NOT NULL DEFAULT 0,
      score_depth REAL NOT NULL DEFAULT 0,
      score_accuracy REAL NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      feedback TEXT NOT NULL DEFAULT '',
      missing_topics TEXT NOT NULL DEFAULT '[]',
      suggestions TEXT NOT NULL DEFAULT '[]',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_cache (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'tavily',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stage_plan_id ON stage(plan_id);
    CREATE INDEX IF NOT EXISTS idx_resource_stage_id ON resource(stage_id);
    CREATE INDEX IF NOT EXISTS idx_assessment_stage_id ON assessment(stage_id);
    CREATE INDEX IF NOT EXISTS idx_search_cache_query ON search_cache(query);
  `);

  safeAddColumn(db, "system_config", "tavily_api_key", "TEXT DEFAULT ''");
  safeAddColumn(db, "system_config", "quality_sites", "TEXT DEFAULT '[]'");
  safeAddColumn(db, "system_config", "search_region", "TEXT DEFAULT 'global'");

  safeAddColumn(db, "learning_plan", "user_motivation", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "user_background", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "expected_outcome", "TEXT DEFAULT ''");

  safeAddColumn(db, "stage", "real_world_cases", "TEXT DEFAULT '[]'");
  safeAddColumn(db, "stage", "assessment_questions", "TEXT DEFAULT '[]'");
  safeAddColumn(db, "stage", "core_output", "TEXT DEFAULT ''");
  safeAddColumn(db, "stage", "learning_objectives", "TEXT DEFAULT '[]'");

  safeAddColumn(db, "resource", "search_source", "TEXT DEFAULT 'llm'");
  safeAddColumn(db, "resource", "verified", "INTEGER DEFAULT 0");

  safeAddColumn(db, "assessment", "per_question_results", "TEXT DEFAULT '[]'");

  safeAddColumn(db, "learning_plan", "review_enabled", "INTEGER DEFAULT 1");
  safeAddColumn(db, "learning_plan", "adaptive_enabled", "INTEGER DEFAULT 1");
  safeAddColumn(db, "learning_plan", "analytics_enabled", "INTEGER DEFAULT 1");
  safeAddColumn(db, "learning_plan", "review_interval_preset", "TEXT DEFAULT 'standard'");

  safeAddColumn(db, "learning_plan", "source_type", "TEXT DEFAULT 'goal'");
  safeAddColumn(db, "learning_plan", "source_path", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "source_file_tree", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "source_files", "TEXT DEFAULT '[]'");

  safeAddColumn(db, "system_config", "review_notifications", "INTEGER DEFAULT 1");
  safeAddColumn(db, "system_config", "default_review_interval_preset", "TEXT DEFAULT 'standard'");

  // teaching_chat.stage_id is a chat thread key (real stage id OR interview_* / stage_interview_*),
  // so it must not enforce FK to stage(id).
  migrateTeachingChatDropStageFk(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS teaching_chat (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_teaching_chat_stage ON teaching_chat(stage_id);

    CREATE TABLE IF NOT EXISTS review_schedule (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      interval_days INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      score REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_review_schedule_plan ON review_schedule(plan_id);
    CREATE INDEX IF NOT EXISTS idx_review_schedule_stage ON review_schedule(stage_id);
    CREATE INDEX IF NOT EXISTS idx_review_schedule_date ON review_schedule(scheduled_at);

    CREATE TABLE IF NOT EXISTS review_session (
      id TEXT PRIMARY KEY,
      review_schedule_id TEXT NOT NULL,
      questions TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (review_schedule_id) REFERENCES review_schedule(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_concept (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL DEFAULT '',
      mastery_status TEXT NOT NULL DEFAULT 'untouched',
      source_stage_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_concept_plan ON knowledge_concept(plan_id);

    CREATE TABLE IF NOT EXISTS knowledge_relation (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      from_concept_id TEXT NOT NULL,
      to_concept_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'related',
      source TEXT NOT NULL DEFAULT 'ai',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE,
      FOREIGN KEY (from_concept_id) REFERENCES knowledge_concept(id) ON DELETE CASCADE,
      FOREIGN KEY (to_concept_id) REFERENCES knowledge_concept(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_relation_plan ON knowledge_relation(plan_id);

    CREATE TABLE IF NOT EXISTS stage_project (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      expected_output TEXT NOT NULL DEFAULT '',
      checklist TEXT NOT NULL DEFAULT '[]',
      output_notes TEXT NOT NULL DEFAULT '',
      attachment_paths TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      estimated_minutes INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'not_started',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_stage ON stage_project(stage_id);

    CREATE TABLE IF NOT EXISTS learning_session (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      stage_id TEXT,
      activity_type TEXT NOT NULL DEFAULT 'resource',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      is_manual INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_plan ON learning_session(plan_id);
    CREATE INDEX IF NOT EXISTS idx_session_started ON learning_session(started_at);

    CREATE TABLE IF NOT EXISTS mastery_profile (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      overall_level TEXT NOT NULL DEFAULT 'on_track',
      weak_topics TEXT NOT NULL DEFAULT '[]',
      assessment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mastery_plan ON mastery_profile(plan_id);

    CREATE TABLE IF NOT EXISTS adaptive_adjustment (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      stage_id TEXT,
      trigger_reason TEXT NOT NULL DEFAULT '',
      adjustment_type TEXT NOT NULL DEFAULT 'stage_depth',
      before_snapshot TEXT NOT NULL DEFAULT '{}',
      after_snapshot TEXT NOT NULL DEFAULT '{}',
      user_accepted INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_adjustment_plan ON adaptive_adjustment(plan_id);

    CREATE TABLE IF NOT EXISTS export_record (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      export_type TEXT NOT NULL DEFAULT 'certificate',
      file_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES learning_plan(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_export_plan ON export_record(plan_id);

    CREATE TABLE IF NOT EXISTS stage_note (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL UNIQUE,
      ai_summary TEXT NOT NULL DEFAULT '',
      user_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stage_note_stage ON stage_note(stage_id);
  `);

  // --- Schema v3: learning mode, outlines, progress, interview sessions ---
  safeAddColumn(db, "learning_plan", "learning_mode", "TEXT DEFAULT 'business'");
  safeAddColumn(db, "learning_plan", "career_identity", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "architecture_snapshot", "TEXT DEFAULT ''");
  safeAddColumn(db, "learning_plan", "architecture_generated_at", "TEXT");

  safeAddColumn(db, "stage", "outline_status", "TEXT DEFAULT 'confirmed'");
  safeAddColumn(db, "stage", "outline_json", "TEXT DEFAULT ''");
  safeAddColumn(db, "stage", "outline_confirmed_at", "TEXT");
  safeAddColumn(db, "stage", "learning_started_at", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS stage_learning_item (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_key TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT NOT NULL DEFAULT '{}',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE,
      UNIQUE(stage_id, item_type, item_key)
    );
    CREATE INDEX IF NOT EXISTS idx_learning_item_stage ON stage_learning_item(stage_id);

    CREATE TABLE IF NOT EXISTS stage_scenario (
      id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      user_response TEXT DEFAULT '',
      conclusion TEXT DEFAULT '',
      conclusion_evidence TEXT NOT NULL DEFAULT '[]',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scenario_stage ON stage_scenario(stage_id);

    CREATE TABLE IF NOT EXISTS interview_session (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL UNIQUE,
      scope_type TEXT NOT NULL DEFAULT 'stage',
      plan_id TEXT,
      stage_id TEXT,
      plan_ids TEXT NOT NULL DEFAULT '[]',
      style TEXT NOT NULL DEFAULT 'standard',
      countdown_enabled INTEGER NOT NULL DEFAULT 0,
      countdown_seconds INTEGER NOT NULL DEFAULT 120,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_interview_session_key ON interview_session(session_key);

    CREATE TABLE IF NOT EXISTS interview_turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      is_late INTEGER NOT NULL DEFAULT 0,
      elapsed_seconds REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_interview_turn_session ON interview_turn(session_id);
  `);

  safeAddColumn(db, "interview_turn", "answer_deadline_at", "TEXT");
  safeAddColumn(db, "interview_turn", "answered_at", "TEXT");

  migrateSchemaV3Backfill(db);
}

function migrateSchemaV3Backfill(db: Database.Database) {
  const row = db.prepare("SELECT schema_version FROM system_config WHERE id = 1").get() as
    | { schema_version: number }
    | undefined;
  const currentVersion = row?.schema_version ?? 2;
  if (currentVersion >= 3) return;

  db.transaction(() => {
    // Code plans default to business_through_tech
    db.prepare(
      `UPDATE learning_plan SET learning_mode = 'business_through_tech'
       WHERE source_type = 'code' AND (learning_mode IS NULL OR learning_mode = 'business' OR learning_mode = '')`
    ).run();

    // Backfill outline_status for legacy stages
    const stages = db.prepare("SELECT id, status FROM stage").all() as { id: string; status: string }[];
    for (const stage of stages) {
      let outlineStatus = "confirmed";
      if (stage.status === "completed") {
        outlineStatus = "confirmed";
      } else {
        const chatCount = db
          .prepare("SELECT COUNT(*) as c FROM teaching_chat WHERE stage_id = ?")
          .get(stage.id) as { c: number };
        if (chatCount.c > 0) {
          outlineStatus = "confirmed";
        }
        // Pre-existing active with no chat: remain confirmed (legacy usability)
      }
      db.prepare("UPDATE stage SET outline_status = ? WHERE id = ? AND (outline_status IS NULL OR outline_status = '')").run(
        outlineStatus,
        stage.id
      );
    }

    db.prepare("UPDATE system_config SET schema_version = 3, updated_at = datetime('now') WHERE id = 1").run();
  })();
}
