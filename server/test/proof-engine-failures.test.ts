// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { fakeAi, finishInterview, getDb, GOOD_CODE, llmDeps, noAi, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

// What the Proof Engine does when the AI misbehaves. The rule under test: a failure is never turned into a result. The phase
// becomes "assessment unavailable", nothing is passed or failed, the work is kept, and the candidate can retry.

const server = await startServer()
const call = server.call
afterAll(() => server.close())

let runId: string
beforeEach(async () => {
  resetDatabase()
  useFakeAi()
  const challengeId = await publishChallenge(call)
  runId = await startRun(call, challengeId)
})

interface Detail {
  state: string
  stage: string
  pipelineMessage: string
  canRetry: boolean
  review: { findings: { anchored: boolean; quote: string }[]; criteria: { status: string; note: string }[]; injectionFlagged: boolean } | null
  interview: { status: string; awaitingAnswer: boolean; messages: { role: string }[] } | null
  assessment: { outcome: string } | null
}
const detail = async (id: string) => (await call("GET", `/submissions/${id}`, SARA)).json.submission as Detail
const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]
const assessmentCount = () => rows("SELECT a.id FROM assessments a JOIN submissions s ON s.id = a.submission_id JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId).length
const phaseState = (key = "p1") => String(rows("SELECT rp.state FROM run_phases rp JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = ?", runId, key)[0].state)

describe("when the AI is unavailable", () => {
  it("with no provider configured: the submission is saved, nothing is assessed, and the message says why", async () => {
    noAi()
    const out = await submit(call, runId, "p1")
    expect(out.status).toBe(200)
    expect(out.json.state).toBe("assessment_unavailable")
    const d = await detail(String(out.json.submissionId))
    expect(d.pipelineMessage).toMatch(/no AI provider is configured/)
    expect(d.assessment).toBeNull()
    expect(assessmentCount()).toBe(0)
    expect(phaseState()).toBe("assessment_unavailable")
  })

  it("an outage during the review leaves the phase unavailable — and a retry after recovery carries on", async () => {
    fakeAi.behavior.fail = ["submission_review"]
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    expect(out.json.state).toBe("assessment_unavailable")
    expect((await detail(id)).canRetry).toBe(true)
    expect(assessmentCount()).toBe(0)

    fakeAi.behavior.fail = []
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(200)
    expect(retried.json.state).toBe("interview_in_progress")
    expect((await detail(id)).review).not.toBeNull()
    await finishInterview(call, id)
    expect((await detail(id)).assessment?.outcome).toBe("passed")
  })

  it("an outage while asking a question keeps the candidate's answer and resumes from it", async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    fakeAi.behavior.fail = ["interview_turn"]
    const answered = await call("POST", `/submissions/${id}/answer`, SARA, { answer: "It lowercases the text and checks the tier first, then looks for billing words." })
    expect(answered.json.state).toBe("assessment_unavailable")
    const sub = await detail(id)
    expect(sub.interview?.messages.filter((m) => m.role === "candidate")).toHaveLength(1) // the answer is not lost
    expect(sub.canRetry).toBe(true)

    fakeAi.behavior.fail = []
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("interview_in_progress")
    expect((await detail(id)).interview?.awaitingAnswer).toBe(true)
  })

  it("an outage during the assessment keeps the completed interview and never records a pass or fail", async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    fakeAi.behavior.fail = ["assessment"]
    await finishInterview(call, id)
    const d = await detail(id)
    expect(d.state).toBe("assessment_unavailable")
    expect(d.interview?.status).toBe("completed")
    expect(d.assessment).toBeNull()
    expect(assessmentCount()).toBe(0)
    expect(phaseState()).toBe("assessment_unavailable")

    fakeAi.behavior.fail = []
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("passed")
    expect((await detail(id)).assessment?.outcome).toBe("passed")
  })

  it("an assessment whose evidence cannot be verified yields NO decision (not a pass, not a fail)", async () => {
    fakeAi.behavior.assessment = "unsupported"
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    await finishInterview(call, id)
    const d = await detail(id)
    expect(d.state).toBe("assessment_unavailable")
    expect(d.assessment).toBeNull()
    expect(d.pipelineMessage).toMatch(/Not enough verified evidence/)
    expect(assessmentCount()).toBe(0)
  })

  it("answers that are not JSON are rejected, retried, and then fail safe", async () => {
    fakeAi.behavior.garbage = ["submission_review"]
    const out = await submit(call, runId, "p1")
    expect(out.json.state).toBe("assessment_unavailable")
    const calls = rows("SELECT attempts, ok FROM ai_calls WHERE purpose = 'review'")
    expect(calls).toHaveLength(1)
    expect(calls[0].ok).toBe(0)
    expect(Number(calls[0].attempts)).toBeGreaterThanOrEqual(2) // retried once before giving up
  })

  it("a transient provider error is retried and the work goes through", async () => {
    fakeAi.behavior.failTimes = { submission_review: 1 }
    const out = await submit(call, runId, "p1")
    expect(out.json.state).toBe("interview_in_progress")
  })

  it("a stalled submission (nothing is working on it) can be retried", async () => {
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    expect((await detail(id)).canRetry).toBe(false) // waiting on the candidate, not stalled
    // Simulate a server restart mid-review: the phase is under review, the review never ran.
    getDb().exec(`UPDATE reviews SET input_hash = 'x' WHERE submission_id = '${id}'`)
    getDb().exec(`DELETE FROM interview_messages WHERE session_id IN (SELECT id FROM interview_sessions WHERE submission_id = '${id}')`)
    getDb().exec(`DELETE FROM interview_sessions WHERE submission_id = '${id}'`)
    getDb().exec(`UPDATE run_phases SET state = 'under_review', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = (SELECT run_phase_id FROM submissions WHERE id = '${id}')`)
    expect((await detail(id)).canRetry).toBe(true)
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(200)
    expect(retried.json.state).toBe("interview_in_progress")
  })

  it("retry is refused when there is nothing to retry", async () => {
    const out = await submit(call, runId, "p1")
    expect((await call("POST", `/submissions/${String(out.json.submissionId)}/retry`, SARA)).status).toBe(409)
  })

  it("two submissions at the same instant: one wins, the other is refused", async () => {
    const [a, b] = await Promise.all([submit(call, runId, "p1"), submit(call, runId, "p1")])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(rows("SELECT s.id FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId)).toHaveLength(1)
  })
})

describe("the review is grounded in the submission", () => {
  it("drops a quote that is not in the code, and does not count a criterion it was meant to support", async () => {
    fakeAi.behavior.reviewFabricates = true
    const out = await submit(call, runId, "p1")
    const d = await detail(String(out.json.submissionId))
    expect(d.review!.findings[0].anchored).toBe(false)
    expect(d.review!.findings[0].quote).toBe("")
    expect(d.review!.criteria.every((c) => c.status === "unclear")).toBe(true)
    expect(d.review!.criteria[0].note).toMatch(/could not be found in the submission/)
  })

  it("keeps verified quotes and marks criteria met only with one", async () => {
    const out = await submit(call, runId, "p1")
    const d = await detail(String(out.json.submissionId))
    expect(d.review!.findings[0].anchored).toBe(true)
    expect(GOOD_CODE).toContain(d.review!.findings[0].quote)
    expect(d.review!.criteria.some((c) => c.status === "met")).toBe(true)
  })
})

describe("provider fallback", () => {
  it("uses the backup provider when the first one is down, and says which one answered", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key-0123456789"
    const goodFetch = llmDeps.fetch
    llmDeps.fetch = async (url, init) => {
      if (url.includes("generativelanguage")) {
        const body = JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[]; systemInstruction: { parts: { text: string }[] } }
        const out = fakeAi.respond({
          messages: [
            { role: "system", content: body.systemInstruction.parts[0].text },
            { role: "user", content: body.contents[0].parts[0].text },
          ],
          response_format: { json_schema: { name: "challenge" } },
        })
        const text = (out.body as { choices: { message: { content: string } }[] }).choices[0].message.content
        return Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] })
      }
      return new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })
    }
    const created = await call("POST", "/company/challenges", "company:co-nahla", {
      problemDescription: "Build a small tool that sorts support tickets into queues and says why for each one.",
      requiredSkills: ["Python"],
      difficulty: "beginner",
      expectedDeliverables: "A Python script with a short README.",
      timeHours: 4,
    })
    const generated = await call("POST", `/company/challenges/${String(created.json.id)}/generate`, "company:co-nahla", {})
    expect(generated.status).toBe(200)
    const used = rows("SELECT provider, ok FROM ai_calls WHERE purpose = 'challenge_generation' ORDER BY rowid DESC LIMIT 1")
    expect(used).toEqual([{ provider: "gemini", ok: 1 }])
    delete process.env.GEMINI_API_KEY
    llmDeps.fetch = goodFetch
  })

  it("never writes a key into the call log or an error message", async () => {
    fakeAi.behavior.fail = ["submission_review"]
    await submit(call, runId, "p1")
    const log = JSON.stringify(rows("SELECT * FROM ai_calls"))
    expect(log).not.toContain("test-groq-key")
    const sub = rows("SELECT pipeline_error FROM submissions")[0]
    expect(String(sub.pipeline_error)).not.toContain("test-groq-key")
  })
})

