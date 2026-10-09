// The phase rules, in one place. Nothing else in the codebase decides whether a phase is open, whether a transition is legal,
// or whether a run is complete — the API and the pipeline call these functions, and the tests exercise them directly.

export const PHASE_STATES = [
  "not_started",
  "in_progress",
  "submitted",
  "under_review",
  "interview_in_progress",
  "passed",
  "failed",
  "revision_needed",
  "assessment_unavailable",
] as const
export type PhaseState = (typeof PHASE_STATES)[number]

/** A phase is "concluded" once the Proof Engine has reached a decision on it — pass OR fail. */
export const CONCLUDED_STATES: readonly PhaseState[] = ["passed", "failed"]
export const isConcluded = (state: PhaseState) => CONCLUDED_STATES.includes(state)

/** States in which a submission is being processed: the candidate cannot submit again until it settles. */
export const IN_FLIGHT_STATES: readonly PhaseState[] = ["submitted", "under_review", "interview_in_progress"]

export interface PhaseNode {
  id: string
  key: string
  position: number
  /** Keys of the earlier phases this one builds on. Describes the work; it does not decide when the phase opens. */
  dependsOn: string[]
}

export interface Availability {
  available: boolean
  /** Keys of the earlier phases that have no valid recorded submission yet, in order. */
  blockedBy: string[]
}

/**
 * What counts as a "valid recorded submission": a row in `submissions` that was SAVED and passed the deterministic checks —
 * its stage is one of these. A "rejected" submission (empty, comment-only, a copy of the task, an unreadable repository) is
 * kept as history but is not valid work; an attempt refused before saving (bad input, a locked or busy phase) has no row at
 * all. A valid submission stays valid whatever its review or assessment later says (pending, failed or unavailable).
 */
export const VALID_SUBMISSION_STAGES = ["checked", "reviewed", "interviewing", "assessed"] as const

/**
 * Sequential SUBMISSION unlock: phase 1 is open from the start, and phase N opens once phase N−1 — and therefore every
 * earlier phase — has a valid recorded submission. Passing is NOT required: a pending, failed or unavailable assessment of an
 * earlier phase does not lock the phases after it. A phase's own state never matters here, and `dependsOn` only describes
 * the work. Submissions are never removed (except with the whole run), so once a phase opens it stays open.
 *
 * Every earlier phase is checked (not only N−1) so that a run recorded under an older rule, where a later phase may have
 * work while an earlier one has none, can never be used to skip a phase. Such a phase is frozen, not reset: its work and
 * results are kept, and it takes no new start, submission, answer or retry until the earlier phases have been submitted.
 *
 * Opening a phase says nothing about completing the challenge: that is the separate, stricter rule in `completion`.
 */
export function availability(phases: PhaseNode[], submitted: ReadonlySet<string>): Map<string, Availability> {
  const ordered = [...phases].sort((a, b) => a.position - b.position)
  const out = new Map<string, Availability>()
  const notSubmittedYet: string[] = []
  for (const phase of ordered) {
    out.set(phase.id, { available: notSubmittedYet.length === 0, blockedBy: [...notSubmittedYet] })
    if (!submitted.has(phase.id)) notSubmittedYet.push(phase.key)
  }
  return out
}

export interface Completion {
  complete: boolean
  /** Ids of the required phases that have not passed. */
  remaining: string[]
  passed: number
  total: number
}

/** The run is complete only when EVERY phase has passed. A failed phase keeps it incomplete until a later attempt passes. */
export function completion(phases: PhaseNode[], states: ReadonlyMap<string, PhaseState>): Completion {
  const remaining = phases.filter((p) => states.get(p.id) !== "passed").map((p) => p.id)
  return { complete: phases.length > 0 && remaining.length === 0, remaining, passed: phases.length - remaining.length, total: phases.length }
}

export type PhaseEvent =
  | "start"
  | "submit"
  | "validation_failed"
  | "review_started"
  | "interview_started"
  | "assessed_passed"
  | "assessed_failed"
  | "pipeline_failed"
  | "resume_review"
  | "resume_interview"

const TRANSITIONS: Record<PhaseEvent, { from: readonly PhaseState[]; to: PhaseState }> = {
  start: { from: ["not_started"], to: "in_progress" },
  // A passed phase is final; a phase being processed cannot be submitted again.
  submit: { from: ["not_started", "in_progress", "failed", "revision_needed", "assessment_unavailable"], to: "submitted" },
  validation_failed: { from: ["submitted"], to: "revision_needed" },
  review_started: { from: ["submitted"], to: "under_review" },
  interview_started: { from: ["under_review"], to: "interview_in_progress" },
  assessed_passed: { from: ["interview_in_progress"], to: "passed" },
  assessed_failed: { from: ["interview_in_progress"], to: "failed" },
  // The Proof Engine could not finish (provider outage, malformed output…). Never a pass, never a fail: recoverable.
  pipeline_failed: { from: ["submitted", "under_review", "interview_in_progress"], to: "assessment_unavailable" },
  resume_review: { from: ["assessment_unavailable"], to: "under_review" },
  resume_interview: { from: ["assessment_unavailable"], to: "interview_in_progress" },
}

export class IllegalTransition extends Error {
  from: PhaseState
  event: PhaseEvent
  constructor(from: PhaseState, event: PhaseEvent) {
    super(`A phase that is ${from.replace(/_/g, " ")} cannot ${event.replace(/_/g, " ")}.`)
    this.from = from
    this.event = event
  }
}

/** The state after `event`, or throws IllegalTransition. */
export function transition(from: PhaseState, event: PhaseEvent): PhaseState {
  const rule = TRANSITIONS[event]
  if (!rule.from.includes(from)) throw new IllegalTransition(from, event)
  return rule.to
}

export const canTransition = (from: PhaseState, event: PhaseEvent) => TRANSITIONS[event].from.includes(from)

/** Plain-language label for a state — used by the API and the UI alike. */
export const PHASE_STATE_LABELS: Record<PhaseState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  interview_in_progress: "Interview in progress",
  passed: "Passed",
  failed: "Not passed yet",
  revision_needed: "Revision needed",
  assessment_unavailable: "Assessment unavailable",
}

/** Checks a version's phase graph: unique keys, known dependencies, no self-dependency, no cycle. Returns problems. */
export function validatePhaseGraph(phases: { key: string; dependsOn: string[] }[]): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const p of phases) {
    if (keys.has(p.key)) problems.push(`Two phases share the key "${p.key}".`)
    keys.add(p.key)
  }
  for (const p of phases) {
    for (const dep of p.dependsOn) {
      if (dep === p.key) problems.push(`Phase "${p.key}" depends on itself.`)
      else if (!keys.has(dep)) problems.push(`Phase "${p.key}" depends on "${dep}", which does not exist.`)
    }
  }
  if (problems.length > 0) return problems
  // Cycle check (Kahn).
  const remaining = new Map(phases.map((p) => [p.key, new Set(p.dependsOn)]))
  let progressed = true
  while (remaining.size > 0 && progressed) {
    progressed = false
    for (const [key, deps] of remaining) {
      if ([...deps].every((d) => !remaining.has(d))) {
        remaining.delete(key)
        progressed = true
      }
    }
  }
  if (remaining.size > 0) problems.push(`The phases form a dependency cycle (${[...remaining.keys()].join(", ")}).`)
  return problems
}
