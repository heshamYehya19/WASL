// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { fakeAi, finishInterview, getDb, LAYLA, NAHLA, OMAR, ORBIT, passPhase, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

// Authorization is enforced on the server for every route, from the account the request resolves to — never from ids in a
// request body, and never from what the page chooses to show.

const server = await startServer()
const call = server.call
afterAll(() => server.close())

let challengeId: string
let runId: string
let submissionId: string
beforeEach(async () => {
  resetDatabase()
  useFakeAi()
  challengeId = await publishChallenge(call)
  runId = await startRun(call, challengeId)
  const out = await submit(call, runId, "p1")
  submissionId = String(out.json.submissionId)
})

const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]

describe("signing in", () => {
  it("treats a missing, malformed or unknown account as signed out", async () => {
    for (const actor of [undefined, "", "student", "student:", "admin:cand-sara", "student:does-not-exist", "company:cand-sara", "student:co-nahla"]) {
      const res = await call("GET", "/work", actor)
      expect(res.status, String(actor)).toBe(401)
    }
  })

  it("an account that is deleted stops working", async () => {
    getDb().exec("PRAGMA foreign_keys = OFF")
    getDb().exec("DELETE FROM candidates WHERE id = 'cand-omar'")
    getDb().exec("PRAGMA foreign_keys = ON")
    expect((await call("GET", "/work", OMAR)).status).toBe(401)
  })

  it("keeps the two kinds of account apart", async () => {
    expect((await call("GET", "/work", NAHLA)).status).toBe(403)
    expect((await call("GET", "/profile", NAHLA)).status).toBe(403)
    expect((await call("GET", "/learning", NAHLA)).status).toBe(403)
    expect((await call("GET", "/company/challenges", SARA)).status).toBe(403)
    expect((await call("GET", "/talent", SARA)).status).toBe(403)
    expect((await call("POST", `/company/challenges/${challengeId}/archive`, SARA)).status).toBe(403)
  })

  it("the health and demo-account endpoints need no sign-in; everything else does", async () => {
    expect((await call("GET", "/health")).status).toBe(200)
    expect((await call("GET", "/demo-accounts")).status).toBe(200)
    for (const [method, path] of [["GET", "/challenges"], ["GET", "/profile"], ["GET", "/talent"], ["GET", "/company/me"], ["GET", "/notifications"], ["POST", "/practice"]] as const) {
      expect((await call(method, path)).status, path).toBe(401)
    }
  })

  it("never lists secrets", async () => {
    const health = JSON.stringify((await call("GET", "/health")).json)
    expect(health).not.toContain("test-groq-key")
  })
})

