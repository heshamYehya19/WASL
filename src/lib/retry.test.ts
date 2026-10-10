// The client side of "Try again": which request it sends, that it sends only one at a time, and what the candidate is told
// for every way it can end. fetch is stubbed — nothing leaves the process.
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "./api"
import { feedbackForError, feedbackForResponse, postRetry, singleFlight } from "./retry"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

describe("postRetry", () => {
  it("POSTs to the retry endpoint of the existing submission — not to the endpoint that creates a submission", async () => {
    const fetch = vi.fn(async () => json(200, { state: "assessment_unavailable", message: "Not enough verified evidence to decide." }))
    vi.stubGlobal("fetch", fetch)
    const res = await postRetry("sub-123")
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/submissions/sub-123/retry")
    expect(init.method).toBe("POST")
    expect(url).not.toMatch(/\/phases\/.*\/submissions/)
    expect(res).toEqual({ state: "assessment_unavailable", message: "Not enough verified evidence to decide." })
  })

  it("rejects with the server's reason when the retry is refused (rate limit, no provider, already running)", async () => {
    for (const [status, error] of [
      [429, "The AI service asked for a short pause after too many requests. Your work is saved; nothing has been assessed. Try again in about 20 seconds."],
      [503, "The AI review isn't available on this server right now (no AI provider is configured). Your work is saved; nothing has been assessed. Try again later."],
      [409, "This is already being processed. Wait a moment and reload."],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => json(status, { error })))
      const err = await postRetry("sub-1").catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiRequestError)
      expect((err as ApiRequestError).status).toBe(status)
      expect(feedbackForError(err)).toContain(error.split(".")[0])
    }
  })

  it("rejects clearly when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))))
    const err = await postRetry("sub-1").catch((e: unknown) => e)
    expect(feedbackForError(err)).toMatch(/Can't reach the Qudra server.*still saved, and nothing has been decided/)
  })
})

describe("singleFlight (no duplicate retries)", () => {
  it("a second click while the first request is running sends nothing new", async () => {
    let release!: () => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (release = () => resolve(json(200, { state: "passed", message: "" })))))
    vi.stubGlobal("fetch", fetch)
    const run = singleFlight(() => postRetry("sub-1"))
    const first = run()
    const second = run()
    expect(second).toBe(first)
    release()
    await first
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("allows another retry once the previous one has finished — even if it failed", async () => {
    const fetch = vi.fn(async () => json(500, { error: "boom" }))
    vi.stubGlobal("fetch", fetch)
    const run = singleFlight(() => postRetry("sub-1"))
    await run().catch(() => undefined)
    await run().catch(() => undefined)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe("what the candidate is told", () => {
  const at = new Date(2026, 9, 10, 9, 41)

  it("a retry that is still unavailable says so, with the reason — so the click is never a silent no-op", () => {
    const text = feedbackForResponse({ state: "assessment_unavailable", message: "Not enough verified evidence to decide. There is not enough verified evidence to rate demonstrated understanding, so no decision was made." }, at)!
    expect(text).toMatch(/^Tried again at .+, but the assessment still couldn't be completed\./)
    expect(text).toContain("not enough verified evidence to rate demonstrated understanding")
    expect(text).toMatch(/still saved, and nothing has been decided/)
    expect(text).not.toMatch(/\bpass(ed)?\b|\bfail(ed)?\b/i) // never an invented result
  })

  it("invalid model output, rate limiting and provider outages are reported with the server's wording", () => {
    for (const message of [
      "The AI's answer couldn't be validated, so no assessment was made. Your work is saved — try again.",
      "The AI service is handling too many requests right now. Your work is saved; nothing has been assessed. Try again in a minute.",
      "The AI service couldn't be reached or returned an error. Your work is saved; nothing has been assessed. Try again in a minute.",
    ]) {
      expect(feedbackForResponse({ state: "assessment_unavailable", message }, at)).toContain(message)
    }
  })

  it("a retry that reached a decision needs no message — the assessment itself is shown", () => {
    expect(feedbackForResponse({ state: "passed", message: "" })).toBeNull()
    expect(feedbackForResponse({ state: "failed", message: "" })).toBeNull()
    expect(feedbackForResponse({ state: "interview_in_progress", message: "" })).toBeNull()
  })

  it("an unexpected error still says the work is saved", () => {
    expect(feedbackForError(new Error("x"))).toMatch(/Something went wrong.*still saved, and nothing has been decided/)
    expect(feedbackForError(new ApiRequestError("This submission isn't waiting on a retry.", 409))).toMatch(/isn't waiting on a retry\. Your work and interview answers are still saved/)
  })
})
