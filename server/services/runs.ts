import type { DatabaseSync } from "node:sqlite"
import { OPEN_STATUSES } from "../domain/lifecycle.ts"
import { availability, completion, PHASE_STATE_LABELS, transition } from "../domain/phases.ts"
import type { PhaseEvent, PhaseNode, PhaseState } from "../domain/phases.ts"
import { publicPhase } from "../domain/spec.ts"
import { ApiError } from "../http.ts"
import type { Body } from "../http.ts"
import { all, exec, newId, nowIso, one, transaction } from "../sql.ts"
import { advance, challengeById } from "./challenges.ts"
import { notify } from "./notifications.ts"
import { loadVersion, versionMeta } from "./versions.ts"
import type { StoredVersion } from "./versions.ts"

export const SHARE_SCOPES = ["private", "challenge_owner", "employers"] as const
export type ShareScope = (typeof SHARE_SCOPES)[number]

export const SHARE_SCOPE_LABELS: Record<ShareScope, string> = {
  private: "Only me",
  challenge_owner: "The company that posted this challenge",
  employers: "Employers who find me in Talent Discovery",
}

export interface RunRow {
  id: string
  candidateId: string
  kind: "company" | "practice"
  challengeId: string | null
  practiceId: string | null
  versionId: string
  status: "in_progress" | "completed"
  shareScope: ShareScope
  completionNote: string
  isDemoFixture: boolean
  startedAt: string
  completedAt: string | null
}

const toRun = (r: Record<string, unknown>): RunRow => ({
  id: String(r.id),
  candidateId: String(r.candidate_id),
  kind: r.kind as "company" | "practice",
  challengeId: (r.challenge_id as string | null) ?? null,
  practiceId: (r.practice_id as string | null) ?? null,
  versionId: String(r.version_id),
  status: r.status as "in_progress" | "completed",
  shareScope: r.share_scope as ShareScope,
  completionNote: String(r.completion_note ?? ""),
  isDemoFixture: r.is_demo_fixture === 1,
  startedAt: String(r.started_at),
  completedAt: (r.completed_at as string | null) ?? null,
})

/** A candidate's own run. Anyone else's is "not found". */
export function ownedRun(db: DatabaseSync, candidateId: string, runId: string): RunRow {
  const r = one(db, "SELECT * FROM runs WHERE id = ? AND candidate_id = ?", runId, candidateId)
  if (!r) throw new ApiError(404, "That work wasn't found.")
  return toRun(r)
}

export const runById = (db: DatabaseSync, runId: string): RunRow | null => {
  const r = one(db, "SELECT * FROM runs WHERE id = ?", runId)
  return r ? toRun(r) : null
}

