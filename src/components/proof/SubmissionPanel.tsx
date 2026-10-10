import { useEffect, useRef, useState } from "react"
import { Badge, PhaseStateBadge } from "../ui/StatusBadge"
import { Card, CardHeader } from "../ui/Card"
import { Button, Field, inputClass, Notice, Spinner } from "../ui/kit"
import { RatingPips } from "../ui/ListKit"
import { CodeBlock } from "./CodeBlock"
import { formatDate } from "../../lib/format"
import { feedbackForError, feedbackForResponse, singleFlight } from "../../lib/retry"
import type { RetryResponse } from "../../lib/retry"
import type { AssessmentDetail, EvidenceCitation, InterviewMessage, StaticCheck, SubmissionDetail } from "../../types"

/* One attempt, start to finish: where it is in the pipeline, what the checks and the review found, the interview, and the
   assessment. The same component serves the candidate (who can answer and retry) and the company evaluating them. */

const STEPS = ["Submitted", "Checked", "AI review", "Interview", "Assessment"] as const

type StepState = "done" | "current" | "blocked" | "todo"

function stepStates(d: SubmissionDetail): StepState[] {
  const s: StepState[] = ["done", "todo", "todo", "todo", "todo"]
  if (d.stage === "rejected") {
    s[1] = "blocked"
    return s
  }
  s[1] = "done"
  const unavailable = d.state === "assessment_unavailable"
  const reviewed = d.review !== null
  const interviewDone = d.interview?.status === "completed"
  if (d.stage === "assessed") return ["done", "done", "done", "done", "done"]
  if (!reviewed) {
    s[2] = unavailable ? "blocked" : "current"
    return s
  }
  s[2] = "done"
  if (!interviewDone) {
    s[3] = unavailable ? "blocked" : "current"
    return s
  }
  s[3] = "done"
  s[4] = unavailable ? "blocked" : "current"
  return s
}

