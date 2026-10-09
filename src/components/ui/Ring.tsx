import { useCountUp } from "../../hooks/useCountUp"

/** A progress ring that sweeps to `value / max` with the percentage counting up in the middle. */
export function Ring({
  value,
  max,
  label,
  sub,
  strokeClassName = "stroke-teal-500",
  size = "h-28 w-28",
}: {
  value: number
  max: number
  label: string
  sub?: string
  strokeClassName?: string
  size?: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const shown = useCountUp(pct)
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <div className="group flex flex-col items-center text-center">
      <div className={`relative ${size} transition-transform duration-300 group-hover:scale-105`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-ink-100" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            className={strokeClassName}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-ink-950 tabular-nums">{Math.round(shown)}%</div>
      </div>
      <div className="mt-2 text-sm font-semibold text-ink-800">{label}</div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  )
}
