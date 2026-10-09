// Turns a short brief (a company's five fields, or a student's Practice Lab request) into a validated multi-phase challenge.
// With a provider, the model drafts it and the server validates it (retrying once with the problems listed); with none, a
// labelled offline scaffold is used. If a provider is configured but fails, this throws — it never quietly swaps in the
// scaffold and calls it AI.

import { finalizeSpec, specField, SpecProblem } from "../domain/spec.ts"
import type { ChallengeSpec, Difficulty } from "../domain/spec.ts"
import { output } from "./schema.ts"
import { AiError, aiConfigured, completeJson } from "./provider.ts"
import { offlineTemplate } from "./offline-template.ts"
import { UNTRUSTED_RULES, untrusted } from "./safety.ts"

export const CHALLENGE_PROMPT_VERSION = "challenge-gen.v1"
export const PRACTICE_PROMPT_VERSION = "practice-gen.v1"

export interface Generated {
  spec: ChallengeSpec
  origin: "ai" | "offline_template"
  provider: string
  model: string
  promptVersion: string
}

export interface CompanyBrief {
  problemDescription: string
  requiredSkills: string[]
  difficulty: Difficulty
  expectedDeliverables: string
  timeHours: number
}

export interface PracticeRequest {
  skills: string[]
  difficulty: Difficulty
  description: string
  language: string
  timeHours: number
}

const SYSTEM_COMMON = `You design practical, assessable challenges for WASL, a platform where students and graduates demonstrate real ability. Each challenge is split into 2–6 ordered phases. A phase is something one person can finish and submit as code, a short written piece, or both; it is then reviewed by software and discussed with the candidate in an interview, so make the work something a person can explain.

Rules for the design:
- Phases build on each other. Use "dependsOn" to name EARLIER phase keys only (p1, p2, …); the first phase depends on nothing. A phase may depend on several earlier phases or on none.
- Every phase has 2–8 concrete acceptance criteria (conditions that can be checked by reading the submission) and 3–9 rubric items. The rubric must contain at least one item for each of: "correctness" (does it do what was asked), "code_quality" (is it readable, organised, maintainable — for a written phase, the clarity and structure of the writing) and "understanding" (what the candidate should be able to explain about their own work). For each rubric item give "strongSignal": what a strong piece of work or answer would show. Candidates never see strongSignal.
- Nothing may require running a server, paid services, accounts, private data, or special hardware. Work must be doable from a text editor and standard free tools.
- The challenge is an evaluation exercise: self-contained, with invented data and names. Do not ask for production features, access to real systems, personal data, or anything whose ownership would pass to a company.
- Be specific. Name concrete inputs, outputs and edge cases. Avoid filler such as "write clean code".
- Every required skill must be exercised by at least one phase (put it in that phase's "skills").
- estimatedHours: realistic hours for one candidate for each phase; the server scales your numbers to the stated time budget, so make them proportionate.
- Write in plain, direct English addressed to the candidate in "instructions". Use the same language register for every phase.

${UNTRUSTED_RULES}

Return only the JSON object.`

export const COMPANY_SYSTEM = `${SYSTEM_COMMON}

This challenge is for a company to put in front of candidates. Use 3–5 phases. Stay within the company's brief: do not widen its scope, and make the deliverables of the final phase match what the company said it expects.`

export const PRACTICE_SYSTEM = `${SYSTEM_COMMON}

This is a private practice challenge for one student to improve their skills — nobody else sees it. Use 2–4 phases. If a language is stated, use it for all code; if a description is given, follow it; otherwise pick a realistic, small scenario that exercises the chosen skills at the stated difficulty.`

function companyUser(brief: CompanyBrief): string {
  return [
    "Design a challenge from this company brief.",
    untrusted("company_problem_description", brief.problemDescription),
    untrusted("company_expected_deliverables", brief.expectedDeliverables),
    `Required skills/technologies: ${brief.requiredSkills.join(", ")}`,
    `Difficulty: ${brief.difficulty}`,
    `Realistic time for one candidate: ${brief.timeHours} hours in total`,
  ].join("\n\n")
}

function practiceUser(req: PracticeRequest): string {
  return [
    "Design a private practice challenge for a student.",
    `Skills to practise: ${req.skills.join(", ")}`,
    `Difficulty: ${req.difficulty}`,
    `Time available: ${req.timeHours} hours in total`,
    req.language ? `Programming language: ${req.language}` : "Programming language: the student's choice",
    req.description ? untrusted("student_description", req.description) : "No description was given: choose a suitable scenario.",
  ].join("\n\n")
}

async function generate(
  kind: "company" | "practice",
  user: string,
  ctx: { requiredSkills: string[]; budgetHours: number; difficulty: Difficulty },
  subject: { type: string; id: string } | undefined,
): Promise<Generated> {
  const promptVersion = kind === "company" ? CHALLENGE_PROMPT_VERSION : PRACTICE_PROMPT_VERSION
  let feedback = ""
  let lastProblems: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const done = await completeJson({
      purpose: kind === "company" ? "challenge_generation" : "practice_generation",
      promptVersion,
      system: kind === "company" ? COMPANY_SYSTEM : PRACTICE_SYSTEM,
      user: user + feedback,
      output: output("challenge", specField),
      temperature: 0.4,
      maxTokens: 7000,
      reasoning: "medium",
      subject,
    })
    try {
      const spec = finalizeSpec(done.value, ctx)
      return { spec, origin: "ai", provider: done.provider, model: done.model, promptVersion }
    } catch (err) {
      if (!(err instanceof SpecProblem)) throw err
      lastProblems = err.problems
      feedback = `\n\nYour previous attempt was rejected for these reasons — fix them:\n- ${err.problems.join("\n- ")}`
    }
  }
  throw new AiError("schema", `The model's challenge did not pass validation (${lastProblems.slice(0, 3).join(" ")}).`)
}

/** `useTemplate` is an explicit request for the offline scaffold when a provider is configured but unavailable. */
export async function generateCompanyChallenge(brief: CompanyBrief, opts: { useTemplate?: boolean; subject?: { type: string; id: string } } = {}): Promise<Generated> {
  if (opts.useTemplate || !aiConfigured()) {
    const spec = offlineTemplate({ problem: brief.problemDescription, skills: brief.requiredSkills, difficulty: brief.difficulty, deliverables: brief.expectedDeliverables, hours: brief.timeHours })
    return { spec, origin: "offline_template", provider: "", model: "", promptVersion: "offline-template.v1" }
  }
  return generate("company", companyUser(brief), { requiredSkills: brief.requiredSkills, budgetHours: brief.timeHours, difficulty: brief.difficulty }, opts.subject)
}

export async function generatePracticeChallenge(req: PracticeRequest, opts: { useTemplate?: boolean; subject?: { type: string; id: string } } = {}): Promise<Generated> {
  if (opts.useTemplate || !aiConfigured()) {
    const spec = offlineTemplate({ problem: req.description, skills: req.skills, difficulty: req.difficulty, deliverables: "", hours: req.timeHours, practice: true, language: req.language })
    return { spec, origin: "offline_template", provider: "", model: "", promptVersion: "offline-template.v1" }
  }
  return generate("practice", practiceUser(req), { requiredSkills: req.skills, budgetHours: req.timeHours, difficulty: req.difficulty }, opts.subject)
}
