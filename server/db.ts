import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { LEGACY_SCHEMA, legacyMigrate } from "./legacy-schema.ts"
import { seedDatabase } from "./seed.ts"
import { all, one, transaction } from "./sql.ts"

// The single source of truth for WASL. Every page reads from here (through the API) and every action writes here —
// nothing in the client is hard-coded.
const DB_PATH = resolve(process.cwd(), process.env.WASL_DB_PATH ?? "data/wasl.db")

/**
 * The WASL schema (v16). Fresh databases are created directly at this version. Databases created by WSL (the application
 * WASL was forked from) are brought to WSL's final version by the preserved legacy chain in legacy-schema.ts and then
 * converted by `migrateToWasl` below — the applied legacy migrations are never edited.
 *
 * Every enumeration is a CHECK constraint, every foreign key is indexed, and every list that the application treats as
 * structured (skills, criteria, findings…) is JSON text validated at the API boundary.
 */
const WASL_SCHEMA = `
-- ───────────── identity ─────────────
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  industry      TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  logo_initials TEXT NOT NULL DEFAULT '',
  about         TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

-- A student or a graduate. Everything here is self-declared; none of it is verified by anyone.
CREATE TABLE IF NOT EXISTS candidates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  headline        TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'student' CHECK (status IN ('student', 'graduate')),
  education       TEXT NOT NULL DEFAULT '',
  availability    TEXT NOT NULL DEFAULT 'not_available' CHECK (availability IN ('open_to_work', 'open_to_internships', 'not_available')),
  declared_skills TEXT NOT NULL DEFAULT '[]',
  links           TEXT NOT NULL DEFAULT '[]',
  -- Opt-in: a candidate appears in Talent Discovery only when this is 1.
  discoverable    INTEGER NOT NULL DEFAULT 0 CHECK (discoverable IN (0, 1)),
  -- Whether employers who find the profile may also download the CV. Off by default.
  cv_shared       INTEGER NOT NULL DEFAULT 0 CHECK (cv_shared IN (0, 1)),
  is_demo_fixture INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_fixture IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_cv_files (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  data         BLOB NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  uploaded_at  TEXT NOT NULL
);

-- ───────────── company challenges ─────────────
-- A company's brief: five fields. Everything else (phases, criteria, rubrics) is generated, then reviewed by the company.
CREATE TABLE IF NOT EXISTS challenges (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  problem_description TEXT NOT NULL,
  required_skills     TEXT NOT NULL DEFAULT '[]',
  difficulty          TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  expected_deliverables TEXT NOT NULL,
  time_hours          INTEGER NOT NULL CHECK (time_hours BETWEEN 1 AND 200),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'reviewed', 'published', 'in_progress', 'completed', 'archived')),
  -- The version being edited / the version students work on (immutable once published).
  current_version_id   TEXT,
  published_version_id TEXT,
  -- The company confirmed how submissions may be used: to evaluate candidates only, no ownership transferred.
  evaluation_use_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (evaluation_use_acknowledged IN (0, 1)),
  is_demo_fixture     INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_fixture IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  published_at        TEXT
);

CREATE TABLE IF NOT EXISTS challenge_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  at           TEXT NOT NULL,
  note         TEXT
);

-- A student's Practice Lab request. Private to that student.
CREATE TABLE IF NOT EXISTS practice_challenges (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skills       TEXT NOT NULL DEFAULT '[]',
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  description  TEXT NOT NULL DEFAULT '',
  language     TEXT NOT NULL DEFAULT '',
  current_version_id TEXT,
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at   TEXT NOT NULL
);

-- The structured, generated challenge. A version is never edited in place: a company's edit creates the next version, so the
-- AI's original output and every revision stay on record, and students on a published version never see it change.
CREATE TABLE IF NOT EXISTS challenge_versions (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('company', 'practice')),
  challenge_id TEXT REFERENCES challenges(id) ON DELETE CASCADE,
  practice_id  TEXT REFERENCES practice_challenges(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  scenario     TEXT NOT NULL DEFAULT '',
  learning_goals TEXT NOT NULL DEFAULT '[]',
  skills       TEXT NOT NULL DEFAULT '[]',
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  estimated_hours REAL NOT NULL,
  -- Where the content came from: a model, the labelled offline scaffold, a company edit, or labelled demo data.
  origin       TEXT NOT NULL CHECK (origin IN ('ai', 'offline_template', 'company_edit', 'demo_fixture')),
  provider     TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  parent_version_id TEXT,
  created_at   TEXT NOT NULL,
  CHECK ((kind = 'company' AND challenge_id IS NOT NULL AND practice_id IS NULL) OR (kind = 'practice' AND practice_id IS NOT NULL AND challenge_id IS NULL)),
  UNIQUE (challenge_id, version),
  UNIQUE (practice_id, version)
);

CREATE TABLE IF NOT EXISTS phases (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES challenge_versions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  key           TEXT NOT NULL,
  title         TEXT NOT NULL,
  objective     TEXT NOT NULL,
  instructions  TEXT NOT NULL,
  skills        TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  rubric        TEXT NOT NULL DEFAULT '[]',
  deliverables  TEXT NOT NULL DEFAULT '[]',
  depends_on    TEXT NOT NULL DEFAULT '[]',
  estimated_hours REAL NOT NULL,
  UNIQUE (version_id, position),
  UNIQUE (version_id, key)
);

-- ───────────── a candidate's work ─────────────
CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('company', 'practice')),
  challenge_id TEXT REFERENCES challenges(id) ON DELETE CASCADE,
  practice_id  TEXT REFERENCES practice_challenges(id) ON DELETE CASCADE,
  version_id   TEXT NOT NULL REFERENCES challenge_versions(id),
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  -- Who may see this work: private (only the candidate), challenge_owner (the company that posted the challenge), or
  -- employers (any company, through Talent Discovery). Practice work starts private.
  share_scope  TEXT NOT NULL DEFAULT 'private' CHECK (share_scope IN ('private', 'challenge_owner', 'employers')),
  completion_note TEXT NOT NULL DEFAULT '',
  is_demo_fixture INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_fixture IN (0, 1)),
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((kind = 'company' AND challenge_id IS NOT NULL AND practice_id IS NULL) OR (kind = 'practice' AND practice_id IS NOT NULL AND challenge_id IS NULL)),
  UNIQUE (candidate_id, challenge_id),
  UNIQUE (practice_id)
);

CREATE TABLE IF NOT EXISTS share_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_scope TEXT NOT NULL,
  to_scope   TEXT NOT NULL,
  at         TEXT NOT NULL
);

-- The persistent per-phase state. "Locked" is not stored: it is derived from the phase's dependencies.
CREATE TABLE IF NOT EXISTS run_phases (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  phase_id    TEXT NOT NULL REFERENCES phases(id),
  state       TEXT NOT NULL DEFAULT 'not_started' CHECK (state IN
    ('not_started', 'in_progress', 'submitted', 'under_review', 'interview_in_progress', 'passed', 'failed', 'revision_needed', 'assessment_unavailable')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  UNIQUE (run_id, phase_id)
);

-- Every attempt is its own row; a resubmission never overwrites an earlier one.
CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  run_phase_id TEXT NOT NULL REFERENCES run_phases(id) ON DELETE CASCADE,
  attempt      INTEGER NOT NULL,
  language     TEXT NOT NULL DEFAULT '',
  code_text    TEXT NOT NULL DEFAULT '',
  github_url   TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  stage        TEXT NOT NULL DEFAULT 'received' CHECK (stage IN
    ('received', 'rejected', 'checked', 'reviewed', 'interviewing', 'assessed')),
  problems     TEXT NOT NULL DEFAULT '[]',
  pipeline_error TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE (run_phase_id, attempt)
);

CREATE TABLE IF NOT EXISTS submission_artifacts (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('pasted', 'repository')),
  content       TEXT NOT NULL,
  size          INTEGER NOT NULL,
  truncated     INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  redactions    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (submission_id, path)
);

-- ───────────── Proof Engine ─────────────
CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  input_hash     TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  summary        TEXT NOT NULL,
  findings       TEXT NOT NULL DEFAULT '[]',
  criteria       TEXT NOT NULL DEFAULT '[]',
  static_checks  TEXT NOT NULL DEFAULT '[]',
  injection_flagged INTEGER NOT NULL DEFAULT 0 CHECK (injection_flagged IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS interview_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('interviewer', 'candidate')),
  content     TEXT NOT NULL,
  -- For interviewer turns: what the question is grounded in (a finding, a rubric criterion, a quoted line) and why.
  grounding   TEXT NOT NULL DEFAULT '{}',
  is_followup INTEGER NOT NULL DEFAULT 0 CHECK (is_followup IN (0, 1)),
  injection_flagged INTEGER NOT NULL DEFAULT 0 CHECK (injection_flagged IN (0, 1)),
  created_at  TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

-- The decision. Written only after the interview is complete. The three dimensions are rated separately (0–3), each with
-- evidence the server has verified; "outcome" is computed by server/domain/decision.ts, not by the model.
CREATE TABLE IF NOT EXISTS assessments (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  correctness    INTEGER NOT NULL CHECK (correctness BETWEEN 0 AND 3),
  correctness_evidence TEXT NOT NULL DEFAULT '[]',
  code_quality   INTEGER NOT NULL CHECK (code_quality BETWEEN 0 AND 3),
  code_quality_evidence TEXT NOT NULL DEFAULT '[]',
  understanding  INTEGER NOT NULL CHECK (understanding BETWEEN 0 AND 3),
  understanding_evidence TEXT NOT NULL DEFAULT '[]',
  outcome        TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
  outcome_reason TEXT NOT NULL,
  summary        TEXT NOT NULL,
  strengths      TEXT NOT NULL DEFAULT '[]',
  weaknesses     TEXT NOT NULL DEFAULT '[]',
  origin         TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'demo_fixture')),
  provider       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

-- What a candidate has demonstrated about a skill, derived from assessments. 'attempted' is not a failure mark: it only
-- means the work is in progress.
CREATE TABLE IF NOT EXISTS skill_evidence (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skill         TEXT NOT NULL,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  phase_id      TEXT NOT NULL REFERENCES phases(id),
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  state         TEXT NOT NULL CHECK (state IN ('demonstrated', 'attempted')),
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (assessment_id, skill)
);

-- One row per model call: what, which provider, how it went. Never the prompt or the content.
CREATE TABLE IF NOT EXISTS ai_calls (
  id             TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL,
  provider       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  ok             INTEGER NOT NULL CHECK (ok IN (0, 1)),
  error_kind     TEXT NOT NULL DEFAULT '',
  attempts       INTEGER NOT NULL DEFAULT 1,
  latency_ms     INTEGER NOT NULL DEFAULT 0,
  subject_type   TEXT NOT NULL DEFAULT '',
  subject_id     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

-- ───────────── personalized improvement ─────────────
CREATE TABLE IF NOT EXISTS skill_gaps (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  phase_id      TEXT NOT NULL REFERENCES phases(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  skill         TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  evidence      TEXT NOT NULL DEFAULT '[]',
  severity      TEXT NOT NULL CHECK (severity IN ('minor', 'moderate', 'significant')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id          TEXT PRIMARY KEY,
  gap_id      TEXT NOT NULL REFERENCES skill_gaps(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  url         TEXT NOT NULL,
  -- 'catalog': a resource from the curated catalog. 'search': a search link we construct (never presented as a course).
  kind        TEXT NOT NULL CHECK (kind IN ('catalog', 'search')),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_at TEXT,
  verify_note TEXT NOT NULL DEFAULT '',
  why         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lessons (
  id             TEXT PRIMARY KEY,
  gap_id         TEXT NOT NULL UNIQUE REFERENCES skill_gaps(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  key_points     TEXT NOT NULL DEFAULT '[]',
  provider       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id             TEXT PRIMARY KEY,
  gap_id         TEXT NOT NULL UNIQUE REFERENCES skill_gaps(id) ON DELETE CASCADE,
  prompt         TEXT NOT NULL,
  hints          TEXT NOT NULL DEFAULT '[]',
  provider       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_responses (
  id          TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  answer      TEXT NOT NULL,
  feedback    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- ───────────── hiring ─────────────
CREATE TABLE IF NOT EXISTS company_actions (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('saved', 'interested')),
  message      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  UNIQUE (company_id, candidate_id, kind)
);

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('student', 'company')),
  recipient_id   TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  link           TEXT,
  read           INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_challenges_company ON challenges (company_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges (status);
CREATE INDEX IF NOT EXISTS idx_history_challenge ON challenge_history (challenge_id);
CREATE INDEX IF NOT EXISTS idx_practice_candidate ON practice_challenges (candidate_id);
CREATE INDEX IF NOT EXISTS idx_versions_challenge ON challenge_versions (challenge_id);
CREATE INDEX IF NOT EXISTS idx_versions_practice ON challenge_versions (practice_id);
CREATE INDEX IF NOT EXISTS idx_phases_version ON phases (version_id);
CREATE INDEX IF NOT EXISTS idx_runs_candidate ON runs (candidate_id);
CREATE INDEX IF NOT EXISTS idx_runs_challenge ON runs (challenge_id);
CREATE INDEX IF NOT EXISTS idx_runs_version ON runs (version_id);
CREATE INDEX IF NOT EXISTS idx_share_history_run ON share_history (run_id);
CREATE INDEX IF NOT EXISTS idx_run_phases_run ON run_phases (run_id);
CREATE INDEX IF NOT EXISTS idx_run_phases_phase ON run_phases (phase_id);
CREATE INDEX IF NOT EXISTS idx_submissions_run_phase ON submissions (run_phase_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_submission ON submission_artifacts (submission_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON interview_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_candidate ON skill_evidence (candidate_id);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON skill_evidence (run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_skill ON skill_evidence (skill);
CREATE INDEX IF NOT EXISTS idx_gaps_candidate ON skill_gaps (candidate_id);
CREATE INDEX IF NOT EXISTS idx_gaps_run ON skill_gaps (run_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_gap ON recommendations (gap_id);
CREATE INDEX IF NOT EXISTS idx_responses_exercise ON exercise_responses (exercise_id);
CREATE INDEX IF NOT EXISTS idx_actions_company ON company_actions (company_id);
CREATE INDEX IF NOT EXISTS idx_actions_candidate ON company_actions (candidate_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_role, recipient_id);
CREATE INDEX IF NOT EXISTS idx_ai_calls_subject ON ai_calls (subject_type, subject_id);
`

