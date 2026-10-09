import type { ReactNode } from "react"
import { CountUp } from "../../hooks/useCountUp"

/* Shared building blocks for list pages, so they read as one family with the dashboards. */

/** Compact dark banner: eyebrow, title, subtitle, an optional action and a row of live stats. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  action,
  stats = [],
}: {
  eyebrow: string
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  stats?: { label: string; value: number; suffix?: string; accent?: boolean }[]
}) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl bg-night shadow-xl shadow-ink-950/10">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute -top-24 right-10 h-64 w-64 rounded-full bg-teal-500/20 blur-3xl" />
      <div className="relative p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="text-xs font-semibold tracking-wide text-teal-300 uppercase">{eyebrow}</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-2 text-sm leading-relaxed text-white/70">{subtitle}</p>}
          </div>
          {action}
        </div>
        {stats.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {stats.map((s) => (
              <div key={s.label} className={`rounded-2xl border px-4 py-2 ${s.accent ? "border-teal-400/40 bg-teal-500/10" : "border-white/10 bg-white/5"}`}>
                <span className={`text-lg font-bold tabular-nums ${s.accent ? "text-teal-300" : "text-white"}`}>
                  <CountUp value={s.value} suffix={s.suffix} />
                </span>
                <span className="ml-2 text-xs text-white/60">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A wrap-friendly row of filter pills, each optionally carrying a count. */
export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {label && <span className="mr-1 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</span>}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${
              active
                ? "border-night bg-night text-white shadow-md shadow-ink-950/10"
                : "border-ink-200 bg-surface text-ink-600 hover:-translate-y-0.5 hover:border-teal-400 hover:text-ink-900"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? "bg-teal-400 text-ink-950" : "bg-ink-100 text-ink-500"}`}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Three bars for beginner / intermediate / advanced. */
export function DifficultyBars({ level }: { level: "beginner" | "intermediate" | "advanced" }) {
  const n = level === "advanced" ? 3 : level === "intermediate" ? 2 : 1
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-500" title={`${label} difficulty`}>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i <= n ? "bg-teal-500" : "bg-ink-200"}`} style={{ height: `${4 + i * 3}px` }} />
        ))}
      </span>
      {label}
    </span>
  )
}

/** A 0–3 rating shown as three pips plus its words, so it is never read as a percentage score. */
export function RatingPips({ rating, label }: { rating: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-2 w-5 rounded-full ${i <= rating ? "bg-teal-500" : "bg-ink-200"}`} />
        ))}
      </span>
      <span className="text-xs font-semibold text-ink-700 tabular-nums">{rating} / 3</span>
    </span>
  )
}
