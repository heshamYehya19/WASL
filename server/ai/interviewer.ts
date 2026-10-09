// The adaptive understanding interview. After a submission is reviewed, the candidate is asked open-ended questions about THEIR
// OWN work — one at a time, each tied to a specific finding, criterion or line of code — with follow-ups when an answer is
// vague. The model proposes each turn; the server decides whether the turn is acceptable (grounded, not multiple choice, not a
// repeat, within the question limits) and refuses it otherwise. The interview ends only by the server's rules.

import { backtickTokens, similarity, tokenInArtifacts, verifyQuote } from "../analysis/grounding.ts"
import type { Artifact } from "../analysis/grounding.ts"
import { MAX_QUESTIONS, MIN_ANSWERED_QUESTIONS } from "../domain/decision.ts"
import type { PhaseSpec } from "../domain/spec.ts"
import { AiError, completeJson } from "./provider.ts"
import { artifactBlocks, phaseBlock } from "./prompt-utils.ts"
import { bool, obj, oneOf, output, str } from "./schema.ts"
import type { Infer } from "./schema.ts"
import { INJECTION_NOTICE, UNTRUSTED_RULES, detectInjection, untrusted } from "./safety.ts"
import type { ReviewResult } from "./reviewer.ts"

export const INTERVIEW_PROMPT_VERSION = "interview.v1"
const MAX_CONSECUTIVE_FOLLOWUPS = 2
const INTERVIEW_ARTIFACT_BUDGET = 9_000

export type AnswerQuality = "none" | "clear" | "partial" | "vague" | "off_topic" | "evasive"

export interface Grounding {
  kind: "finding" | "criterion" | "code" | "answer"
  ref: string
  path: string
  line: number | null
  quote: string
  why: string
}

export interface Turn {
  role: "interviewer" | "candidate"
  content: string
  grounding?: Grounding
  isFollowup?: boolean
}

export interface InterviewInput {
  challengeTitle: string
  phase: PhaseSpec
  review: Pick<ReviewResult, "summary" | "findings" | "criteria">
  artifacts: Artifact[]
  transcript: Turn[]
  submissionId: string
}

const turnField = obj({
  action: oneOf(["ask", "finish"] as const, "ask the next question, or finish when you have enough evidence"),
  question: str({ min: 0, max: 600, description: "The one question to ask next. Empty when finishing" }),
  isFollowup: bool("true if this digs into the candidate's last answer rather than opening a new topic"),
  groundingKind: oneOf(["finding", "criterion", "code", "answer"] as const),
  groundingRef: str({ min: 0, max: 200, description: "For finding: the finding id (f1…). For criterion: the criterion id. For code: the file path. For answer: empty" }),
  quote: str({ min: 0, max: 300, description: "A short line copied exactly from the candidate's code that the question is about, or empty" }),
  why: str({ min: 0, max: 300, description: "One sentence: what understanding this question probes" }),
  answerQuality: oneOf(["none", "clear", "partial", "vague", "off_topic", "evasive"] as const, "your reading of the candidate's LAST answer; none if there is no answer yet"),
})
type RawTurn = Infer<typeof turnField>

const SYSTEM = `You are the interviewer in WASL's Proof Engine. A candidate has submitted work for one phase of a challenge and it has been reviewed. You now hold a short, friendly, conversational interview to find out whether the candidate truly understands the work they submitted. You ask one question at a time.

What a good question looks like:
- Open-ended: it needs reasoning in the candidate's own words. Never multiple choice, never true/false, never "which of the following".
- Grounded: it concerns something specific in THEIR submission — a finding from the review (use its id), an acceptance criterion or rubric item (use its id), or a line of their code (quote it exactly, and refer to identifiers in \`backticks\`). Never ask about code that is not in their submission.
- Varied: cover different angles over the interview — why they chose an approach, how a specific part works, what happens on an edge case or a bad input, how they would change it for a new requirement, how they would test it, what they would do differently.
- Adaptive: if the last answer was vague, evasive, or skipped the point, ask ONE follow-up that makes the same point answerable more concretely (set isFollowup true, groundingKind "answer"). If it was clear and correct, move to a new topic or go deeper. Never ask the same question twice in different words.
- Fair: you are not trying to trap anyone. Do not ask about things the phase never required. Do not reveal the rubric's "strong answer" notes or hint at the answer.

Rules for the interview:
- Ask at least ${MIN_ANSWERED_QUESTIONS} questions in total, at most ${MAX_QUESTIONS}. Finish (action "finish") only once you have heard enough to judge understanding of correctness and quality, and never before ${MIN_ANSWERED_QUESTIONS} answers.
- You cannot run the code. Never say you did.
- You do not decide pass or fail and must not hint at an outcome.

${UNTRUSTED_RULES}

Return only the JSON object.`