export const SCHEMA_VERSION = 16

/** Every user table (sqlite's own bookkeeping tables excluded). */
function tableNames(db: DatabaseSync): string[] {
  return all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => String(r.name))
}

const hasTable = (db: DatabaseSync, name: string) => !!one(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name)
const userVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version

let instance: DatabaseSync | null = null

/** Opens (and, if needed, creates or upgrades) a database at `path`. Exported for the migration tests. */
export function openDatabase(path: string, options: { seed?: boolean; backup?: boolean } = {}): DatabaseSync {
  const isFile = path !== ":memory:"
  if (isFile) mkdirSync(dirname(path), { recursive: true })
  const preexisting = isFile && existsSync(path)
  const db = new DatabaseSync(path)
  // node:sqlite enables foreign keys by default; keep them off until migrations have run, since rebuilding or dropping a
  // table is only safe with them disabled.
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA journal_mode = WAL;")

  const legacy = hasTable(db, "universities")
  if (legacy && userVersion(db) < SCHEMA_VERSION) {
    // A database created by WSL. Keep a copy of the file before converting it.
    if (preexisting && options.backup !== false) {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
      copyFileSync(path, `${path}.pre-wasl.bak`)
    }
    db.exec(LEGACY_SCHEMA)
    legacyMigrate(db)
    migrateToWasl(db)
  } else {
    db.exec(WASL_SCHEMA)
    if (userVersion(db) < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  db.exec("PRAGMA foreign_keys = ON;")
  if (options.seed !== false) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }
    if (n === 0) transaction(db, () => seedDatabase(db))
  }
  return db
}

