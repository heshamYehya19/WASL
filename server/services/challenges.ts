import type { DatabaseSync } from "node:sqlite"
import { generateCompanyChallenge } from "../ai/challenge-generator.ts"
import type { CompanyBrief } from "../ai/challenge-generator.ts"
import { canonicalSkillList } from "../domain/skills.ts"
import { CHALLENGE_STATUS_LABELS, OPEN_STATUSES, canChallengeTransition, challengeTransition, FROZEN_STATUSES } from "../domain/lifecycle.ts"
import type { ChallengeEvent, ChallengeStatus } from "../domain/lifecycle.ts"
import { DIFFICULTIES, finalizeSpec, publicPhase, specField, SpecProblem } from "../domain/spec.ts"
import type { ChallengeSpec, Difficulty } from "../domain/spec.ts"
import { SchemaError } from "../ai/schema.ts"
import { ApiError, enumValue, stringList, text, wholeNumber } from "../http.ts"
import type { Body } from "../http.ts"
import { screenChallenge } from "../screening.ts"
import type { ScreeningFinding } from "../../src/types.ts"
import { all, exec, newId, nowIso, one, parseList, transaction } from "../sql.ts"
import { insertVersion, loadVersion, versionMeta } from "./versions.ts"
import type { StoredVersion } from "./versions.ts"

// ------------------------------------------------------------------ the brief

export const BRIEF_LIMITS = { problem: { min: 40, max: 4000 }, deliverables: { min: 10, max: 2000 }, skills: { min: 1, max: 8 }, hours: { min: 1, max: 200 } } as const

/** Personal data has no business in a challenge brief; these kinds stop the brief, the rest are warnings. */
const BLOCKING_KINDS = new Set(["phone", "email", "nationalId", "birthDate", "card", "iban"])

export function parseBrief(body: Body): { brief: CompanyBrief; warnings: ScreeningFinding[] } {
  const problemDescription = text(body.problemDescription, "The problem description", { required: true, ...BRIEF_LIMITS.problem, key: "problemDescription" })
  const expectedDeliverables = text(body.expectedDeliverables, "The expected deliverables", { required: true, ...BRIEF_LIMITS.deliverables, key: "expectedDeliverables" })
  const requiredSkills = canonicalSkillList(
    stringList(body.requiredSkills, "Required skills", { min: BRIEF_LIMITS.skills.min, max: BRIEF_LIMITS.skills.max, key: "requiredSkills" }),
    BRIEF_LIMITS.skills.max,
  )
  const difficulty = enumValue(body.difficulty, DIFFICULTIES, "Difficulty", { key: "difficulty" })
  const timeHours = wholeNumber(body.timeHours, "The time expectation (hours)", { ...BRIEF_LIMITS.hours, key: "timeHours" })
  const findings = screenChallenge({
    fields: [
      { label: "Problem description", text: problemDescription },
      { label: "Expected deliverables", text: expectedDeliverables },
    ],
    files: [],
  })
  const blocking = findings.filter((f) => BLOCKING_KINDS.has(f.kind))
  if (blocking.length > 0) {
    throw new ApiError(
      422,
      `The brief seems to contain personal or sensitive data (${blocking.map((f) => `${f.count} × ${f.label.toLowerCase()}`).join(", ")}). Remove it — a challenge should use invented data — and try again.`,
      "problemDescription",
      { findings: blocking },
    )
  }
  return { brief: { problemDescription, requiredSkills, difficulty, expectedDeliverables, timeHours }, warnings: findings.filter((f) => !BLOCKING_KINDS.has(f.kind) && f.kind !== "unreadable") }
}

// ------------------------------------------------------------------ ownership & lifecycle

export interface ChallengeRow {
  id: string
  companyId: string
  status: ChallengeStatus
  brief: CompanyBrief
  currentVersionId: string | null
  publishedVersionId: string | null
  evaluationUseAcknowledged: boolean
  isDemoFixture: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

function toRow(r: Record<string, unknown>): ChallengeRow {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    status: r.status as ChallengeStatus,
    brief: {
      problemDescription: String(r.problem_description),
      requiredSkills: parseList(r.required_skills),
      difficulty: r.difficulty as Difficulty,
      expectedDeliverables: String(r.expected_deliverables),
      timeHours: Number(r.time_hours),
    },
    currentVersionId: (r.current_version_id as string | null) ?? null,
    publishedVersionId: (r.published_version_id as string | null) ?? null,
    evaluationUseAcknowledged: r.evaluation_use_acknowledged === 1,
    isDemoFixture: r.is_demo_fixture === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    publishedAt: (r.published_at as string | null) ?? null,
  }
}