describe("one candidate cannot reach another's work", () => {
  it("runs, submissions, answers, retries and sharing all answer 'not found'", async () => {
    const probes: [string, string, unknown?][] = [
      ["GET", `/work/${runId}`],
      ["GET", `/work/${runId}/phases/p1/attempts`],
      ["POST", `/work/${runId}/phases/p1/start`],
      ["POST", `/work/${runId}/phases/p1/submissions`, { code: "def f():\n    return 1 + 1\n" }],
      ["POST", `/work/${runId}/share`, { scope: "employers" }],
      ["POST", `/work/${runId}/complete`, {}],
      ["GET", `/submissions/${submissionId}`],
      ["POST", `/submissions/${submissionId}/answer`, { answer: "an answer from the wrong person" }],
      ["POST", `/submissions/${submissionId}/retry`],
    ]
    for (const [method, path, body] of probes) {
      const res = await call(method, path, LAYLA, body)
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    // And nothing changed.
    expect(rows("SELECT role FROM interview_messages WHERE role = 'candidate'")).toEqual([])
    expect(rows("SELECT share_scope FROM runs WHERE id = ?", runId)[0].share_scope).toBe("challenge_owner")
  })

  it("learning material belongs to its candidate", async () => {
    fakeAi.behavior.assessment = "weak"
    const run2 = await startRun(call, challengeId, LAYLA)
    await passPhase(call, run2, "p1", LAYLA)
    const gap = ((await call("GET", "/learning", LAYLA)).json.gaps as { id: string }[])[0]
    expect(gap).toBeDefined()
    expect(((await call("GET", "/learning", SARA)).json.gaps as unknown[]).length).toBe(0)
    for (const [method, path] of [
      ["GET", `/learning/gaps/${gap.id}`],
      ["POST", `/learning/gaps/${gap.id}/lesson`],
      ["POST", `/learning/gaps/${gap.id}/exercise`],
    ] as const) {
      expect((await call(method, path, SARA)).status, path).toBe(404)
    }
  })

  it("notifications are per account", async () => {
    await finishInterview(call, submissionId)
    expect(((await call("GET", "/notifications", SARA)).json.notifications as unknown[]).length).toBeGreaterThan(0)
    expect(((await call("GET", "/notifications", LAYLA)).json.notifications as { title: string }[]).filter((n) => /Phase/.test(n.title))).toEqual([])
  })

  it("ignores identifiers in a request body: ownership always comes from the signed-in account", async () => {
    const res = await call("PUT", "/profile", LAYLA, { id: "cand-sara", candidateId: "cand-sara", name: "Layla H." })
    expect(res.status).toBe(200)
    expect(rows("SELECT name FROM candidates WHERE id = 'cand-sara'")[0].name).toBe("Sara Nasser")
    expect(rows("SELECT name FROM candidates WHERE id = 'cand-layla'")[0].name).toBe("Layla H.")
  })
})

describe("one company cannot reach another's challenges or candidates' private work", () => {
  it("every company route answers 'not found' for someone else's challenge", async () => {
    const run = String(rows("SELECT id FROM runs WHERE challenge_id = ?", challengeId)[0].id)
    const probes: [string, string, unknown?][] = [
      ["GET", `/company/challenges/${challengeId}`],
      ["PUT", `/company/challenges/${challengeId}/brief`, { problemDescription: "x".repeat(60), requiredSkills: ["a"], difficulty: "beginner", expectedDeliverables: "something useful", timeHours: 3 }],
      ["POST", `/company/challenges/${challengeId}/generate`, {}],
      ["PUT", `/company/challenges/${challengeId}/version`, {}],
      ["POST", `/company/challenges/${challengeId}/review`],
      ["POST", `/company/challenges/${challengeId}/publish`, { acknowledgeEvaluationUse: true }],
      ["POST", `/company/challenges/${challengeId}/archive`],
      ["POST", `/company/challenges/${challengeId}/complete`],
      ["GET", `/company/challenges/${challengeId}/participants`],
      ["GET", `/company/challenges/${challengeId}/participants/${run}`],
      ["GET", `/company/challenges/${challengeId}/participants/${run}/submissions/${submissionId}`],
    ]
    for (const [method, path, body] of probes) {
      expect((await call(method, path, ORBIT, body)).status, `${method} ${path}`).toBe(404)
    }
    expect(fakeAi.callsFor("challenge")).toHaveLength(1) // Orbit's attempt to regenerate did not spend a model call
  })

  it("the owning company sees the work, and the submission must belong to the run it names", async () => {
    const run = String(rows("SELECT id FROM runs WHERE challenge_id = ?", challengeId)[0].id)
    expect((await call("GET", `/company/challenges/${challengeId}/participants/${run}/submissions/${submissionId}`, NAHLA)).status).toBe(200)
    // A submission from a different run, reached through this run's URL.
    const other = await startRun(call, challengeId, LAYLA)
    const otherSub = String((await submit(call, other, "p1", undefined, LAYLA)).json.submissionId)
    expect((await call("GET", `/company/challenges/${challengeId}/participants/${run}/submissions/${otherSub}`, NAHLA)).status).toBe(404)
  })

  it("candidates who keep their work private are counted but not named", async () => {
    await call("POST", `/work/${runId}/share`, SARA, { scope: "private" })
    const list = (await call("GET", `/company/challenges/${challengeId}/participants`, NAHLA)).json as { participants: unknown[]; privateCount: number }
    expect(list.participants).toEqual([])
    expect(list.privateCount).toBe(1)
    const run = String(rows("SELECT id FROM runs WHERE challenge_id = ?", challengeId)[0].id)
    expect((await call("GET", `/company/challenges/${challengeId}/participants/${run}/submissions/${submissionId}`, NAHLA)).status).toBe(404)
  })

  it("a candidate who shared only with the challenge owner is not visible to other companies", async () => {
    await call("PUT", "/profile", SARA, { discoverable: true, declaredSkills: ["Python"] })
    // Not shared with employers: Orbit cannot find Sara with evidence, and cannot open her challenge work.
    const found = ((await call("GET", "/talent?skills=Python&demonstrated=1", ORBIT)).json.results as { candidate: { id: string } }[]).map((r) => r.candidate.id)
    expect(found).not.toContain("cand-sara")
    // Nahla (the owner) can open her profile because she took part in its challenge.
    expect((await call("GET", "/talent/cand-sara", NAHLA)).status).toBe(200)
  })
})

describe("the AI cache never mixes candidates, phases, versions or submissions", () => {
  it("two candidates submitting identical code each get their own review", async () => {
    const run2 = await startRun(call, challengeId, LAYLA)
    const second = await submit(call, run2, "p1", undefined, LAYLA)
    const reviews = rows("SELECT submission_id, input_hash FROM reviews")
    const mine = reviews.filter((r) => r.submission_id === submissionId || r.submission_id === String(second.json.submissionId))
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((r) => r.input_hash)).size).toBe(2) // different candidates, different review keys
    expect(fakeAi.callsFor("submission_review")).toHaveLength(2) // and the model was asked twice
  })

  it("the same candidate's identical resubmission is its own attempt with its own review", async () => {
    fakeAi.behavior.assessment = "weak"
    await call("POST", `/submissions/${submissionId}/answer`, SARA, { answer: "It checks the tier and then the keywords, in that order, because enterprise customers come first." })
    const before = fakeAi.callsFor("submission_review").length
    // finish the first attempt as a failure so a second one is allowed
    for (let i = 0; i < 6; i++) {
      const d = (await call("GET", `/submissions/${submissionId}`, SARA)).json.submission as { interview: { awaitingAnswer: boolean } }
      if (!d.interview.awaitingAnswer) break
      await call("POST", `/submissions/${submissionId}/answer`, SARA, { answer: "It lowercases the text, checks the enterprise tier first and then looks for billing words in order." })
    }
    const again = await submit(call, runId, "p1")
    expect(again.status).toBe(200)
    expect(fakeAi.callsFor("submission_review").length).toBe(before + 1)
    const hashes = rows("SELECT input_hash FROM reviews r JOIN submissions s ON s.id = r.submission_id JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId)
    // Each attempt keeps its own review row (the key identifies what was reviewed; it is never used to reuse another attempt's review).
    expect(hashes).toHaveLength(2)
  })
})

