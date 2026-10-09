// The structured challenge — what a company reviews, what students work on, and what the Proof Engine assesses against —
// plus the validation every source of one must pass: the model, the offline template, and a company's own edits.

import { arr, num, obj, oneOf, str } from "../ai/schema.ts"
import type { Infer } from "../ai/schema.ts"
import { validatePhaseGraph } from "./phases.ts"
import { canonicalSkillList, canonicalSkillName } from "./skills.ts"

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const
export type Difficulty = (typeof DIFFICULTIES)[number]
/** Every challenge — generated, templated or edited — has this many phases. Enforced in finalizeSpec, not by the schema. */
export const MIN_PHASES = 3
export const MAX_PHASES = 5
export const DIMENSIONS = ["correctness", "code_quality", "understanding"] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  correctness: "Correctness",
  code_quality: "Code quality",
  understanding: "Demonstrated understanding",
}

const phaseField = obj({
  key: str({ min: 1, max: 12, description: "Short unique key such as p1, p2" }),
  title: str({ min: 3, max: 100 }),
  objective: str({ min: 10, max: 400, description: "One sentence: what the candidate will have shown by the end of this phase" }),
  instructions: str({ min: 30, max: 2500, description: "What the candidate should do, written to them, in plain language" }),
  skills: arr(str({ min: 1, max: 60 }), { min: 1, max: 6, description: "Skills this phase exercises" }),
  acceptanceCriteria: arr(str({ min: 8, max: 300 }), { min: 2, max: 8, description: "Concrete, checkable conditions the work must meet" }),
  rubric: arr(
    obj({
      dimension: oneOf(DIMENSIONS),
      criterion: str({ min: 8, max: 300, description: "What is being judged" }),
      strongSignal: str({ min: 8, max: 400, description: "What a strong answer or piece of work would show (hidden from the candidate)" }),
    }),
    { min: 3, max: 9, description: "At least one item for each of correctness, code_quality and understanding" },
  ),
  deliverables: arr(str({ min: 3, max: 200 }), { min: 1, max: 6 }),
  dependsOn: arr(str({ min: 1, max: 12 }), { max: 5, description: "Keys of earlier phases this phase builds on" }),
  estimatedHours: num({ min: 0.25, max: 100 }),
})

export const specField = obj({
  title: str({ min: 5, max: 120 }),
  summary: str({ min: 30, max: 900, description: "What the challenge is, in two or three sentences" }),
  scenario: str({ min: 0, max: 1500, description: "A short, self-contained scenario that frames the work" }),
  learningGoals: arr(str({ min: 5, max: 200 }), { min: 1, max: 6 }),
  skills: arr(str({ min: 1, max: 60 }), { min: 1, max: 10 }),
  difficulty: oneOf(DIFFICULTIES),
  estimatedHours: num({ min: 0.5, max: 400 }),
  // Deliberately looser than MIN_PHASES..MAX_PHASES: `arr` would silently drop extra phases, and a schema error would not tell
  // the model why. finalizeSpec rejects a wrong count with a reason instead.
  phases: arr(phaseField, { min: 1, max: 20, description: `Between ${MIN_PHASES} and ${MAX_PHASES} ordered phases` }),
})
export type RawSpec = Infer<typeof specField>

export interface AcceptanceCriterion {
  id: string
  text: string
}
export interface RubricItem {
  id: string
  dimension: Dimension
  criterion: string
  strongSignal: string
}
export interface PhaseSpec {
  key: string
  title: string
  objective: string
  instructions: string
  skills: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  rubric: RubricItem[]
  deliverables: string[]
  dependsOn: string[]
  estimatedHours: number
}
export interface ChallengeSpec {
  title: string
  summary: string
  scenario: string
  learningGoals: string[]
  skills: string[]
  difficulty: Difficulty
  estimatedHours: number
  phases: PhaseSpec[]
}

export class SpecProblem extends Error {
  problems: string[]
  constructor(problems: string[]) {
    super(problems.join(" "))
    this.problems = problems
  }
}

const round = (n: number, step = 0.25) => Math.round(n / step) * step

export interface SpecContext {
  /** The skills the challenge must cover (the company's required skills, or the student's chosen skills). */
  requiredSkills: string[]
  /** The time budget the workload is normalised to, in hours. */
  budgetHours: number
  difficulty: Difficulty
}

/**
 * Turns a parsed spec into the canonical one or throws SpecProblem listing everything wrong:
 *  - there are MIN_PHASES to MAX_PHASES phases;
 *  - phase keys become p1…pN by position, dependencies are rewritten, and may only point at EARLIER phases;
 *  - every phase has acceptance criteria and a rubric covering all three dimensions;
 *  - every required skill is exercised by some phase;
 *  - the workload is scaled so the phases add up to the stated time budget (the budget is the company's, not the model's).
 * Ids for criteria and rubric items are assigned here, never taken from the model.
 * `keepHours` is for a company's own edits: its numbers stand, and the total is their sum.
 */
