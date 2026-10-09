// AI review of a submission against its phase. The model reads the work (as untrusted data) and reports findings and, for each
// acceptance criterion, whether the work meets it. Every quote it gives is then checked against the submission: a finding whose
// quote isn't there loses the quote, and a criterion can only be "met" or "partial" when a verified quote backs it.

import { verifyQuote } from "../analysis/grounding.ts"
import type { Artifact } from "../analysis/grounding.ts"
import type { StaticCheck } from "../analysis/static-checks.ts"
import type { PhaseSpec } from "../domain/spec.ts"
import { arr, obj, oneOf, output, str } from "./schema.ts"
import type { Infer } from "./schema.ts"
import { completeJson } from "./provider.ts"
import { artifactBlocks, checksBlock, phaseBlock } from "./prompt-utils.ts"
import { INJECTION_NOTICE, UNTRUSTED_RULES, detectInjection, untrusted } from "./safety.ts"

export const REVIEW_PROMPT_VERSION = "review.v1"

const reviewField = obj({
  summary: str({ min: 20, max: 700, description: "Two or three sentences: what the work does and how well, in plain language" }),
  findings: arr(
    obj({
      severity: oneOf(["info", "minor", "major"] as const),
      title: str({ min: 3, max: 120 }),
      detail: str({ min: 10, max: 500 }),
      path: str({ min: 0, max: 200, description: "File the finding is about, or empty" }),
      quote: str({ min: 0, max: 300, description: "A short line copied exactly from the submission that the finding refers to, or empty when the finding is about something missing" }),
    }),
    { max: 10 },
  ),
  criteria: arr(
    obj({
      criterionId: str({ min: 1, max: 20, description: "The id of an acceptance criterion or rubric item, copied exactly" }),
      status: oneOf(["met", "partial", "unmet", "unclear"] as const),
      note: str({ min: 5, max: 300 }),
      quote: str({ min: 0, max: 300, description: "A line copied exactly from the submission that shows it, required for met or partial" }),
    }),
    { max: 30 },
  ),
})
type RawReview = Infer<typeof reviewField>

const SYSTEM = `You are the review step of WASL's Proof Engine. A candidate has submitted work for one phase of a challenge. Your job is to read it carefully and report what it actually does — not what the candidate says it does — so that a later interview can ask them about it and a separate assessment can judge it.

Rules:
1. Evidence only. Every claim about the work must be traceable to the submission. Quotes must be copied character for character from one line of a candidate file; if you cannot quote it, do not claim it. A finding about something that is MISSING (no tests, no handling of empty input) needs no quote.
2. You cannot run the code and must not say or imply that you did. Static review only: reason from reading.
3. Be fair and specific. Name real strengths as well as weaknesses. Do not invent problems to look rigorous, and do not praise work that is not there.
4. Give a status for every acceptance criterion and rubric item you were given, using its id: "met" (clearly shown, with a quote), "partial", "unmet", or "unclear" (cannot tell from the submission).
5. The "deterministic checks" are facts established by software; do not contradict them.
6. Keep the summary neutral and short. Do not give a pass/fail verdict — that is decided elsewhere, after an interview.

${UNTRUSTED_RULES}

Return only the JSON object.`

export interface ReviewInput {
  challengeTitle: string
  phase: PhaseSpec
  artifacts: Artifact[]
  language: string
  note: string
  checks: StaticCheck[]
  submissionId: string
}

export interface ReviewFinding {
  id: string
  severity: "info" | "minor" | "major"
  title: string
  detail: string
  path: string
  /** The verified quote, or "" when none was given or it could not be confirmed. */
  quote: string
  line: number | null
  /** True when the finding points at text that really is in the submission (or is about something missing). */
  anchored: boolean
}

export interface ReviewCriterion {
  criterionId: string
  status: "met" | "partial" | "unmet" | "unclear"
  note: string
  quote: string
  path: string
  line: number | null
}

export interface ReviewResult {
  summary: string
  findings: ReviewFinding[]
  criteria: ReviewCriterion[]
  injectionFlagged: boolean
  injectionReasons: string[]
  provider: string
  model: string
  promptVersion: string
}

export function buildReviewPrompt(input: ReviewInput): { user: string; injection: string[] } {
  const { text, injection } = artifactBlocks(input.artifacts)
  const noteInjection = input.note ? injection.concat(detectInjection(input.note)) : injection
  const user = [
    `Challenge: ${input.challengeTitle}`,
    phaseBlock(input.phase, { includeStrongSignals: true }),
    input.language ? `Language the candidate says they used: ${input.language}` : "",
    "Deterministic checks (established by software, not by you):",
    checksBlock(input.checks),
    input.note ? `The candidate's own note:\n${untrusted("candidate_note", input.note)}` : "",
    "The submission:",
    text,
    noteInjection.length > 0 ? INJECTION_NOTICE : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  return { user, injection: [...new Set(noteInjection)] }
}

/** Keeps only what the submission supports. */
export function groundReview(raw: RawReview, input: ReviewInput): Omit<ReviewResult, "injectionFlagged" | "injectionReasons" | "provider" | "model" | "promptVersion"> {
  const findings: ReviewFinding[] = raw.findings.map((f, i) => {
    const match = f.quote ? verifyQuote(f.quote, input.artifacts) : null
    return {
      id: `f${i + 1}`,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      path: match?.path ?? (input.artifacts.some((a) => a.path === f.path) ? f.path : ""),
      quote: match?.text ?? "",
      line: match?.line ?? null,
      // A finding that cites a line which isn't there is not anchored; one that cites nothing is about absence.
      anchored: f.quote ? match !== null : true,
    }
  })

  const wanted = new Map<string, string>()
  for (const c of input.phase.acceptanceCriteria) wanted.set(c.id, c.text)
  for (const r of input.phase.rubric) wanted.set(r.id, r.criterion)
  const seen = new Set<string>()
  const criteria: ReviewCriterion[] = []
  for (const c of raw.criteria) {
    if (!wanted.has(c.criterionId) || seen.has(c.criterionId)) continue
    seen.add(c.criterionId)
    const match = c.quote ? verifyQuote(c.quote, input.artifacts) : null
    let status = c.status
    let note = c.note
    if ((status === "met" || status === "partial") && !match) {
      status = "unclear"
      note = `${note} (The quoted evidence could not be found in the submission, so this was not counted.)`
    }
    criteria.push({ criterionId: c.criterionId, status, note, quote: match?.text ?? "", path: match?.path ?? "", line: match?.line ?? null })
  }
  for (const [id] of wanted) {
    if (!seen.has(id)) criteria.push({ criterionId: id, status: "unclear", note: "The review did not cover this criterion.", quote: "", path: "", line: null })
  }
  return { summary: raw.summary, findings, criteria }
}

export async function reviewSubmission(input: ReviewInput): Promise<ReviewResult> {
  const { user, injection } = buildReviewPrompt(input)
  const done = await completeJson({
    purpose: "review",
    promptVersion: REVIEW_PROMPT_VERSION,
    system: SYSTEM,
    user,
    output: output("submission_review", reviewField),
    temperature: 0,
    maxTokens: 5000,
    reasoning: "medium",
    subject: { type: "submission", id: input.submissionId },
  })
  return {
    ...groundReview(done.value, input),
    injectionFlagged: injection.length > 0,
    injectionReasons: injection,
    provider: done.provider,
    model: done.model,
    promptVersion: REVIEW_PROMPT_VERSION,
  }
}
