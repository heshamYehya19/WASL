// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { finishInterview, getDb, GOOD_CODE, LAYLA, NAHLA, ORBIT, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

// A company reviewing the solutions candidates submitted to ITS challenge:
//   GET /company/challenges/:challengeId/participants                         who shared their work, and their phases
//   GET /company/challenges/:challengeId/participants/:runId                  one candidate's run, with every attempt per phase
//   GET /company/challenges/:challengeId/participants/:runId/submissions/:id  one submitted solution, read-only
// Every request is checked on the server: the company must own the challenge, the run must be on that challenge and shared
// with it, and the submission must belong to that run. Anything else is "not found", whatever ids the URL carries.

const server = await startServer()
const call = server.call
afterAll(() => server.close())

const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]
const base = (challengeId: string, runId: string) => `/company/challenges/${challengeId}/participants/${runId}`

let challengeId: string
let runId: string
let p1: string
beforeEach(async () => {
  resetDatabase()
  useFakeAi()
  challengeId = await publishChallenge(call)
  runId = await startRun(call, challengeId)
  p1 = String((await submit(call, runId, "p1")).json.submissionId)
  await finishInterview(call, p1)
})

interface Solution {
  id: string
  attempt: number
  createdAt: string
  stage: string
  state: string
  phase: { key: string; title: string }
  language: string
  canRetry: boolean
  artifacts: { path: string; source: string; content: string }[]
  review: { findings: Record<string, unknown>[]; criteria: Record<string, unknown>[] } | null
  interview: { messages: { role: string; content: string; grounding: Record<string, unknown> | null }[] } | null
  assessment: { outcome: string } | null
}

describe("the owning company can review a submitted solution", () => {
  it("returns the actual stored solution, tied to its phase, attempt, stage and time", async () => {
    const res = await call("GET", `${base(challengeId, runId)}/submissions/${p1}`, NAHLA)
    expect(res.status).toBe(200)
    const s = res.json.submission as Solution
    const stored = rows("SELECT code_text, attempt, stage, created_at, language FROM submissions WHERE id = ?", p1)[0]
    expect(s.id).toBe(p1)
    expect(s.phase.key).toBe("p1")
    expect(s.attempt).toBe(stored.attempt)
    expect(s.stage).toBe(stored.stage)
    expect(s.createdAt).toBe(stored.created_at)
    expect(s.language).toBe(stored.language)
    expect(s.artifacts.map((a) => a.content).join("\n")).toContain("def route_ticket")
    expect(String(stored.code_text)).toContain(s.artifacts[0].content.trim().split("\n")[0])
    expect(s.assessment?.outcome).toBe("passed")
    expect(s.canRetry).toBe(false) // read-only: no actions for the company
  })

  it("lists only that candidate's attempts under the right phases", async () => {
    const p2 = String((await submit(call, runId, "p2")).json.submissionId)
    const res = await call("GET", base(challengeId, runId), NAHLA)
    expect(res.status).toBe(200)
    const phases = (res.json.run as { phases: { key: string; attemptList: { id: string }[] }[] }).phases
    expect(phases.find((p) => p.key === "p1")!.attemptList.map((a) => a.id)).toEqual([p1])
    expect(phases.find((p) => p.key === "p2")!.attemptList.map((a) => a.id)).toEqual([p2])
    expect(phases.find((p) => p.key === "p3")!.attemptList).toEqual([]) // nothing submitted, nothing shown
    // Each solution reports its own phase, whichever phase card it was opened from.
    expect(((await call("GET", `${base(challengeId, runId)}/submissions/${p2}`, NAHLA)).json.submission as Solution).phase.key).toBe("p2")
  })

  it("a submission turned away by the checks is shown as such, not as a reviewed solution", async () => {
    const run = await startRun(call, challengeId, LAYLA)
    const rejected = String((await submit(call, run, "p1", { code: "# nothing here yet\n\n# TODO\n", language: "Python" }, LAYLA)).json.submissionId)
    const s = (await call("GET", `${base(challengeId, run)}/submissions/${rejected}`, NAHLA)).json.submission as Solution & { problems: string[] }
    expect(s.stage).toBe("rejected")
    expect(s.state).toBe("revision_needed")
    expect(s.problems.length).toBeGreaterThan(0)
    expect(s.review).toBeNull()
    expect(s.assessment).toBeNull()
  })
})