describe("accounts and reset", () => {
  it("sign-up creates an account of the requested kind and validates the name", async () => {
    const bad = await call("POST", "/accounts", undefined, { role: "student", name: "x" })
    expect(bad.status).toBe(400)
    expect((await call("POST", "/accounts", undefined, { role: "wizard", name: "Someone" })).status).toBe(400)
    const student = await call("POST", "/accounts", undefined, { role: "student", name: "Noor Ahmad" })
    expect(student.status).toBe(200)
    expect((await call("GET", "/profile", `student:${String(student.json.id)}`)).status).toBe(200)
    const company = await call("POST", "/accounts", undefined, { role: "company", name: "Brightline Labs" })
    expect((await call("GET", "/company/me", `company:${String(company.json.id)}`)).status).toBe(200)
    expect((await call("POST", "/accounts", undefined, { role: "company", name: "brightline labs" })).status).toBe(409)
  })

  it("reset restores the seed and signs out accounts that no longer exist", async () => {
    const created = await call("POST", "/accounts", undefined, { role: "student", name: "Temporary Person" })
    const actor = `student:${String(created.json.id)}`
    expect((await call("GET", "/profile", actor)).status).toBe(200)
    expect((await call("POST", "/reset")).status).toBe(200)
    expect((await call("GET", "/profile", actor)).status).toBe(401)
    expect((await call("GET", "/profile", SARA)).status).toBe(200)
    expect(rows("SELECT id FROM challenges WHERE is_demo_fixture = 0")).toEqual([])
  })

  it("outside demo mode, reset and sign-up are refused and the account list is empty", async () => {
    process.env.WASL_DEMO_MODE = "false"
    try {
      expect((await call("POST", "/reset")).status).toBe(403)
      expect((await call("POST", "/accounts", undefined, { role: "student", name: "Someone New" })).status).toBe(403)
      expect((await call("GET", "/demo-accounts")).json).toMatchObject({ demoMode: false, companies: [], students: [] })
    } finally {
      process.env.WASL_DEMO_MODE = "true"
    }
  })
})