export function finalizeSpec(raw: RawSpec, ctx: SpecContext, opts: { keepHours?: boolean } = {}): ChallengeSpec {
  const problems: string[] = []
  if (raw.phases.length < MIN_PHASES || raw.phases.length > MAX_PHASES) {
    problems.push(`A challenge needs ${MIN_PHASES} to ${MAX_PHASES} phases; this one has ${raw.phases.length}.`)
  }
  const keyMap = new Map<string, string>()
  raw.phases.forEach((p, i) => {
    if (keyMap.has(p.key)) problems.push(`Two phases share the key "${p.key}".`)
    keyMap.set(p.key, `p${i + 1}`)
  })

  const phases: PhaseSpec[] = raw.phases.map((p, i) => {
    const key = `p${i + 1}`
    const dependsOn: string[] = []
    for (const dep of p.dependsOn) {
      const mapped = keyMap.get(dep)
      if (!mapped) problems.push(`Phase ${i + 1} depends on "${dep}", which does not exist.`)
      else if (Number(mapped.slice(1)) >= i + 1) problems.push(`Phase ${i + 1} may only depend on earlier phases.`)
      else if (!dependsOn.includes(mapped)) dependsOn.push(mapped)
    }
    for (const dim of DIMENSIONS) {
      if (!p.rubric.some((r) => r.dimension === dim)) problems.push(`Phase ${i + 1} ("${p.title}") has no rubric item for ${DIMENSION_LABELS[dim].toLowerCase()}.`)
    }
    return {
      key,
      title: p.title,
      objective: p.objective,
      instructions: p.instructions,
      skills: canonicalSkillList(p.skills, 6),
      acceptanceCriteria: p.acceptanceCriteria.map((text, n) => ({ id: `${key}.ac${n + 1}`, text })),
      rubric: p.rubric.map((r, n) => ({ id: `${key}.rb${n + 1}`, dimension: r.dimension, criterion: r.criterion, strongSignal: r.strongSignal })),
      deliverables: p.deliverables,
      dependsOn,
      estimatedHours: p.estimatedHours,
    }
  })

  problems.push(...validatePhaseGraph(phases))

  const covered = new Set(phases.flatMap((p) => p.skills.map((s) => s.toLowerCase())))
  for (const skill of ctx.requiredSkills) {
    if (!covered.has(canonicalSkillName(skill).toLowerCase())) problems.push(`No phase exercises the required skill "${skill}".`)
  }
  if (problems.length > 0) throw new SpecProblem(problems)

  if (!opts.keepHours) {
    // Scale the workload to the stated budget, keeping the model's relative proportions.
    const total = phases.reduce((sum, p) => sum + p.estimatedHours, 0)
    const scale = total > 0 ? ctx.budgetHours / total : 1
    let scaled = phases.map((p) => Math.max(0.25, round(p.estimatedHours * scale)))
    // Rounding can drift a little; put the difference on the longest phase.
    const drift = round(ctx.budgetHours - scaled.reduce((a, b) => a + b, 0))
    if (drift !== 0) {
      const longest = scaled.indexOf(Math.max(...scaled))
      scaled = scaled.map((h, i) => (i === longest ? Math.max(0.25, h + drift) : h))
    }
    phases.forEach((p, i) => (p.estimatedHours = scaled[i]))
  }
  const totalHours = round(phases.reduce((sum, p) => sum + p.estimatedHours, 0))

  return {
    title: raw.title,
    summary: raw.summary,
    scenario: raw.scenario,
    learningGoals: raw.learningGoals,
    skills: canonicalSkillList([...ctx.requiredSkills, ...raw.skills], 12),
    difficulty: opts.keepHours ? raw.difficulty : ctx.difficulty,
    estimatedHours: opts.keepHours ? totalHours : ctx.budgetHours,
    phases,
  }
}

/** The part of a spec a student may see: no rubric "strong signals". */
export function publicPhase(p: PhaseSpec) {
  return {
    key: p.key,
    title: p.title,
    objective: p.objective,
    instructions: p.instructions,
    skills: p.skills,
    acceptanceCriteria: p.acceptanceCriteria,
    // Candidates see what is judged, not what a strong answer sounds like.
    rubric: p.rubric.map((r) => ({ id: r.id, dimension: r.dimension, criterion: r.criterion })),
    deliverables: p.deliverables,
    dependsOn: p.dependsOn,
    estimatedHours: p.estimatedHours,
  }
}
