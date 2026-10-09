// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { BRIEF, GOOD_ANSWER, GOOD_CODE, fakeAi, finishInterview, getDb, NAHLA, OMAR, passPhase, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

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

  it("fails a phase whose work or understanding is weak — with reasons — and the next phase stays open (it was submitted)", async () => {
    fakeAi.behavior.assessment = "weak"
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    await finishInterview(call, submissionId)
    const d = await detail(submissionId)
    expect(d.state).toBe("failed")
    expect(d.assessment?.outcome).toBe("failed")
    expect(d.assessment?.outcomeReason).toMatch(/not passed yet/i)

    // Sequential SUBMISSION unlock: phase 1 has a recorded submission, so phase 2 is open even though phase 1 did not pass.
    const run = (await call("GET", `/work/${runId}`, SARA)).json.run as { phases: { key: string; available: boolean; state: string }[] }
    expect(run.phases.find((p) => p.key === "p2")!.available).toBe(true)
    expect(run.phases.find((p) => p.key === "p1")!.state).toBe("failed")
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
    expect(String(early.json.error)).toMatch(/opens once you submit “Plan the approach”/)
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

describe("sequential submission unlock (through the API)", () => {
  interface PhaseView { key: string; available: boolean; state: string; blockedBy: { key: string; title: string }[] }
  const phasesOf = async (run = runId, actor = SARA) => ((await call("GET", `/work/${run}`, actor)).json.run as { phases: PhaseView[] }).phases
  const openKeys = async (run = runId, actor = SARA) => (await phasesOf(run, actor)).filter((p) => p.available).map((p) => p.key)
  const state = (key: string) => String(rows("SELECT rp.state FROM run_phases rp JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = ?", runId, key)[0].state)
  const subsOf = (key: string) => rows("SELECT s.id, s.stage FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = ?", runId, key)
  const COMMENTS_ONLY = { code: "# nothing here yet\n\n# TODO\n" } // saved, but rejected by the deterministic checks

  it("1. phase 1 is open at the start and phase 3 is locked before phase 2 has a recorded submission", async () => {
    expect(await openKeys()).toEqual(["p1"])
    await submit(call, runId, "p1")
    expect(await openKeys()).toEqual(["p1", "p2"])
    const p3 = (await phasesOf()).find((p) => p.key === "p3")!
    expect(p3).toMatchObject({ available: false, blockedBy: [{ key: "p2", title: "Build the core" }] })
    // Starting phase 2, or an attempt the checks reject, is not a recorded submission.
    expect((await call("POST", `/work/${runId}/phases/p2/start`, SARA)).status).toBe(200)
    expect(await openKeys()).toEqual(["p1", "p2"])
    expect((await submit(call, runId, "p2", COMMENTS_ONLY)).json).toMatchObject({ rejected: true, state: "revision_needed" })
    expect(subsOf("p2")).toEqual([expect.objectContaining({ stage: "rejected" })])
    expect(await openKeys()).toEqual(["p1", "p2"])
    // An attempt that is refused before it is saved leaves no row and unlocks nothing either.
    expect((await submit(call, runId, "p2", {})).status).toBe(400)
    expect(await openKeys()).toEqual(["p1", "p2"])
  })

  it("2. recording a phase 2 submission opens phase 3 while its review and interview are still pending", async () => {
    await submit(call, runId, "p1")
    const out = await submit(call, runId, "p2")
    expect(out.json.state).toBe("interview_in_progress") // nothing assessed yet
    expect(subsOf("p2")).toEqual([expect.objectContaining({ stage: "interviewing" })])
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    expect((await submit(call, runId, "p3")).status).toBe(200)
  })

  it("3. a failed phase 2 assessment does not relock phase 3", async () => {
    await submit(call, runId, "p1")
    fakeAi.behavior.assessment = "weak"
    expect((await passPhase(call, runId, "p2")).detail.state).toBe("failed")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    // …and a later rejected resubmission of phase 2 does not take it away: the earlier valid one is still recorded.
    expect((await submit(call, runId, "p2", COMMENTS_ONLY)).json.state).toBe("revision_needed")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    expect((await submit(call, runId, "p3")).status).toBe(200)
  })

  it("4. an unavailable phase 2 assessment (review or assessment outage, or a failed retry) does not relock phase 3", async () => {
    await submit(call, runId, "p1")
    fakeAi.behavior.fail = ["submission_review"]
    const out = await submit(call, runId, "p2") // saved, then the review fails
    const id = String(out.json.submissionId)
    expect(out.json.state).toBe("assessment_unavailable")
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    expect((await call("POST", `/submissions/${id}/retry`, SARA)).json.state).toBe("assessment_unavailable") // still down
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    // Nothing was decided and nothing was invented.
    expect(rows("SELECT id FROM assessments WHERE submission_id = ?", id)).toEqual([])
    expect(state("p2")).toBe("assessment_unavailable")
  })

  it("5. direct API requests cannot skip submitting the previous phase, whatever the payload says, and change nothing", async () => {
    await submit(call, runId, "p1") // p2 open, p3 locked
    const before = state("p3")
    const tries = [
      await call("POST", `/work/${runId}/phases/p3/start`, SARA, { force: true, state: "passed" }),
      await submit(call, runId, "p3"),
      await submit(call, runId, "p3", { code: GOOD_CODE, language: "Python", phaseKey: "p2", available: true, submitted: true }),
    ]
    for (const t of tries) {
      expect(t.status).toBe(409)
      expect(String(t.json.error)).toMatch(/opens once you submit “Build the core”/)
    }
    expect(state("p3")).toBe(before)
    expect(subsOf("p3")).toEqual([])
    expect((await submit(call, runId, "p9")).status).toBe(404) // an unknown phase is "not found", not a way round the rule
  })

  it("5b. a phase recorded under an older rule without its predecessor's submission is frozen for answers and retries, then resumes", async () => {
    await submit(call, runId, "p1")
    await submit(call, runId, "p2")
    const out = await submit(call, runId, "p3")
    const id = String(out.json.submissionId)
    // Recreate an anomalous old run: phase 2's only submission was rejected, yet phase 3 has work mid-interview.
    const setP2 = (stage: string) => getDb().prepare("UPDATE submissions SET stage = ? WHERE run_phase_id = (SELECT rp.id FROM run_phases rp JOIN phases p ON p.id = rp.phase_id WHERE rp.run_id = ? AND p.key = 'p2')").run(stage, runId)
    setP2("rejected")
    const kept = (await detail(id)).interview!.messages.length
    expect((await phasesOf()).find((p) => p.key === "p3")).toMatchObject({ available: false, state: "interview_in_progress" })
    const answer = await call("POST", `/submissions/${id}/answer`, SARA, { answer: GOOD_ANSWER })
    expect(answer.status).toBe(409)
    expect(String(answer.json.error)).toMatch(/opens once you submit “Build the core”.*saved and continues/)
    expect((await call("POST", `/submissions/${id}/retry`, SARA)).status).toBe(409)
    expect((await detail(id)).canRetry).toBe(false)
    expect((await detail(id)).interview!.messages.length).toBe(kept) // frozen, not reset
    setP2("interviewing")
    expect((await call("POST", `/submissions/${id}/answer`, SARA, { answer: GOOD_ANSWER })).status).toBe(200)
  })

  it("6. opening phases never completes the challenge: every phase open and submitted, but completion still needs every pass", async () => {
    fakeAi.behavior.assessment = "weak"
    for (const k of ["p1", "p2", "p3"]) await passPhase(call, runId, k) // all submitted, all not passed
    expect(await openKeys()).toEqual(["p1", "p2", "p3"])
    const run = (await call("GET", `/work/${runId}`, SARA)).json.run as { progress: { passed: number; complete: boolean }; canComplete: boolean; status: string }
    expect(run).toMatchObject({ progress: { passed: 0, complete: false }, canComplete: false, status: "in_progress" })
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(409)
    fakeAi.behavior.assessment = "strong"
    for (const k of ["p1", "p2", "p3"]) await passPhase(call, runId, k)
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(200)
  })

  it("7. holds for every phase of a five-phase challenge", async () => {
    // A company edits a generated challenge to five phases (within the 3–5 rule), reviews and publishes it.
    const created = String((await call("POST", "/company/challenges", NAHLA, BRIEF)).json.id)
    await call("POST", `/company/challenges/${created}/generate`, NAHLA, {})
    const spec = ((await call("GET", `/company/challenges/${created}`, NAHLA)).json.challenge as { current: { spec: { phases: Record<string, unknown>[] } } }).current.spec
    while (spec.phases.length < 5) {
      const k = spec.phases.length + 1
      spec.phases.push({ ...structuredClone(spec.phases[spec.phases.length - 1]), key: `p${k}`, title: `Extend it, part ${k}`, dependsOn: [`p${k - 1}`] })
    }
    expect((await call("PUT", `/company/challenges/${created}/version`, NAHLA, spec)).status).toBe(200)
    await call("POST", `/company/challenges/${created}/review`, NAHLA)
    expect((await call("POST", `/company/challenges/${created}/publish`, NAHLA, { acknowledgeEvaluationUse: true })).status).toBe(200)
    const five = await startRun(call, created, OMAR)

    const keys = ["p1", "p2", "p3", "p4", "p5"]
    for (let n = 0; n < keys.length; n++) {
      expect(await openKeys(five, OMAR), `after ${n} submissions`).toEqual(keys.slice(0, n + 1))
      if (n + 1 < keys.length) expect((await submit(call, five, keys[n + 1], undefined, OMAR)).status, `${keys[n + 1]} before ${keys[n]}`).toBe(409)
      // Each phase is only submitted — every assessment is still pending — and that alone opens the next one.
      expect((await submit(call, five, keys[n], undefined, OMAR)).json.state).toBe("interview_in_progress")
    }
    expect(await openKeys(five, OMAR)).toEqual(keys)
    expect(rows("SELECT a.id FROM assessments a JOIN submissions s ON s.id = a.submission_id JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", five)).toEqual([])
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
