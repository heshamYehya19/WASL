import type { Artifact } from "../analysis/grounding.ts"
import type { StaticCheck } from "../analysis/static-checks.ts"
import type { PhaseSpec } from "../domain/spec.ts"
import { detectInjection, untrusted } from "./safety.ts"

/** Total characters of submission text any single prompt carries. Providers have per-minute token limits; this keeps a prompt well inside them. */
export const PROMPT_ARTIFACT_BUDGET = 24_000

/**
 * The submission as untrusted data blocks, one per file, within a character budget. Files are shortened evenly (never silently
 * dropped) and marked when cut. Returns the text and whether anything the author wrote tries to instruct the model.
 */
export function artifactBlocks(artifacts: Artifact[], budget = PROMPT_ARTIFACT_BUDGET): { text: string; injection: string[] } {
  const per = Math.max(800, Math.floor(budget / Math.max(1, artifacts.length)))
  const injection = new Set<string>()
  const blocks = artifacts.map((a) => {
    for (const r of detectInjection(a.content)) injection.add(r)
    const cut = a.content.length > per
    return untrusted("candidate_file", cut ? `${a.content.slice(0, per)}\n[… the rest of this file was not included]` : a.content, { path: a.path })
  })
  return { text: blocks.join("\n\n"), injection: [...injection] }
}

export function phaseBlock(phase: PhaseSpec, opts: { includeStrongSignals: boolean }): string {
  return [
    `Phase: ${phase.title}`,
    `Skills this phase exercises: ${phase.skills.join(", ")}`,
    `Objective: ${phase.objective}`,
    `Instructions given to the candidate: ${phase.instructions}`,
    `Expected deliverables: ${phase.deliverables.join("; ")}`,
    "Acceptance criteria:",
    ...phase.acceptanceCriteria.map((c) => `- [${c.id}] ${c.text}`),
    "Rubric:",
    ...phase.rubric.map((r) => `- [${r.id}] (${r.dimension}) ${r.criterion}${opts.includeStrongSignals ? ` — a strong answer: ${r.strongSignal}` : ""}`),
  ].join("\n")
}

export function checksBlock(checks: StaticCheck[]): string {
  return checks.length === 0 ? "(no deterministic checks)" : checks.map((c) => `- [${c.id}] ${c.status.toUpperCase()}: ${c.label} — ${c.detail}`).join("\n")
}