/** A company's own challenge. Someone else's challenge is "not found", not "forbidden" — its existence is not theirs to learn. */
export function ownedChallenge(db: DatabaseSync, companyId: string, challengeId: string): ChallengeRow {
  const r = one(db, "SELECT * FROM challenges WHERE id = ? AND company_id = ?", challengeId, companyId)
  if (!r) throw new ApiError(404, "Challenge not found.")
  return toRow(r)
}

export function challengeById(db: DatabaseSync, challengeId: string): ChallengeRow | null {
  const r = one(db, "SELECT * FROM challenges WHERE id = ?", challengeId)
  return r ? toRow(r) : null
}

/** Moves a challenge along its lifecycle; fails if another request already moved it (compare-and-set on the old status). */
export function advance(db: DatabaseSync, challenge: { id: string; status: ChallengeStatus }, event: ChallengeEvent, note?: string): ChallengeStatus {
  const to = challengeTransition(challenge.status, event)
  const res = db.prepare("UPDATE challenges SET status = ?, updated_at = ? WHERE id = ? AND status = ?").run(to, nowIso(), challenge.id, challenge.status)
  if (Number(res.changes) !== 1) throw new ApiError(409, "This challenge just changed. Reload and try again.")
  if (to !== challenge.status) exec(db, "INSERT INTO challenge_history (challenge_id, status, at, note) VALUES (?, ?, ?, ?)", challenge.id, to, nowIso(), note ?? null)
  return to
}

function lifecycleGuard(status: ChallengeStatus, event: ChallengeEvent): void {
  if (!canChallengeTransition(status, event)) {
    throw new ApiError(409, `A ${CHALLENGE_STATUS_LABELS[status].toLowerCase()} challenge can't be ${event === "review" ? "marked as reviewed" : event === "generate" ? "regenerated" : event === "edit" ? "edited" : event === "publish" ? "published" : event === "complete" ? "marked completed" : event === "archive" ? "archived" : "started"}.`)
  }
}

// ------------------------------------------------------------------ company operations

