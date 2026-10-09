// Mini-lessons, practice exercises and practice feedback for a skill gap. These are LEARNING material: they are generated for one
// candidate's gap, labelled as such everywhere they appear, and never feed back into an assessment or a pass/fail outcome.

import { arr, obj, oneOf, output, str } from "./schema.ts"
import { completeJson } from "./provider.ts"
import { UNTRUSTED_RULES, untrusted } from "./safety.ts"

export const LESSON_PROMPT_VERSION = "lesson.v2"
export const EXERCISE_PROMPT_VERSION = "exercise.v2"
export const EXERCISE_FEEDBACK_PROMPT_VERSION = "exercise-feedback.v2"

export interface GapContext {
  skill: string
  title: string
  detail: string
  severity: string
  difficulty: "beginner" | "intermediate" | "advanced"
  language: string
  /** A line from the candidate's code or interview answer that the server VERIFIED shows the gap; empty when there is none. */
  evidenceQuote: string
  /** Where the verified quote came from. "none" means nothing was verified (or the gap is about something absent). */
  evidenceSource: "code" | "answer" | "none"
  /** For code evidence: "path line N". */
  evidenceLocation: string
  /** For answer evidence: the interview question the quoted answer was replying to. */
  askedQuestion: string
  phaseTitle: string
  phaseObjective: string
  /** What the assessment said was weak, for context (model-written: treated as data). */
  weaknesses: string[]
  gapId: string
}

/**
 * Whether learning material for a gap can be aimed at the learner's own work. Only verified evidence counts: without it the
 * material is a clearly labelled GENERAL lesson on the named skill, never an invented diagnosis of what the learner did.
 */
export const lessonBasis = (g: Pick<GapContext, "evidenceQuote" | "evidenceSource">): "evidence" | "general" =>
  g.evidenceSource !== "none" && g.evidenceQuote.trim() ? "evidence" : "general"

export const LESSON_BASIS_LABELS = {
  evidence: "Based on your own work: the assessment pointed to a specific line of your code or interview answer.",
  general: "General lesson: the assessment named this skill gap but did not point to a specific line of your work, so this covers the skill in general rather than diagnosing what you did.",
} as const

const lessonField = obj({
  title: str({ min: 5, max: 120 }),
  body: str({ min: 200, max: 2200, description: "A focused explanation in plain language, with one short worked example in a fenced block if code helps" }),
  keyPoints: arr(str({ min: 5, max: 200 }), { min: 2, max: 6 }),
})
const exerciseField = obj({
  prompt: str({ min: 40, max: 1200, description: "A small task the learner can do in 10–20 minutes, different from the original challenge" }),
  hints: arr(str({ min: 5, max: 200 }), { min: 1, max: 4 }),
})
const feedbackField = obj({
  looksCorrect: oneOf(["yes", "partly", "no"] as const),
  whatWorked: arr(str({ min: 5, max: 200 }), { max: 4 }),
  toImprove: arr(str({ min: 5, max: 250 }), { max: 4 }),
  nextStep: str({ min: 10, max: 300 }),
})
export type ExerciseFeedback = { looksCorrect: "yes" | "partly" | "no"; whatWorked: string[]; toImprove: string[]; nextStep: string }

const COMMON = `You are a patient tutor inside WASL. A learner's work on a challenge showed a specific gap in one skill. You write short learning material to help them close it.

Rules:
- This is practice and teaching, NOT assessment. Never say or imply that it changes their results, and never grade them.
- Aim at the exact weakness described in the gap — and, when one is given, at the learner's own line or answer and the question it replied to. Not the broader topic it belongs to, and not a neighbouring idea.
- If the basis is GENERAL, you do not know what the learner did. Do not describe their work or guess at a cause; teach the named skill in general, and say in the first sentence that this is a general lesson.
- Be kind and concrete. Describe the skill to build, never the person's shortcomings.
- Do not invent facts, links, course names or sources. If you are not sure of something, leave it out.
- Keep any code short, correct and in the learner's language when one is given.

${UNTRUSTED_RULES}

Return only the JSON object.`

