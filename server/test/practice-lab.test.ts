// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeAi, finishInterview, getDb, LAYLA, NAHLA, noAi, passPhase, resetDatabase, SARA, startServer, submit, useFakeAi } from "./helpers.ts"

const server = await startServer()
const call = server.call
afterAll(() => server.close())

beforeEach(() => {
  resetDatabase()
  useFakeAi()
})
// fakeAi.reset() does not undo an instance override of respond; restore the prototype's after every test, pass or fail.
afterEach(() => void delete (fakeAi as { respond?: unknown }).respond)

const REQUEST = { skills: ["python", "sql"], difficulty: "intermediate", description: "Something to do with inventory.", language: "Python" }
const start = (body: Record<string, unknown> = REQUEST, actor = SARA) => call("POST", "/practice", actor, body)
const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]

describe("creating a practice challenge", () => {
  it("builds a phased, private challenge from skills, difficulty, description and language", async () => {
    const res = await start()
    expect(res.status, JSON.stringify(res.json)).toBe(200)
    const run = (await call("GET", `/work/${String(res.json.runId)}`, SARA)).json.run as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(run.kind).toBe("practice")
    expect(run.shareScope).toBe("private")
    expect(run.challenge.skills).toEqual(expect.arrayContaining(["Python", "SQL"]))
    expect(run.challenge.difficulty).toBe("intermediate")
    expect(run.phases.length).toBeGreaterThanOrEqual(3)
    expect(run.phases.length).toBeLessThanOrEqual(5)
    expect(run.phases[0].available).toBe(true)
    expect(run.phases[1].available).toBe(false)
    const prompt = fakeAi.callsFor("challenge").pop()!.user
    expect(prompt).toContain("Programming language: Python")
    expect(prompt).toContain('<untrusted_data kind="student_description">')
  })

  it("needs only skills and a difficulty — the description and language are optional", async () => {
    const res = await start({ skills: ["Python"], difficulty: "beginner" })
    expect(res.status).toBe(200)
    expect(fakeAi.callsFor("challenge").pop()!.user).toContain("Programming language: the student's choice")
    expect(fakeAi.callsFor("challenge").pop()!.user).toContain("choose a suitable scenario")
  })

  it("validates every input and names the field", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...REQUEST, skills: [] }, "skills"],
      [{ ...REQUEST, skills: ["a", "b", "c", "d", "e", "f", "g"] }, "skills"],
      [{ ...REQUEST, difficulty: "legendary" }, "difficulty"],
      [{ ...REQUEST, description: "d".repeat(2000) }, "description"],
      [{ ...REQUEST, language: "x".repeat(60) }, "language"],
      [{ ...REQUEST, language: "py;rm -rf" }, "language"],
    ]
    for (const [body, field] of cases) {
      const res = await start(body)
      expect(res.status, field).toBe(400)
      expect(res.json.field, field).toBe(field)
    }
  })

  it("stores nothing when generation fails, and offers the labelled template", async () => {
    fakeAi.behavior.fail = ["challenge"]
    const res = await start()
    expect(res.status).toBe(503)
    expect(res.json.detail).toMatchObject({ templateAvailable: true })
    expect(rows("SELECT id FROM practice_challenges WHERE candidate_id = 'cand-sara'")).toEqual([])
    const templ = await start({ ...REQUEST, useTemplate: true })
    expect(templ.status).toBe(200)
    const run = (await call("GET", `/work/${String(templ.json.runId)}`, SARA)).json.run as { challenge: { origin: string } }
    expect(run.challenge.origin).toMatch(/not AI-generated/)
  })

  it("never creates a practice run from a design with fewer than 3 phases", async () => {
    const orig = fakeAi.respond.bind(fakeAi)
    fakeAi.respond = (body) => {
      const out = orig(body)
      if ((body as { response_format?: { json_schema?: { name?: string } } }).response_format?.json_schema?.name !== "challenge") return out
      const content = JSON.parse((out.body as { choices: { message: { content: string } }[] }).choices[0].message.content)
      content.phases = content.phases.slice(0, 2)
      return { status: 200, body: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] } }
    }
    const res = await start()
    expect(res.status).toBe(503)
    expect(fakeAi.callsFor("challenge")).toHaveLength(2) // one retry, told why
    expect(fakeAi.callsFor("challenge")[0].system).toMatch(/Use 3–4 phases/)
    expect(fakeAi.callsFor("challenge")[1].user).toContain("A challenge needs 3 to 5 phases; this one has 2.")
    expect(rows("SELECT id FROM practice_challenges WHERE candidate_id = 'cand-sara'")).toEqual([])
    expect(rows("SELECT id FROM runs WHERE candidate_id = 'cand-sara' AND kind = 'practice'")).toEqual([])
  })

  it("works without any provider by labelling the scaffold, and says that review and interview then need one", async () => {
    noAi()
    const res = await start()
    expect(res.status).toBe(200)
    const out = await submit(call, String(res.json.runId), "p1", { code: "def total(items):\n    return sum(item['qty'] for item in items)\n", language: "Python" })
    expect(out.json.state).toBe("assessment_unavailable")
  })

  it("is for students only", async () => {
    expect((await start(REQUEST, NAHLA)).status).toBe(403)
    expect((await call("POST", "/practice", undefined, REQUEST)).status).toBe(401)
  })
})

