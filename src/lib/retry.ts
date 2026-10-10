// Running the Proof Engine again for an attempt that couldn't be finished. The retry continues the SAME submission on the server
// (POST /submissions/:id/retry) — the work and every interview answer are kept and no new attempt is created. Kept apart from
// the components so the request, the one-at-a-time guard and the wording can be tested without a browser.

import { api, ApiRequestError } from "./api"

/** What the server answers: where the attempt ended up, and — if it is still unavailable — why. */
export interface RetryResponse {
  state: string
  message?: string
}

const SAVED = "Your work and interview answers are still saved, and nothing has been decided."

export function postRetry(submissionId: string): Promise<RetryResponse> {
  return api.post<RetryResponse>(`/submissions/${encodeURIComponent(submissionId)}/retry`)
}

/**
 * What to tell the candidate after the server ran the retry. A retry can succeed as a request and still end in "assessment
 * unavailable" (for example, the evidence the model cited could not be verified again) — that is said plainly, because the page
 * would otherwise look exactly as it did before the click.
 */
export function feedbackForResponse(res: RetryResponse, at: Date = new Date()): string | null {
  if (res.state !== "assessment_unavailable") return null
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const why = res.message?.trim() ? ` ${res.message.trim()}` : ""
  return `Tried again at ${time}, but the assessment still couldn't be completed.${why} ${SAVED}`
}

/** What to tell the candidate when the retry request itself was refused or never reached the server. */
export function feedbackForError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    // The server's messages already say what happened (rate limit, no provider, already running…) and that the work is saved.
    const text = err.message.trim() || "The retry couldn't be started."
    return /saved/i.test(text) ? text : `${text} ${SAVED}`
  }
  return `Something went wrong while trying again. ${SAVED}`
}

/** Wraps `fn` so a second call while the first is still running does not start another request; it gets the same promise. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null
  return () => {
    if (!running) {
      running = fn().finally(() => {
        running = null
      })
    }
    return running
  }
}
