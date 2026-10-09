// A company challenge's lifecycle. Draft → Generated → Reviewed → Published → In Progress → Completed / Archived.

export const CHALLENGE_STATUSES = ["draft", "generated", "reviewed", "published", "in_progress", "completed", "archived"] as const
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number]

export type ChallengeEvent = "generate" | "edit" | "review" | "publish" | "start" | "complete" | "archive"

const TRANSITIONS: Record<ChallengeEvent, { from: readonly ChallengeStatus[]; to: ChallengeStatus }> = {
  // (Re)generating or editing produces a new, unreviewed version.
  generate: { from: ["draft", "generated", "reviewed"], to: "generated" },
  edit: { from: ["generated", "reviewed"], to: "generated" },
  review: { from: ["generated"], to: "reviewed" },
  publish: { from: ["reviewed"], to: "published" },
  // The first candidate to start a published challenge moves it to in-progress; later starts leave it there.
  start: { from: ["published", "in_progress"], to: "in_progress" },
  complete: { from: ["published", "in_progress"], to: "completed" },
  archive: { from: ["draft", "generated", "reviewed", "published", "in_progress", "completed"], to: "archived" },
}

export class IllegalChallengeTransition extends Error {
  from: ChallengeStatus
  event: ChallengeEvent
  constructor(from: ChallengeStatus, event: ChallengeEvent) {
    super(`A challenge that is ${from.replace(/_/g, " ")} cannot be ${EVENT_VERB[event]}.`)
    this.from = from
    this.event = event
  }
}

const EVENT_VERB: Record<ChallengeEvent, string> = {
  generate: "generated",
  edit: "edited",
  review: "marked as reviewed",
  publish: "published",
  start: "started",
  complete: "marked completed",
  archive: "archived",
}

export const canChallengeTransition = (from: ChallengeStatus, event: ChallengeEvent) => TRANSITIONS[event].from.includes(from)

export function challengeTransition(from: ChallengeStatus, event: ChallengeEvent): ChallengeStatus {
  if (!canChallengeTransition(from, event)) throw new IllegalChallengeTransition(from, event)
  return TRANSITIONS[event].to
}

/** Candidates can find and start a challenge only while it is open. */
export const OPEN_STATUSES: readonly ChallengeStatus[] = ["published", "in_progress"]
/** Once published, the structure students work on is frozen. */
export const FROZEN_STATUSES: readonly ChallengeStatus[] = ["published", "in_progress", "completed", "archived"]

export const CHALLENGE_STATUS_LABELS: Record<ChallengeStatus, string> = {
  draft: "Draft",
  generated: "Generated",
  reviewed: "Reviewed",
  published: "Published",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
}
