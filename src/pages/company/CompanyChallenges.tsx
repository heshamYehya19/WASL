import { useState } from "react"
import { Link } from "react-router-dom"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, DemoBadge, LinkButton } from "../../components/ui/kit"
import { DifficultyBars, PageHero, Pills } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { ChallengeStatusBadge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import type { ChallengeStatus, ChallengeSummary } from "../../types"

type Filter = "all" | "draft" | "open" | "closed"
const GROUPS: Record<Filter, ChallengeStatus[] | null> = {
  all: null,
  draft: ["draft", "generated", "reviewed"],
  open: ["published", "in_progress"],
  closed: ["completed", "archived"],
}

export default function CompanyChallenges() {
  const state = useApi<{ challenges: ChallengeSummary[] }>("/company/challenges")
  const [filter, setFilter] = useState<Filter>("all")
  const all = state.data?.challenges ?? []
  const shown = all.filter((c) => !GROUPS[filter] || GROUPS[filter]!.includes(c.status))
  const count = (f: Filter) => all.filter((c) => !GROUPS[f] || GROUPS[f]!.includes(c.status)).length

  return (
    <div>
      <PageHero eyebrow="Company challenges" title="Your challenges" subtitle="Draft → Generated → Reviewed → Published → In progress → Completed. Nothing reaches candidates until you've reviewed and published it." action={<LinkButton to="/company/challenges/new" variant="secondary" className="!border-white/20 !bg-white/10 !text-white">New challenge</LinkButton>} />
      <Async state={state}>
        {() =>
          all.length === 0 ? (
            <EmptyState title="No challenges yet" description="Describe a real problem in five fields. WASL drafts the phases, criteria and rubrics; you review before publishing." action={<LinkButton to="/company/challenges/new">Create a challenge</LinkButton>} />
          ) : (
            <>
              <div className="mb-5">
                <Pills
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All", count: count("all") },
                    { value: "draft", label: "Drafts", count: count("draft") },
                    { value: "open", label: "Open to candidates", count: count("open") },
                    { value: "closed", label: "Completed / archived", count: count("closed") },
                  ]}
                />
              </div>
              <ul className="grid gap-4 md:grid-cols-2">
                {shown.map((c) => (
                  <li key={c.id}>
                    <Link to={`/company/challenges/${c.id}`} className="flex h-full flex-col rounded-2xl border border-ink-200 bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChallengeStatusBadge status={c.status} />
                        {c.isDemoFixture && <DemoBadge />}
                      </div>
                      <h2 className="mt-2 font-bold text-ink-950">{c.title}</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">{c.skills.slice(0, 4).map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-ink-500">
                        <DifficultyBars level={c.difficulty} />
                        <span>{c.phaseCount ? `${c.phaseCount} phases` : "not generated"}</span>
                        <span>{c.candidatesStarted} started</span>
                        <span>updated {formatRelative(c.updatedAt)}</span>
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