function Timeline({ detail }: { detail: SubmissionDetail }) {
  const states = stepStates(detail)
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3" aria-label="Where this attempt is">
      {STEPS.map((label, i) => {
        const st = states[i]
        return (
          <li key={label} className="flex items-center gap-2" aria-current={st === "current" ? "step" : undefined}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                st === "done" ? "bg-teal-500 text-ink-950" : st === "current" ? "bg-night text-teal-300 ring-2 ring-teal-400/60" : st === "blocked" ? "bg-danger-100 text-danger-600 ring-1 ring-danger-600/40" : "border border-ink-200 bg-surface text-ink-400"
              }`}
            >
              {st === "done" ? "✓" : st === "blocked" ? "!" : i + 1}
            </span>
            <span className={`text-sm ${st === "todo" ? "text-ink-400" : st === "blocked" ? "font-semibold text-danger-600" : "font-medium text-ink-800"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-ink-200 sm:block" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

const CHECK_TONE: Record<StaticCheck["status"], string> = {
  pass: "text-verified-600",
  warn: "text-amber-600",
  fail: "text-danger-600",
  info: "text-ink-500",
}
const CHECK_ICON: Record<StaticCheck["status"], string> = { pass: "✓", warn: "!", fail: "✕", info: "i" }

function Checks({ checks, note }: { checks: StaticCheck[]; note: string }) {
  if (checks.length === 0) return null
  return (
    <Card>
      <CardHeader title="Deterministic checks" subtitle={note} />
      <ul className="divide-y divide-ink-100">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-3 px-5 py-2.5 text-sm">
            <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${CHECK_TONE[c.status]}`} aria-label={c.status}>{CHECK_ICON[c.status]}</span>
            <span className="min-w-0">
              <span className="font-medium text-ink-800">{c.label}</span>
              <span className="block text-ink-500">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const SEVERITY: Record<string, "neutral" | "amber" | "red"> = { info: "neutral", minor: "amber", major: "red" }
const CRITERION_LABEL: Record<string, string> = { met: "Met", partial: "Partly met", unmet: "Not met", unclear: "Couldn't tell" }
const CRITERION_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { met: "green", partial: "amber", unmet: "red", unclear: "neutral" }

function Review({ review }: { review: NonNullable<SubmissionDetail["review"]> }) {
  return (
    <Card>
      <CardHeader title="AI review" subtitle={`Read by ${review.model || "the model"} as untrusted data. Every quoted line below was checked against the submission.`} />
      <div className="space-y-4 px-5 py-4">
        {review.injectionFlagged && <Notice tone="warn">The submission contains text that tries to instruct the grader. It was ignored and did not influence anything.</Notice>}
        <p className="text-sm leading-relaxed text-ink-700">{review.summary}</p>
        {review.findings.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Findings</h4>
            <ul className="space-y-3">
              {review.findings.map((f) => (
                <li key={f.id} className="rounded-xl border border-ink-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY[f.severity]}>{f.severity}</Badge>
                    <span className="font-medium text-ink-900">{f.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-600">{f.detail}</p>
                  {f.quote && (
                    <p className="mt-2 rounded-lg bg-ink-100 px-2.5 py-1.5 font-mono text-xs text-ink-700">
                      {f.path}
                      {f.line ? `:${f.line}` : ""} — {f.quote}
                    </p>
                  )}
                  {!f.anchored && <p className="mt-1 text-xs text-amber-600">The line the model cited could not be found in the submission, so it was removed.</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {review.criteria.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Against the criteria</h4>
            <ul className="space-y-2">
              {review.criteria.map((c) => (
                <li key={c.criterionId} className="flex flex-wrap items-start gap-2 text-sm">
                  <Badge tone={CRITERION_TONE[c.status]} className="mt-0.5">{CRITERION_LABEL[c.status]}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink-800">{c.text}</span>
                    <span className="block text-ink-500">{c.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function Message({ m }: { m: InterviewMessage }) {
  const mine = m.role === "candidate"
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${mine ? "bg-night text-white" : "border border-ink-200 bg-surface text-ink-800"}`}>
        <div className={`mb-0.5 text-[10px] font-bold tracking-wide uppercase ${mine ? "text-teal-300" : "text-teal-700"}`}>
          {mine ? "Candidate" : m.isFollowup ? "Interviewer · follow-up" : "Interviewer"}
        </div>
        <p className="whitespace-pre-wrap">{m.content}</p>
        {!mine && m.grounding && m.grounding.kind !== "answer" && (
          <p className="mt-1.5 border-t border-ink-100 pt-1.5 text-[11px] text-ink-500">
            Asked about {m.grounding.kind === "code" ? `your code${m.grounding.path ? ` (${m.grounding.path}${m.grounding.line ? `:${m.grounding.line}` : ""})` : ""}` : m.grounding.kind === "finding" ? "a review finding" : "one of the criteria"}
            {m.grounding.why ? ` — ${m.grounding.why}` : ""}
          </p>
        )}
        {mine && m.injectionFlagged && <p className="mt-1 text-[11px] text-amber-300">This answer contained instructions aimed at the grader; they were ignored.</p>}
      </div>
    </li>
  )
}

function Interview({
  detail,
  audience,
  onAnswer,
  busy,
}: {
  detail: SubmissionDetail
  audience: "candidate" | "company"
  onAnswer?: (answer: string) => Promise<void>
  busy: boolean
}) {
  const iv = detail.interview!
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // (A block body: some browsers' scrollIntoView returns a Promise, which React would take for a cleanup function.)
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [iv.messages.length])

  return (
    <Card>
      <CardHeader
        title="Understanding interview"
        subtitle={
          iv.status === "completed"
            ? `Complete — ${iv.answered} question${iv.answered === 1 ? "" : "s"} answered.`
            : `Open-ended questions about the submitted work. ${iv.minQuestions}–${iv.maxQuestions} questions; no decision is made until it's complete.`
        }
      />
      <div className="px-5 py-4">
        <ol className="space-y-3" aria-live="polite" aria-label="Interview">
          {iv.messages.map((m) => <Message key={m.seq} m={m} />)}
          {busy && (
            <li className="flex items-center gap-2 text-sm text-ink-500">
              <Spinner small /> The interviewer is reading your answer…
            </li>
          )}
          <li ref={end} aria-hidden="true" />
        </ol>
        {audience === "candidate" && iv.awaitingAnswer && onAnswer && (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setError(null)
              try {
                await onAnswer(answer)
                setAnswer("")
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong.")
              }
            }}
          >
            <Field label="Your answer" htmlFor="interview-answer" hint="In your own words. Refer to your code where it helps. A specific answer beats a long one." error={error}>
              <textarea id="interview-answer" className={`${inputClass} min-h-28`} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={3000} disabled={busy} aria-invalid={!!error} />
            </Field>
            <Button type="submit" loading={busy} disabled={answer.trim().length === 0}>Send answer</Button>
          </form>
        )}
        {audience === "candidate" && iv.status === "in_progress" && !iv.awaitingAnswer && !busy && (
          <p className="mt-4 text-sm text-ink-500">Waiting for the next question…</p>
        )}
      </div>
    </Card>
  )
}

function Evidence({ items }: { items: EvidenceCitation[] }) {
  if (items.length === 0) return <p className="text-xs text-ink-500">No evidence could be verified for this.</p>
  const label = (e: EvidenceCitation) => (e.source === "code" ? `Code${e.path ? ` · ${e.path}${e.line ? `:${e.line}` : ""}` : ""}` : e.source === "answer" ? `Interview answer ${e.ref}` : e.source === "check" ? "Deterministic check" : "Review finding")
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs text-ink-700">
          <span className="font-semibold">{label(e)}</span>
          {e.quote && <span className="block font-mono text-ink-600">“{e.quote}”</span>}
          <span className="block text-ink-500">{e.note}</span>
        </li>
      ))}
    </ul>
  )
}