describe("practice work runs through the same Proof Engine", () => {
  it("enforces phase order, interviews, assesses, and passes phases", async () => {
    const runId = String((await start()).json.runId)
    expect((await submit(call, runId, "p2")).status).toBe(409)
    const first = await passPhase(call, runId, "p1")
    expect(first.detail.state).toBe("passed")
    expect((await submit(call, runId, "p2")).status).toBe(200)
  })

  it("can be completed only when every phase has passed", async () => {
    const runId = String((await start()).json.runId)
    const phases = ((await call("GET", `/work/${runId}`, SARA)).json.run as { phases: { key: string }[] }).phases
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(409)
    for (const p of phases) await passPhase(call, runId, p.key)
    expect((await call("POST", `/work/${runId}/complete`, SARA, {})).status).toBe(200)
  })

  it("accepts a code submission, a repository link, or both", async () => {
    const runId = String((await start()).json.runId)
    const out = await submit(call, runId, "p1", { code: "def total(items):\n    return sum(i['qty'] for i in items)\n", language: "Python" })
    expect(out.status).toBe(200)
  })
})

describe("practice stays private", () => {
  it("is invisible to other students and to companies", async () => {
    const runId = String((await start()).json.runId)
    const out = await submit(call, runId, "p1")
    const submissionId = String(out.json.submissionId)
    expect((await call("GET", `/work/${runId}`, LAYLA)).status).toBe(404)
    expect((await call("GET", `/submissions/${submissionId}`, LAYLA)).status).toBe(404)
    expect((await call("POST", `/submissions/${submissionId}/answer`, LAYLA, { answer: "hello there" })).status).toBe(404)
    expect((await call("POST", `/work/${runId}/share`, LAYLA, { scope: "employers" })).status).toBe(404)
    expect((await call("GET", `/work/${runId}`, NAHLA)).status).toBe(403)
  })

  it("only reaches employers if the student chooses — and only after that, and only as assessed skills", async () => {
    // Make Sara discoverable and pass a practice phase.
    await call("PUT", "/profile", SARA, { discoverable: true, declaredSkills: ["Python"] })
    const runId = String((await start({ skills: ["Python"], difficulty: "beginner" })).json.runId)
    await passPhase(call, runId, "p1")

    const search = async () => ((await call("GET", "/talent?skills=Python&demonstrated=1", NAHLA)).json.results as { candidate: { id: string } }[]).map((r) => r.candidate.id)
    expect(await search()).not.toContain("cand-sara") // private practice proves nothing to employers

    expect((await call("POST", `/work/${runId}/share`, SARA, { scope: "challenge_owner" })).status).toBe(400) // there is no company behind practice
    expect((await call("POST", `/work/${runId}/share`, SARA, { scope: "employers" })).status).toBe(200)
    expect(await search()).toContain("cand-sara")

    const profile = (await call("GET", "/talent/cand-sara", NAHLA)).json.candidate as { evidence: { skills: { skill: string; status: string; evidence: Record<string, unknown>[] }[] } }
    const python = profile.evidence.skills.find((s) => s.skill === "Python")!
    expect(python.status).toBe("demonstrated")
    // Employers see the assessment's ratings — never the code, the review or the interview transcript.
    expect(JSON.stringify(profile)).not.toContain("route_ticket")
    expect(Object.keys(python.evidence[0]).sort()).toEqual(["assessedAt", "companyName", "isDemoFixture", "kind", "origin", "outcome", "phaseTitle", "ratings", "runId", "runTitle", "skill"])

    // And the student can take it back.
    await call("POST", `/work/${runId}/share`, SARA, { scope: "private" })
    expect(await search()).not.toContain("cand-sara")
    const history = rows("SELECT from_scope, to_scope FROM share_history WHERE run_id = ? ORDER BY id", runId)
    expect(history).toEqual([
      { from_scope: "private", to_scope: "employers" },
      { from_scope: "employers", to_scope: "private" },
    ])
  })

  it("deleting a practice challenge removes it and everything attached to it", async () => {
    const res = await start()
    const runId = String(res.json.runId)
    const out = await submit(call, runId, "p1")
    await finishInterview(call, String(out.json.submissionId))
    expect((await call("DELETE", `/practice/${String(res.json.practiceId)}`, LAYLA)).status).toBe(404) // not theirs
    expect((await call("DELETE", `/practice/${String(res.json.practiceId)}`, SARA)).status).toBe(200)
    expect((await call("GET", `/work/${runId}`, SARA)).status).toBe(404)
    expect(rows("SELECT id FROM submissions WHERE id = ?", String(out.json.submissionId))).toEqual([])
    expect(rows("SELECT id FROM challenge_versions WHERE practice_id = ?", String(res.json.practiceId))).toEqual([])
    expect(rows("PRAGMA foreign_key_check")).toEqual([])
  })
})
