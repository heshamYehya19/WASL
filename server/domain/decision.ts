// The pass/fail rule. The model rates three dimensions 0–3 and cites evidence; THIS file decides the outcome. The model is
// never asked to say pass or fail, and cannot talk its way to one: a rating without evidence the server has verified does
// not count, and an interview that was not completed produces no decision at all.

export const RATING_LABELS = ["Not demonstrated", "Partly demonstrated", "Largely demonstrated", "Clearly demonstrated"] as const

export const PASS_RULE = {
  /** Correctness: the work does what the phase asked. */
  correctness: 2,
  /** Code quality: a deliberately low bar — readable, structured enough to follow. */
  codeQuality: 1,
  /** Demonstrated understanding: the candidate can explain and defend the work in their own words. */
  understanding: 2,
} as const

/** The interview must reach at least this many answered questions before any decision exists. */
export const MIN_ANSWERED_QUESTIONS = 3
export const MAX_QUESTIONS = 6

export type Rating = 0 | 1 | 2 | 3
export const isRating = (n: unknown): n is Rating => n === 0 || n === 1 || n === 2 || n === 3

export interface DecisionInput {
  correctness: { rating: Rating; verifiedEvidence: number }
  codeQuality: { rating: Rating; verifiedEvidence: number }
  understanding: { rating: Rating; verifiedEvidence: number }
  interviewCompleted: boolean
  answeredQuestions: number
}

export type Decision =
  | { kind: "passed"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "insufficient"; reason: string }

export function decide(input: DecisionInput): Decision {
  if (!input.interviewCompleted) return { kind: "insufficient", reason: "The understanding interview is not complete, so there is no decision yet." }
  if (input.answeredQuestions < MIN_ANSWERED_QUESTIONS) {
    return { kind: "insufficient", reason: `The interview needs at least ${MIN_ANSWERED_QUESTIONS} answered questions; it has ${input.answeredQuestions}.` }
  }
  const missing = (
    [
      ["correctness", input.correctness],
      ["code quality", input.codeQuality],
      ["demonstrated understanding", input.understanding],
    ] as const
  )
    .filter(([, d]) => d.verifiedEvidence < 1)
    .map(([name]) => name)
  if (missing.length > 0) {
    return { kind: "insufficient", reason: `There is not enough verified evidence to rate ${missing.join(" and ")}, so no decision was made.` }
  }

  const short: string[] = []
  if (input.correctness.rating < PASS_RULE.correctness) short.push(`correctness was rated ${input.correctness.rating} of 3 (needs ${PASS_RULE.correctness})`)
  if (input.codeQuality.rating < PASS_RULE.codeQuality) short.push(`code quality was rated ${input.codeQuality.rating} of 3 (needs ${PASS_RULE.codeQuality})`)
  if (input.understanding.rating < PASS_RULE.understanding) short.push(`demonstrated understanding was rated ${input.understanding.rating} of 3 (needs ${PASS_RULE.understanding})`)
  if (short.length > 0) return { kind: "failed", reason: `Not passed yet: ${short.join("; ")}.` }
  return { kind: "passed", reason: "Correctness, code quality and demonstrated understanding all met the bar." }
}
