import type { ReactNode } from "react"

/** Three connected nodes — a quiet nod to وصل (connection) — waiting for something to link up. */
function Illustration() {
  return (
    <svg viewBox="0 0 64 40" className="animate-float mb-4 h-12 w-20" fill="none">
      <path d="M12 28 32 12 52 26" className="flow-line stroke-teal-400" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="28" r="5" className="fill-teal-100 stroke-teal-500" strokeWidth="1.5" />
      <circle cx="32" cy="12" r="6" className="fill-teal-500" />
      <circle cx="52" cy="26" r="5" className="fill-surface stroke-ink-300" strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-surface px-6 py-14 text-center">
      <Illustration />
      <h3 className="font-semibold text-ink-800">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
