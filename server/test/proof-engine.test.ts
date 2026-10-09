// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { BRIEF, GOOD_ANSWER, GOOD_CODE, fakeAi, finishInterview, getDb, NAHLA, passPhase, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

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

interface Detail {
  state: string
  stage: string
  pipelineMessage: string
  canRetry: boolean
  problems: string[]
  review: { summary: string; findings: { id: string; quote: string; anchored: boolean }[]; criteria: { status: string; quote: string }[] } | null
  interview: { status: string; answered: number; awaitingAnswer: boolean; messages: { role: string; content: string; isFollowup: boolean; grounding: { kind: string; ref: string } | null }[] } | null
  assessment: { outcome: string; outcomeReason: string; dimensions: { key: string; rating: number; evidence: unknown[] }[]; origin: string } | null
}
const detail = async (submissionId: string, actor = SARA) => (await call("GET", `/submissions/${submissionId}`, actor)).json.submission as Detail
const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]
// (The seed contains labelled demonstration assessments for other candidates; these look only at this run.)
const assessmentsOfRun = () =>
  rows("SELECT a.id FROM assessments a JOIN submissions s ON s.id = a.submission_id JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId)
const submissionsOfRun = () => rows("SELECT s.id FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId)

describe("the Proof Engine, end to end", () => {
  it("reviews the work, interviews the candidate, then assesses — and only then passes the phase", async () => {
    const out = await submit(call, runId, "p1")
    expect(out.status).toBe(200)
    const submissionId = String(out.json.submissionId)

    // Before the interview: reviewed, being interviewed, and NO decision exists.
    expect(out.json.state).toBe("interview_in_progress")
    const mid = await detail(submissionId)
    expect(mid.review?.summary).toBeTruthy()
    expect(mid.interview?.awaitingAnswer).toBe(true)
    expect(mid.assessment).toBeNull()
    expect(assessmentsOfRun()).toEqual([])

    await finishInterview(call, submissionId)
    const done = await detail(submissionId)
    expect(done.state).toBe("passed")
    expect(done.interview?.status).toBe("completed")
    expect(done.assessment?.outcome).toBe("passed")
    // Three separate dimensions, each with verified evidence.
    expect(done.assessment?.dimensions.map((d) => d.key)).toEqual(["correctness", "code_quality", "understanding"])
    for (const d of done.assessment!.dimensions) expect(d.evidence.length).toBeGreaterThan(0)
  })

  it("asks open-ended, grounded questions, never multiple choice, and never the same one twice", async () => {
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    await finishInterview(call, submissionId)
    const interview = (await detail(submissionId)).interview!
    const questions = interview.messages.filter((m) => m.role === "interviewer")
    expect(questions.length).toBeGreaterThanOrEqual(3)
    expect(new Set(questions.map((q) => q.content)).size).toBe(questions.length)
    for (const q of questions) {
      expect(q.content).not.toMatch(/which of the following|true or false|choose one/i)
      expect(q.grounding).not.toBeNull()
    }
    // The first question is about the candidate's own code.
    expect(questions[0].grounding?.kind).toBe("code")
    expect(questions[0].content).toContain("`")
  })

  it("follows up when an answer is vague, then moves on", async () => {
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    await call("POST", `/submissions/${submissionId}/answer`, SARA, { answer: "it just works" })
    const after = await detail(submissionId)
    const second = after.interview!.messages.filter((m) => m.role === "interviewer")[1]
    expect(second.isFollowup).toBe(true)
    expect(second.grounding?.kind).toBe("answer")
  })

  it("will not accept an answer out of turn, or after the interview has ended", async () => {
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    expect((await call("POST", `/submissions/${submissionId}/answer`, SARA, { answer: "" })).status).toBe(400)
    await finishInterview(call, submissionId)
    expect((await call("POST", `/submissions/${submissionId}/answer`, SARA, { answer: GOOD_ANSWER })).status).toBe(409)
  })

  it("fails a phase whose work or understanding is weak — with reasons — and keeps the next phase locked until it passes", async () => {
    fakeAi.behavior.assessment = "weak"
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    await finishInterview(call, submissionId)
    const d = await detail(submissionId)
    expect(d.state).toBe("failed")
    expect(d.assessment?.outcome).toBe("failed")
    expect(d.assessment?.outcomeReason).toMatch(/not passed yet/i)

    // Strict sequential progression (an intentional change: a failed phase used to open the next one).
    const run = (await call("GET", `/work/${runId}`, SARA)).json.run as { phases: { key: string; available: boolean; state: string }[] }
    expect(run.phases.find((p) => p.key === "p2")!.available).toBe(false)
    expect(run.phases.find((p) => p.key === "p1")!.state).toBe("failed")
    expect((await submit(call, runId, "p2")).status).toBe(409)

    // Passing phase 1 on a new attempt opens phase 2.
    fakeAi.behavior.assessment = "strong"
    expect((await passPhase(call, runId, "p1")).detail.state).toBe("passed")
    expect((await submit(call, runId, "p2")).status).toBe(200)
  })

  it("cannot submit the complete solution while any phase has not passed, but can once every one has", async () => {
    await passPhase(call, runId, "p1")
    await passPhase(call, runId, "p2")
    fakeAi.behavior.assessment = "weak"
    await passPhase(call, runId, "p3") // fails

    const blocked = await call("POST", `/work/${runId}/complete`, SARA, {})
    expect(blocked.status).toBe(409)
    expect(String(blocked.json.error)).toMatch(/Every phase must pass/)
    expect(JSON.stringify(blocked.json.detail)).toMatch(/Test and explain/)
    expect(rows("SELECT status FROM runs WHERE id = ?", runId)[0].status).toBe("in_progress")

    // Retrying the failed phase and passing it completes the requirement.
    fakeAi.behavior.assessment = "strong"
    const retry = await passPhase(call, runId, "p3")
    expect(retry.detail.state).toBe("passed")
    const ok = await call("POST", `/work/${runId}/complete`, SARA, { note: "Done." })
    expect(ok.status).toBe(200)
    expect(rows("SELECT status FROM runs WHERE id = ?", runId)[0].status).toBe("completed")
  })

  it("keeps every attempt: a resubmission never overwrites an earlier one", async () => {
    fakeAi.behavior.assessment = "weak"
    const first = await passPhase(call, runId, "p1")
    fakeAi.behavior.assessment = "strong"
    const second = await passPhase(call, runId, "p1")
    expect(second.submissionId).not.toBe(first.submissionId)
    const attempts = (await call("GET", `/work/${runId}/phases/p1/attempts`, SARA)).json.attempts as { attempt: number; outcome: string | null }[]
    expect(attempts.map((a) => [a.attempt, a.outcome])).toEqual([
      [2, "passed"],
      [1, "failed"],
    ])
    // The first attempt's review, interview and assessment are all still there.
    const old = await detail(first.submissionId)
    expect(old.assessment?.outcome).toBe("failed")
    expect(old.interview?.messages.length).toBeGreaterThan(0)
  })

  it("will not accept a new submission for a phase that has passed, or one still being interviewed", async () => {
    const out = await submit(call, runId, "p1")
    expect((await submit(call, runId, "p1")).status).toBe(409) // interview in progress
    await finishInterview(call, String(out.json.submissionId))
    const again = await submit(call, runId, "p1")
    expect(again.status).toBe(409)
    expect(String(again.json.error)).toMatch(/already passed/)
  })

  it("enforces the phase order on the server", async () => {
    const early = await submit(call, runId, "p2")
    expect(early.status).toBe(409)
    expect(String(early.json.error)).toMatch(/locked until you pass “Plan the approach”/)
    expect(submissionsOfRun()).toEqual([])
  })

  it("records skill evidence from an assessment", async () => {
    await passPhase(call, runId, "p1")
    const ev = rows("SELECT skill, state FROM skill_evidence WHERE run_id = ? ORDER BY skill", runId)
    expect(ev.map((e) => e.skill)).toEqual(expect.arrayContaining(["Python", "Software Testing"]))
    expect(ev.every((e) => e.state === "demonstrated")).toBe(true)
  })

  it("opens a failed phase's improvement plan: skill gaps tied to the submission", async () => {
    fakeAi.behavior.assessment = "weak"
    await passPhase(call, runId, "p1")
    const gaps = (await call("GET", "/learning", SARA)).json.gaps as { skill: string; title: string; resolved: boolean }[]
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].resolved).toBe(false)
  })
})

