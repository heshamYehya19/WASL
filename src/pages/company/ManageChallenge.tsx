import { useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { SpecEditor } from "../../components/company/SpecEditor"
import { Card, CardHeader } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, Button, DemoBadge, Notice, Tabs } from "../../components/ui/kit"
import { DifficultyBars, RatingPips } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge, ChallengeStatusBadge, PhaseStateBadge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import { formatDate, formatRelative } from "../../lib/format"
import { CHALLENGE_STATUS_LABELS } from "../../types"
import type { ChallengeDetail, ChallengeSpec, ChallengeStatus, Participant } from "../../types"

type Tab = "overview" | "challenge" | "candidates" | "history"

const STEPS: ChallengeStatus[] = ["draft", "generated", "reviewed", "published", "in_progress", "completed"]

function Stepper({ status }: { status: ChallengeStatus }) {
  const archived = status === "archived"
  const current = archived ? -1 : STEPS.indexOf(status)
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-3" aria-label="Where this challenge is">
      {STEPS.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-teal-500 text-ink-950" : active ? "bg-night text-teal-300 ring-2 ring-teal-400/60" : "border border-ink-200 bg-surface text-ink-400"}`}>{done ? "✓" : i + 1}</span>
            <span className={`text-sm ${active ? "font-semibold text-ink-900" : done ? "text-ink-600" : "text-ink-400"}`}>{CHALLENGE_STATUS_LABELS[s]}</span>
          </li>
        )
      })}
      {archived && <li><Badge tone="neutral">Archived</Badge></li>}
    </ol>
  )
}

