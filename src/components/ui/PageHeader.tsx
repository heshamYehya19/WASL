import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1.5 text-xs font-semibold tracking-wide text-teal-600 uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
