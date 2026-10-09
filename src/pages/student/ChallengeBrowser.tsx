import { useState } from "react"
import { Link } from "react-router-dom"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, DemoBadge, inputClass } from "../../components/ui/kit"
import { DifficultyBars, PageHero, Pills } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import type { Difficulty, OpenChallenge } from "../../types"

export default function ChallengeBrowser() {
  const state = useApi<{ challenges: OpenChallenge[] }>("/challenges")
  const [query, setQuery] = useState("")
  const [level, setLevel] = useState<"all" | Difficulty>("all")

  const q = query.trim().toLowerCase()
  const filtered = (state.data?.challenges ?? []).filter(
    (c) => (level === "all" || c.difficulty === level) && (!q || [c.title, c.summary, c.company.name, ...c.skills].some((t) => t.toLowerCase().includes(q))),
  )

  return (
    <div>
      <PageHero eyebrow="Company challenges" title="Real problems from real companies" subtitle="Each challenge is split into phases. Before you start you'll see who is asking, what's expected, how it's judged and who sees your work." stats={[{ label: "open challenges", value: state.data?.challenges.length ?? 0, accent: true }]} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="challenge-search" className="sr-only">Search challenges</label>
          <input id="challenge-search" className={inputClass} placeholder="Search by title, company or skill…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Pills
          label="Difficulty"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All" },
            { value: "beginner", label: "Beginner" },
            { value: "intermediate", label: "Intermediate" },
            { value: "advanced", label: "Advanced" },
          ]}
        />
      </div>
      <Async state={state}>
        {() =>
          filtered.length === 0 ? (
            <EmptyState title="No challenges match" description="Try a different search, or build your own in the Practice Lab." />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link to={`/student/challenges/${c.id}`} className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-500/5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-night text-xs font-bold text-teal-300">{c.company.logoInitials}</span>
                        <span className="min-w-0 truncate text-sm font-medium text-ink-600">{c.company.name}</span>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {c.isDemoFixture && <DemoBadge />}
                        {c.runId && <Badge tone="teal">Started</Badge>}
                      </div>
                    </div>
                    <h2 className="mt-3 text-lg font-bold text-ink-950 group-hover:text-teal-700">{c.title}</h2>
                    <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink-600">{c.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">{c.skills.slice(0, 5).map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-ink-500">
                      <DifficultyBars level={c.difficulty} />
                      <span>{c.phases.length} phases</span>
                      <span>≈ {c.estimatedHours} hours</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </div>
  )
}
