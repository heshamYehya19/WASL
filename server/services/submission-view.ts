import type { DatabaseSync } from "node:sqlite"
import { MAX_QUESTIONS, MIN_ANSWERED_QUESTIONS, PASS_RULE, RATING_LABELS } from "../domain/decision.ts"
import { PHASE_STATE_LABELS } from "../domain/phases.ts"
import { all, one } from "../sql.ts"
import { canRetry, contextFor } from "./pipeline.ts"
import type { Ctx } from "./pipeline.ts"
import { loadArtifacts, loadReview, loadSession } from "./submissions.ts"

function dimension(raw: unknown) {
  try {
    const parsed = JSON.parse(String(raw)) as { rationale?: string; adjustment?: string; dropped?: number; items?: unknown[] }
    return { rationale: parsed.rationale ?? "", adjustment: parsed.adjustment ?? "", dropped: parsed.dropped ?? 0, evidence: parsed.items ?? [] }
  } catch {
    return { rationale: "", adjustment: "", dropped: 0, evidence: [] }
  }
}

export function assessmentDetail(db: DatabaseSync, submissionId: string) {
  const a = one(db, "SELECT * FROM assessments WHERE submission_id = ?", submissionId)
  if (!a) return null
  const labels = (n: number) => RATING_LABELS[Math.max(0, Math.min(3, n))]
  return {
    outcome: a.outcome as "passed" | "failed",
    outcomeLabel: a.outcome === "passed" ? "Passed" : "Not passed yet",
    outcomeReason: String(a.outcome_reason),
    summary: String(a.summary),
    strengths: JSON.parse(String(a.strengths)) as string[],
    weaknesses: JSON.parse(String(a.weaknesses)) as string[],
    // Three separate dimensions, never one blended score.
    dimensions: [
      { key: "correctness", label: "Correctness", rating: Number(a.correctness), ratingLabel: labels(Number(a.correctness)), needed: PASS_RULE.correctness, ...dimension(a.correctness_evidence) },
      { key: "code_quality", label: "Code quality", rating: Number(a.code_quality), ratingLabel: labels(Number(a.code_quality)), needed: PASS_RULE.codeQuality, ...dimension(a.code_quality_evidence) },
      { key: "understanding", label: "Demonstrated understanding", rating: Number(a.understanding), ratingLabel: labels(Number(a.understanding)), needed: PASS_RULE.understanding, ...dimension(a.understanding_evidence) },
    ],
    origin: a.origin as "ai" | "demo_fixture",
    provider: String(a.provider),
    model: String(a.model),
    promptVersion: String(a.prompt_version),
    createdAt: String(a.created_at),
  }
}

/** Everything about one attempt, as the candidate (or the company evaluating them) sees it. */
export function submissionDetail(db: DatabaseSync, ctx: Ctx, opts: { audience: "candidate" | "company" }) {
  const { submission, runPhase } = ctx
  const review = loadReview(db, submission.id)
  const session = loadSession(db, submission.id)
  const messages = session?.messages ?? []
  const answered = messages.filter((m) => m.role === "candidate").length
  const waitingOnCandidate = runPhase.state === "interview_in_progress" && session?.status === "in_progress" && messages[messages.length - 1]?.role === "interviewer"
  const latest = one(db, "SELECT id FROM submissions WHERE run_phase_id = ? ORDER BY attempt DESC LIMIT 1", runPhase.id)
  return {
    id: submission.id,
    attempt: submission.attempt,
    createdAt: submission.createdAt,
    language: submission.language,
    githubUrl: submission.githubUrl,
    note: submission.note,
    stage: submission.stage,
    isLatest: latest?.id === submission.id,
    phase: { key: ctx.phase.key, title: ctx.phase.title },
    state: runPhase.state,
    stateLabel: PHASE_STATE_LABELS[runPhase.state],
    problems: submission.problems,
    pipelineMessage: submission.pipelineError,
    canRetry: opts.audience === "candidate" && submission.stage !== "assessed" && submission.stage !== "rejected" && canRetry(db, ctx),
    // Static analysis only: the platform never runs submitted code, and says so.
    analysis: { executed: false, note: "Your code is read, not run. Checks are static; the AI reviews what the code says, and the interview tests whether you understand it." },
    artifacts: loadArtifacts(db, submission.id).map((a) => ({ path: a.path, source: a.source, content: a.content, truncated: a.truncated, redactions: a.redactions })),
    checks: review?.staticChecks ?? [],
    review: review
      ? {
          summary: review.summary,
          findings: review.findings,
          criteria: review.criteria.map((c) => ({ ...c, text: criterionText(ctx, c.criterionId) })),
          injectionFlagged: review.injectionFlagged,
          provider: review.provider,
          model: review.model,
          promptVersion: review.promptVersion,
        }
      : null,
    interview: session
      ? {
          status: session.status,
          answered,
          minQuestions: MIN_ANSWERED_QUESTIONS,
          maxQuestions: MAX_QUESTIONS,
          awaitingAnswer: waitingOnCandidate,
          messages: messages.map((m) => ({
            seq: m.seq,
            role: m.role,
            content: m.content,
            isFollowup: m.isFollowup,
            // Why a question was asked: shown so the interview is explainable, never the hidden rubric notes.
            grounding: m.grounding ? { kind: m.grounding.kind, ref: m.grounding.ref, path: m.grounding.path, line: m.grounding.line, quote: m.grounding.quote, why: m.grounding.why } : null,
            injectionFlagged: opts.audience === "company" ? m.injectionFlagged : false,
            createdAt: m.createdAt,
          })),
        }
      : null,
    assessment: assessmentDetail(db, submission.id),
  }
}

function criterionText(ctx: Ctx, id: string): string {
  return ctx.phase.acceptanceCriteria.find((c) => c.id === id)?.text ?? ctx.phase.rubric.find((r) => r.id === id)?.criterion ?? id
}

export function submissionDetailById(db: DatabaseSync, submissionId: string, opts: { audience: "candidate" | "company" }) {
  return submissionDetail(db, contextFor(db, submissionId), opts)
}

/** Every attempt on a phase, newest first (attempts are never overwritten). */
export function attemptList(db: DatabaseSync, runPhaseId: string) {
  return all(db, "SELECT id, attempt, stage, created_at FROM submissions WHERE run_phase_id = ? ORDER BY attempt DESC", runPhaseId).map((r) => {
    const a = one(db, "SELECT outcome FROM assessments WHERE submission_id = ?", String(r.id))
    return { id: String(r.id), attempt: Number(r.attempt), stage: String(r.stage), createdAt: String(r.created_at), outcome: (a?.outcome as string | undefined) ?? null }
  })
}
