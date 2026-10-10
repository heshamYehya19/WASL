// The Proof Engine pipeline: validate → deterministic checks → AI review → adaptive interview → assessment → decision.
//
// Invariants this file exists to keep:
//  * A pass or fail is written ONLY by `assessmentStep`, only after the interview session is completed, and only when the
//    decision rule has enough verified evidence. Anything else leaves the phase "assessment unavailable" — never passed.
//  * An AI failure at any step is recoverable and says so; it is never turned into an outcome.
//  * Every step is scoped to one submission: nothing is read from, or cached for, another candidate, phase or version.

import type { DatabaseSync } from "node:sqlite"
import { assessSubmission, ASSESS_PROMPT_VERSION } from "../ai/assessor.ts"
import { nextInterviewTurn } from "../ai/interviewer.ts"
import { AiError, aiConfigured, describeAiError, waitPhrase } from "../ai/provider.ts"
import { REVIEW_PROMPT_VERSION, reviewSubmission } from "../ai/reviewer.ts"
import type { ReviewResult } from "../ai/reviewer.ts"
import { detectInjection } from "../ai/safety.ts"
import { redactSecrets } from "../analysis/secrets.ts"
import { blockingProblems } from "../analysis/static-checks.ts"
import { decide } from "../domain/decision.ts"
import { availability, canTransition, completion, PHASE_STATE_LABELS } from "../domain/phases.ts"
import type { PhaseSpec } from "../domain/spec.ts"
import { readGithubRepo } from "../github.ts"
import { ApiError, text } from "../http.ts"
import type { Body } from "../http.ts"
import { exec, newId, nowIso, one, transaction } from "../sql.ts"
import { notify } from "./notifications.ts"
import { applyEvent, loadRunVersion, ownedRun, phaseNodes, runPhaseRows, statesOf, submittedPhaseIds } from "./runs.ts"
import type { RunPhaseRow, RunRow } from "./runs.ts"
import {
  buildArtifacts,
  checksFor,
  contentHash,
  loadArtifacts,
  loadReview,
  loadSession,
  loadSubmission,
  parseSubmissionInput,
  sha256,
  SUBMISSION_LIMITS,
  toTranscript,
} from "./submissions.ts"
import type { SubmissionRow } from "./submissions.ts"
import type { StoredVersion } from "./versions.ts"

/** Submissions currently being processed in this server process. Guards against a double submit and identifies stalled work. */
const active = new Set<string>()
const STALE_AFTER_MS = 90_000
/**
 * When a provider's rate limit made a submission unavailable and said how long to wait, a retry before then is refused (it
 * would only hit the same limit). Kept in memory: after a restart the guidance is simply forgotten and a retry is allowed.
 */
const retryNotBefore = new Map<string, number>()

export interface Ctx {
  run: RunRow
  version: StoredVersion
  phase: PhaseSpec
  runPhase: RunPhaseRow
  submission: SubmissionRow
}

export function contextFor(db: DatabaseSync, submissionId: string): Ctx {
  const submission = loadSubmission(db, submissionId)
  if (!submission) throw new ApiError(404, "That submission wasn't found.")
  const rp = one(db, "SELECT run_id FROM run_phases WHERE id = ?", submission.runPhaseId)!
  const runRow = one(db, "SELECT * FROM runs WHERE id = ?", String(rp.run_id))!
  const run = ownedRun(db, String(runRow.candidate_id), String(runRow.id))
  const version = loadRunVersion(db, run)
  const runPhase = runPhaseRows(db, run.id).find((r) => r.id === submission.runPhaseId)!
  const phase = version.spec.phases.find((p) => version.phaseIds[p.key] === runPhase.phaseId)!
  return { run, version, phase, runPhase, submission }
}

/** A candidate's own submission. Anyone else's is "not found". */
export function ownedContext(db: DatabaseSync, candidateId: string, submissionId: string): Ctx {
  const ctx = contextFor(db, submissionId)
  if (ctx.run.candidateId !== candidateId) throw new ApiError(404, "That submission wasn't found.")
  return ctx
}

