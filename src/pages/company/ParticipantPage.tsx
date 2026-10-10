import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { SubmissionPanel } from "../../components/proof/SubmissionPanel"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Notice } from "../../components/ui/kit"
import { RatingPips } from "../../components/ui/ListKit"
import { Badge, PhaseStateBadge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatDate } from "../../lib/format"
import type { RunView, SubmissionDetail } from "../../types"

interface ParticipantData {
  candidate: { id: string; name: string; headline: string; location: string; bio: string }
  run: Omit<RunView, "phases"> & { phases: (RunView["phases"][number] & { attemptList: { id: string; attempt: number; stage: string; createdAt: string; outcome: string | null }[] })[] }
}

function Attempt({ challengeId, runId, submissionId }: { challengeId: string; runId: string; submissionId: string }) {
  const state = useApi<{ submission: SubmissionDetail }>(`/company/challenges/${challengeId}/participants/${runId}/submissions/${submissionId}`)
  return <Async state={state}>{({ submission }) => <SubmissionPanel detail={submission} audience="company" />}</Async>
}

export default function ParticipantPage() {
  const { id, runId } = useParams()
  const state = useApi<ParticipantData>(`/company/challenges/${id}/participants/${runId}`)
  // The attempt chosen in each phase (by phase key), so choosing one in a phase doesn't reset the others.
  const [picked, setPicked] = useState<Record<string, string>>({})

  return (
    <Async state={state}>
      {({ candidate, run }) => (
        <div className="mx-auto max-w-5xl">
          <Link to={`/company/challenges/${id}`} className="text-sm font-medium text-ink-500 hover:text-teal-700">← {run.challenge.title}</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">{candidate.name}</h1>
            <Badge tone={run.status === "completed" ? "green" : "neutral"}>{run.status === "completed" ? "Completed" : "In progress"}</Badge>
          </div>
          <p className="mt-1 text-ink-600">{candidate.headline}{candidate.location ? ` · ${candidate.location}` : ""}</p>
          <p className="mt-2 text-sm">
            <Link to={`/company/talent/${candidate.id}`} className="font-semibold text-teal-700 hover:underline">View their full profile and evidence</Link>
          </p>
          <Notice tone="info" className="mt-5">
            This candidate shared their work on this challenge with you, to evaluate their ability. Code was read, never run; the interview raises confidence in understanding but doesn't prove authorship.
          </Notice>

          <div className="mt-6 space-y-4">
            {run.phases.map((p, i) => {
              const attempts = p.attemptList
              const choice = picked[p.key]
              const shown = choice && attempts.some((a) => a.id === choice) ? choice : attempts[0]?.id
              return (
                <Card key={p.key}>
                  <CardHeader
                    title={`${i + 1}. ${p.title}`}
                    subtitle={p.objective}
                    action={<PhaseStateBadge state={p.state} locked={!p.available && p.state === "not_started"} />}
                  />
                  {p.latestSubmission?.assessment && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-3 text-sm text-ink-700">
                      <span className="flex items-center gap-2">Correctness <RatingPips rating={p.latestSubmission.assessment.ratings.correctness} /></span>
                      <span className="flex items-center gap-2">Code quality <RatingPips rating={p.latestSubmission.assessment.ratings.codeQuality} /></span>
                      <span className="flex items-center gap-2">Understanding <RatingPips rating={p.latestSubmission.assessment.ratings.understanding} /></span>
                    </div>
                  )}
                  {attempts.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-ink-500">No submissions yet.</p>
                  ) : (
                    <details className="border-t border-ink-100">
                      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-teal-700">Open the evidence ({attempts.length} attempt{attempts.length === 1 ? "" : "s"})</summary>
                      <div className="space-y-3 px-5 pb-5">
                        {attempts.length > 1 && (
                          <div className="flex flex-wrap gap-2" role="group" aria-label={`Attempts for ${p.title}`}>
                            {attempts.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => setPicked((prev) => ({ ...prev, [p.key]: a.id }))}
                                aria-pressed={a.id === shown}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${a.id === shown ? "border-night bg-night text-white" : "border-ink-200 text-ink-700 hover:border-teal-400"}`}
                              >
                                Attempt {a.attempt} · {formatDate(a.createdAt)}{a.outcome === "passed" ? " · passed" : a.outcome === "failed" ? " · not passed yet" : ""}
                              </button>
                            ))}
                          </div>
                        )}
                        {shown && <Attempt key={shown} challengeId={id!} runId={runId!} submissionId={shown} />}
                      </div>
                    </details>
                  )}
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </Async>
  )
}
