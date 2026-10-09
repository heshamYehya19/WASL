// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeAi, finishInterview, getDb, GOOD_ANSWER, GOOD_CODE, LAYLA, llmDeps, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

// The Proof Engine's ordering and evidence rules, through the real API with the scriptable fake provider (synthetic code and
// answers only). These prove the server's behaviour around a model; they say nothing about how a live model answers.

const server = await startServer()
const call = server.call
afterAll(() => server.close())

let challengeId: string
let runId: string
beforeEach(async () => {
  resetDatabase()
  useFakeAi()
  challengeId = await publishChallenge(call)
  runId = await startRun(call, challengeId)
})
// fakeAi.reset() does not undo an instance override of respond; restore the prototype's so tests stay independent.
afterEach(() => void delete (fakeAi as { respond?: unknown }).respond)

interface Detail {
  state: string
  canRetry: boolean
  pipelineMessage: string
  interview: { status: string; answered: number; awaitingAnswer: boolean; messages: { role: string; content: string }[] } | null
  assessment: { outcome: string; outcomeReason: string; dimensions: { key: string; rating: number; evidence: unknown[] }[] } | null
}
const detail = async (id: string, actor = SARA) => (await call("GET", `/submissions/${id}`, actor)).json.submission as Detail
const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]
const assessmentsOf = (submissionId: string) => rows("SELECT id FROM assessments WHERE submission_id = ?", submissionId)
const answer = (id: string, text = GOOD_ANSWER, actor = SARA) => call("POST", `/submissions/${id}/answer`, actor, { answer: text })

/** Rewrites the fake model's assessment ratings, leaving its (verifiable) evidence alone. */
const assessmentRates = (ratings: { correctness?: number; codeQuality?: number; understanding?: number }) => {
  const orig = fakeAi.respond.bind(fakeAi)
  fakeAi.respond = (body) => {
    const out = orig(body)
    if ((body as { response_format?: { json_schema?: { name?: string } } }).response_format?.json_schema?.name !== "assessment") return out
    const content = JSON.parse((out.body as { choices: { message: { content: string } }[] }).choices[0].message.content)
    for (const [k, v] of Object.entries(ratings)) content[k].rating = v
    return { status: 200, body: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] } }
  }
}

describe("the assessment waits for the interview", () => {
  it("never asks a model for an assessment until the interview is complete, then assesses from the review and the answers", async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    expect(fakeAi.callsFor("submission_review")).toHaveLength(1)
    expect(fakeAi.callsFor("interview_turn").length).toBeGreaterThanOrEqual(1)

    // Two answered questions: still interviewing, and no assessment has been requested — let alone stored.
    for (let i = 0; i < 2; i++) expect((await answer(id)).status).toBe(200)
    const mid = await detail(id)
    expect(mid.interview?.awaitingAnswer).toBe(true)
    expect(mid.interview?.answered).toBe(2)
    expect(mid.assessment).toBeNull()
    expect(fakeAi.callsFor("assessment")).toEqual([])
    expect(assessmentsOf(id)).toEqual([])

    await finishInterview(call, id)
    const done = await detail(id)
    expect(done.interview?.status).toBe("completed")
    expect(done.assessment?.outcome).toBe("passed")
    expect(fakeAi.callsFor("assessment")).toHaveLength(1)

    // The assessment request carries this submission's evidence: its code, its review and every interview answer.
    const prompt = fakeAi.callsFor("assessment")[0].user
    expect(prompt).toContain("def route_ticket(ticket):")
    expect(prompt).toContain("Review of the submission:")
    const answered = done.interview!.messages.filter((m) => m.role === "candidate").length
    expect(answered).toBeGreaterThanOrEqual(3)
    for (let n = 1; n <= answered; n++) expect(prompt).toContain(`Answer A${n}:`)
    expect(prompt).toContain(GOOD_ANSWER)
  })

  it("grounds each candidate's interview in their own submission, not someone else's", async () => {
    const layla = await startRun(call, challengeId, LAYLA)
    const LAYLA_CODE = [
      "QUEUE_WORDS = {'billing': ('invoice', 'refund'), 'technical': ('error', 'crash')}",
      "",
      "def choose_queue(ticket):",
      "    words = str(ticket.get('subject', '')).lower().split()",
      "    for queue, keys in QUEUE_WORDS.items():",
      "        if any(k in words for k in keys):",
      "            return {'queue': queue, 'reason': f'matched a {queue} word'}",
      "    return {'queue': 'general', 'reason': 'nothing matched'}",
    ].join("\n")
    await submit(call, runId, "p1")
    const theirs = await submit(call, layla, "p1", { code: LAYLA_CODE, language: "Python" }, LAYLA)
    expect(theirs.status).toBe(200)

    const turns = fakeAi.callsFor("interview_turn")
    const laylaTurn = turns[turns.length - 1].user
    expect(laylaTurn).toContain("def choose_queue(ticket):")
    expect(laylaTurn).not.toContain("route_ticket")
    // Her first question is about a line of HER code (the server checks the quoted line exists in her submission).
    const first = (await detail(String(theirs.json.submissionId), LAYLA)).interview!.messages.find((m) => m.role === "interviewer")!
    expect(first.content).toContain("`QUEUE_WORDS`")
    expect(GOOD_CODE).not.toContain("QUEUE_WORDS")
  })
})