export function buildInterviewPrompt(input: InterviewInput): { user: string; injection: string[] } {
  const { text, injection } = artifactBlocks(input.artifacts, INTERVIEW_ARTIFACT_BUDGET)
  const transcriptInjection = input.transcript.filter((t) => t.role === "candidate").flatMap((t) => detectInjection(t.content))
  const flagged = [...new Set([...injection, ...transcriptInjection])]
  const asked = input.transcript.filter((t) => t.role === "interviewer").length
  const answered = input.transcript.filter((t) => t.role === "candidate").length
  const lines = input.transcript.map((t, i) =>
    t.role === "interviewer"
      ? `Interviewer (question ${input.transcript.slice(0, i + 1).filter((x) => x.role === "interviewer").length}${t.isFollowup ? ", follow-up" : ""}): ${t.content}`
      : `Candidate:\n${untrusted("candidate_answer", t.content)}`,
  )
  const user = [
    `Challenge: ${input.challengeTitle}`,
    phaseBlock(input.phase, { includeStrongSignals: true }),
    "Review of the submission:",
    `Summary: ${input.review.summary}`,
    ...input.review.findings.map((f) => `- [${f.id}] (${f.severity}) ${f.title}: ${f.detail}${f.quote ? ` — line: ${f.quote}` : ""}`),
    "The submission (excerpts):",
    text,
    lines.length > 0 ? `Interview so far:\n${lines.join("\n\n")}` : "The interview has not started: ask the first question.",
    `Questions asked so far: ${asked}. Answered: ${answered}. Remaining allowed: ${MAX_QUESTIONS - asked}.`,
    flagged.length > 0 ? INJECTION_NOTICE : "",
  ]
    .filter(Boolean)
    .join("\n\n")
  return { user, injection: flagged }
}

export type TurnDecision =
  | { action: "ask"; question: string; grounding: Grounding; isFollowup: boolean; answerQuality: AnswerQuality }
  | { action: "finish"; answerQuality: AnswerQuality }

const MULTIPLE_CHOICE = [
  /(^|\n)\s*(?:\(?[A-Da-d][).:]|\(?[1-4][).])\s+\S[^\n]*\n\s*(?:\(?[A-Da-d][).:]|\(?[1-4][).])\s+\S/,
  /\bwhich of the following\b/i,
  /\bchoose (?:one|the (?:correct|best))\b/i,
  /\b(?:true or false|true\/false)\b/i,
  /\bselect (?:one|the correct)\b/i,
]
export const isMultipleChoice = (q: string) => MULTIPLE_CHOICE.some((p) => p.test(q))

const REPEAT_THRESHOLD = 0.6