describe("“Try again” after the assessment was unavailable", () => {
  // The candidate is on the "Assessment unavailable — nothing has been decided" screen after a completed interview. Clicking
  // "Try again" posts to /submissions/:id/retry. These pin down that the retry runs the assessment again for the SAME
  // submission, keeps every answer, and — when it still can't decide — says so in the response instead of looking like a no-op.
  const submissionsInPhase = () => rows("SELECT s.id FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId).length
  const answersOf = async (id: string) => (await detail(id)).interview!.messages.filter((m) => m.role === "candidate").length

  async function unavailableAfterInterview(): Promise<string> {
    fakeAi.behavior.assessment = "unsupported"
    const out = await submit(call, runId, "p1")
    const id = String(out.json.submissionId)
    await finishInterview(call, id)
    const d = await detail(id)
    expect(d.state).toBe("assessment_unavailable")
    expect(d.interview?.status).toBe("completed")
    expect(d.canRetry).toBe(true)
    return id
  }

  it("still not enough verified evidence: the retry really runs, keeps the work, decides nothing, and says why", async () => {
    const id = await unavailableAfterInterview()
    const answers = await answersOf(id)
    const assessCalls = fakeAi.callsFor("assessment").length

    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(200)
    expect(retried.json.state).toBe("assessment_unavailable")
    expect(String(retried.json.message)).toMatch(/Not enough verified evidence/)
    expect(fakeAi.callsFor("assessment").length).toBeGreaterThan(assessCalls) // the assessor was asked again — not a no-op

    expect(submissionsInPhase()).toBe(1) // no new submission
    expect(await answersOf(id)).toBe(answers) // no interview answer lost or re-asked
    expect(assessmentCount()).toBe(0) // no invented result
    expect((await detail(id)).canRetry).toBe(true) // and it can be tried again
  })

  it("once the evidence can be verified, the same submission is assessed by the normal rule", async () => {
    const id = await unavailableAfterInterview()
    const answers = await answersOf(id)
    fakeAi.behavior.assessment = "strong"
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(200)
    expect(retried.json.state).toBe("passed")
    expect(retried.json.message).toBe("")
    const d = await detail(id)
    expect(d.assessment?.outcome).toBe("passed")
    expect(submissionsInPhase()).toBe(1)
    expect(await answersOf(id)).toBe(answers)
  })

  it("a weak but verifiable assessment is 'not passed yet' — the retry does not turn the rule into a pass", async () => {
    const id = await unavailableAfterInterview()
    fakeAi.behavior.assessment = "weak"
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("failed")
    expect((await detail(id)).assessment?.outcome).toBe("failed")
  })

  it("invalid model output on retry: unavailable again, with an honest message, nothing recorded", async () => {
    const id = await unavailableAfterInterview()
    fakeAi.behavior.assessment = "strong"
    fakeAi.behavior.garbage = ["assessment"]
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(200)
    expect(retried.json.state).toBe("assessment_unavailable")
    expect(String(retried.json.message)).toMatch(/couldn't be validated, so no assessment was made/)
    expect(assessmentCount()).toBe(0)
    expect(submissionsInPhase()).toBe(1)
  })

  it("provider down on retry: unavailable again, the message says the AI service couldn't be reached", async () => {
    const id = await unavailableAfterInterview()
    fakeAi.behavior.fail = ["assessment"]
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("assessment_unavailable")
    expect(String(retried.json.message)).toMatch(/couldn't be reached or returned an error.*nothing has been assessed/)
    expect(assessmentCount()).toBe(0)
  })

  it("rate limited on retry: unavailable again, the message says so", async () => {
    const id = await unavailableAfterInterview()
    llmDeps.fetch = async () => Response.json({ error: { message: "Rate limit reached." } }, { status: 429 })
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.json.state).toBe("assessment_unavailable")
    expect(String(retried.json.message)).toMatch(/too many requests.*nothing has been assessed/)
    expect(assessmentCount()).toBe(0)
  })

  it("no provider configured: the retry is refused with 503 and the reason; the state and answers are untouched", async () => {
    const id = await unavailableAfterInterview()
    const answers = await answersOf(id)
    noAi()
    const retried = await call("POST", `/submissions/${id}/retry`, SARA)
    expect(retried.status).toBe(503)
    expect(String(retried.json.error)).toMatch(/no AI provider is configured.*Your work is saved/)
    expect(phaseState()).toBe("assessment_unavailable")
    expect(await answersOf(id)).toBe(answers)
  })

  it("two retries at once: only one runs, the other is refused", async () => {
    const id = await unavailableAfterInterview()
    // A provider that takes a moment, so the second request arrives while the first is still running.
    const instant = llmDeps.fetch
    llmDeps.fetch = async (url, init) => {
      await new Promise((r) => setTimeout(r, 150))
      return instant(url, init)
    }
    const [a, b] = await Promise.all([call("POST", `/submissions/${id}/retry`, SARA), call("POST", `/submissions/${id}/retry`, SARA)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(submissionsInPhase()).toBe(1)
  })

  it("someone else's submission cannot be retried", async () => {
    const id = await unavailableAfterInterview()
    expect((await call("POST", `/submissions/${id}/retry`, "student:cand-layla")).status).toBe(404)
  })
})