describe("nobody else can reach it", () => {
  it("another company gets 'not found' for the list, the run and the solution", async () => {
    for (const path of [`/company/challenges/${challengeId}/participants`, base(challengeId, runId), `${base(challengeId, runId)}/submissions/${p1}`]) {
      expect((await call("GET", path, ORBIT)).status, path).toBe(404)
    }
  })

  it("another company can't reach it through ITS OWN challenge id either", async () => {
    const orbitChallenge = await publishChallenge(call, ORBIT)
    expect((await call("GET", base(orbitChallenge, runId), ORBIT)).status).toBe(404)
    expect((await call("GET", `${base(orbitChallenge, runId)}/submissions/${p1}`, ORBIT)).status).toBe(404)
  })

  it("signed-out requests are refused (401), and student accounts — even the author — are refused (403)", async () => {
    const path = `${base(challengeId, runId)}/submissions/${p1}`
    expect((await call("GET", path)).status).toBe(401)
    expect((await call("GET", path, "company:does-not-exist")).status).toBe(401)
    expect((await call("GET", path, SARA)).status).toBe(403)
    expect((await call("GET", path, LAYLA)).status).toBe(403)
  })

  it("swapping ids in the URL can't bypass the checks", async () => {
    // Same company, its other challenge: the run belongs to the first one.
    const second = await publishChallenge(call)
    expect((await call("GET", base(second, runId), NAHLA)).status).toBe(404)
    expect((await call("GET", `${base(second, runId)}/submissions/${p1}`, NAHLA)).status).toBe(404)
    // Another candidate's submission on the same challenge, through this candidate's run.
    const laylaRun = await startRun(call, challengeId, LAYLA)
    const laylaSub = String((await submit(call, laylaRun, "p1", undefined, LAYLA)).json.submissionId)
    expect((await call("GET", `${base(challengeId, runId)}/submissions/${laylaSub}`, NAHLA)).status).toBe(404)
    // A candidate id where a run id belongs, and a private practice run's id.
    expect((await call("GET", base(challengeId, "cand-sara"), NAHLA)).status).toBe(404)
    const practice = String((await call("POST", "/practice", SARA, { skills: ["Python"], difficulty: "beginner" })).json.runId)
    const practiceSub = String((await submit(call, practice, "p1")).json.submissionId)
    expect((await call("GET", base(challengeId, practice), NAHLA)).status).toBe(404)
    expect((await call("GET", `${base(challengeId, runId)}/submissions/${practiceSub}`, NAHLA)).status).toBe(404)
  })

  it("work the candidate keeps private, or stops sharing, is not exposed", async () => {
    await call("POST", `/work/${runId}/share`, SARA, { scope: "private" })
    expect((await call("GET", base(challengeId, runId), NAHLA)).status).toBe(404)
    expect((await call("GET", `${base(challengeId, runId)}/submissions/${p1}`, NAHLA)).status).toBe(404)
  })

  it("a missing or malformed id is a plain 'not found' that names no other record", async () => {
    for (const id of ["sub-does-not-exist", "x", "%27%20OR%201%3D1--"]) {
      const res = await call("GET", `${base(challengeId, runId)}/submissions/${id}`, NAHLA)
      expect(res.status, id).toBe(404)
      expect(Object.keys(res.json)).toEqual(["error"])
      expect(JSON.stringify(res.json)).not.toMatch(/route_ticket|cand-|run-|sub-[0-9a-f]/)
    }
    expect((await call("GET", base(challengeId, "run-missing"), NAHLA)).status).toBe(404)
  })
})

describe("what stays private", () => {
  it("no prompts, keys, hashes or internal fields — only the named fields the review page uses", async () => {
    const res = await call("GET", `${base(challengeId, runId)}/submissions/${p1}`, NAHLA)
    const text = JSON.stringify(res.json)
    for (const secret of ["You are the", "Return only the JSON", "test-groq-key", "inputHash", "input_hash", "answerQuality", "untrusted_data", "Authorization"]) {
      expect(text, secret).not.toContain(secret)
    }
    const s = res.json.submission as Solution
    expect(Object.keys(s.review!.findings[0]).sort()).toEqual(["anchored", "detail", "id", "line", "path", "quote", "severity", "title"])
    expect(Object.keys(s.review!.criteria[0]).sort()).toEqual(["criterionId", "line", "note", "path", "quote", "status", "text"])
    for (const m of s.interview!.messages) if (m.grounding) expect(Object.keys(m.grounding).sort()).toEqual(["kind", "line", "path", "quote", "ref", "why"])
  })
})

describe("reviewing changes nothing", () => {
  it("opening the list, the run and every attempt leaves status, outcomes, evidence, progression and completion as they were", async () => {
    const snapshot = () =>
      JSON.stringify({
        submissions: rows("SELECT id, stage, pipeline_error, attempt FROM submissions ORDER BY id"),
        phases: rows("SELECT id, state, attempts, updated_at FROM run_phases ORDER BY id"),
        runs: rows("SELECT id, status, share_scope, completed_at FROM runs ORDER BY id"),
        assessments: rows("SELECT id, outcome FROM assessments ORDER BY id"),
        evidence: rows("SELECT id, state FROM skill_evidence ORDER BY id"),
        notifications: rows("SELECT COUNT(*) AS n FROM notifications"),
        aiCalls: rows("SELECT COUNT(*) AS n FROM ai_calls"),
      })
    const before = snapshot()
    await call("GET", `/company/challenges/${challengeId}/participants`, NAHLA)
    await call("GET", base(challengeId, runId), NAHLA)
    for (let i = 0; i < 3; i++) await call("GET", `${base(challengeId, runId)}/submissions/${p1}`, NAHLA)
    expect(snapshot()).toBe(before)
  })

  it("there is no way to write through it: other methods aren't routes, and student actions refuse a company", async () => {
    const path = `${base(challengeId, runId)}/submissions/${p1}`
    for (const method of ["POST", "PUT", "DELETE"]) expect((await call(method, path, NAHLA, { code: "x" })).status, method).toBe(404)
    expect((await call("POST", `/submissions/${p1}/answer`, NAHLA, { answer: "an answer the company wrote" })).status).toBe(403)
    expect((await call("POST", `/submissions/${p1}/retry`, NAHLA)).status).toBe(403)
    expect((await call("GET", `/submissions/${p1}`, NAHLA)).status).toBe(403)
    expect(String(rows("SELECT code_text FROM submissions WHERE id = ?", p1)[0].code_text)).toContain(GOOD_CODE.split("\n")[0])
  })
})
