// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { getDb, resetDatabase, testDir } from "./helpers.ts"
import { openDatabase, SCHEMA_VERSION } from "../db.ts"
import { LEGACY_SCHEMA, LEGACY_SCHEMA_VERSION, legacyMigrate } from "../legacy-schema.ts"

const version = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
let counter = 0
const tmp = () => join(testDir, `migration-${++counter}.db`)

/** A database exactly as the application WASL was forked from (WSL) leaves it: schema v15, with some university-era data. */
function makeLegacyDatabase(path: string) {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = OFF")
  db.exec(LEGACY_SCHEMA)
  legacyMigrate(db)
  db.exec(`
    INSERT INTO universities (id, name, short_name, city, type, established, website, faculty, about) VALUES ('uni-1', 'Old University', 'OU', 'Amman', 'Public', 1962, 'ou.example', 'IT', 'x');
    INSERT INTO staff (id, university_id, name, title) VALUES ('stf-1', 'uni-1', 'Dr. Staff', 'Coordinator');
    INSERT INTO programs (id, university_id, name, major, coordinator_id) VALUES ('prg-1', 'uni-1', 'B.Sc. AI', 'Artificial Intelligence', 'stf-1');
    INSERT INTO companies (id, name, industry, city, logo_initials, about) VALUES ('org-1', 'Legacy Co', 'Software', 'Amman', 'LC', 'Builds things.');
    INSERT INTO students (id, university_id, program_id, student_number, name, year, gpa, city, bio, availability)
      VALUES ('stu-1', 'uni-1', 'prg-1', '2021001', 'Old Student', 'Year 3', 3.4, 'Irbid', 'A bio.', 'Open to Internships'),
             ('stu-2', 'uni-1', 'prg-1', '2021002', 'Other Student', 'Year 4', 3.9, 'Amman', '', 'Not Available');
  `)
  expect(version(db)).toBe(LEGACY_SCHEMA_VERSION)
  db.close()
}

describe("a new database", () => {
  it("is created directly at the WASL schema", () => {
    const db = openDatabase(tmp(), { seed: false })
    expect(version(db)).toBe(SCHEMA_VERSION)
    expect(tables(db)).toEqual(
      [
        "ai_calls", "assessments", "candidate_cv_files", "candidates", "challenge_history", "challenge_versions", "challenges", "companies", "company_actions", "exercise_responses",
        "exercises", "interview_messages", "interview_sessions", "lessons", "notifications", "phases", "practice_challenges", "recommendations", "reviews", "run_phases", "runs",
        "share_history", "skill_evidence", "skill_gaps", "submission_artifacts", "submissions",
      ].sort(),
    )
    for (const gone of ["universities", "staff", "programs", "students", "projects", "evidence", "skill_signals", "challenge_assignments"]) expect(tables(db)).not.toContain(gone)
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([])
  })

  it("is seeded once, and re-opening does not seed again", () => {
    const path = tmp()
    const first = openDatabase(path)
    const n = (first.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }).n
    expect(n).toBe(2)
    first.close()
    const again = openDatabase(path)
    expect((again.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }).n).toBe(2)
    expect(version(again)).toBe(SCHEMA_VERSION)
  })

  it("can start empty", () => {
    process.env.WASL_SEED_DEMO_DATA = "false"
    try {
      const db = openDatabase(tmp())
      expect((db.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }).n).toBe(0)
    } finally {
      delete process.env.WASL_SEED_DEMO_DATA
    }
  })

  it("the seed passes its own integrity checks", () => {
    resetDatabase()
    expect(getDb().prepare("PRAGMA foreign_key_check").all()).toEqual([])
    expect(getDb().prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
  })
})

