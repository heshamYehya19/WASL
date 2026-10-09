import { useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router-dom"
import { Card } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { Button, ChipInput, DemoBadge, ErrorState, Field, inputClass, Loading, Notice } from "../../components/ui/kit"
import { PageHero } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import type { TalentSearch as TalentSearchData } from "../../types"

interface Filters {
  skills: string[]
  match: "all" | "any"
  demonstrated: boolean
  availability: string
  status: string
  location: string
}
const EMPTY: Filters = { skills: [], match: "all", demonstrated: false, availability: "", status: "", location: "" }

const toQuery = (f: Filters) => {
  const p = new URLSearchParams()
  if (f.skills.length) p.set("skills", f.skills.join(","))
  if (f.match === "any") p.set("match", "any")
  if (f.demonstrated) p.set("demonstrated", "1")
  if (f.availability) p.set("availability", f.availability)
  if (f.status) p.set("status", f.status)
  if (f.location.trim()) p.set("location", f.location.trim())
  const s = p.toString()
  return s ? `?${s}` : ""
}

export default function TalentSearch() {
  const [form, setForm] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)
  const state = useApi<TalentSearchData>(`/talent${toQuery(applied)}`)
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setForm((f) => ({ ...f, [k]: v }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setApplied(form)
  }

  return (
    <div>
      <PageHero eyebrow="Talent Discovery" title="Find people by what they've shown" subtitle="Only candidates who chose to be discoverable appear, and only the work they shared with employers counts. Every match says why." stats={[{ label: "candidates match", value: state.data?.results.length ?? 0, accent: true }]} />
      <form onSubmit={submit} className="mb-6">
        <Card>
          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Skills" htmlFor="t-skills" hint="Leave empty to browse everyone discoverable.">
                <ChipInput id="t-skills" value={form.skills} onChange={(v) => set("skills", v)} max={8} placeholder="e.g. Python, SQL" />
              </Field>
            </div>
            <Field label="Match" htmlFor="t-match">
              <select id="t-match" className={inputClass} value={form.match} onChange={(e) => set("match", e.target.value as "all" | "any")}>
                <option value="all">All of these skills</option>
                <option value="any">Any of these skills</option>
              </select>
            </Field>
            <Field label="Evidence" htmlFor="t-demo">
              <label className="flex items-center gap-2 rounded-xl border border-ink-200 px-3.5 py-2.5 text-sm">
                <input id="t-demo" type="checkbox" className="h-4 w-4 accent-teal-600" checked={form.demonstrated} onChange={(e) => set("demonstrated", e.target.checked)} />
                Demonstrated skills only (ignore declared)
              </label>
            </Field>
            <Field label="Availability" htmlFor="t-avail">
              <select id="t-avail" className={inputClass} value={form.availability} onChange={(e) => set("availability", e.target.value)}>
                <option value="">Any</option>
                <option value="open_to_work">Open to work</option>
                <option value="open_to_internships">Open to internships</option>
                <option value="not_available">Not available</option>
              </select>
            </Field>
            <Field label="Student or graduate" htmlFor="t-status">
              <select id="t-status" className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">Either</option>
                <option value="student">Student</option>
                <option value="graduate">Graduate</option>
              </select>
            </Field>
            <Field label="Location contains" htmlFor="t-loc" optional>
              <input id="t-loc" className={inputClass} value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={80} />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit">Search</Button>
              <Button variant="ghost" onClick={() => { setForm(EMPTY); setApplied(EMPTY) }}>Clear</Button>
            </div>
          </div>
        </Card>
      </form>

      {state.error && <ErrorState error={state.error} onRetry={() => void state.reload()} />}
      {!state.data && !state.error && <Loading />}
      {state.data && (
        <>
          <Notice tone="info" className="mb-5">{state.data.scoring}</Notice>
          {state.data.results.length === 0 ? (
            <EmptyState title="No candidates match" description="Try fewer skills, “any” instead of “all”, or include declared skills." />
          ) : (
            <ul className="space-y-4">
              {state.data.results.map((r) => (
                <li key={r.candidate.id}>
                  <Card>
                    <div className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/company/talent/${r.candidate.id}`} className="text-lg font-bold text-teal-700 hover:underline">{r.candidate.name}</Link>
                            {r.candidate.isDemoFixture && <DemoBadge />}
                            {r.candidate.saved && <Badge tone="teal">Saved</Badge>}
                            {r.candidate.interestSent && <Badge tone="green">Interest sent</Badge>}
                          </div>
                          <div className="text-sm text-ink-600">{r.candidate.headline || (r.candidate.status === "graduate" ? "Graduate" : "Student")}{r.candidate.location ? ` · ${r.candidate.location}` : ""}</div>
                          <div className="mt-0.5 text-xs text-ink-500">{r.candidate.availabilityLabel}</div>
                        </div>
                        <div className="text-right text-xs text-ink-500">
                          <div>{r.candidate.evidence.demonstratedCount} skill{r.candidate.evidence.demonstratedCount === 1 ? "" : "s"} demonstrated</div>
                          {state.data!.query.skills.length > 0 && <div>match score {r.score}</div>}
                        </div>
                      </div>
                      {r.matches.length > 0 && (
                        <div className="mt-3">
                          <h3 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Why this candidate</h3>
                          <ul className="mt-1.5 space-y-1.5 text-sm">
                            {r.matches.map((m) => (
                              <li key={m.skill} className="flex flex-wrap items-center gap-2">
                                <SkillChip skill={m.skill} state={m.status === "none" ? undefined : m.status} size="sm" />
                                <span className="text-ink-600">
                                  {m.status === "demonstrated" ? `Demonstrated in ${m.evidence.length} assessed phase${m.evidence.length === 1 ? "" : "s"}: ${m.evidence.slice(0, 2).map((e) => e.phaseTitle).join("; ")}` : m.status === "declared" ? "Self-declared only — not yet demonstrated" : "No evidence for this skill"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {r.matches.length === 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">{r.candidate.evidence.skills.slice(0, 6).map((s) => <SkillChip key={s.skill} skill={s.skill} state={s.status === "building" ? "declared" : s.status} size="sm" />)}</div>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