function Assessment({ a }: { a: AssessmentDetail }) {
  return (
    <Card>
      <CardHeader
        title="Assessment"
        subtitle="Three separate judgements, each backed by evidence the server verified. A fixed rule — not the model — decides the outcome."
        action={<Badge tone={a.outcome === "passed" ? "green" : "neutral"}>{a.outcomeLabel}</Badge>}
      />
      <div className="space-y-5 px-5 py-4">
        {a.origin === "demo_fixture" && <Notice tone="demo">Demonstration data — this assessment was not produced by the Proof Engine.</Notice>}
        <p className="text-sm leading-relaxed text-ink-700">{a.summary}</p>
        <p className="rounded-xl bg-ink-100 px-4 py-2.5 text-sm text-ink-700"><strong>Why:</strong> {a.outcomeReason}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          {a.dimensions.map((d) => (
            <section key={d.key} className="rounded-xl border border-ink-200 p-4" aria-label={d.label}>
              <h4 className="text-sm font-bold text-ink-900">{d.label}</h4>
              <div className="mt-1.5"><RatingPips rating={d.rating} /></div>
              <div className="mt-0.5 text-xs text-ink-500">{d.ratingLabel} · needs {d.needed}</div>
              <p className="mt-2 text-sm text-ink-600">{d.rationale}</p>
              {d.adjustment && <p className="mt-2 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs text-ink-800">Adjusted by the server: {d.adjustment}</p>}
              <div className="mt-3">
                <Evidence items={d.evidence} />
                {d.dropped > 0 && <p className="mt-1.5 text-[11px] text-ink-500">{d.dropped} cited item{d.dropped === 1 ? "" : "s"} couldn't be verified and {d.dropped === 1 ? "was" : "were"} discarded.</p>}
              </div>
            </section>
          ))}
        </div>
        {(a.strengths.length > 0 || a.weaknesses.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {a.strengths.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">What went well</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
            {a.weaknesses.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">To work on</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">{a.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-ink-500">
          {a.origin === "ai" ? `Assessed by ${a.model} (${a.provider}) with prompt ${a.promptVersion} on ${formatDate(a.createdAt)}.` : ""} The interview raises confidence that the candidate understands their work; it does not prove who wrote it.
        </p>
      </div>
    </Card>
  )
}

/**
 * Runs the pipeline again for this attempt. One request at a time (a second click while one is running starts nothing), a
 * visible "working" state, and an explicit result: a retry that ends in "unavailable" again says so, and a refused or failed
 * request shows the server's reason — never a silent no-op, and never a made-up outcome.
 */
function RetryAction({ label, onRetry }: { label: string; onRetry: () => Promise<RetryResponse> }) {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const latest = useRef(onRetry)
  useEffect(() => {
    latest.current = onRetry
  })
  // Created on the first click and kept, so the guard survives the re-renders a retry causes.
  const run = useRef<(() => Promise<void>) | null>(null)
  const click = () => {
    run.current ??= singleFlight(async () => {
      setPending(true)
      setFeedback(null)
      try {
        setFeedback(feedbackForResponse(await latest.current()))
      } catch (err) {
        setFeedback(feedbackForError(err))
      } finally {
        setPending(false)
      }
    })
    void run.current()
  }
  return (
    <div className="mt-3 space-y-2">
      <Button variant="secondary" loading={pending} onClick={click}>{label}</Button>
      <div aria-live="polite">
        {pending && <p className="text-xs text-ink-600">Running the Proof Engine again on this attempt. This can take up to a minute — keep this page open.</p>}
        {!pending && feedback && (
          <p className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-danger-600 ring-1 ring-danger-600/30" data-testid="retry-feedback">
            {feedback}
          </p>
        )}
      </div>
    </div>
  )
}

export function SubmissionPanel({
  detail,
  audience,
  onAnswer,
  onRetry,
  busy = false,
}: {
  detail: SubmissionDetail
  audience: "candidate" | "company"
  onAnswer?: (answer: string) => Promise<void>
  onRetry?: () => Promise<RetryResponse>
  busy?: boolean
}) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Attempt {detail.attempt} · {formatDate(detail.createdAt)}</div>
            <div className="mt-0.5 font-semibold text-ink-900">{detail.phase.title}</div>
          </div>
          <PhaseStateBadge state={detail.state} />
        </div>
        <div className="border-t border-ink-100 px-5 py-4"><Timeline detail={detail} /></div>
      </Card>

      {detail.stage === "rejected" && (
        <Notice tone="warn" title="This needs a revision before it can be reviewed">
          <ul className="list-disc pl-5">{detail.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Notice>
      )}

      {detail.state === "assessment_unavailable" && (
        <Notice tone="danger" title="Assessment unavailable — nothing has been decided">
          {detail.pipelineMessage || "The Proof Engine couldn't finish this step."}{" "}
          {audience === "candidate" ? "Your work and answers are saved." : ""}
          {audience === "candidate" && detail.canRetry && onRetry && <RetryAction label="Try again" onRetry={onRetry} />}
        </Notice>
      )}

      {(detail.state === "submitted" || detail.state === "under_review") && !detail.canRetry && !busy && (
        <Notice tone="info"><span className="inline-flex items-center gap-2"><Spinner small /> This attempt is being processed.</span></Notice>
      )}
      {(detail.state === "submitted" || detail.state === "under_review") && detail.canRetry && onRetry && audience === "candidate" && (
        <Notice tone="warn" title="This stalled">
          Processing seems to have stopped (for example, the server restarted). Your work is saved.
          <RetryAction label="Continue processing" onRetry={onRetry} />
        </Notice>
      )}

      {detail.assessment && <Assessment a={detail.assessment} />}
      {detail.interview && <Interview detail={detail} audience={audience} onAnswer={onAnswer} busy={busy} />}
      {detail.review && <Review review={detail.review} />}
      <Checks checks={detail.checks} note={detail.analysis.note} />

      <Card>
        <CardHeader title="The submission" subtitle={detail.githubUrl ? `Repository: ${detail.githubUrl}` : detail.language ? `Language: ${detail.language}` : undefined} />
        <div className="space-y-3 px-5 py-4">
          {detail.note && <p className="text-sm text-ink-700"><strong>Note:</strong> {detail.note}</p>}
          {detail.artifacts.length === 0 && <p className="text-sm text-ink-500">No files were read for this attempt.</p>}
          {detail.artifacts.map((a) => (
            <CodeBlock key={a.path} path={a.path} code={a.content} note={[a.source === "repository" ? "from GitHub" : "pasted", a.truncated ? "truncated" : "", a.redactions ? `${a.redactions} secret${a.redactions === 1 ? "" : "s"} removed` : ""].filter(Boolean).join(" · ")} />
          ))}
        </div>
      </Card>
    </div>
  )
}
