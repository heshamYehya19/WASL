// A deterministic, clearly labelled scaffold used ONLY for challenge generation when the server has no AI provider configured.
// It is not AI output and is never presented as such: the version's origin is "offline_template", the company is told to
// review and edit it, and the UI says so. It exists so a company can still shape a challenge by hand without a key. The
// Proof Engine (review, interview, assessment) has no template equivalent — without a model those steps are unavailable.

import { finalizeSpec } from "../domain/spec.ts"
import type { ChallengeSpec, Difficulty, RawSpec } from "../domain/spec.ts"
import { canonicalSkillList } from "../domain/skills.ts"

export interface TemplateInput {
  problem: string
  skills: string[]
  difficulty: Difficulty
  deliverables: string
  hours: number
  /** "company" briefs ask for a stated deliverable; practice has none. */
  practice?: boolean
  language?: string
}

const firstSentence = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  const cut = flat.split(/(?<=[.!?])\s/)[0] ?? flat
  return (cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut).replace(/[.]+$/, "")
}

export function offlineTemplate(input: TemplateInput): ChallengeSpec {
  const skills = canonicalSkillList(input.skills, 8)
  const topic = firstSentence(input.problem || skills.join(", "), 80)
  const where = input.language ? ` in ${input.language}` : ""
  const raw: RawSpec = {
    title: input.practice ? `Practice: ${topic}`.slice(0, 120) : `Challenge: ${topic}`.slice(0, 120),
    summary: (
      `${input.problem.replace(/\s+/g, " ").trim().slice(0, 600)} ` +
      "This three-phase outline is a scaffold, not AI output: review each phase and edit it before using it."
    ).trim(),
    scenario: "",
    learningGoals: [`Apply ${skills.slice(0, 3).join(", ")} to a realistic problem`, "Explain design decisions and trade-offs in your own words"],
    skills,
    difficulty: input.difficulty,
    estimatedHours: input.hours,
    phases: [
      {
        key: "p1",
        title: "Understand the problem and plan",
        objective: "Show that you understand the problem and have a sound plan before building.",
        instructions:
          `Read the problem carefully: "${firstSentence(input.problem, 200)}". Write a short plan in your own words covering what you will build, the assumptions you are making, ` +
          "the open questions you would ask, the main parts of the solution, and how you will check that it works. Keep it under one page.",
        skills: skills.slice(0, 3),
        acceptanceCriteria: [
          "States the problem in the candidate's own words",
          "Lists assumptions and at least one open question",
          "Names the main components and how each will be tested",
        ],
        rubric: [
          { dimension: "correctness", criterion: "The plan addresses what the problem actually asks for", strongSignal: "Refers to specific requirements from the problem rather than generic steps" },
          { dimension: "code_quality", criterion: "The plan is organised and easy to follow", strongSignal: "Clear structure, no padding, decisions are easy to find" },
          { dimension: "understanding", criterion: "The candidate can explain why they chose this approach over alternatives", strongSignal: "Names a real alternative and a concrete reason it was rejected" },
        ],
        deliverables: ["A short written plan (plain text or Markdown)"],
        dependsOn: [],
        estimatedHours: 1,
      },
      {
        key: "p2",
        title: "Build the core solution",
        objective: "Implement the central behaviour the problem asks for.",
        instructions:
          `Implement the core of the solution${where}. ${input.practice ? "Choose a small, well-defined slice of the problem" : `Deliver what was asked for: ${input.deliverables.replace(/\s+/g, " ").trim().slice(0, 400)}`}. ` +
          "Prefer a smaller solution that works and that you can explain over a larger one that you cannot. Submit your code (pasted, or a public GitHub repository link).",
        skills,
        acceptanceCriteria: [
          "The core behaviour described in the problem works",
          "Inputs that are missing or invalid are handled rather than crashing",
          "The code is organised into functions or modules with clear names",
        ],
        rubric: [
          { dimension: "correctness", criterion: "The core behaviour works as the problem describes", strongSignal: "Handles the stated cases and at least one edge case correctly" },
          { dimension: "code_quality", criterion: "The code is readable, named clearly and reasonably structured", strongSignal: "Small functions with one job; names that explain intent; no dead code" },
          { dimension: "understanding", criterion: "The candidate can explain how the code works and why it was written that way", strongSignal: "Walks through a specific function and justifies a design decision" },
        ],
        deliverables: input.practice ? ["Your code, pasted or as a GitHub link"] : ["Your code, pasted or as a GitHub link", input.deliverables.replace(/\s+/g, " ").trim().slice(0, 200)],
        dependsOn: ["p1"],
        estimatedHours: 2,
      },
      {
        key: "p3",
        title: "Test, harden and explain",
        objective: "Show that the solution holds up and that you can describe its limits.",
        instructions:
          "Add tests or a written test plan for the main behaviour and at least two edge cases. Review your own solution for weaknesses and write a short note on what you would improve with more time, " +
          "what the limitations are, and how someone else would run or use it.",
        skills: skills.slice(0, 3),
        acceptanceCriteria: [
          "Includes tests, or a concrete written test plan, covering the main behaviour",
          "Covers at least two edge cases",
          "Documents limitations and how to run or use the solution",
        ],
        rubric: [
          { dimension: "correctness", criterion: "The tests or test plan would catch real mistakes in the main behaviour", strongSignal: "Tests assert specific expected results, not just that code runs" },
          { dimension: "code_quality", criterion: "Tests and notes are clear and maintainable", strongSignal: "Descriptive test names; short, accurate run instructions" },
          { dimension: "understanding", criterion: "The candidate can name the weakest part of their solution and what they would do about it", strongSignal: "Identifies a genuine limitation and a realistic fix" },
        ],
        deliverables: ["Tests or a written test plan", "A short note on limitations and how to run the solution"],
        dependsOn: ["p2"],
        estimatedHours: 1,
      },
    ],
  }
  return finalizeSpec(raw, { requiredSkills: skills, budgetHours: input.hours, difficulty: input.difficulty })
}