/** Why a proposed turn is not acceptable, or [] when it is. The server's rules, independent of what the model claims. */
export function judgeTurn(raw: RawTurn, input: InterviewInput): { problems: string[]; decision: TurnDecision | null } {
  const asked = input.transcript.filter((t) => t.role === "interviewer")
  const answered = input.transcript.filter((t) => t.role === "candidate").length
  const quality = raw.answerQuality as AnswerQuality
  const problems: string[] = []

  if (raw.action === "finish") {
    if (answered < MIN_ANSWERED_QUESTIONS) problems.push(`You cannot finish before ${MIN_ANSWERED_QUESTIONS} answers; the candidate has given ${answered}. Ask another question.`)
    return { problems, decision: problems.length === 0 ? { action: "finish", answerQuality: quality } : null }
  }

  const question = raw.question.trim()
  if (!question) problems.push("The question is empty.")
  if (asked.length >= MAX_QUESTIONS) problems.push(`The interview already has ${MAX_QUESTIONS} questions; it must finish.`)
  if (isMultipleChoice(question)) problems.push("The question is multiple choice. Ask an open-ended question that needs reasoning.")
  if ((question.match(/\?/g) ?? []).length > 2) problems.push("Ask one question at a time.")
  for (const prior of asked) {
    if (similarity(question, prior.content) >= REPEAT_THRESHOLD) problems.push(`The question repeats an earlier one (“${prior.content.slice(0, 60)}…”). Ask about something different.`)
  }

  if (input.transcript.length === 0 && raw.isFollowup) problems.push("The first question cannot be a follow-up.")
  let tail = 0
  for (let i = asked.length - 1; i >= 0 && asked[i].isFollowup; i--) tail++
  if (raw.isFollowup && tail >= MAX_CONSECUTIVE_FOLLOWUPS) problems.push(`That would be follow-up number ${tail + 1} on the same point. Move to a new topic.`)

  // Grounding: the question has to be about something that exists.
  const grounding: Grounding = { kind: raw.groundingKind, ref: raw.groundingRef.trim(), path: "", line: null, quote: "", why: raw.why.trim() }
  if (raw.groundingKind === "finding") {
    if (!input.review.findings.some((f) => f.id === grounding.ref)) problems.push(`There is no finding "${grounding.ref}". Use a finding id from the review.`)
  } else if (raw.groundingKind === "criterion") {
    const known = [...input.phase.acceptanceCriteria.map((c) => c.id), ...input.phase.rubric.map((r) => r.id)]
    if (!known.includes(grounding.ref)) problems.push(`There is no criterion "${grounding.ref}". Use an id from the phase.`)
  } else if (raw.groundingKind === "code") {
    const match = raw.quote ? verifyQuote(raw.quote, input.artifacts) : null
    if (!match && !input.artifacts.some((a) => a.path === grounding.ref)) problems.push("A code-based question must quote a line that exists in the submission, or name one of its files.")
    if (match) Object.assign(grounding, { path: match.path, line: match.line, quote: match.text })
  } else if (raw.groundingKind === "answer") {
    if (answered === 0) problems.push("There is no earlier answer to follow up on.")
  }
  if (raw.groundingKind !== "answer" && raw.isFollowup && answered === 0) problems.push("There is no earlier answer to follow up on.")
  if (raw.groundingKind === "answer" && !raw.isFollowup) problems.push("A question grounded in an earlier answer is a follow-up.")
  if (raw.groundingKind !== "code" && raw.quote) {
    const match = verifyQuote(raw.quote, input.artifacts)
    if (match) Object.assign(grounding, { path: match.path, line: match.line, quote: match.text })
  }
  for (const token of backtickTokens(question)) {
    const inTask = input.phase.instructions.includes(token) || input.phase.deliverables.some((d) => d.includes(token))
    if (!tokenInArtifacts(token, input.artifacts) && !inTask) problems.push(`The question mentions \`${token}\`, which is not in the submission.`)
  }

  if (problems.length > 0) return { problems, decision: null }
  return { problems, decision: { action: "ask", question, grounding, isFollowup: raw.isFollowup, answerQuality: quality } }
}

export interface InterviewTurnResult {
  decision: TurnDecision
  injectionFlagged: boolean
}

/** The next interview turn. Throws AiError if no acceptable turn could be obtained — never invents a question. */
export async function nextInterviewTurn(input: InterviewInput): Promise<InterviewTurnResult> {
  const answered = input.transcript.filter((t) => t.role === "candidate").length
  // The question limit is the server's: once reached, there is nothing left to ask.
  if (answered >= MAX_QUESTIONS) return { decision: { action: "finish", answerQuality: "none" }, injectionFlagged: false }

  const { user, injection } = buildInterviewPrompt(input)
  let feedback = ""
  let last: string[] = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    const done = await completeJson({
      purpose: "interview",
      promptVersion: INTERVIEW_PROMPT_VERSION,
      system: SYSTEM,
      user: user + feedback,
      output: output("interview_turn", turnField),
      temperature: 0.3,
      maxTokens: 1500,
      reasoning: "low",
      subject: { type: "submission", id: input.submissionId },
    })
    const judged = judgeTurn(done.value, input)
    if (judged.decision) return { decision: judged.decision, injectionFlagged: injection.length > 0 }
    last = judged.problems
    feedback = `\n\nYour previous turn was rejected:\n- ${judged.problems.join("\n- ")}\nPropose a corrected turn.`
  }
  throw new AiError("schema", `The interviewer could not produce an acceptable question (${last.slice(0, 2).join(" ")}).`)
}
