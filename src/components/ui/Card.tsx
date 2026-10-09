import type { ReactNode } from "react"
import { CountUp } from "../../hooks/useCountUp"

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-ink-200 bg-surface ${className}`}>{children}</div>
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
      <div>
        <h3 className="font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Numbers (and "72%"-style strings) count up on mount; anything else renders as-is. */
function AnimatedValue({ value }: { value: ReactNode }) {
  if (typeof value === "number") return <CountUp value={value} />
  if (typeof value === "string") {
    const m = /^(\d+)%$/.exec(value)
    if (m) return <CountUp value={Number(m[1])} suffix="%" />
  }
  return <>{value}</>
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-ink-200 bg-surface px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-500/5">
      <div className="pointer-events-none absolute -top-6 -right-6 h-16 w-16 rounded-full bg-teal-400/10 transition-transform duration-500 group-hover:scale-[2.2]" />
      <div className="relative text-2xl font-bold tracking-tight text-ink-900 tabular-nums transition-colors group-hover:text-teal-600">
        <AnimatedValue value={value} />
      </div>
      <div className="relative mt-1 text-sm text-ink-500">{label}</div>
      {hint && <div className="relative mt-1 text-xs text-teal-600">{hint}</div>}
    </div>
  )
}