function markUnavailable(db: DatabaseSync, ctx: Ctx, err: unknown): void {
  const message = err instanceof AiError && err.kind === "schema" && err.message.startsWith("Not enough") ? err.message : describeAiError(err)
  if (err instanceof AiError && err.kind === "rate_limit" && err.retryAfterMs) retryNotBefore.set(ctx.submission.id, Date.now() + err.retryAfterMs)
  transaction(db, () => {
    exec(db, "UPDATE submissions SET pipeline_error = ? WHERE id = ?", message, ctx.submission.id)
    const state = one(db, "SELECT state FROM run_phases WHERE id = ?", ctx.runPhase.id)!.state
    if (canTransition(state as never, "pipeline_failed")) applyEvent(db, ctx.runPhase.id, "pipeline_failed")
  })
}

async function locked<T>(submissionId: string, fn: () => Promise<T>): Promise<T> {
  if (active.has(submissionId)) throw new ApiError(409, "This is already being processed. Wait a moment and reload.")
  active.add(submissionId)
  try {
    return await fn()
  } finally {
    active.delete(submissionId)
  }
}

// ------------------------------------------------------------------ eligibility

/**
 * Why a phase is locked, or null when every earlier phase has a valid recorded submission. The one check behind start,
 * submit, answer and retry — so no endpoint, payload or page can skip submitting the phase before.
 */
function lockedReason(db: DatabaseSync, run: RunRow, version: StoredVersion, row: RunPhaseRow): string | null {
  const avail = availability(phaseNodes(version), submittedPhaseIds(db, run.id)).get(row.phaseId)!
  if (avail.available) return null
  const titles = avail.blockedBy.map((k) => `“${version.spec.phases.find((p) => p.key === k)?.title ?? k}”`)
  const saved = row.state === "not_started" ? "" : " Your work on this phase is saved and continues from where it stopped once you have."
  return `This phase opens once you submit ${titles.join(" and ")}. Phases open in order: each opens when the one before it has a submission that was accepted for review — it doesn't need to have passed.${saved}`
}

function requireEligible(db: DatabaseSync, run: RunRow, runPhaseId: string): void {
  const row = runPhaseRows(db, run.id).find((r) => r.id === runPhaseId)!
  const reason = lockedReason(db, run, loadRunVersion(db, run), row)
  if (reason) throw new ApiError(409, reason)
}

// ------------------------------------------------------------------ submitting

export interface SubmitOutcome {
  submissionId: string
  state: string
  rejected: boolean
  problems: string[]
}

export async function startPhase(db: DatabaseSync, candidateId: string, runId: string, phaseKey: string): Promise<void> {
  const run = ownedRun(db, candidateId, runId)
  const version = loadRunVersion(db, run)
  const rows = runPhaseRows(db, run.id)
  const row = rows.find((r) => r.key === phaseKey)
  if (!row) throw new ApiError(404, "That phase wasn't found.")
  const reason = lockedReason(db, run, version, row)
  if (reason) throw new ApiError(409, reason)
  if (row.state === "not_started") applyEvent(db, row.id, "start")
}

