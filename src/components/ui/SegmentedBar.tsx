import { useEffect, useState } from "react"

export interface BarSegment {
  key: string
  label: string
  value: number
  colorClassName: string
}

export function SegmentedBar({
  segments,
  emptyMessage = "No data yet.",
}: {
  segments: BarSegment[]
  emptyMessage?: string
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const visible = segments.filter((s) => s.value > 0)

  if (total === 0) {
    return <p className="rounded-2xl border border-dashed border-ink-200 bg-surface p-6 text-center text-sm text-ink-400">{emptyMessage}</p>
  }

  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {visible.map((seg, i) => {
          const pct = (seg.value / total) * 100
          const isFirst = i === 0
          const isLast = i === visible.length - 1
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${seg.value} (${Math.round(pct)}%)`}
              className={`h-full transition-[filter] duration-200 hover:brightness-110 ${seg.colorClassName} ${isFirst ? "rounded-l-full" : ""} ${isLast ? "rounded-r-full" : ""}`}
              style={{ width: mounted ? `${pct}%` : "0%", transition: "width 700ms ease-out" }}
            />
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 shrink-0 rounded-full ${seg.colorClassName}`} />
            <span className="text-ink-500">{seg.label}</span>
            <span className="font-semibold tabular-nums text-ink-900">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