export function createChallenge(db: DatabaseSync, companyId: string, brief: CompanyBrief): string {
  const id = newId("chl")
  const now = nowIso()
  transaction(db, () => {
    exec(
      db,
      `INSERT INTO challenges (id, company_id, problem_description, required_skills, difficulty, expected_deliverables, time_hours, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id, companyId, brief.problemDescription, JSON.stringify(brief.requiredSkills), brief.difficulty, brief.expectedDeliverables, brief.timeHours, now, now,
    )
    exec(db, "INSERT INTO challenge_history (challenge_id, status, at, note) VALUES (?, 'draft', ?, 'Brief written.')", id, now)
  })
  return id
}

/** The brief can still be rewritten while nothing has been generated from it. */
export function updateBrief(db: DatabaseSync, companyId: string, challengeId: string, brief: CompanyBrief): void {
  const c = ownedChallenge(db, companyId, challengeId)
  if (c.status !== "draft") throw new ApiError(409, "The brief can only be changed before a challenge is generated. Edit the generated challenge instead.")
  exec(
    db,
    "UPDATE challenges SET problem_description = ?, required_skills = ?, difficulty = ?, expected_deliverables = ?, time_hours = ?, updated_at = ? WHERE id = ?",
    brief.problemDescription, JSON.stringify(brief.requiredSkills), brief.difficulty, brief.expectedDeliverables, brief.timeHours, nowIso(), challengeId,
  )
}

/**
 * Generates a new version from the brief. The model call happens outside any transaction (it can take many seconds); the
 * result is stored only if the challenge is still in a state that allows it.
 */
export async function generateForChallenge(db: DatabaseSync, companyId: string, challengeId: string, opts: { useTemplate?: boolean } = {}): Promise<{ versionId: string }> {
  const c = ownedChallenge(db, companyId, challengeId)
  lifecycleGuard(c.status, "generate")
  const generated = await generateCompanyChallenge(c.brief, { useTemplate: opts.useTemplate, subject: { type: "challenge", id: challengeId } })
  return transaction(db, () => {
    const fresh = ownedChallenge(db, companyId, challengeId)
    lifecycleGuard(fresh.status, "generate")
    const versionId = insertVersion(db, {
      kind: "company",
      challengeId,
      spec: generated.spec,
      origin: generated.origin,
      provider: generated.provider,
      model: generated.model,
      promptVersion: generated.promptVersion,
      parentVersionId: fresh.currentVersionId,
    })
    exec(db, "UPDATE challenges SET current_version_id = ? WHERE id = ?", versionId, challengeId)
    advance(db, fresh, "generate", generated.origin === "ai" ? "Challenge generated by AI." : "Offline template created (no AI provider was used).")
    return { versionId }
  })
}

/** Accepts the editor's JSON: acceptance criteria may come back as {id,text} objects; ids are always reassigned. */
function normalizeEditPayload(body: Body): unknown {
  const phases = Array.isArray(body.phases) ? body.phases : body.phases
  if (!Array.isArray(phases)) return body
  return {
    ...body,
    phases: phases.map((p) => {
      if (!p || typeof p !== "object") return p
      const phase = p as Record<string, unknown>
      return {
        ...phase,
        acceptanceCriteria: Array.isArray(phase.acceptanceCriteria)
          ? phase.acceptanceCriteria.map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).text : c))
          : phase.acceptanceCriteria,
      }
    }),
  }
}

/** Saves the company's edits as the next version (the AI's original and every earlier revision stay on record). */
export function saveEdit(db: DatabaseSync, companyId: string, challengeId: string, body: Body): { versionId: string } {
  const c = ownedChallenge(db, companyId, challengeId)
  lifecycleGuard(c.status, "edit")
  let spec: ChallengeSpec
  try {
    const raw = specField.parse(normalizeEditPayload(body), "")
    spec = finalizeSpec(raw, { requiredSkills: c.brief.requiredSkills, budgetHours: c.brief.timeHours, difficulty: c.brief.difficulty }, { keepHours: true })
  } catch (err) {
    if (err instanceof SchemaError) throw new ApiError(400, `The challenge isn't complete: ${err.message}.`)
    if (err instanceof SpecProblem) throw new ApiError(422, err.problems.join(" "), undefined, { problems: err.problems })
    throw err
  }
  return transaction(db, () => {
    const fresh = ownedChallenge(db, companyId, challengeId)
    lifecycleGuard(fresh.status, "edit")
    const versionId = insertVersion(db, { kind: "company", challengeId, spec, origin: "company_edit", parentVersionId: fresh.currentVersionId })
    exec(db, "UPDATE challenges SET current_version_id = ? WHERE id = ?", versionId, challengeId)
    advance(db, fresh, "edit", "The company edited the challenge.")
    return { versionId }
  })
}

export function markReviewed(db: DatabaseSync, companyId: string, challengeId: string): void {
  const c = ownedChallenge(db, companyId, challengeId)
  if (!c.currentVersionId) throw new ApiError(409, "Generate the challenge before reviewing it.")
  lifecycleGuard(c.status, "review")
  advance(db, c, "review", "The company reviewed the challenge.")
}

export const EVALUATION_NOTICE =
  "Submissions to this challenge are used only to evaluate candidates' abilities. Publishing it does not transfer ownership of anything a candidate writes, and candidates are told so before they start."

export function publish(db: DatabaseSync, companyId: string, challengeId: string, body: Body): void {
  const c = ownedChallenge(db, companyId, challengeId)
  lifecycleGuard(c.status, "publish")
  if (body.acknowledgeEvaluationUse !== true) {
    throw new ApiError(400, "Confirm how submissions will be used before publishing.", "acknowledgeEvaluationUse", { notice: EVALUATION_NOTICE })
  }
  if (!c.currentVersionId || !loadVersion(db, c.currentVersionId)) throw new ApiError(409, "There is no generated challenge to publish.")
  transaction(db, () => {
    exec(db, "UPDATE challenges SET published_version_id = current_version_id, evaluation_use_acknowledged = 1, published_at = ? WHERE id = ?", nowIso(), challengeId)
    advance(db, c, "publish", "Published to candidates.")
  })
}

export function archive(db: DatabaseSync, companyId: string, challengeId: string): void {
  const c = ownedChallenge(db, companyId, challengeId)
  lifecycleGuard(c.status, "archive")
  advance(db, c, "archive", "Archived by the company.")
}

export function complete(db: DatabaseSync, companyId: string, challengeId: string): void {
  const c = ownedChallenge(db, companyId, challengeId)
  lifecycleGuard(c.status, "complete")
  advance(db, c, "complete", "Marked completed by the company.")
}

// ------------------------------------------------------------------ views

export function companyChallengeSummary(db: DatabaseSync, c: ChallengeRow) {
  const version = c.currentVersionId ? loadVersion(db, c.currentVersionId) : null
  const counts = one(
    db,
    `SELECT COUNT(*) AS started, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM runs WHERE challenge_id = ? AND share_scope != 'private'`,
    c.id,
  )!
  const hidden = one(db, "SELECT COUNT(*) AS n FROM runs WHERE challenge_id = ? AND share_scope = 'private'", c.id)!
  return {
    id: c.id,
    title: version?.spec.title ?? firstWords(c.brief.problemDescription, 70),
    status: c.status,
    statusLabel: CHALLENGE_STATUS_LABELS[c.status],
    difficulty: c.brief.difficulty,
    skills: c.brief.requiredSkills,
    timeHours: c.brief.timeHours,
    phaseCount: version?.spec.phases.length ?? 0,
    candidatesStarted: Number(counts.started ?? 0) + Number(hidden.n ?? 0),
    candidatesCompleted: Number(counts.completed ?? 0),
    isDemoFixture: c.isDemoFixture,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    publishedAt: c.publishedAt,
  }
}

const firstWords = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

export function listCompanyChallenges(db: DatabaseSync, companyId: string) {
  return all(db, "SELECT * FROM challenges WHERE company_id = ? ORDER BY created_at DESC", companyId).map(toRow).map((c) => companyChallengeSummary(db, c))
}

export function companyChallengeDetail(db: DatabaseSync, companyId: string, challengeId: string) {
  const c = ownedChallenge(db, companyId, challengeId)
  const current = c.currentVersionId ? loadVersion(db, c.currentVersionId) : null
  const published = c.publishedVersionId ? loadVersion(db, c.publishedVersionId) : null
  const versions = all(db, "SELECT id FROM challenge_versions WHERE challenge_id = ? ORDER BY version DESC", challengeId)
    .map((r) => loadVersion(db, String(r.id)))
    .filter((v): v is StoredVersion => v !== null)
    .map(versionMeta)
  return {
    ...companyChallengeSummary(db, c),
    brief: c.brief,
    evaluationUseAcknowledged: c.evaluationUseAcknowledged,
    evaluationNotice: EVALUATION_NOTICE,
    // The editor works on the current version, which carries the full rubric.
    current: current ? { meta: versionMeta(current), spec: current.spec } : null,
    publishedVersionId: c.publishedVersionId,
    publishedMatchesCurrent: !!published && published.id === current?.id,
    versions,
    history: all(db, "SELECT status, at, note FROM challenge_history WHERE challenge_id = ? ORDER BY id", challengeId),
    frozen: FROZEN_STATUSES.includes(c.status),
  }
}

// ---- candidate-facing

/** What a candidate may see about a published challenge: no hidden rubric notes. */
export function candidateChallengeView(db: DatabaseSync, c: ChallengeRow) {
  if (!c.publishedVersionId) return null
  const version = loadVersion(db, c.publishedVersionId)
  if (!version) return null
  const company = one(db, "SELECT id, name, industry, location, logo_initials FROM companies WHERE id = ?", c.companyId)!
  return {
    id: c.id,
    status: c.status,
    company: { id: String(company.id), name: String(company.name), industry: String(company.industry), location: String(company.location), logoInitials: String(company.logo_initials) },
    title: version.spec.title,
    summary: version.spec.summary,
    scenario: version.spec.scenario,
    learningGoals: version.spec.learningGoals,
    skills: version.spec.skills,
    difficulty: version.spec.difficulty,
    estimatedHours: version.spec.estimatedHours,
    expectedDeliverables: c.brief.expectedDeliverables,
    phases: version.spec.phases.map(publicPhase),
    evaluationNotice: EVALUATION_NOTICE,
    isDemoFixture: c.isDemoFixture,
    publishedAt: c.publishedAt,
    origin: versionMeta(version).originLabel,
  }
}

/** Challenges a candidate can find and start: published or in progress, never drafts or archived ones. */
export function listOpenChallenges(db: DatabaseSync) {
  return all(db, `SELECT * FROM challenges WHERE status IN (${OPEN_STATUSES.map(() => "?").join(",")}) ORDER BY published_at DESC`, ...OPEN_STATUSES)
    .map(toRow)
    .map((c) => candidateChallengeView(db, c))
    .filter((c): c is NonNullable<typeof c> => c !== null)
}