function Candidates({ challengeId }: { challengeId: string }) {
  const state = useApi<{ participants: Participant[]; privateCount: number }>(`/company/challenges/${challengeId}/participants`)
  return (
    <Async state={state}>
      {({ participants, privateCount }) => (
        <div className="space-y-4">
          <Notice tone="info">You see only work that candidates chose to share with you. {privateCount > 0 ? `${privateCount} other candidate${privateCount === 1 ? " has" : "s have"} started and kept their work private; they're counted but not named.` : ""}</Notice>
          {participants.length === 0 ? (
            <EmptyState title="No shared work yet" description="When candidates start this challenge and share their work with you, they appear here with their progress and ratings." />
          ) : (
            <ul className="space-y-3">
              {participants.map((p) => (
                <li key={p.runId}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/company/challenges/${challengeId}/candidates/${p.runId}`} className="font-semibold text-teal-700 hover:underline">{p.candidate.name}</Link>
                          {p.isDemoFixture && <DemoBadge />}
                          <Badge tone={p.status === "completed" ? "green" : "neutral"}>{p.status === "completed" ? "Completed" : "In progress"}</Badge>
                        </div>
                        <div className="text-xs text-ink-500">{p.candidate.headline || "—"} · started {formatRelative(p.startedAt)}</div>
                      </div>
                      <div className="text-sm font-semibold text-ink-700 tabular-nums">{p.progress.passed}/{p.progress.total} phases passed</div>
                    </div>
                    <ul className="divide-y divide-ink-100 border-t border-ink-100">
                      {p.phases.map((ph) => (
                        <li key={ph.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
                          <span className="min-w-0 truncate text-ink-800">{ph.title}</span>
                          <span className="flex items-center gap-3">
                            {ph.ratings && <span className="hidden items-center gap-3 text-xs text-ink-500 md:flex">C <RatingPips rating={ph.ratings.correctness} /> Q <RatingPips rating={ph.ratings.codeQuality} /> U <RatingPips rating={ph.ratings.understanding} /></span>}
                            <PhaseStateBadge state={ph.state} locked={ph.state === "not_started" && false} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Async>
  )
}

export default function ManageChallenge() {
  const { id } = useParams()
  const location = useLocation()
  const state = useApi<{ challenge: ChallengeDetail }>(`/company/challenges/${id}`)
  const [tab, setTab] = useState<Tab>("overview")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; canUseTemplate?: boolean } | null>(() => {
    const e = (location.state as { generationError?: string } | null)?.generationError
    return e ? { message: e, canUseTemplate: true } : null
  })
  const [ack, setAck] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await state.reload()
    } catch (err) {
      setError({ message: err instanceof ApiRequestError ? err.message : "Something went wrong.", canUseTemplate: err instanceof ApiRequestError && err.status === 503 && name.startsWith("generate") })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Async state={state}>
      {({ challenge: c }) => {
        const editable = c.status === "draft" || c.status === "generated" || c.status === "reviewed"
        const generate = (useTemplate = false) => act(useTemplate ? "generate-template" : "generate", () => api.post(`/company/challenges/${c.id}/generate`, { useTemplate }))
        return (
          <div className="mx-auto max-w-5xl">
            <Link to="/company/challenges" className="text-sm font-medium text-ink-500 hover:text-teal-700">← Challenges</Link>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">{c.title}</h1>
              <ChallengeStatusBadge status={c.status} />
              {c.isDemoFixture && <DemoBadge />}
            </div>
            <div className="mt-4"><Stepper status={c.status} /></div>

            {error && (
              <Notice tone="danger" className="mt-5" title={error.canUseTemplate ? "The AI couldn't generate the challenge" : undefined}>
                {error.message}
                {error.canUseTemplate && (
                  <div className="mt-3 text-sm">
                    Try again, or start from a plain template instead — it is not AI-generated, is labelled that way everywhere, and you edit it before publishing.
                    <div className="mt-2 flex gap-2"><Button variant="secondary" loading={busy === "generate"} onClick={() => void generate(false)}>Try the AI again</Button><Button variant="secondary" loading={busy === "generate-template"} onClick={() => void generate(true)}>Use the template</Button></div>
                  </div>
                )}
              </Notice>
            )}

            <div className="mt-6">
              <Tabs
                label="Challenge sections"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: "overview", label: "Overview" },
                  { value: "challenge", label: c.current ? "Challenge" : "Challenge (not generated)" },
                  { value: "candidates", label: "Candidates", count: c.candidatesStarted },
                  { value: "history", label: "History" },
                ]}
              />
            </div>

            <div className="mt-6" role="tabpanel">
              {tab === "overview" && (
                <div className="space-y-5">
                  {c.current && c.current.meta.origin === "ai" && c.status !== "published" && c.status !== "in_progress" && (
                    <Notice tone="warn" title="Generated by AI — please review it">AI can misjudge scope or difficulty. Read each phase, edit what's off, then mark it reviewed.</Notice>
                  )}
                  {c.current?.meta.origin === "offline_template" && (
                    <Notice tone="warn" title="This is a template, not AI output">{c.current.meta.originLabel}. It's a starting point: edit every phase to fit your problem before publishing.</Notice>
                  )}

                  <Card>
                    <CardHeader title="Your brief" />
                    <div className="space-y-3 px-5 py-4 text-sm">
                      <p className="whitespace-pre-wrap leading-relaxed text-ink-800">{c.brief.problemDescription}</p>
                      <p className="text-ink-700"><strong>Expected deliverables:</strong> {c.brief.expectedDeliverables}</p>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><DifficultyBars level={c.brief.difficulty} /><span>≈ {c.brief.timeHours} hours</span></div>
                      <div className="flex flex-wrap gap-1.5">{c.brief.requiredSkills.map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader title="Next step" />
                    <div className="space-y-3 px-5 py-4 text-sm text-ink-700">
                      {c.status === "draft" && (
                        <>
                          <p>The brief is saved. Generate the phased challenge to review it.</p>
                          <Button loading={busy === "generate"} onClick={() => void generate(false)}>Generate the challenge</Button>
                        </>
                      )}
                      {c.status === "generated" && (
                        <>
                          <p>Read and, if needed, edit the challenge. When you're happy with it, mark it reviewed.</p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" onClick={() => setTab("challenge")}>Review and edit</Button>
                            <Button loading={busy === "review"} onClick={() => void act("review", () => api.post(`/company/challenges/${c.id}/review`))}>Mark as reviewed</Button>
                            <Button variant="ghost" loading={busy === "generate"} onClick={() => void generate(false)}>Regenerate</Button>
                          </div>
                        </>
                      )}
                      {c.status === "reviewed" && (
                        <>
                          <p>Reviewed. Publishing makes it visible to every student and graduate on WASL, and freezes this version: candidates always work on the version they started.</p>
                          {!publishing ? (
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={() => setPublishing(true)}>Publish…</Button>
                              <Button variant="secondary" onClick={() => setTab("challenge")}>Edit again</Button>
                            </div>
                          ) : (
                            <div className="space-y-3 rounded-xl border border-ink-200 p-4">
                              <p className="leading-relaxed">{c.evaluationNotice}</p>
                              <label className="flex cursor-pointer items-start gap-3">
                                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                                <span>I confirm that submissions to this challenge will be used only to evaluate candidates' abilities, and that this does not transfer ownership of anything they write.</span>
                              </label>
                              <div className="flex gap-2">
                                <Button disabled={!ack} loading={busy === "publish"} onClick={() => void act("publish", () => api.post(`/company/challenges/${c.id}/publish`, { acknowledgeEvaluationUse: true }))}>Publish this challenge</Button>
                                <Button variant="ghost" onClick={() => setPublishing(false)}>Cancel</Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {(c.status === "published" || c.status === "in_progress") && (
                        <>
                          <p>Open to candidates{c.publishedAt ? ` since ${formatDate(c.publishedAt)}` : ""}. {c.candidatesStarted} {c.candidatesStarted === 1 ? "has" : "have"} started. The published version can't be edited.</p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" onClick={() => setTab("candidates")}>See candidates</Button>
                            <Button variant="secondary" loading={busy === "complete"} onClick={() => void act("complete", () => api.post(`/company/challenges/${c.id}/complete`))}>Mark as completed</Button>
                            <Button variant="danger" loading={busy === "archive"} onClick={() => confirm("Archive this challenge? It disappears from candidates' lists; people who started can keep going.") && void act("archive", () => api.post(`/company/challenges/${c.id}/archive`))}>Archive</Button>
                          </div>
                        </>
                      )}
                      {c.status === "completed" && (
                        <>
                          <p>Marked completed. No new candidates can start.</p>
                          <Button variant="danger" loading={busy === "archive"} onClick={() => void act("archive", () => api.post(`/company/challenges/${c.id}/archive`))}>Archive</Button>
                        </>
                      )}
                      {c.status === "archived" && <p>Archived. It no longer appears for candidates.</p>}
                    </div>
                  </Card>
                </div>
              )}

              {tab === "challenge" && (
                !c.current ? (
                  <EmptyState title="Nothing generated yet" description="Generate the challenge from your brief first." action={c.status === "draft" ? <Button loading={busy === "generate"} onClick={() => void generate(false)}>Generate</Button> : undefined} />
                ) : editable ? (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-600">{c.current.meta.originLabel} · version {c.current.meta.version} · {formatDate(c.current.meta.createdAt)}</p>
                    <SpecEditor
                      key={c.current.meta.id}
                      spec={c.current.spec}
                      saving={busy === "save"}
                      onSave={async (spec: ChallengeSpec) => {
                        setBusy("save")
                        try {
                          await api.put(`/company/challenges/${c.id}/version`, spec)
                          await state.reload()
                        } finally {
                          setBusy(null)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Notice tone="info">This version is published and can't be changed. {c.current.meta.originLabel}.</Notice>
                    {c.current.spec.phases.map((p, i) => (
                      <Card key={p.key}>
                        <div className="px-5 py-4">
                          <h3 className="font-semibold text-ink-900">{i + 1}. {p.title} <span className="text-xs font-normal text-ink-500">· ≈ {p.estimatedHours} h</span></h3>
                          <p className="mt-1 text-sm text-ink-600">{p.objective}</p>
                          <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">{p.acceptanceCriteria.map((a) => <li key={a.id}>{a.text}</li>)}</ul>
                        </div>
                      </Card>
                    ))}
                  </div>
                )
              )}

              {tab === "candidates" && <Candidates challengeId={c.id} />}

              {tab === "history" && (
                <Card>
                  <CardHeader title="Lifecycle" />
                  <ul className="divide-y divide-ink-100">
                    {c.history.map((h, i) => (
                      <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                        <span><strong>{CHALLENGE_STATUS_LABELS[h.status]}</strong>{h.note ? ` — ${h.note}` : ""}</span>
                        <span className="text-xs text-ink-500">{formatDate(h.at)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-ink-100 px-5 py-4">
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Versions</h4>
                    <ul className="space-y-1 text-sm text-ink-700">
                      {c.versions.map((v) => <li key={v.id}>Version {v.version} — {v.originLabel} · {formatDate(v.createdAt)}{v.id === c.publishedVersionId ? " · published" : ""}</li>)}
                      {c.versions.length === 0 && <li className="text-ink-500">None yet.</li>}
                    </ul>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )
      }}
    </Async>
  )
}