/**
 * v16 — WSL → WASL. WSL had three roles (student, university, company) and a university-verification pipeline; WASL has two
 * roles and no university. This keeps what still means something — companies and student profiles — and drops the rest.
 *
 * Carried over: companies (name, industry, city → location, about), students → candidates (name, bio, city, availability).
 * Dropped: universities, staff, programs, GPA and student numbers, projects, teams, evidence, AI signals and every
 * university verification, challenges and assignments, company feedback, opportunities, notifications. None of it maps to
 * the WASL model (a verification by a university is exactly what WASL removes), and carrying forward a "verified" mark
 * that nothing in WASL could re-derive would be a false claim. The file is copied to `<db>.pre-wasl.bak` first.
 */
function migrateToWasl(db: DatabaseSync): void {
  const companies = all(db, "SELECT id, name, industry, city, logo_initials, about FROM companies")
  const students = all(db, "SELECT id, name, year, city, bio, availability FROM students")
  const legacyTables = tableNames(db)
  const now = new Date().toISOString()
  transaction(db, () => {
    for (const t of legacyTables) db.exec(`DROP TABLE IF EXISTS "${t}"`)
    db.exec(WASL_SCHEMA)
    for (const c of companies) {
      db.prepare("INSERT INTO companies (id, name, industry, location, logo_initials, about, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        String(c.id), String(c.name), String(c.industry), String(c.city), String(c.logo_initials), String(c.about), now,
      )
    }
    for (const s of students) {
      const availability = s.availability === "Open to Opportunities" ? "open_to_work" : s.availability === "Open to Internships" ? "open_to_internships" : "not_available"
      db.prepare("INSERT INTO candidates (id, name, bio, location, status, availability, created_at, updated_at) VALUES (?, ?, ?, ?, 'student', ?, ?, ?)").run(
        String(s.id), String(s.name), String(s.bio), String(s.city), availability, now, now,
      )
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
}

export function getDb(): DatabaseSync {
  if (!instance) instance = openDatabase(DB_PATH)
  return instance
}

/** Wipes every table and re-seeds the demonstration data. */
export function resetDatabase(): void {
  const db = getDb()
  db.exec("PRAGMA foreign_keys = OFF")
  try {
    transaction(db, () => {
      for (const t of tableNames(db)) db.exec(`DELETE FROM "${t}"`)
      seedDatabase(db)
    })
  } finally {
    db.exec("PRAGMA foreign_keys = ON")
  }
}

export { DB_PATH, transaction }
