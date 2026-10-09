import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Button, DemoBadge, Notice } from "../../components/ui/kit"
import { DifficultyBars } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import { DIMENSION_LABELS } from "../../types"
import type { OpenChallenge } from "../../types"

export default function ChallengeView() {
  const { id } = useParams()
  const state = useApi<{ challenge: OpenChallenge }>(`/challenges/${id}`)
  const navigate = useNavigate()
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Async state={state}>
      {({ challenge: c }) => {
        const start = async () => {
          setBusy(true)
          setError(null)
          try {
            const res = await api.post<{ id: string }>(`/challenges/${c.id}/start`, { acknowledgeSharing: true })
            navigate(`/student/work/${res.id}`)
          } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
            setBusy(false)
          }
        }
        return (
          <div className="mx-auto max-w-4xl">
            <Link to="/student/challenges" className="text-sm font-medium text-ink-500 hover:text-teal-700">← All challenges</Link>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-night text-xs font-bold text-teal-300">{c.company.logoInitials}</span>
              <span className="font-semibold text-ink-800">{c.company.name}</span>
              <span>{c.company.industry}</span>
              {c.isDemoFixture && <DemoBadge />}
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink-950">{c.title}</h1>
            <p className="mt-3 max-w-3xl leading-relaxed text-ink-700">{c.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-600">
              <DifficultyBars level={c.difficulty} />
              <span>{c.phases.length} phases</span>
              <span>≈ {c.estimatedHours} hours</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{c.skills.map((s) => <SkillChip key={s} skill={s} />)}</div>
            <p className="mt-3 text-xs text-ink-500">{c.origin}. The company reviewed this challenge before publishing it.</p>

            {c.scenario && (
              <Card className="mt-6">
                <CardHeader title="Scenario" />
                <p className="px-5 py-4 text-sm leading-relaxed text-ink-700">{c.scenario}</p>
              </Card>
            )}

            <Card className="mt-6">
              <CardHeader title="What the company expects" subtitle="In their words." />
              <p className="px-5 py-4 text-sm leading-relaxed text-ink-700">{c.expectedDeliverables}</p>
              {c.learningGoals.length > 0 && (
                <ul className="list-disc space-y-1 px-9 pb-4 text-sm text-ink-700">{c.learningGoals.map((g) => <li key={g}>{g}</li>)}</ul>
              )}
            </Card>

            <h2 className="mt-8 mb-3 text-lg font-bold text-ink-950">The phases</h2>
            <ol className="space-y-3">
              {c.phases.map((p, i) => (
                <li key={p.key}>
                  <Card>
                    <div className="px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold text-ink-900">{i + 1}. {p.title}</h3>
                        <span className="text-xs text-ink-500">≈ {p.estimatedHours} h{p.dependsOn.length > 0 ? ` · after ${p.dependsOn.map((k) => c.phases.findIndex((x) => x.key === k) + 1).join(", ")}` : ""}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink-600">{p.objective}</p>
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-semibold text-teal-700">Criteria and how it's judged</summary>
                        <div className="mt-2 grid gap-4 sm:grid-cols-2">
                          <div>
                            <h4 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Acceptance criteria</h4>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-700">{p.acceptanceCriteria.map((a) => <li key={a.id}>{a.text}</li>)}</ul>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Rubric</h4>
                            <ul className="mt-1 space-y-1 text-ink-700">{p.rubric.map((r) => <li key={r.id}><span className="font-medium">{DIMENSION_LABELS[r.dimension]}:</span> {r.criterion}</li>)}</ul>
                          </div>
                        </div>
                      </details>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>

            <Card className="mt-8">
              <CardHeader title="Before you start" subtitle="Who sees your work, and what it's used for." />
              <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-ink-700">
                <p>{c.sharingNotice}</p>
                <p>{c.evaluationNotice}</p>
                <p>Your code is read by software and an AI, not run. After each submission you'll be interviewed about your own work; no phase is decided before that. You can change who sees your work at any time.</p>
              </div>
              <div className="border-t border-ink-100 px-5 py-4">
                {c.runId ? (
                  <Link to={`/student/work/${c.runId}`} className="inline-flex rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-600">Continue this challenge</Link>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-800">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                      <span>I understand that {c.company.name} will see my submissions, the review, my interview answers and the assessment for this challenge, and that nothing I write becomes theirs.</span>
                    </label>
                    {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
                    <Button className="mt-4" disabled={!ack} loading={busy} onClick={() => void start()}>Start this challenge</Button>
                  </>
                )}
              </div>
            </Card>
          </div>
        )
      }}
    </Async>
  )
}