export async function submitSolution(db: DatabaseSync, candidateId: string, runId: string, phaseKey: string, body: Body): Promise<SubmitOutcome> {
  const run = ownedRun(db, candidateId, runId)
  if (run.status === "completed") throw new ApiError(409, "This work is already submitted as complete.")
  const version = loadRunVersion(db, run)
  const phase = version.spec.phases.find((p) => p.key === phaseKey)
  if (!phase) throw new ApiError(404, "That phase wasn't found.")
  const rows = runPhaseRows(db, run.id)
  const row = rows.find((r) => r.key === phaseKey)!
  const reason = lockedReason(db, run, version, row)
  if (reason) throw new ApiError(409, reason)
  if (!canTransition(row.state, "submit")) {
    throw new ApiError(
      409,
      row.state === "passed" ? "This phase has already passed." : `This phase is ${PHASE_STATE_LABELS[row.state].toLowerCase()}, so it can't take a new submission right now.`,
    )
  }
  const input = parseSubmissionInput(body)

  // Reading a repository can take a few seconds; do it before opening any transaction.
  const problems: string[] = []
  let repoFiles: Awaited<ReturnType<typeof readGithubRepo>> | null = null
  if (input.githubUrl) {
    repoFiles = await readGithubRepo(input.githubUrl)
    if (!repoFiles.ok) problems.push(repoFiles.message)
  }
  const { artifacts, redactions } = buildArtifacts(input, repoFiles?.ok ? repoFiles.files : [])
  const checks = artifacts.length > 0 ? checksFor(input, artifacts, redactions, phase) : []
  if (artifacts.length === 0 && problems.length === 0) problems.push("There was nothing to review in that submission.")
  if (artifacts.length > 0) problems.push(...blockingProblems(checks))
  const rejected = problems.length > 0

  const hash = contentHash(artifacts)
  const submissionId = newId("sub")
  transaction(db, () => {
    applyEvent(db, row.id, "submit")
    const attempt = Number(one(db, "SELECT attempts FROM run_phases WHERE id = ?", row.id)!.attempts) + 1
    exec(db, "UPDATE run_phases SET attempts = ? WHERE id = ?", attempt, row.id)
    exec(
      db,
      `INSERT INTO submissions (id, run_phase_id, attempt, language, code_text, github_url, note, content_hash, stage, problems, pipeline_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
      submissionId, row.id, attempt, input.language, redactSecrets(input.code).text, input.githubUrl, input.note, hash, rejected ? "rejected" : "checked", JSON.stringify(problems), nowIso(),
    )
    for (const a of artifacts) {
      exec(db, "INSERT INTO submission_artifacts (id, submission_id, path, source, content, size, truncated, redactions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId("art"), submissionId, a.path, a.source, a.content, a.size, a.truncated ? 1 : 0, a.redactions)
    }
    applyEvent(db, row.id, rejected ? "validation_failed" : "review_started")
  })

  if (rejected) return { submissionId, state: "revision_needed", rejected: true, problems }
  await locked(submissionId, () => reviewAndOpenInterview(db, submissionId))
  const state = one(db, "SELECT state FROM run_phases WHERE id = ?", row.id)!.state as string
  return { submissionId, state, rejected: false, problems: [] }
}

// ------------------------------------------------------------------ review → interview

/** Runs (or reuses) the review, then asks the first interview question. Any AI failure leaves the phase recoverably unavailable. */
async function reviewAndOpenInterview(db: DatabaseSync, submissionId: string): Promise<void> {
  const ctx = contextFor(db, submissionId)
  try {
    await reviewStage(db, ctx)
    await interviewStep(db, contextFor(db, submissionId))
    const fresh = contextFor(db, submissionId)
    if (fresh.runPhase.state === "under_review") applyEvent(db, fresh.runPhase.id, "interview_started")
    exec(db, "UPDATE submissions SET pipeline_error = '' WHERE id = ?", submissionId)
  } catch (err) {
    if (err instanceof ApiError) throw err
    markUnavailable(db, contextFor(db, submissionId), err)
  }
}

async function reviewStage(db: DatabaseSync, ctx: Ctx): Promise<ReviewResult | ReturnType<typeof loadReview>> {
  const artifacts = loadArtifacts(db, ctx.submission.id)
  const inputHash = sha256([ctx.run.candidateId, ctx.run.id, ctx.phase.key, ctx.version.id, ctx.submission.contentHash, REVIEW_PROMPT_VERSION].join("|"))
  const existing = loadReview(db, ctx.submission.id)
  // The review is cached per candidate, run, phase, version, content and prompt version — never shared across any of them.
  if (existing && existing.inputHash === inputHash) return existing

  const input = { language: ctx.submission.language, code: ctx.submission.codeText, githubUrl: ctx.submission.githubUrl, note: ctx.submission.note }
  const redactions = { count: artifacts.reduce((n, a) => n + a.redactions, 0), kinds: artifacts.some((a) => a.redactions > 0) ? ["credential-like values"] : [] }
  const checks = checksFor(input, artifacts, redactions, ctx.phase)
  const result = await reviewSubmission({
    challengeTitle: ctx.version.spec.title,
    phase: ctx.phase,
    artifacts,
    language: ctx.submission.language,
    note: ctx.submission.note,
    checks,
    submissionId: ctx.submission.id,
  })
  const noteInjection = detectInjection(ctx.submission.note)
  transaction(db, () => {
    exec(db, "DELETE FROM reviews WHERE submission_id = ?", ctx.submission.id)
    exec(
      db,
      `INSERT INTO reviews (id, submission_id, input_hash, prompt_version, provider, model, summary, findings, criteria, static_checks, injection_flagged, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("rev"), ctx.submission.id, inputHash, result.promptVersion, result.provider, result.model, result.summary, JSON.stringify(result.findings),
      JSON.stringify(result.criteria), JSON.stringify(checks), result.injectionFlagged || noteInjection.length > 0 ? 1 : 0, nowIso(),
    )
    exec(db, "UPDATE submissions SET stage = 'reviewed' WHERE id = ? AND stage = 'checked'", ctx.submission.id)
  })
  return result
}

/** Asks the next interview question, or completes the session when the interviewer is done. Returns what happened. */
async function interviewStep(db: DatabaseSync, ctx: Ctx): Promise<"asked" | "finished"> {
  const review = loadReview(db, ctx.submission.id)
  if (!review) throw new AiError("schema", "The review is missing.")
  let session = loadSession(db, ctx.submission.id)
  if (!session) {
    exec(db, "INSERT INTO interview_sessions (id, submission_id, status, created_at) VALUES (?, ?, 'in_progress', ?)", newId("ivs"), ctx.submission.id, nowIso())
    session = loadSession(db, ctx.submission.id)!
  }
  const turn = await nextInterviewTurn({
    challengeTitle: ctx.version.spec.title,
    phase: ctx.phase,
    review,
    artifacts: loadArtifacts(db, ctx.submission.id),
    transcript: toTranscript(session.messages),
    submissionId: ctx.submission.id,
  })
  const decision = turn.decision
  if (decision.action === "finish") {
    exec(db, "UPDATE interview_sessions SET status = 'completed', completed_at = ? WHERE id = ?", nowIso(), session.id)
    exec(db, "UPDATE submissions SET stage = 'interviewing' WHERE id = ?", ctx.submission.id)
    return "finished"
  }
  const seq = (session.messages[session.messages.length - 1]?.seq ?? 0) + 1
  try {
    exec(
      db,
      "INSERT INTO interview_messages (id, session_id, seq, role, content, grounding, is_followup, injection_flagged, created_at) VALUES (?, ?, ?, 'interviewer', ?, ?, ?, 0, ?)",
      newId("ivm"), session.id, seq, decision.question, JSON.stringify(decision.grounding), decision.isFollowup ? 1 : 0, nowIso(),
    )
  } catch {
    throw new ApiError(409, "The interview just moved on. Reload to continue.")
  }
  exec(db, "UPDATE submissions SET stage = 'interviewing' WHERE id = ?", ctx.submission.id)
  return "asked"
}

// ------------------------------------------------------------------ answering

export async function answerInterview(db: DatabaseSync, candidateId: string, submissionId: string, body: Body): Promise<{ state: string }> {
  const ctx = ownedContext(db, candidateId, submissionId)
  requireEligible(db, ctx.run, ctx.runPhase.id)
  if (ctx.runPhase.state !== "interview_in_progress") throw new ApiError(409, "This interview isn't open for answers right now.")
  const session = loadSession(db, submissionId)
  if (!session || session.status !== "in_progress") throw new ApiError(409, "This interview is already complete.")
  const last = session.messages[session.messages.length - 1]
  if (!last || last.role !== "interviewer") throw new ApiError(409, "You've already answered — wait for the next question.")
  const answer = text(body.answer, "Your answer", { required: true, max: SUBMISSION_LIMITS.answer, key: "answer" })
  const flagged = detectInjection(answer).length > 0

  return locked(submissionId, async () => {
    try {
      exec(
        db,
        "INSERT INTO interview_messages (id, session_id, seq, role, content, grounding, is_followup, injection_flagged, created_at) VALUES (?, ?, ?, 'candidate', ?, '{}', 0, ?, ?)",
        newId("ivm"), session.id, last.seq + 1, answer, flagged ? 1 : 0, nowIso(),
      )
    } catch {
      throw new ApiError(409, "That question was already answered. Reload to continue.")
    }
    return continueInterview(db, submissionId)
  })
}

/** After an answer is stored (or on retry): the next question, or — when the interview is finished — the assessment. */
async function continueInterview(db: DatabaseSync, submissionId: string): Promise<{ state: string }> {
  const ctx = contextFor(db, submissionId)
  try {
    const step = await interviewStep(db, ctx)
    if (step === "finished") await assessmentStep(db, contextFor(db, submissionId))
  } catch (err) {
    if (err instanceof ApiError) throw err
    markUnavailable(db, contextFor(db, submissionId), err)
  }
  return { state: one(db, "SELECT state FROM run_phases WHERE id = ?", ctx.runPhase.id)!.state as string }
}

// ------------------------------------------------------------------ assessment

async function assessmentStep(db: DatabaseSync, ctx: Ctx): Promise<void> {
  const review = loadReview(db, ctx.submission.id)
  const session = loadSession(db, ctx.submission.id)
  if (!review || !session || session.status !== "completed") throw new AiError("schema", "The interview is not complete.")
  const artifacts = loadArtifacts(db, ctx.submission.id)
  const transcript = toTranscript(session.messages)

  const result = await assessSubmission({
    challengeTitle: ctx.version.spec.title,
    phase: ctx.phase,
    artifacts,
    checks: review.staticChecks,
    review,
    transcript,
    submissionId: ctx.submission.id,
  })
  const answered = session.messages.filter((m) => m.role === "candidate").length
  const decision = decide({
    correctness: { rating: result.correctness.rating, verifiedEvidence: result.correctness.evidence.length },
    codeQuality: { rating: result.codeQuality.rating, verifiedEvidence: result.codeQuality.evidence.length },
    understanding: { rating: result.understanding.rating, verifiedEvidence: result.understanding.evidence.length },
    interviewCompleted: session.status === "completed",
    answeredQuestions: answered,
  })
  // Not enough verified evidence is not a verdict on the candidate: no decision is recorded.
  if (decision.kind === "insufficient") throw new AiError("schema", `Not enough verified evidence to decide. ${decision.reason}`)

  const dimension = (d: typeof result.correctness) => JSON.stringify({ rationale: d.rationale, adjustment: d.adjustment, dropped: d.dropped, items: d.evidence })
  const candidate = one(db, "SELECT name FROM candidates WHERE id = ?", ctx.run.candidateId)!
  transaction(db, () => {
    const assessmentId = newId("asm")
    exec(
      db,
      `INSERT INTO assessments (id, submission_id, correctness, correctness_evidence, code_quality, code_quality_evidence, understanding, understanding_evidence,
         outcome, outcome_reason, summary, strengths, weaknesses, origin, provider, model, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?)`,
      assessmentId, ctx.submission.id, result.correctness.rating, dimension(result.correctness), result.codeQuality.rating, dimension(result.codeQuality),
      result.understanding.rating, dimension(result.understanding), decision.kind, decision.reason, result.summary, JSON.stringify(result.strengths),
      JSON.stringify(result.weaknesses), result.provider, result.model, ASSESS_PROMPT_VERSION, nowIso(),
    )
    exec(db, "UPDATE submissions SET stage = 'assessed', pipeline_error = '' WHERE id = ?", ctx.submission.id)
    applyEvent(db, ctx.runPhase.id, decision.kind === "passed" ? "assessed_passed" : "assessed_failed")
    for (const skill of ctx.phase.skills) {
      exec(
        db,
        "INSERT OR IGNORE INTO skill_evidence (id, candidate_id, skill, run_id, phase_id, assessment_id, state, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        newId("evd"), ctx.run.candidateId, skill, ctx.run.id, ctx.runPhase.phaseId, assessmentId, decision.kind === "passed" ? "demonstrated" : "attempted", result.summary.slice(0, 300), nowIso(),
      )
    }
    for (const g of result.gaps) {
      exec(
        db,
        `INSERT INTO skill_gaps (id, candidate_id, run_id, phase_id, submission_id, skill, title, detail, evidence, severity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId("gap"), ctx.run.candidateId, ctx.run.id, ctx.runPhase.phaseId, ctx.submission.id, g.skill, g.title, g.detail, JSON.stringify(g.evidence), g.severity, nowIso(),
      )
    }
    notify(
      db,
      "student",
      ctx.run.candidateId,
      decision.kind === "passed" ? "Phase passed" : "Phase assessed",
      decision.kind === "passed" ? `You passed “${ctx.phase.title}”.` : `“${ctx.phase.title}” wasn't passed yet — see the feedback and your improvement plan, then try again.`,
      `/student/work/${ctx.run.id}`,
    )
    if (ctx.run.challengeId && ctx.run.shareScope !== "private" && decision.kind === "passed") {
      const challenge = one(db, "SELECT company_id FROM challenges WHERE id = ?", ctx.run.challengeId)
      if (challenge) {
        const done = completion(phaseNodes(ctx.version), statesOf(runPhaseRows(db, ctx.run.id)))
        if (done.passed === 1 || done.complete) {
          notify(db, "company", String(challenge.company_id), "A candidate passed a phase", `${String(candidate.name)} passed “${ctx.phase.title}” in “${ctx.version.spec.title}”.`, `/company/challenges/${ctx.run.challengeId}`)
        }
      }
    }
  })
}

// ------------------------------------------------------------------ recovery

/** Whether the pipeline can be run again: it failed, or it stalled (server restarted, request dropped) and nothing is working on it. */
export function canRetry(db: DatabaseSync, ctx: Ctx): boolean {
  if (active.has(ctx.submission.id)) return false
  if (lockedReason(db, ctx.run, ctx.version, ctx.runPhase)) return false // a locked phase is frozen
  if (ctx.runPhase.state === "assessment_unavailable") return true
  if (["submitted", "under_review", "interview_in_progress"].includes(ctx.runPhase.state)) {
    // An interview waiting for the candidate's answer is not stalled; only one waiting on the system is.
    const session = loadSession(db, ctx.submission.id)
    const waitingOnCandidate = ctx.runPhase.state === "interview_in_progress" && session?.status === "in_progress" && session.messages[session.messages.length - 1]?.role === "interviewer"
    if (waitingOnCandidate) return false
    const updated = one(db, "SELECT updated_at FROM run_phases WHERE id = ?", ctx.runPhase.id)!.updated_at as string
    return Date.now() - new Date(updated).getTime() > STALE_AFTER_MS
  }
  return false
}

/**
 * Runs the pipeline again for an existing submission, from what already exists: the work and every interview answer are kept,
 * and no new attempt is created. The answer says where it ended and, when that is still "assessment unavailable", why — so a
 * retry that produced the same outcome is reported as such instead of looking like nothing happened.
 */
export async function retrySubmission(db: DatabaseSync, candidateId: string, submissionId: string): Promise<{ state: string; message: string }> {
  const ctx = ownedContext(db, candidateId, submissionId)
  if (ctx.submission.stage === "rejected" || ctx.submission.stage === "assessed") throw new ApiError(409, "There is nothing to retry for this submission.")
  const latest = one(db, "SELECT id FROM submissions WHERE run_phase_id = ? ORDER BY attempt DESC LIMIT 1", ctx.runPhase.id)
  if (!latest || latest.id !== submissionId) throw new ApiError(409, "Only the latest attempt can be retried.")
  requireEligible(db, ctx.run, ctx.runPhase.id)
  if (!canRetry(db, ctx)) throw new ApiError(409, "This submission isn't waiting on a retry.")
  if (!aiConfigured()) {
    // Fail fast and honestly rather than flipping the state back and forth.
    throw new ApiError(503, describeAiError(new AiError("unconfigured", "")))
  }
  const waitMs = (retryNotBefore.get(submissionId) ?? 0) - Date.now()
  if (waitMs > 0) {
    throw new ApiError(429, `The AI service asked for a short pause after too many requests. Your work is saved; nothing has been assessed. Try again in ${waitPhrase(waitMs)}.`, undefined, { retryAfterSeconds: Math.ceil(waitMs / 1000) })
  }
  retryNotBefore.delete(submissionId)

  return locked(submissionId, async () => {
    let fresh = contextFor(db, submissionId)
    // Stalled work (server restarted, request dropped) is first made recoverable, exactly like a reported failure.
    if (fresh.runPhase.state !== "assessment_unavailable") applyEvent(db, fresh.runPhase.id, "pipeline_failed")
    fresh = contextFor(db, submissionId)

    // Resume from what actually exists, not from what a stage label says.
    const review = loadReview(db, submissionId)
    const session = loadSession(db, submissionId)
    if (!review || !session) {
      applyEvent(db, fresh.runPhase.id, "resume_review")
      await reviewAndOpenInterview(db, submissionId)
    } else {
      applyEvent(db, fresh.runPhase.id, "resume_interview")
      const last = session.messages[session.messages.length - 1]
      if (session.status === "completed") {
        try {
          await assessmentStep(db, contextFor(db, submissionId))
        } catch (err) {
          if (err instanceof ApiError) throw err
          markUnavailable(db, contextFor(db, submissionId), err)
        }
      } else if (!last || last.role === "candidate") {
        await continueInterview(db, submissionId)
      }
      // Otherwise the interviewer's question is waiting for the candidate; the state is already interview_in_progress.
    }
    const state = one(db, "SELECT state FROM run_phases WHERE id = ?", fresh.runPhase.id)!.state as string
    const message = state === "assessment_unavailable" ? String(one(db, "SELECT pipeline_error FROM submissions WHERE id = ?", submissionId)!.pipeline_error) : ""
    return { state, message }
  })
}
