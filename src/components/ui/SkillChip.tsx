/**
 * A skill label. `state` says what is known about it — never a score:
 *  - demonstrated: a Proof Engine assessment of the candidate's own work passed for it
 *  - building: they are working on it (an attempt that has not passed yet)
 *  - declared: self-reported, unverified
 */
export function SkillChip({ skill, state, size = "md" }: { skill: string; state?: "demonstrated" | "building" | "declared"; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
  const title =
    state === "demonstrated" ? "Demonstrated: passed an assessment of their own work" : state === "building" ? "Building: working towards this" : state === "declared" ? "Declared: self-reported, not yet demonstrated" : undefined
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border bg-surface font-medium text-ink-800 ${state === "declared" ? "border-dashed border-ink-300" : state === "demonstrated" ? "border-verified-500/50" : "border-ink-200"} ${pad}`}
    >
      <span>{skill}</span>
      {state === "demonstrated" && <span className="font-bold text-verified-600" aria-label="Demonstrated">✓</span>}
      {state === "building" && <span className="text-[10px] font-normal text-amber-600">building</span>}
      {state === "declared" && <span className="text-[10px] font-normal text-ink-400">declared</span>}
    </span>
  )
}