describe("constraints", () => {
  const db = openDatabase(tmp(), { seed: false })
  const fails = (sql: string) => expect(() => db.exec(sql)).toThrow(/constraint/i)
  db.exec("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 'x')")
  db.exec("INSERT INTO candidates (id, name, created_at, updated_at) VALUES ('k1', 'K', 'x', 'x')")

  it("rejects values outside every enumeration", () => {
    fails("INSERT INTO challenges (id, company_id, problem_description, difficulty, expected_deliverables, time_hours, status, created_at, updated_at) VALUES ('x', 'c1', 'p', 'beginner', 'e', 5, 'live', 'x', 'x')")
    fails("INSERT INTO challenges (id, company_id, problem_description, difficulty, expected_deliverables, time_hours, created_at, updated_at) VALUES ('x', 'c1', 'p', 'expert', 'e', 5, 'x', 'x')")
    fails("INSERT INTO challenges (id, company_id, problem_description, difficulty, expected_deliverables, time_hours, created_at, updated_at) VALUES ('x', 'c1', 'p', 'beginner', 'e', 0, 'x', 'x')")
    fails("UPDATE candidates SET availability = 'maybe' WHERE id = 'k1'")
    fails("UPDATE candidates SET status = 'professor' WHERE id = 'k1'")
    fails("UPDATE candidates SET discoverable = 2 WHERE id = 'k1'")
  })

  it("rejects a run that is not exactly one of company or practice work", () => {
    fails("INSERT INTO runs (id, candidate_id, kind, version_id, started_at) VALUES ('r1', 'k1', 'company', 'v', 'x')")
    fails("INSERT INTO runs (id, candidate_id, kind, challenge_id, practice_id, version_id, started_at) VALUES ('r2', 'k1', 'company', 'a', 'b', 'v', 'x')")
    fails("INSERT INTO runs (id, candidate_id, kind, practice_id, version_id, started_at) VALUES ('r3', 'k1', 'company', 'b', 'v', 'x')")
  })

  it("only knows the nine phase states and three sharing scopes", () => {
    fails("INSERT INTO run_phases (id, run_id, phase_id, state, updated_at) VALUES ('rp', 'r', 'p', 'done', 'x')")
    fails("INSERT INTO runs (id, candidate_id, kind, practice_id, version_id, share_scope, started_at) VALUES ('r4', 'k1', 'practice', 'b', 'v', 'public', 'x')")
  })

  it("allows a decision to be only 'passed' or 'failed'", () => {
    fails("INSERT INTO assessments (id, submission_id, correctness, code_quality, understanding, outcome, outcome_reason, summary, created_at) VALUES ('a', 's', 3, 3, 3, 'unavailable', 'r', 's', 'x')")
    fails("INSERT INTO assessments (id, submission_id, correctness, code_quality, understanding, outcome, outcome_reason, summary, created_at) VALUES ('a', 's', 4, 3, 3, 'passed', 'r', 's', 'x')")
  })
})

describe("upgrading a WSL database", () => {
  it("keeps companies and student profiles, drops everything university-shaped, and backs up first", () => {
    const path = tmp()
    makeLegacyDatabase(path)
    const db = openDatabase(path)

    expect(version(db)).toBe(SCHEMA_VERSION)
    expect(db.prepare("SELECT id, name, industry, location, logo_initials, about FROM companies").all()).toEqual([
      { id: "org-1", name: "Legacy Co", industry: "Software", location: "Amman", logo_initials: "LC", about: "Builds things." },
    ])
    const candidates = db.prepare("SELECT id, name, bio, location, status, availability, discoverable FROM candidates ORDER BY id").all()
    expect(candidates).toEqual([
      { id: "stu-1", name: "Old Student", bio: "A bio.", location: "Irbid", status: "student", availability: "open_to_internships", discoverable: 0 },
      { id: "stu-2", name: "Other Student", bio: "", location: "Amman", status: "student", availability: "not_available", discoverable: 0 },
    ])
    for (const gone of ["universities", "staff", "programs", "students", "projects", "project_members", "evidence", "skill_signals", "challenge_assignments", "company_contacts", "opportunities", "company_feedback"]) {
      expect(tables(db), gone).not.toContain(gone)
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([])
    // Nobody is discoverable until they choose to be, and no verification carried over.
    expect((db.prepare("SELECT COUNT(*) AS n FROM skill_evidence").get() as { n: number }).n).toBe(0)

    // The original file was copied before anything was dropped, and it is still a legacy database.
    expect(existsSync(`${path}.pre-wasl.bak`)).toBe(true)
    const backup = new DatabaseSync(`${path}.pre-wasl.bak`)
    expect(tables(backup)).toContain("universities")
    expect((backup.prepare("SELECT COUNT(*) AS n FROM students").get() as { n: number }).n).toBe(2)
    backup.close()
  })

  it("is idempotent: opening the upgraded database again changes nothing", () => {
    const path = tmp()
    makeLegacyDatabase(path)
    openDatabase(path).close()
    const again = openDatabase(path)
    expect(version(again)).toBe(SCHEMA_VERSION)
    expect((again.prepare("SELECT COUNT(*) AS n FROM candidates").get() as { n: number }).n).toBe(2)
    expect((again.prepare("SELECT COUNT(*) AS n FROM companies").get() as { n: number }).n).toBe(1)
  })

  it("lets a migrated database do real work afterwards", () => {
    const db = openDatabase(tmp(), { seed: false })
    expect(() => db.exec("INSERT INTO companies (id, name, created_at) VALUES ('z', 'Z Co', 'x')")).not.toThrow()
  })

  it("leaves the legacy migration chain (v2 → v15) as it was, in its own file", () => {
    const source = readFileSync(new URL("../legacy-schema.ts", import.meta.url), "utf8")
    for (const marker of ["v2: a challenge's single assigned university", "v7: challenges gained `shared_sensitive_data`", "v14: team projects get individual proof", "v15: a reviewer can explicitly acknowledge"]) {
      expect(source).toContain(marker)
    }
    expect(LEGACY_SCHEMA_VERSION).toBe(15)
    // Running the chain on an already-current legacy database is a no-op.
    const db = new DatabaseSync(":memory:")
    db.exec(LEGACY_SCHEMA)
    legacyMigrate(db)
    const before = JSON.stringify(tables(db))
    legacyMigrate(db)
    expect(JSON.stringify(tables(db))).toBe(before)
  })
})