export function createRun(db: DatabaseSync, args: { candidateId: string; kind: "company" | "practice"; challengeId?: string; practiceId?: string; versionId: string; shareScope: ShareScope; isDemoFixture?: boolean }): string {
  const version = loadVersion(db, args.versionId)
  if (!version) throw new ApiError(500, "The challenge version is missing.")
  const id = newId("run")
  const now = nowIso()
  exec(
    db,
    `INSERT INTO runs (id, candidate_id, kind, challenge_id, practice_id, version_id, status, share_scope, is_demo_fixture, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
    id, args.candidateId, args.kind, args.challengeId ?? null, args.practiceId ?? null, args.versionId, args.shareScope, args.isDemoFixture ? 1 : 0, now,
  )
  for (const phase of version.spec.phases) {
    exec(db, "INSERT INTO run_phases (id, run_id, phase_id, state, attempts, updated_at) VALUES (?, ?, ?, 'not_started', 0, ?)", newId("rph"), id, version.phaseIds[phase.key], now)
  }
  return id
}

export const CHALLENGE_SHARING_NOTICE = (company: string) =>
  `${company} will be able to see your submissions, the review, your interview answers and the assessment for this challenge, to evaluate your ability. Nothing you write becomes theirs, and it isn't shown to other companies unless you choose "Employers who find me" later.`

/** Starts (or returns) a candidate's run on a published company challenge. */
export function startCompanyRun(db: DatabaseSync, candidateId: string, challengeId: string, body: Body): { id: string; created: boolean } {
  const c = challengeById(db, challengeId)
  const existing = one(db, "SELECT id FROM runs WHERE candidate_id = ? AND challenge_id = ?", candidateId, challengeId)
  if (existing) return { id: String(existing.id), created: false }
  if (!c || !OPEN_STATUSES.includes(c.status) || !c.publishedVersionId) throw new ApiError(404, "That challenge isn't open.")
  const company = one(db, "SELECT name FROM companies WHERE id = ?", c.companyId)!
  if (body.acknowledgeSharing !== true) {
    throw new ApiError(400, "Confirm that you understand who will see your work before you start.", "acknowledgeSharing", { notice: CHALLENGE_SHARING_NOTICE(String(company.name)) })
  }
  const candidate = one(db, "SELECT name FROM candidates WHERE id = ?", candidateId)!
  return transaction(db, () => {
    const id = createRun(db, { candidateId, kind: "company", challengeId, versionId: c.publishedVersionId!, shareScope: "challenge_owner" })
    advance(db, { id: c.id, status: c.status }, "start")
    notify(db, "company", c.companyId, "A candidate started your challenge", `${String(candidate.name)} started “${loadVersion(db, c.publishedVersionId!)!.spec.title}”.`, `/company/challenges/${c.id}`)
    return { id, created: true }
  })
}

// ------------------------------------------------------------------ phase state

export interface RunPhaseRow {
  id: string
  runId: string
  phaseId: string
  key: string
  state: PhaseState
  attempts: number
}

export function runPhaseRows(db: DatabaseSync, runId: string): RunPhaseRow[] {
  return all(
    db,
    `SELECT rp.id, rp.run_id, rp.phase_id, p.key, rp.state, rp.attempts
     FROM run_phases rp JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? ORDER BY p.position`,
    runId,
  ).map((r) => ({ id: String(r.id), runId: String(r.run_id), phaseId: String(r.phase_id), key: String(r.key), state: r.state as PhaseState, attempts: Number(r.attempts) }))
}

export function phaseNodes(version: StoredVersion): PhaseNode[] {
  return version.spec.phases.map((p, i) => ({ id: version.phaseIds[p.key], key: p.key, position: i + 1, dependsOn: p.dependsOn }))
}

export function statesOf(rows: RunPhaseRow[]): Map<string, PhaseState> {
  return new Map(rows.map((r) => [r.phaseId, r.state]))
}

/**
 * Applies a state event to a run phase. The write is conditional on the state we read, so two requests racing (a double click,
 * two tabs) cannot both move the same phase: the loser gets a 409 instead of corrupting the state.
 */
export function applyEvent(db: DatabaseSync, runPhaseId: string, event: PhaseEvent): PhaseState {
  const row = one(db, "SELECT state FROM run_phases WHERE id = ?", runPhaseId)
  if (!row) throw new ApiError(404, "Phase not found.")
  const from = row.state as PhaseState
  let to: PhaseState
  try {
    to = transition(from, event)
  } catch (err) {
    throw new ApiError(409, err instanceof Error ? err.message : "That isn't possible right now.")
  }
  const res = db.prepare("UPDATE run_phases SET state = ?, updated_at = ? WHERE id = ? AND state = ?").run(to, nowIso(), runPhaseId, from)
  if (Number(res.changes) !== 1) throw new ApiError(409, "This phase just changed. Reload and try again.")
  return to
}

// ------------------------------------------------------------------ views

export function loadRunVersion(db: DatabaseSync, run: RunRow): StoredVersion {
  const v = loadVersion(db, run.versionId)
  if (!v) throw new ApiError(500, "The challenge version is missing.")
  return v
}

/** The assessment ratings a candidate sees for a submission (never the model's raw output). */
export function assessmentSummary(db: DatabaseSync, submissionId: string) {
  const a = one(db, "SELECT * FROM assessments WHERE submission_id = ?", submissionId)
  if (!a) return null
  return {
    outcome: a.outcome as "passed" | "failed",
    outcomeReason: String(a.outcome_reason),
    summary: String(a.summary),
    ratings: { correctness: Number(a.correctness), codeQuality: Number(a.code_quality), understanding: Number(a.understanding) },
    origin: a.origin as "ai" | "demo_fixture",
    model: String(a.model),
    createdAt: String(a.created_at),
  }
}

export function runView(db: DatabaseSync, run: RunRow) {
  const version = loadRunVersion(db, run)
  const rows = runPhaseRows(db, run.id)
  const states = statesOf(rows)
  const nodes = phaseNodes(version)
  const avail = availability(nodes, states)
  const done = completion(nodes, states)
  const titleByKey = new Map(version.spec.phases.map((p) => [p.key, p.title]))
  const challenge = run.challengeId ? challengeById(db, run.challengeId) : null
  const company = challenge ? one(db, "SELECT id, name, logo_initials FROM companies WHERE id = ?", challenge.companyId) : null

  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    shareScope: run.shareScope,
    shareScopeLabel: SHARE_SCOPE_LABELS[run.shareScope],
    isDemoFixture: run.isDemoFixture,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    completionNote: run.completionNote,
    challengeId: run.challengeId,
    practiceId: run.practiceId,
    company: company ? { id: String(company.id), name: String(company.name), logoInitials: String(company.logo_initials) } : null,
    challenge: {
      title: version.spec.title,
      summary: version.spec.summary,
      scenario: version.spec.scenario,
      learningGoals: version.spec.learningGoals,
      skills: version.spec.skills,
      difficulty: version.spec.difficulty,
      estimatedHours: version.spec.estimatedHours,
      origin: versionMeta(version).originLabel,
    },
    progress: { passed: done.passed, total: done.total, complete: done.complete },
    canComplete: done.complete && run.status === "in_progress",
    phases: version.spec.phases.map((p, i) => {
      const row = rows.find((r) => r.key === p.key)!
      const a = avail.get(row.phaseId)!
      const latest = one(db, "SELECT id, attempt, stage, created_at FROM submissions WHERE run_phase_id = ? ORDER BY attempt DESC LIMIT 1", row.id)
      return {
        ...publicPhase(p),
        position: i + 1,
        runPhaseId: row.id,
        state: row.state,
        stateLabel: PHASE_STATE_LABELS[row.state],
        available: a.available,
        blockedBy: a.blockedBy.map((k) => ({ key: k, title: titleByKey.get(k) ?? k })),
        attempts: row.attempts,
        latestSubmission: latest
          ? { id: String(latest.id), attempt: Number(latest.attempt), stage: String(latest.stage), createdAt: String(latest.created_at), assessment: assessmentSummary(db, String(latest.id)) }
          : null,
      }
    }),
  }
}

export function listCandidateRuns(db: DatabaseSync, candidateId: string, kind?: "company" | "practice") {
  const rows = all(db, `SELECT * FROM runs WHERE candidate_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY started_at DESC`, ...(kind ? [candidateId, kind] : [candidateId])).map(toRun)
  return rows.map((run) => {
    const version = loadRunVersion(db, run)
    const states = statesOf(runPhaseRows(db, run.id))
    const done = completion(phaseNodes(version), states)
    const challenge = run.challengeId ? challengeById(db, run.challengeId) : null
    const company = challenge ? one(db, "SELECT name FROM companies WHERE id = ?", challenge.companyId) : null
    return {
      id: run.id,
      kind: run.kind,
      title: version.spec.title,
      companyName: company ? String(company.name) : null,
      skills: version.spec.skills,
      difficulty: version.spec.difficulty,
      status: run.status,
      shareScope: run.shareScope,
      progress: { passed: done.passed, total: done.total },
      startedAt: run.startedAt,
      isDemoFixture: run.isDemoFixture,
    }
  })
}

// ------------------------------------------------------------------ sharing & completion

export function setShareScope(db: DatabaseSync, candidateId: string, runId: string, scopeRaw: unknown): ShareScope {
  const run = ownedRun(db, candidateId, runId)
  if (typeof scopeRaw !== "string" || !(SHARE_SCOPES as readonly string[]).includes(scopeRaw)) throw new ApiError(400, `Sharing must be one of: ${SHARE_SCOPES.join(", ")}.`)
  const scope = scopeRaw as ShareScope
  if (run.kind === "practice" && scope === "challenge_owner") throw new ApiError(400, "Practice work has no company behind it — choose “Only me” or “Employers who find me”.")
  if (scope === run.shareScope) return scope
  transaction(db, () => {
    exec(db, "UPDATE runs SET share_scope = ? WHERE id = ?", scope, runId)
    exec(db, "INSERT INTO share_history (run_id, from_scope, to_scope, at) VALUES (?, ?, ?, ?)", runId, run.shareScope, scope, nowIso())
  })
  return scope
}

/** Submits the complete solution. Server-enforced: every phase must have passed — the client cannot skip it. */
export function completeRun(db: DatabaseSync, candidateId: string, runId: string, body: Body): void {
  const run = ownedRun(db, candidateId, runId)
  if (run.status === "completed") throw new ApiError(409, "This work is already submitted as complete.")
  const version = loadRunVersion(db, run)
  const rows = runPhaseRows(db, run.id)
  const done = completion(phaseNodes(version), statesOf(rows))
  if (!done.complete) {
    const titleByPhase = new Map(version.spec.phases.map((p) => [version.phaseIds[p.key], p.title]))
    throw new ApiError(
      409,
      `Every phase must pass before the complete solution can be submitted. Still to pass: ${done.remaining.map((id) => `“${titleByPhase.get(id)}”`).join(", ")}.`,
      undefined,
      { remaining: done.remaining.map((id) => ({ phaseId: id, title: titleByPhase.get(id) })) },
    )
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : ""
  transaction(db, () => {
    exec(db, "UPDATE runs SET status = 'completed', completed_at = ?, completion_note = ? WHERE id = ?", nowIso(), note, runId)
    if (run.challengeId) {
      const c = challengeById(db, run.challengeId)
      const candidate = one(db, "SELECT name FROM candidates WHERE id = ?", candidateId)!
      if (c && run.shareScope !== "private") {
        notify(db, "company", c.companyId, "A candidate completed your challenge", `${String(candidate.name)} passed every phase of “${version.spec.title}”.`, `/company/challenges/${c.id}`)
      }
    }
  })
}