function basisBlock(g: GapContext): string {
  if (lessonBasis(g) === "general") return "Basis: GENERAL — no line of the learner's code or interview answers was verified as showing this gap."
  if (g.evidenceSource === "code") {
    return `Basis: EVIDENCE — a verified line from the learner's own code${g.evidenceLocation ? ` (${g.evidenceLocation})` : ""}:\n${untrusted("learner_code_line", g.evidenceQuote)}`
  }
  return [
    "Basis: EVIDENCE — a verified passage from the learner's own interview answer.",
    g.askedQuestion ? `The question they were answering:\n${untrusted("interview_question", g.askedQuestion)}` : "",
    `What they said:\n${untrusted("learner_answer_excerpt", g.evidenceQuote)}`,
  ]
    .filter(Boolean)
    .join("\n")
}

const gapBlock = (g: GapContext) =>
  [
    `The skill gap to work on${g.phaseTitle ? `, from the assessment of the phase “${g.phaseTitle}”` : ""}:`,
    `Skill: ${g.skill}`,
    `The gap: ${g.title}`,
    untrusted("gap_detail", g.detail),
    `Severity: ${g.severity}`,
    basisBlock(g),
    g.phaseObjective ? `What that phase asked of the learner: ${g.phaseObjective}` : "",
    g.weaknesses.length ? `Other weaknesses the assessment noted (context only):\n${untrusted("assessment_weaknesses", g.weaknesses.map((w) => `- ${w}`).join("\n"))}` : "",
    `Level: ${g.difficulty}`,
    g.language ? `Language: ${g.language}` : "",
  ]
    .filter(Boolean)
    .join("\n")

export async function writeLesson(g: GapContext) {
  const done = await completeJson({
    purpose: "lesson",
    promptVersion: LESSON_PROMPT_VERSION,
    system: `${COMMON}\n\nWrite a mini-lesson: a clear explanation of the idea behind THIS gap, one worked example that shows exactly that idea, and the key points to remember. With an EVIDENCE basis, connect the explanation to the learner's line or answer.`,
    user: gapBlock(g),
    output: output("lesson", lessonField),
    temperature: 0.3,
    maxTokens: 3000,
    reasoning: "low",
    subject: { type: "gap", id: g.gapId },
  })
  return { ...done.value, provider: done.provider, model: done.model, promptVersion: LESSON_PROMPT_VERSION }
}

export async function writeExercise(g: GapContext) {
  const done = await completeJson({
    purpose: "exercise",
    promptVersion: EXERCISE_PROMPT_VERSION,
    system: `${COMMON}\n\nWrite one practice exercise that tests exactly this gap: someone who has closed the gap can do it, and someone who has not will struggle. Do not test a neighbouring topic. It must be answerable in writing or with a short piece of code, and must not need a server, an account or private data.`,
    user: gapBlock(g),
    output: output("exercise", exerciseField),
    temperature: 0.4,
    maxTokens: 1500,
    reasoning: "low",
    subject: { type: "gap", id: g.gapId },
  })
  return { ...done.value, provider: done.provider, model: done.model, promptVersion: EXERCISE_PROMPT_VERSION }
}

export async function giveFeedback(g: GapContext, exercisePrompt: string, answer: string): Promise<ExerciseFeedback & { provider: string; model: string }> {
  const done = await completeJson({
    purpose: "exercise_feedback",
    promptVersion: EXERCISE_FEEDBACK_PROMPT_VERSION,
    system: `${COMMON}\n\nGive formative feedback on the learner's answer to a practice exercise: what worked, what to improve, and one next step. Judge it against the exercise and this gap only, and keep "what to improve" and the next step about this weakness. You cannot run code; reason from reading.`,
    user: [gapBlock(g), `The exercise:\n${exercisePrompt}`, `The learner's answer:\n${untrusted("learner_answer", answer)}`].join("\n\n"),
    output: output("exercise_feedback", feedbackField),
    temperature: 0.2,
    maxTokens: 1500,
    reasoning: "low",
    subject: { type: "gap", id: g.gapId },
  })
  return { ...done.value, provider: done.provider, model: done.model }
}
