// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { docx, png, upload } from "./fixtures.ts"
import { fakeAi, getDb, LAYLA, NAHLA, OMAR, ORBIT, passPhase, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, useFakeAi } from "./helpers.ts"

const server = await startServer()
const call = server.call
afterAll(() => server.close())

beforeEach(() => {
  resetDatabase()
  useFakeAi()
})

interface Result {
  candidate: { id: string; name: string; isDemoFixture: boolean; availability: string; evidence: { skills: { skill: string; status: string; declared: boolean; evidence: { outcome: string; runTitle: string }[] }[]; demonstratedCount: number } }
  matches: { skill: string; status: string; evidence: unknown[] }[]
  score: number
}
const search = async (query: string, actor = NAHLA) => (await call("GET", `/talent${query}`, actor)).json as { results: Result[]; scoring: string }
const ids = (r: { results: Result[] }) => r.results.map((x) => x.candidate.id)
const rows = (sql: string, ...p: (string | number)[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]

describe("who can be found", () => {
  it("only candidates who opted in, and the first launch is not empty because the demo candidates are labelled", async () => {
    const all = await search("")
    expect(ids(all).sort()).toEqual(["cand-layla", "cand-omar"])
    expect(all.results.every((r) => r.candidate.isDemoFixture)).toBe(true)
    expect(ids(all)).not.toContain("cand-sara") // not discoverable
    expect((await call("GET", "/talent/cand-sara", NAHLA)).status).toBe(404)
  })

  it("turning discoverability on and off takes effect immediately", async () => {
    await call("PUT", "/profile", SARA, { discoverable: true, declaredSkills: ["Python"] })
    expect(ids(await search("?skills=Python"))).toContain("cand-sara")
    await call("PUT", "/profile", SARA, { discoverable: false })
    expect(ids(await search("?skills=Python"))).not.toContain("cand-sara")
  })

  it("is for companies only; there is no university area at all", async () => {
    expect((await call("GET", "/talent", SARA)).status).toBe(403)
    expect((await call("GET", "/talent")).status).toBe(401)
    for (const path of ["/university/industry-insights", "/universities", "/students", "/snapshot"]) expect((await call("GET", path, NAHLA)).status, path).toBe(404)
  })
})

describe("explainable, evidence-based search", () => {
  it("ranks demonstrated skills above declared ones, and says why", async () => {
    const r = await search("?skills=Python")
    // Layla demonstrated Python through passed phases; Omar only declared it (his Python phase was not passed).
    expect(ids(r)).toEqual(["cand-layla", "cand-omar"])
    const [layla, omar] = r.results
    expect(layla.matches[0]).toMatchObject({ skill: "Python", status: "demonstrated" })
    expect(layla.matches[0].evidence.length).toBeGreaterThan(0)
    expect(omar.matches[0]).toMatchObject({ skill: "Python", status: "declared", evidence: [] })
    expect(layla.score).toBeGreaterThan(omar.score)
    expect(r.scoring).toMatch(/declared/)
  })

  it("can require demonstrated skills only", async () => {
    expect(ids(await search("?skills=Python&demonstrated=1"))).toEqual(["cand-layla"])
  })

  it("matches all skills or any of them", async () => {
    expect(ids(await search("?skills=Python,Machine Learning&match=all"))).toEqual(["cand-omar"]) // only Omar declares both
    expect(ids(await search("?skills=Python,Machine Learning&match=any")).sort()).toEqual(["cand-layla", "cand-omar"])
    expect(ids(await search("?skills=Cobol"))).toEqual([])
  })

  it("filters by availability, status and location", async () => {
    expect(ids(await search("?availability=open_to_internships"))).toEqual(["cand-omar"])
    expect(ids(await search("?status=graduate"))).toEqual(["cand-layla"])
    expect(ids(await search("?location=irbid"))).toEqual(["cand-omar"])
    expect((await call("GET", "/talent?availability=nonsense", NAHLA)).status).toBe(400)
  })

  it("shows employers only what was demonstrated — never failed attempts, code or transcripts", async () => {
    const profile = (await call("GET", "/talent/cand-omar", NAHLA)).json.candidate as { evidence: { skills: { skill: string; status: string; evidence: { outcome: string }[] }[] } }
    const all = profile.evidence.skills.flatMap((s) => s.evidence)
    expect(all.every((e) => e.outcome === "passed")).toBe(true)
    expect(JSON.stringify(profile)).not.toMatch(/find_anomalies|abs\(t - mean\)|outcome":"failed|building/)
    // …while the candidate sees their own attempt, described as work in progress rather than as a failure.
    const own = (await call("GET", "/profile", OMAR)).json.profile as { evidence: { skills: { skill: string; status: string }[] } }
    expect(own.evidence.skills.find((s) => s.skill === "Python")?.status).toBe("building")
  })

  it("separates declared from demonstrated on the candidate's own evidence profile", async () => {
    await call("PUT", "/profile", SARA, { declaredSkills: ["Python", "Rust"] })
    const runId = await startRun(call, await publishChallenge(call))
    await passPhase(call, runId, "p1")
    const own = (await call("GET", "/profile", SARA)).json.profile as { evidence: { skills: { skill: string; status: string; declared: boolean }[]; explanation: string } }
    const by = Object.fromEntries(own.evidence.skills.map((s) => [s.skill, s]))
    expect(by.Python).toMatchObject({ status: "demonstrated", declared: true })
    expect(by.Rust).toMatchObject({ status: "declared", declared: true })
    expect(by["Software Testing"]).toMatchObject({ status: "demonstrated", declared: false })
    expect(own.evidence.explanation).toMatch(/self-reported and unverified/)
  })

  it("never lets one company see work shared only with another company", async () => {
    const challenge = await publishChallenge(call, ORBIT)
    const runId = await startRun(call, challenge)
    await call("PUT", "/profile", SARA, { discoverable: true, declaredSkills: [] })
    await passPhase(call, runId, "p1")
    // Shared with Orbit (the challenge owner) only: Orbit sees the evidence, Nahla does not.
    const orbit = (await call("GET", "/talent/cand-sara", ORBIT)).json.candidate as { evidence: { demonstratedCount: number } }
    const nahla = (await call("GET", "/talent/cand-sara", NAHLA)).json.candidate as { evidence: { demonstratedCount: number } }
    expect(orbit.evidence.demonstratedCount).toBeGreaterThan(0)
    expect(nahla.evidence.demonstratedCount).toBe(0)
    await call("POST", `/work/${runId}/share`, SARA, { scope: "employers" })
    const nahlaAfter = (await call("GET", "/talent/cand-sara", NAHLA)).json.candidate as { evidence: { demonstratedCount: number } }
    expect(nahlaAfter.evidence.demonstratedCount).toBeGreaterThan(0)
  })
})

describe("expressing interest", () => {
  it("tells the candidate who is interested, once, with the company's message", async () => {
    const res = await call("POST", "/talent/cand-layla/interest", NAHLA, { message: "We would like to talk about a junior backend role." })
    expect(res.status).toBe(200)
    const notes = (await call("GET", "/notifications", LAYLA)).json.notifications as { title: string; body: string }[]
    expect(notes[0].title).toBe("Nahla Systems is interested in you")
    expect(notes[0].body).toContain("junior backend role")
    const received = (await call("GET", "/interest", LAYLA)).json.interest as { company: { name: string }; message: string }[]
    expect(received).toHaveLength(1)
    expect(received[0].company.name).toBe("Nahla Systems")
    expect((await call("POST", "/talent/cand-layla/interest", NAHLA, { message: "again" })).status).toBe(409)
    // The candidate's other companies are unaffected.
    expect((await call("POST", "/talent/cand-layla/interest", ORBIT, {})).status).toBe(200)
  })

  it("cannot be sent to someone who isn't discoverable, doesn't exist, or to an over-long message", async () => {
    expect((await call("POST", "/talent/cand-sara/interest", NAHLA, {})).status).toBe(404)
    expect((await call("POST", "/talent/nobody/interest", NAHLA, {})).status).toBe(404)
    expect((await call("POST", "/talent/cand-layla/interest", NAHLA, { message: "m".repeat(600) })).status).toBe(400)
    expect(rows("SELECT id FROM company_actions")).toEqual([])
  })

  it("is capped per company per day", async () => {
    const stmt = getDb().prepare("INSERT INTO candidates (id, name, discoverable, created_at, updated_at) VALUES (?, ?, 1, 'x', 'x')")
    for (let i = 0; i < 26; i++) stmt.run(`cand-bulk-${i}`, `Bulk ${i}`)
    let last = 200
    for (let i = 0; i < 26; i++) last = (await call("POST", `/talent/cand-bulk-${i}/interest`, NAHLA, {})).status
    expect(last).toBe(429)
    expect(rows("SELECT id FROM company_actions WHERE kind = 'interested'")).toHaveLength(25)
  })

  it("saved candidates form a private shortlist per company", async () => {
    expect((await call("POST", "/talent/cand-omar/save", NAHLA)).json).toEqual({ saved: true })
    await call("POST", "/talent/cand-layla/interest", NAHLA, { message: "hello" })
    const list = (await call("GET", "/talent/shortlist", NAHLA)).json.shortlist as { kind: string; candidate: { id: string } }[]
    expect(list.map((x) => `${x.kind}:${x.candidate.id}`).sort()).toEqual(["interested:cand-layla", "saved:cand-omar"])
    expect(((await call("GET", "/talent/shortlist", ORBIT)).json.shortlist as unknown[]).length).toBe(0)
    expect((await call("POST", "/talent/cand-omar/save", NAHLA)).json).toEqual({ saved: false })
  })
})

describe("a candidate's profile", () => {
  it("validates what can be edited and says which field is wrong", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "x" }, "name"],
      [{ headline: "h".repeat(200) }, "headline"],
      [{ bio: "b".repeat(2000) }, "bio"],
      [{ status: "professor" }, "status"],
      [{ availability: "maybe" }, "availability"],
      [{ declaredSkills: Array.from({ length: 25 }, (_, i) => `Skill ${i}`) }, "declaredSkills"],
      [{ links: [{ label: "Site", url: "http://insecure.example.com" }] }, "links"],
      [{ links: [{ label: "Site", url: "javascript:alert(1)" }] }, "links"],
      [{ links: [{ label: "", url: "https://example.com" }] }, "links"],
      [{ links: Array.from({ length: 6 }, () => ({ label: "L", url: "https://example.com" })) }, "links"],
    ]
    for (const [body, field] of cases) {
      const res = await call("PUT", "/profile", SARA, body)
      expect(res.status, field).toBe(400)
      expect(res.json.field, field).toBe(field)
    }
  })

  it("stores canonical skill names and https links", async () => {
    await call("PUT", "/profile", SARA, { headline: "Aspiring tester", declaredSkills: ["python", "SQL", "sql"], links: [{ label: "GitHub", url: "https://github.com/sara-n" }], availability: "open_to_work" })
    const p = (await call("GET", "/profile", SARA)).json.profile as Record<string, unknown>
    expect(p).toMatchObject({ headline: "Aspiring tester", declaredSkills: ["Python", "SQL"], availabilityLabel: "Open to work" })
    expect(p.links).toEqual([{ label: "GitHub", url: "https://github.com/sara-n" }])
  })

  it("keeps a CV private unless the candidate shares it, and validates the file", async () => {
    const cv = docx(["Sara Nasser", "Python developer with an interest in testing and support tooling."])
    expect((await call("PUT", "/profile/cv", SARA, upload("cv.docx", cv))).status).toBe(200)
    await call("PUT", "/profile", LAYLA, {}) // no-op
    await call("PUT", "/profile", SARA, { discoverable: true })
    expect((await call("GET", "/talent/cand-sara/cv", NAHLA)).status).toBe(404) // discoverable, but the CV isn't shared
    expect((await call("GET", "/talent/cand-sara", NAHLA)).status).toBe(200)
    expect(((await call("GET", "/talent/cand-sara", NAHLA)).json.candidate as { cvAvailable: boolean }).cvAvailable).toBe(false)
    await call("PUT", "/profile", SARA, { cvShared: true })
    const res = await server.fetch("/talent/cand-sara/cv", NAHLA)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain("cv.docx")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect((await server.fetch("/talent/cand-sara/cv", ORBIT)).status).toBe(200) // any company that can find a shared CV
    expect((await server.fetch("/profile/cv", SARA)).status).toBe(200)
    expect((await server.fetch("/profile/cv", LAYLA)).status).toBe(404)

    expect((await call("PUT", "/profile/cv", SARA, upload("cv.exe", Buffer.from("MZ not a document at all")))).status).toBe(400)
    expect((await call("PUT", "/profile/cv", SARA, upload("cv.pdf", Buffer.from("this is not a pdf")))).status).toBe(400)
    expect((await call("PUT", "/profile/cv", SARA, upload("empty.docx", Buffer.alloc(0)))).status).toBe(400)
    expect((await call("PUT", "/profile/cv", SARA, upload("photo.png", png()))).status).toBe(400) // not a CV format
    await call("DELETE", "/profile/cv", SARA)
    expect((await server.fetch("/profile/cv", SARA)).status).toBe(404)
  })

  it("does not carry a fake metric: the profile counts only what the engine assessed", async () => {
    const own = (await call("GET", "/profile", SARA)).json.profile as { evidence: { demonstratedCount: number; phasesPassed: number } }
    expect(own.evidence).toMatchObject({ demonstratedCount: 0, phasesPassed: 0 })
    expect(fakeAi.calls).toHaveLength(0)
  })

  it("a candidate can complete a challenge and then appears with that challenge's evidence", async () => {
    const challengeId = await publishChallenge(call)
    const runId = await startRun(call, challengeId)
    await passPhase(call, runId, "p1")
    await call("PUT", "/profile", SARA, { discoverable: true })
    await call("POST", `/work/${runId}/share`, SARA, { scope: "employers" })
    const found = await search("?skills=Software Testing&demonstrated=1", ORBIT)
    expect(ids(found)).toContain("cand-sara")
    const sara = found.results.find((r) => r.candidate.id === "cand-sara")!
    expect(sara.candidate.evidence.skills.find((s) => s.skill === "Software Testing")?.evidence[0].runTitle).toBe("Python and Software Testing challenge")
    expect((await submit(call, runId, "p2")).status).toBe(200)
  })
})
