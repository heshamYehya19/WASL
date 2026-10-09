import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Button, DemoBadge, Field, inputClass, Notice } from "../../components/ui/kit"
import { DifficultyBars, RatingPips } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge, PhaseStateBadge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import type { RunPhaseView, RunView, ShareScope } from "../../types"

const SCOPES: { value: ShareScope; label: string; help: string; practice: boolean }[] = [
  { value: "private", label: "Only me", help: "Nobody else can see this work.", practice: true },
  { value: "challenge_owner", label: "The company that posted this challenge", help: "They can see your submissions, the review, your interview and the assessment, to evaluate you.", practice: false },
  { value: "employers", label: "Employers who find me in Talent Discovery", help: "Only if your profile is discoverable. They see which skills you demonstrated and your ratings — never your code or interview.", practice: true },
]

function Sharing({ run, onChanged }: { run: RunView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = SCOPES.filter((s) => run.kind === "company" || s.practice)
  return (
    <Card>
      <CardHeader title="Who can see this work" subtitle="You can change this at any time." />
      <fieldset className="space-y-2 px-5 py-4" disabled={busy}>
        <legend className="sr-only">Sharing</legend>
        {options.map((s) => (
          <label key={s.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors ${run.shareScope === s.value ? "border-teal-400 bg-teal-100/40" : "border-ink-200 hover:border-teal-400"}`}>
            <input
              type="radio"
              name="share"
              className="mt-0.5 h-4 w-4 accent-teal-600"
              checked={run.shareScope === s.value}
              onChange={async () => {
                setBusy(true)
                setError(null)
                try {
                  await api.post(`/work/${run.id}/share`, { scope: s.value })
                  onChanged()
                } catch (err) {
                  setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
                } finally {
                  setBusy(false)
                }
              }}
            />
            <span>
              <span className="block font-semibold text-ink-900">{s.label}{s.value === "challenge_owner" && run.company ? ` (${run.company.name})` : ""}</span>
              <span className="block text-ink-600">{s.help}</span>
            </span>
          </label>
        ))}
        {error && <Notice tone="danger">{error}</Notice>}
      </fieldset>
    </Card>
  )
}

function PhaseRow({ runId, phase, index, runDone }: { runId: string; phase: RunPhaseView; index: number; runDone: boolean }) {
  const locked = !phase.available && phase.state === "not_started"
  const ratings = phase.latestSubmission?.assessment?.ratings
  return (
    <li>
      <Card className={locked ? "opacity-80" : ""}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-night text-xs font-bold text-teal-300">{index + 1}</span>
              <h3 className="font-semibold text-ink-900">{phase.title}</h3>
              <PhaseStateBadge state={phase.state} locked={locked} />
            </div>
            <p className="mt-1.5 text-sm text-ink-600">{phase.objective}</p>
            {locked && (
              <p className="mt-2 text-xs text-ink-500">
                Opens once you've finished {phase.blockedBy.map((b) => `“${b.title}”`).join(" and ")}. A phase counts as finished when it has been assessed — passed or not yet passed.
              </p>
            )}
            {!locked && phase.state === "failed" && <p className="mt-2 text-xs text-ink-600">Not passed yet — the feedback is on the phase page, and you can submit again whenever you're ready. Later phases are open meanwhile.</p>}
            {ratings && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-600">
                <span className="flex items-center gap-2">Correctness <RatingPips rating={ratings.correctness} /></span>
                <span className="flex items-center gap-2">Code quality <RatingPips rating={ratings.codeQuality} /></span>
                <span className="flex items-center gap-2">Understanding <RatingPips rating={ratings.understanding} /></span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-ink-500">
            <span>≈ {phase.estimatedHours} h</span>
            {phase.attempts > 0 && <span>{phase.attempts} attempt{phase.attempts === 1 ? "" : "s"}</span>}
            {!locked && (
              <Link to={`/student/work/${runId}/${phase.key}`} className="mt-1 rounded-full bg-night px-4 py-1.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-teal-600">
                {phase.state === "passed" || runDone ? "Open" : phase.state === "not_started" ? "Start" : "Continue"}
              </Link>
            )}
          </div>
        </div>
      </Card>
    </li>
  )
}

export default function WorkOverview() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const state = useApi<{ run: RunView }>(`/work/${runId}`)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Async state={state}>
      {({ run }) => {
        const remaining = run.phases.filter((p) => p.state !== "passed")
        const complete = async () => {
          setBusy(true)
          setError(null)
          try {
            await api.post(`/work/${run.id}/complete`, { note })
            await state.reload()
          } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
          } finally {
            setBusy(false)
          }
        }
        return (
          <div className="mx-auto max-w-4xl">
            <Link to="/student/work" className="text-sm font-medium text-ink-500 hover:text-teal-700">← My work</Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={run.kind === "practice" ? "sky" : "teal"}>{run.kind === "practice" ? "Practice" : run.company?.name}</Badge>
              <Badge tone={run.status === "completed" ? "green" : "neutral"}>{run.status === "completed" ? "Completed" : "In progress"}</Badge>
              {run.isDemoFixture && <DemoBadge />}
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink-950">{run.challenge.title}</h1>
            <p className="mt-2 max-w-3xl leading-relaxed text-ink-700">{run.challenge.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-600">
              <DifficultyBars level={run.challenge.difficulty} />
              <span>≈ {run.challenge.estimatedHours} hours</span>
              <span>{run.progress.passed} of {run.progress.total} phases passed</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{run.challenge.skills.map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
            <p className="mt-2 text-xs text-ink-500">{run.challenge.origin}.</p>
            {run.challenge.scenario && <p className="mt-4 max-w-3xl rounded-xl bg-ink-100 px-4 py-3 text-sm leading-relaxed text-ink-700">{run.challenge.scenario}</p>}

            <h2 className="mt-8 mb-3 text-lg font-bold text-ink-950">Phases</h2>
            <ol className="space-y-3">
              {run.phases.map((p, i) => <PhaseRow key={p.key} runId={run.id} phase={p} index={i} runDone={run.status === "completed"} />)}
            </ol>

            <Card className="mt-8">
              <CardHeader title="Submit the complete solution" subtitle="Every phase has to pass first. This is checked by the server." />
              <div className="px-5 py-4">
                {run.status === "completed" ? (
                  <Notice tone="success">Submitted as complete. {run.completionNote && <>Your note: “{run.completionNote}”</>}</Notice>
                ) : run.canComplete ? (
                  <div className="space-y-3">
                    <Field label="A short note for whoever reads this" htmlFor="completion-note" optional>
                      <textarea id="completion-note" className={`${inputClass} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                    </Field>
                    {error && <Notice tone="danger">{error}</Notice>}
                    <Button onClick={() => void complete()} loading={busy}>Submit complete solution</Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-600">
                    Still to pass: {remaining.map((p) => `“${p.title}”`).join(", ")}. A phase that is not passed yet doesn't stop you moving on, but it has to pass before the whole solution can be submitted.
                  </p>
                )}
              </div>
            </Card>

            <div className="mt-6"><Sharing run={run} onChanged={() => void state.reload()} /></div>

            {run.kind === "practice" && run.practiceId && (
              <div className="mt-6">
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!confirm("Delete this practice challenge and everything attached to it — submissions, interviews and assessments? This can't be undone.")) return
                    await api.del(`/practice/${run.practiceId}`)
                    navigate("/student/practice")
                  }}
                >
                  Delete this practice challenge
                </Button>
              </div>
            )}
          </div>
        )
      }}
    </Async>
  )
}