describe("strict sequential progression (through the API)", () => {
  interface PhaseView { key: string; available: boolean; state: string; blockedBy: { key: string; title: string }[] }
  const phasesOf = async () => ((await call("GET", `/work/${runId}`, SARA)).json.run as { phases: PhaseView[] }).phases
  const openKeys = async () => (await phasesOf()).filter((p) => p.available).map((p) => p.key)
  const state = (key: string) => String(rows("SELECT rp.state FROM run_phases rp JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = ?", runId, key)[0].state)
  const subsOf = (key: string) => rows("SELECT s.id FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = ?", runId, key)

  it("phase 1 is open at the start; phase 2 waits for phase 1 and phase 3 waits for phase 2 — each to PASS", async () => {
    expect(await openKeys()).toEqual(["p1"])
    expect((await phasesOf()).find((p) => p.key === "p3")!.blockedBy.map((b) => b.key)).toEqual(["p1", "p2"])
    await passPhase(call, runId, "p1")
    expect(await openKeys()).toEqual(["p1", "p2"])
    await passPhase(call, runId, "p2")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
  })

  it("starting, submitting and being interviewed on phase 2 does not open phase 3", async () => {
    await passPhase(call, runId, "p1")
    expect((await call("POST", `/work/${runId}/phases/p2/start`, SARA)).status).toBe(200)
    expect(await openKeys()).toEqual(["p1", "p2"])
    const out = await submit(call, runId, "p2")
    expect(out.json.state).toBe("interview_in_progress")
    await call("POST", `/submissions/${String(out.json.submissionId)}/answer`, SARA, { answer: GOOD_ANSWER })
    expect(await openKeys()).toEqual(["p1", "p2"])
    expect((await submit(call, runId, "p3")).status).toBe(409)
  })

  it("a failed assessment does not open the next phase; a later passing attempt does", async () => {
    await passPhase(call, runId, "p1")
    fakeAi.behavior.assessment = "weak"
    expect((await passPhase(call, runId, "p2")).detail.state).toBe("failed")
    expect(await openKeys()).toEqual(["p1", "p2"])
    fakeAi.behavior.assessment = "strong"
    expect((await passPhase(call, runId, "p2")).detail.state).toBe("passed")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
  })

  it("an unavailable assessment — and a retry that fails again — does not open the next phase; a retry that passes does", async () => {
    await passPhase(call, runId, "p1")
    fakeAi.behavior.fail = ["assessment"]
    const out = await submit(call, runId, "p2")
    const id = String(out.json.submissionId)
    await finishInterview(call, id)
    expect(state("p2")).toBe("assessment_unavailable")
    expect(await openKeys()).toEqual(["p1", "p2"])

    expect((await call("POST", `/submissions/${id}/retry`, SARA)).json.state).toBe("assessment_unavailable") // still down
    expect(await openKeys()).toEqual(["p1", "p2"])

    fakeAi.behavior.fail = []
    expect((await call("POST", `/submissions/${id}/retry`, SARA)).json.state).toBe("passed")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
  })

  it("rejects direct API attempts to start or submit a locked phase, whatever the payload says, and changes nothing", async () => {
    await passPhase(call, runId, "p1") // p2 open, p3 locked
    const before = state("p3")
    const tries = [
      await call("POST", `/work/${runId}/phases/p3/start`, SARA, { force: true, state: "passed" }),
      await submit(call, runId, "p3"),
      await submit(call, runId, "p3", { code: GOOD_CODE, language: "Python", phaseKey: "p2", available: true, state: "passed" }),
    ]
    for (const t of tries) {
      expect(t.status).toBe(409)
      expect(String(t.json.error)).toMatch(/locked until you pass “Build the core”/)
    }
    expect(state("p3")).toBe(before)
    expect(subsOf("p3")).toEqual([])
    // An unknown phase is "not found", not a way round the rule.
    expect((await submit(call, runId, "p9")).status).toBe(404)
  })

  it("freezes — never resets — a phase whose earlier phase is no longer passed (work begun under the old rule)", async () => {
    await passPhase(call, runId, "p1")
    await passPhase(call, runId, "p2")
    const out = await submit(call, runId, "p3")
    const id = String(out.json.submissionId)
    // Recreate a run from the old rule: phase 2 only failed, yet phase 3 was opened and is mid-interview.
    getDb().prepare("UPDATE run_phases SET state = 'failed' WHERE run_id = ? AND phase_id = (SELECT id FROM phases WHERE key = 'p2' AND version_id = (SELECT version_id FROM runs WHERE id = ?))").run(runId, runId)
    const kept = (await detail(id)).interview!.messages.length

    const view = (await phasesOf()).find((p) => p.key === "p3")!
    expect(view.available).toBe(false)
    expect(view.state).toBe("interview_in_progress") // its state and work are kept
    const answer = await call("POST", `/submissions/${id}/answer`, SARA, { answer: GOOD_ANSWER })
    expect(answer.status).toBe(409)
    expect(String(answer.json.error)).toMatch(/locked until you pass “Build the core”.*saved and continues/)
    expect((await call("POST", `/submissions/${id}/retry`, SARA)).status).toBe(409)
    expect((await detail(id)).canRetry).toBe(false)
    expect((await detail(id)).interview!.messages.length).toBe(kept)

    // Once phase 2 passes again, phase 3 continues exactly where it stopped.
    getDb().prepare("UPDATE run_phases SET state = 'passed' WHERE run_id = ? AND phase_id = (SELECT id FROM phases WHERE key = 'p2' AND version_id = (SELECT version_id FROM runs WHERE id = ?))").run(runId, runId)
    expect((await call("POST", `/submissions/${id}/answer`, SARA, { answer: GOOD_ANSWER })).status).toBe(200)
  })

  it("cannot be completed while any phase is unpassed — even with every phase open", async () => {
    await passPhase(call, runId, "p1")
    await passPhase(call, runId, "p2")
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(409) // p3 open but not passed
    await passPhase(call, runId, "p3")
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(200)
  })
})

describe("what the company sees", () => {
  it("only the work the candidate shared with the challenge's company", async () => {
    await passPhase(call, runId, "p1")
    const list = await call("GET", `/company/challenges/${challengeId}/participants`, NAHLA)
    const participants = list.json.participants as { runId: string; candidate: { name: string } }[]
    expect(participants).toHaveLength(1)
    const run = participants[0].runId
    const full = await call("GET", `/company/challenges/${challengeId}/participants/${run}`, NAHLA)
    expect(full.status).toBe(200)

    // The candidate withdraws the sharing: the company can no longer see them.
    await call("POST", `/work/${run}/share`, SARA, { scope: "private" })
    const after = await call("GET", `/company/challenges/${challengeId}/participants`, NAHLA)
    expect(after.json.participants).toEqual([])
    expect(after.json.privateCount).toBe(1)
    expect((await call("GET", `/company/challenges/${challengeId}/participants/${run}`, NAHLA)).status).toBe(404)
  })

  it("brief text used in these tests is the five-field brief", () => {
    expect(Object.keys(BRIEF).sort()).toEqual(["difficulty", "expectedDeliverables", "problemDescription", "requiredSkills", "timeHours"])
    expect(GOOD_CODE).toContain("route_ticket")
  })
})