describe("three separate dimensions", () => {
  const run = async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    await finishInterview(call, id)
    return detail(id)
  }

  it("working, readable code the candidate cannot explain does not pass — and the reason names only understanding", async () => {
    assessmentRates({ correctness: 3, codeQuality: 3, understanding: 1 })
    const d = await run()
    expect(d.state).toBe("failed")
    // Code quality was rated 3 with one piece of evidence; a top rating needs two verified, so the server lowered it to 2.
    expect(d.assessment?.dimensions.map((x) => [x.key, x.rating])).toEqual([["correctness", 3], ["code_quality", 2], ["understanding", 1]])
    expect(d.assessment?.outcomeReason).toMatch(/demonstrated understanding was rated 1 of 3/)
    expect(d.assessment?.outcomeReason).not.toMatch(/correctness was rated|code quality was rated/)
  })

  it("a good explanation of incorrect work does not pass — and the reason names only correctness", async () => {
    assessmentRates({ correctness: 1, codeQuality: 2, understanding: 3 })
    const d = await run()
    expect(d.state).toBe("failed")
    expect(d.assessment?.outcomeReason).toMatch(/correctness was rated 1 of 3/)
    expect(d.assessment?.outcomeReason).not.toMatch(/understanding was rated|code quality was rated/)
  })

  it("code quality has its own bar: rated 0, the phase fails even with strong correctness and understanding", async () => {
    assessmentRates({ correctness: 3, codeQuality: 0, understanding: 3 })
    const d = await run()
    expect(d.state).toBe("failed")
    expect(d.assessment?.outcomeReason).toMatch(/code quality was rated 0 of 3/)
  })
})

describe("rate limits", () => {
  afterEach(() => void vi.useRealTimers())

  it("says it is a rate limit, keeps the interview, refuses an early retry with the wait, then assesses after the wait", async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    const fake = llmDeps.fetch
    llmDeps.fetch = async (url, init) => {
      const name = (JSON.parse(String(init.body)) as { response_format?: { json_schema?: { name?: string } } }).response_format?.json_schema?.name
      if (name === "assessment") return Response.json({ error: { message: "Rate limit reached. Please try again in 30s." } }, { status: 429, headers: { "retry-after": "30" } })
      return fake(url, init)
    }
    await finishInterview(call, id)
    const d = await detail(id)
    expect(d.state).toBe("assessment_unavailable")
    expect(d.assessment).toBeNull()
    expect(d.interview?.status).toBe("completed")
    expect(d.pipelineMessage).toMatch(/too many requests.*nothing has been assessed.*Try again in about 30 seconds/)
    expect(d.pipelineMessage).not.toMatch(/took too long|test-groq-key/)
    expect(assessmentsOf(id)).toEqual([])

    // Too early: refused with the wait, and nothing changes (no new model call, no new state).
    llmDeps.fetch = fake
    const early = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(early.status).toBe(429)
    expect(String(early.json.error)).toMatch(/Try again in about \d+ seconds/)
    expect((early.json.detail as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(25)
    expect(fakeAi.callsFor("assessment")).toHaveLength(0)
    expect((await detail(id)).state).toBe("assessment_unavailable")

    // After the provider's window, the retry runs and the rule decides.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 })
    const later = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(later.status).toBe(200)
    expect(later.json.state).toBe("passed")
  })
})

describe("a bad or missing assessment is never a result", () => {
  const interviewed = async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    await finishInterview(call, id)
    return id
  }
  const expectNoDecision = async (id: string) => {
    const d = await detail(id)
    expect(d.state).toBe("assessment_unavailable")
    expect(d.assessment).toBeNull()
    expect(d.interview?.status).toBe("completed") // the candidate's interview is kept
    expect(d.canRetry).toBe(true)
    expect(assessmentsOf(id)).toEqual([])
    expect(rows("SELECT id FROM skill_evidence WHERE run_id = ?", runId)).toEqual([])
    return d
  }

  it("a rating outside 0–3 is rejected, retried, then fails safe; a retry after recovery decides normally", async () => {
    assessmentRates({ correctness: 7 })
    const id = await interviewed()
    await expectNoDecision(id)
    expect(fakeAi.callsFor("assessment")).toHaveLength(2) // the provider layer retried once before giving up
    delete (fakeAi as { respond?: unknown }).respond
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("passed")
  })

  it("an assessment that is not JSON fails safe", async () => {
    fakeAi.behavior.garbage = ["assessment"]
    await expectNoDecision(await interviewed())
  })

  it("with BOTH providers down (Groq rate-limited, Gemini erroring), nothing is passed or failed", async () => {
    const id = await (async () => {
      const out = await submit(call, runId, "p1")
      return String(out.json.submissionId)
    })()
    process.env.GEMINI_API_KEY = "test-gemini-key-0123456789" // useFakeAi() in beforeEach removes it again
    const fake = llmDeps.fetch
    const seen: string[] = []
    llmDeps.fetch = async (url, init) => {
      if (url.includes("generativelanguage")) {
        seen.push("gemini")
        return Response.json({ error: { message: "backend error" } }, { status: 500 })
      }
      const name = (JSON.parse(String(init.body)) as { response_format?: { json_schema?: { name?: string } } }).response_format?.json_schema?.name
      if (name === "assessment") {
        seen.push("groq")
        return Response.json({ error: { message: "rate limited" } }, { status: 429 })
      }
      return fake(url, init)
    }
    await finishInterview(call, id)
    const d = await expectNoDecision(id)
    // The last error was Gemini's 5xx (Groq's 429 carried no retry guidance, so there was nothing short to wait out).
    expect(d.pipelineMessage).toMatch(/couldn't be reached or returned an error.*nothing has been assessed/i)
    // Groq's rate limit moved straight to Gemini (no retry on Groq); Gemini's 5xx was retried once.
    expect(seen).toEqual(["groq", "gemini", "gemini"])
    const log = rows("SELECT provider, ok, error_kind FROM ai_calls WHERE purpose = 'assessment'")
    expect(log).toEqual([{ provider: "gemini", ok: 0, error_kind: "http" }])
  })
})
