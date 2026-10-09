import type { ReactNode } from "react"
import { CHALLENGE_STATUS_LABELS, PHASE_STATE_LABELS } from "../../types"
import type { ChallengeStatus, PhaseState } from "../../types"

type Tone = "neutral" | "teal" | "sky" | "amber" | "green" | "red" | "night"

const TONES: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-600 border-ink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-400/40",
  sky: "bg-sky-100 text-sky-700 border-sky-400/40",
  amber: "bg-amber-100 text-amber-600 border-amber-400/40",
  green: "bg-verified-100 text-verified-600 border-verified-500/40",
  red: "bg-danger-100 text-danger-600 border-danger-600/30",
  night: "bg-ink-700 text-ink-50 border-ink-700",
}

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

const PHASE_TONE: Record<PhaseState, Tone> = {
  not_started: "neutral",
  in_progress: "sky",
  submitted: "sky",
  under_review: "amber",
  interview_in_progress: "amber",
  passed: "green",
  // Not a mark of failure: the phase simply is not passed yet, and can be tried again.
  failed: "neutral",
  revision_needed: "amber",
  assessment_unavailable: "red",
}

export function PhaseStateBadge({ state, locked = false }: { state: PhaseState; locked?: boolean }) {
  if (locked) return <Badge tone="neutral">Locked</Badge>
  return <Badge tone={PHASE_TONE[state]}>{PHASE_STATE_LABELS[state]}</Badge>
}

const CHALLENGE_TONE: Record<ChallengeStatus, Tone> = {
  draft: "neutral",
  generated: "sky",
  reviewed: "teal",
  published: "green",
  in_progress: "green",
  completed: "night",
  archived: "neutral",
}

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  return <Badge tone={CHALLENGE_TONE[status]}>{CHALLENGE_STATUS_LABELS[status]}</Badge>
}
