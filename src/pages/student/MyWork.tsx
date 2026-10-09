import { useState } from "react"
import { Link } from "react-router-dom"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, DemoBadge, LinkButton } from "../../components/ui/kit"
import { PageHero, Pills } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import type { WorkItem } from "../../types"

type Filter = "all" | "company" | "practice" | "in_progress" | "completed"

export default function MyWork() {
  const state = useApi<{ work: WorkItem[] }>("/work")
  const [filter, setFilter] = useState<Filter>("all")
  const all = state.data?.work ?? []
  const matches = (w: WorkItem, f: Filter) => f === "all" || (f === "company" || f === "practice" ? w.kind === f : w.status === f)
  const shown = all.filter((w) => matches(w, filter))
  const count = (f: Filter) => all.filter((w) => matches(w, f)).length

  return (
    <div>
      <PageHero
        eyebrow="My work"
        title="Everything you've started"
        subtitle="Company challenges and practice, with every phase and every attempt."
        action={<LinkButton to="/student/practice" variant="secondary" className="!border-white/20 !bg-white/10 !text-white">New practice challenge</LinkButton>}
      />
      <Async state={state}>
        {() =>
          all.length === 0 ? (
            <EmptyState
              title="You haven't started anything yet"
              description="Take a company's challenge or build a practice challenge. Your attempts and results will collect here."
              action={<div className="flex flex-wrap justify-center gap-2"><LinkButton to="/student/challenges">Browse challenges</LinkButton><LinkButton to="/student/practice" variant="secondary">Practice Lab</LinkButton></div>}
            />
          ) : (
            <>
              <div className="mb-5">
                <Pills
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All", count: count("all") },
                    { value: "company", label: "Company", count: count("company") },
                    { value: "practice", label: "Practice", count: count("practice") },
                    { value: "in_progress", label: "In progress", count: count("in_progress") },
                    { value: "completed", label: "Completed", count: count("completed") },
                  ]}
                />
              </div>
              <ul className="grid gap-4 md:grid-cols-2">
                {shown.map((w) => (
                  <li key={w.id}>
                    <Link to={`/student/work/${w.id}`} className="block h-full rounded-2xl border border-ink-200 bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={w.kind === "practice" ? "sky" : "teal"}>{w.kind === "practice" ? "Practice" : w.companyName}</Badge>
                        <Badge tone={w.status === "completed" ? "green" : "neutral"}>{w.status === "completed" ? "Completed" : "In progress"}</Badge>
                        {w.isDemoFixture && <DemoBadge />}
                      </div>
                      <h2 className="mt-2 font-bold text-ink-950">{w.title}</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">{w.skills.slice(0, 4).map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-ink-500">
                          <span>{w.progress.passed} of {w.progress.total} phases passed</span>
                          <span>{formatRelative(w.startedAt)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={w.progress.total} aria-valuenow={w.progress.passed} aria-label="Phases passed">
                          <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${w.progress.total ? (w.progress.passed / w.progress.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </Async>
    </div>
  )
}
