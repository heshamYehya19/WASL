// Mini-lessons, practice exercises and practice feedback for a skill gap. These are LEARNING material: they are generated for one
// candidate's gap, labelled as such everywhere they appear, and never feed back into an assessment or a pass/fail outcome.

import { arr, obj, oneOf, output, str } from "./schema.ts"
import { completeJson } from "./provider.ts"
import { UNTRUSTED_RULES, untrusted } from "./safety.ts"

export const LESSON_PROMPT_VERSION = "lesson.v1"
export const EXERCISE_PROMPT_VERSION = "exercise.v1"
export const EXERCISE_FEEDBACK_PROMPT_VERSION = "exercise-feedback.v1"

export interface GapContext {
  skill: string
  title: string
  detail: string
  severity: string
  difficulty: "beginner" | "intermediate" | "advanced"
  language: string
  /** A verified line from the candidate's work or answer that shows the gap, when there is one. */
  evidenceQuote: string
  gapId: string
}

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
- Be specific to the gap you are given. Do not lecture about the whole subject.
- Be kind and concrete. Describe the skill to build, never the person's shortcomings.
- Do not invent facts, links, course names or sources. If you are not sure of something, leave it out.
- Keep any code short, correct and in the learner's language when one is given.

${UNTRUSTED_RULES}

Return only the JSON object.`

const gapBlock = (g: GapContext) =>
  [
    `Skill: ${g.skill}`,
    `The gap: ${g.title}`,
    untrusted("gap_detail", g.detail),
    g.evidenceQuote ? `Something from the learner's own work or answer that shows it:\n${untrusted("learner_evidence", g.evidenceQuote)}` : "",
    `Level: ${g.difficulty}`,
    g.language ? `Language: ${g.language}` : "",
  ]
    .filter(Boolean)
    .join("\n")

export async function writeLesson(g: GapContext) {
  const done = await completeJson({
    purpose: "lesson",
    promptVersion: LESSON_PROMPT_VERSION,
    system: `${COMMON}\n\nWrite a mini-lesson: a clear explanation of the idea behind the gap, one worked example, and the key points to remember.`,
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
    system: `${COMMON}\n\nWrite one practice exercise that targets the gap directly. It must be answerable in writing or with a short piece of code, and must not need a server, an account or private data.`,
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
    system: `${COMMON}\n\nGive formative feedback on the learner's answer to a practice exercise: what worked, what to improve, and one next step. You cannot run code; reason from reading.`,
    user: [gapBlock(g), `The exercise:\n${exercisePrompt}`, `The learner's answer:\n${untrusted("learner_answer", answer)}`].join("\n\n"),
    output: output("exercise_feedback", feedbackField),
    temperature: 0.2,
    maxTokens: 1500,
    reasoning: "low",
    subject: { type: "gap", id: g.gapId },
  })
  return { ...done.value, provider: done.provider, model: done.model }
}
