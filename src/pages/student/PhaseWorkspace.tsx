import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { SubmissionPanel } from "../../components/proof/SubmissionPanel"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Button, ErrorState, Field, inputClass, Loading, Notice } from "../../components/ui/kit"
import { PhaseStateBadge } from "../../components/ui/StatusBadge"
import { SkillChip } from "../../components/ui/SkillChip"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import { formatDate } from "../../lib/format"
import { DIMENSION_LABELS } from "../../types"
import type { RunPhaseView, RunView, SubmissionDetail } from "../../types"

const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Java", "C#", "C++", "Go", "Rust", "SQL", "Kotlin", "PHP", "Ruby"]
const SUBMITTABLE = ["not_started", "in_progress", "failed", "revision_needed", "assessment_unavailable"]

function Task({ phase }: { phase: RunPhaseView }) {
  const byDimension = (["correctness", "code_quality", "understanding"] as const).map((d) => ({ d, items: phase.rubric.filter((r) => r.dimension === d) }))
  return (
    <Card>
      <CardHeader title="The task" />
      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="leading-relaxed text-ink-800">{phase.objective}</p>
        <p className="whitespace-pre-wrap leading-relaxed text-ink-700">{phase.instructions}</p>
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">What to hand in</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-700">{phase.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">Acceptance criteria</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-700">{phase.acceptanceCriteria.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
        </div>
        <details>
          <summary className="cursor-pointer font-semibold text-teal-700">How it's judged</summary>
          <div className="mt-2 space-y-2 text-ink-700">
            {byDimension.map(({ d, items }) => (
              <div key={d}>
                <div className="font-medium">{DIMENSION_LABELS[d]}</div>
                <ul className="list-disc pl-5 text-ink-600">{items.map((r) => <li key={r.id}>{r.criterion}</li>)}</ul>
              </div>
            ))}
            <p className="text-xs text-ink-500">Each is rated 0–3 separately. After you submit, a review runs and you're interviewed about your work; only then is the phase decided.</p>
          </div>
        </details>
        <div className="flex flex-wrap gap-1.5">{phase.skills.map((s) => <SkillChip key={s} skill={s} size="sm" />)}</div>
      </div>
    </Card>
  )
}

function SubmitForm({ runId, phase, onDone, compact }: { runId: string; phase: RunPhaseView; onDone: (submissionId: string) => void; compact?: boolean }) {
  const [code, setCode] = useState("")
  const [language, setLanguage] = useState("")
  const [githubUrl, setGithubUrl] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setGeneral(null)
    try {
      const res = await api.post<{ submissionId: string }>(`/work/${runId}/phases/${phase.key}/submissions`, { code, language, githubUrl, note })
      onDone(res.submissionId)
    } catch (err) {
      if (err instanceof ApiRequestError && err.field) setErrors({ [err.field]: err.message })
      else setGeneral(err instanceof ApiRequestError ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={compact ? "Submit a new version" : "Your submission"} subtitle="Paste your code, link a public GitHub repository, or both. Your code is read, not run." />
      <form onSubmit={submit} className="space-y-4 px-5 py-4" noValidate>
        <Field label="Code or written answer" htmlFor="code" hint="Up to 24,000 characters. Credentials that look like secrets are removed before anything is stored." error={errors.code}>
          <textarea id="code" className={`${inputClass} min-h-56 font-mono text-[13px]`} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-invalid={!!errors.code} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Language" htmlFor="sub-language" optional error={errors.language}>
            <input id="sub-language" list="sub-languages" className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={40} autoComplete="off" aria-invalid={!!errors.language} />
            <datalist id="sub-languages">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
          <Field label="Public GitHub repository" htmlFor="github" optional hint="e.g. https://github.com/you/project" error={errors.githubUrl}>
            <input id="github" className={inputClass} value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} maxLength={300} inputMode="url" aria-invalid={!!errors.githubUrl} />
          </Field>
        </div>
        <Field label="A note for the reviewer" htmlFor="sub-note" optional error={errors.note}>
          <textarea id="sub-note" className={`${inputClass} min-h-16`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1500} aria-invalid={!!errors.note} />
        </Field>
        {general && <Notice tone="danger">{general}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy} disabled={!code.trim() && !githubUrl.trim()}>{busy ? "Reviewing your work…" : "Submit for review"}</Button>
          {busy && <span className="text-xs text-ink-500">Checking, then an AI review, then your first interview question. This can take up to a minute.</span>}
        </div>
      </form>
    </Card>
  )
}

export default function PhaseWorkspace() {
  const { runId, key } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const run = useApi<{ run: RunView }>(`/work/${runId}`)
  const attempts = useApi<{ attempts: { id: string; attempt: number; stage: string; createdAt: string; outcome: string | null }[] }>(`/work/${runId}/phases/${key}/attempts`)
  const phase = run.data?.run.phases.find((p) => p.key === key)
  const selected = params.get("attempt") ?? phase?.latestSubmission?.id ?? null
  const processing = (s?: SubmissionDetail) => s?.state === "submitted" || s?.state === "under_review"
  // Refresh by itself only while something is being processed.
  const submission = useApi<{ submission: SubmissionDetail }>(selected ? `/submissions/${selected}` : null, { poll: (d) => (processing(d?.submission) ? 3000 : undefined) })
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const refresh = async () => {
    await Promise.all([run.reload(), attempts.reload(), submission.reload()])
  }

  if (run.error) return <ErrorState error={run.error} onRetry={() => void run.reload()} />
  if (!run.data) return <Loading />
  if (!phase) return <ErrorState error="That phase wasn't found." />
  const r = run.data.run
  const sub = submission.data?.submission
  const canSubmit = r.status === "in_progress" && phase.available && SUBMITTABLE.includes(phase.state)
  const locked = !phase.available && phase.state === "not_started"
  const first = !phase.latestSubmission

  return (
    <div className="mx-auto max-w-6xl">
      <Link to={`/student/work/${r.id}`} className="text-sm font-medium text-ink-500 hover:text-teal-700">← {r.challenge.title}</Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">{phase.position}. {phase.title}</h1>
        <PhaseStateBadge state={phase.state} locked={locked} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Task phase={phase} />
          {(attempts.data?.attempts.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Your attempts" subtitle="Every attempt is kept." />
              <ul className="divide-y divide-ink-100">
                {attempts.data!.attempts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setParams(a.id === phase.latestSubmission?.id ? {} : { attempt: a.id })}
                      aria-current={a.id === selected}
                      className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-sm transition-colors hover:bg-ink-50 ${a.id === selected ? "bg-teal-100/40" : ""}`}
                    >
                      <span><span className="font-semibold text-ink-900">Attempt {a.attempt}</span> <span className="text-ink-500">· {formatDate(a.createdAt)}</span></span>
                      <span className="text-xs text-ink-600">{a.outcome === "passed" ? "Passed" : a.outcome === "failed" ? "Not passed yet" : a.stage === "rejected" ? "Revision needed" : "In progress"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-3">
          {locked && (
            <Notice tone="info" title="This phase isn't open yet">
              It opens once you've finished {phase.blockedBy.map((b) => `“${b.title}”`).join(" and ")} — a phase counts as finished when it's been assessed, whether passed or not yet.
            </Notice>
          )}
          {r.status === "completed" && <Notice tone="success">This work was submitted as complete, so new submissions are closed.</Notice>}
          {actionError && <Notice tone="danger">{actionError}</Notice>}

          {sub && (
            <Async state={submission}>
              {({ submission: d }) => (
                <SubmissionPanel
                  detail={d}
                  audience="candidate"
                  busy={busy}
                  retrying={retrying}
                  onAnswer={async (answer) => {
                    setBusy(true)
                    setActionError(null)
                    try {
                      await api.post(`/submissions/${d.id}/answer`, { answer })
                      await refresh()
                    } finally {
                      setBusy(false)
                    }
                  }}
                  onRetry={async () => {
                    setRetrying(true)
                    setActionError(null)
                    try {
                      await api.post(`/submissions/${d.id}/retry`)
                      await refresh()
                    } catch (err) {
                      setActionError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
                    } finally {
                      setRetrying(false)
                    }
                  }}
                />
              )}
            </Async>
          )}
          {selected && !sub && !submission.error && <Loading label="Loading the attempt…" />}
          {processing(sub) && <p className="text-xs text-ink-500">This page refreshes by itself while the attempt is processed.</p>}

          {canSubmit && (first || sub?.state === "failed" || sub?.state === "revision_needed") && (
            <SubmitForm runId={r.id} phase={phase} onDone={(id) => { setParams({ attempt: id }); void refresh(); navigate(`/student/work/${r.id}/${phase.key}?attempt=${id}`, { replace: true }) }} />
          )}
          {canSubmit && !first && sub?.state === "assessment_unavailable" && (
            <div>
              {showNew ? (
                <SubmitForm compact runId={r.id} phase={phase} onDone={(id) => { setShowNew(false); setParams({ attempt: id }); void refresh() }} />
              ) : (
                <Button variant="ghost" onClick={() => setShowNew(true)}>Or submit a new version instead</Button>
              )}
            </div>
          )}
          {phase.state === "passed" && <Notice tone="success">This phase has passed. Open the next phase from the overview.</Notice>}
        </div>
      </div>
    </div>
  )
}
