import { useState } from "react"
import { Link } from "react-router-dom"
import { Card } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, LinkButton, Notice } from "../../components/ui/kit"
import { PageHero, Pills } from "../../components/ui/ListKit"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import type { GapListItem } from "../../types"

export default function Improve() {
  const state = useApi<{ gaps: GapListItem[] }>("/learning")
  const [show, setShow] = useState<"open" | "all">("open")
  const gaps = state.data?.gaps ?? []
  const shown = gaps.filter((g) => show === "all" || !g.resolved)
  const grouped = new Map<string, GapListItem[]>()
  for (const g of shown) grouped.set(g.skill, [...(grouped.get(g.skill) ?? []), g])
  const bySkill = [...grouped.entries()]

  return (
    <div>
      <PageHero eyebrow="Improve" title="From a gap to a plan" subtitle="Each item below comes from something specific in your assessed work. Open one for checked learning links, a short lesson and a practice exercise." />
      <Notice tone="info" className="mb-6">Lessons, exercises and their feedback are practice. They never change a phase result or your profile — only submitting and passing a phase does.</Notice>
      <Async state={state}>
        {() =>
          gaps.length === 0 ? (
            <EmptyState
              title="No skill gaps yet"
              description="When a phase is assessed, anything it showed you could strengthen appears here with a plan. Start a challenge to get going."
              action={<LinkButton to="/student/practice">Start a practice challenge</LinkButton>}
            />
          ) : (
            <>
              <div className="mb-5">
                <Pills label="Show" value={show} onChange={setShow} options={[{ value: "open", label: "To work on", count: gaps.filter((g) => !g.resolved).length }, { value: "all", label: "Including worked through", count: gaps.length }]} />
              </div>
              {bySkill.length === 0 && <p className="text-sm text-ink-500">Nothing open — everything has been worked through.</p>}
              <div className="space-y-6">
                {bySkill.map(([skill, items]) => (
                  <section key={skill} aria-label={skill}>
                    <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-700 uppercase">{skill}</h2>
                    <Card>
                      <ul className="divide-y divide-ink-100">
                        {items.map((g) => (
                          <li key={g.id}>
                            <Link to={`/student/learning/${g.id}`} className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-ink-50">
                              <span className="min-w-0">
                                <span className="block font-semibold text-ink-900">{g.title}</span>
                                <span className="mt-0.5 block text-sm text-ink-600">{g.detail}</span>
                                <span className="mt-1 block text-xs text-ink-500">From “{g.phaseTitle}” in {g.challengeTitle} · {formatRelative(g.createdAt)}</span>
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-1.5">
                                {g.resolved ? <Badge tone="green">Worked through</Badge> : <Badge tone={g.severity === "significant" ? "amber" : "neutral"}>{g.severity}</Badge>}
                                {(g.hasLesson || g.hasExercise) && <span className="text-[11px] text-ink-500">{[g.hasLesson && "lesson", g.hasExercise && "exercise"].filter(Boolean).join(" · ")}</span>}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </section>
                ))}
              </div>
            </>
          )
        }
      </Async>
    </div>
  )
}
