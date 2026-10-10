// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { spawn } from "node:child_process"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { finishInterview, getDb, llmDeps, NAHLA, publishChallenge, resetDatabase, SARA, startRun, startServer, submit, testDir, useFakeAi } from "./helpers.ts"

// Demo mock AI (WASL_AI_MOCK=true): for rehearsing a presentation without spending provider quota. What must hold:
// no request reaches any provider, the answers are deterministic and pass the same schema checks, everything it produces is
// labelled as demo data, it is off by default, and it refuses to run in production or with demo mode off.

const { aiConfigured, aiMockState, completeJson, configuredProviders, MOCK_MODEL, MOCK_PROVIDER } = await import("../ai/provider.ts")
const { arr, obj, output, str } = await import("../ai/schema.ts")
const { evidenceItems } = await import("../services/profile.ts")

const server = await startServer()
const call = server.call
afterAll(() => server.close())

const ENV_KEYS = ["WASL_AI_MOCK", "NODE_ENV", "WASL_DEMO_MODE", "GEMINI_API_KEY", "WASL_AI_PROVIDER"] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

/** Every way a request could leave the process: the provider seam and the global fetch. Each one fails the test loudly. */
let providerRequests: string[]
function forbidNetwork() {
  providerRequests = []
  llmDeps.fetch = async (url) => {
    providerRequests.push(url)
    throw new Error(`A provider was contacted in mock mode: ${url}`)
  }
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    // The test's own HTTP calls to the local WASL server are allowed; nothing else is.
    if (url.startsWith("http://localhost:")) return realFetch(input, init)
    providerRequests.push(url)
    throw new Error("Network access in mock mode")
  })
}

function mockOn() {
  process.env.WASL_AI_MOCK = "true"
  // Real-looking keys for both providers: mock mode must win over them, not depend on their absence.
  process.env.GEMINI_API_KEY = "test-gemini-key-0123456789"
  forbidNetwork()
}

beforeEach(() => {
  resetDatabase()
  useFakeAi() // sets a (fake) GROQ key and an in-process fake provider, as every other suite does
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const rows = (sql: string, ...p: string[]) => getDb().prepare(sql).all(...p) as Record<string, unknown>[]

/** The whole Proof Engine flow: a company generates and publishes a challenge, a student submits, is interviewed, is assessed. */
async function fullFlow() {
  const challengeId = await publishChallenge(call)
  const runId = await startRun(call, challengeId)
  const out = await submit(call, runId, "p1")
  const id = String(out.json.submissionId)
  await finishInterview(call, id)
  const detail = (await call("GET", `/submissions/${id}`, SARA)).json.submission as {
    state: string
    review: { summary: string; provider: string; model: string; findings: { title: string; quote: string }[] }
    interview: { messages: { role: string; content: string }[] }
    assessment: { outcome: string; origin: string; provider: string; model: string; dimensions: { key: string; rating: number }[] } | null
  }
  return { challengeId, runId, id, detail }
}

const lessonSpec = output("lesson", obj({ title: str({ max: 200 }), body: str({ max: 4000 }), keyPoints: arr(str({ max: 200 }), { max: 10 }) }))
const lessonCall = () => completeJson({ purpose: "lesson", promptVersion: "t.v1", system: "Write a lesson.", user: "Topic: input validation", output: lessonSpec })

describe("demo mock AI: on", () => {
  it("runs generate → review → interview → assessment with ZERO requests to any provider, even with keys set", async () => {
    mockOn()
    const { detail } = await fullFlow()
    expect(detail.state).toBe("passed")
    expect(detail.interview.messages.filter((m) => m.role === "interviewer").length).toBeGreaterThanOrEqual(3)
    expect(providerRequests).toEqual([])
    const calls = rows("SELECT purpose, provider, model, ok FROM ai_calls")
    expect(new Set(calls.map((c) => c.purpose))).toEqual(new Set(["challenge_generation", "review", "interview", "assessment"]))
    expect(calls.every((c) => c.provider === MOCK_PROVIDER && c.model === MOCK_MODEL && c.ok === 1)).toBe(true)
  })

  it("labels what it produced as demo data: assessment, review, challenge version, profile evidence, session and health", async () => {
    mockOn()
    const { challengeId, detail } = await fullFlow()
    expect(detail.assessment).toMatchObject({ origin: "demo_fixture", provider: MOCK_PROVIDER, model: MOCK_MODEL })
    expect(detail.review.provider).toBe(MOCK_PROVIDER)
    const challenge = (await call("GET", `/company/challenges/${challengeId}`, NAHLA)).json as { challenge?: { current?: { meta: { originLabel: string } } } }
    expect(JSON.stringify(challenge)).toContain("Demo mock — scripted, not AI-generated")
    expect(JSON.stringify(challenge)).not.toContain("Generated by AI")
    const evidence = evidenceItems(getDb(), "cand-sara", { kind: "self" })
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence.every((e) => e.isDemoFixture && e.origin === "demo_fixture")).toBe(true)
    expect((await call("GET", "/session", SARA)).json.aiMock).toBe(true)
    const health = (await call("GET", "/health")).json as { aiMock: boolean; ai: { provider: string } }
    expect(health.aiMock).toBe(true)
    expect(health.ai.provider).toBe(MOCK_PROVIDER)
    expect(providerRequests).toEqual([]) // the health check didn't probe a provider either
  })

  it("is deterministic: the same input gives the same answer, call after call and run after run", async () => {
    mockOn()
    const a = await lessonCall()
    const b = await lessonCall()
    expect(a).toEqual(b)
    expect(a.provider).toBe(MOCK_PROVIDER)

    const first = (await fullFlow()).detail
    resetDatabase()
    const second = (await fullFlow()).detail
    const shape = (d: typeof first) => ({
      review: [d.review.summary, d.review.findings.map((f) => [f.title, f.quote])],
      questions: d.interview.messages.filter((m) => m.role === "interviewer").map((m) => m.content),
      ratings: d.assessment!.dimensions.map((x) => [x.key, x.rating]),
      outcome: d.assessment!.outcome,
    })
    expect(shape(second)).toEqual(shape(first))
    expect(providerRequests).toEqual([])
  })

  it("does not bypass the rules: the phase lock still applies and the answers still go through grounding", async () => {
    mockOn()
    const challengeId = await publishChallenge(call)
    const runId = await startRun(call, challengeId)
    // Phase 2 is locked until phase 1 has been submitted — mock mode doesn't change that.
    expect((await submit(call, runId, "p2")).status).not.toBe(200)
    expect(rows("SELECT s.id FROM submissions s JOIN run_phases rp ON rp.id = s.run_phase_id WHERE rp.run_id = ?", runId)).toHaveLength(0)
    // Evidence is still verified against the real submission: every cited code quote is a line from it.
    const out = await submit(call, runId, "p1")
    await finishInterview(call, String(out.json.submissionId))
    const d = (await call("GET", `/submissions/${String(out.json.submissionId)}`, SARA)).json.submission as { assessment: { dimensions: { evidence: { source: string; quote: string }[] }[] } }
    const code = String(rows("SELECT code_text FROM submissions WHERE id = ?", String(out.json.submissionId))[0].code_text)
    for (const e of d.assessment.dimensions.flatMap((x) => x.evidence)) if (e.source === "code") expect(code).toContain(e.quote)
  })
})

describe("demo mock AI: off (the default)", () => {
  it("is off when unset or 'false', and provider selection is exactly what it was", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key-0123456789"
    process.env.WASL_AI_PROVIDER = "gemini"
    delete process.env.WASL_AI_MOCK
    expect(aiMockState()).toBe("off")
    const unset = configuredProviders()
    process.env.WASL_AI_MOCK = "false"
    expect(aiMockState()).toBe("off")
    expect(configuredProviders()).toEqual(unset)
    expect(unset.map((p) => p.id)).toEqual(["gemini", "groq"])
  })

  it("with it off, a call goes to the configured provider as before — not to the mock", async () => {
    delete process.env.WASL_AI_MOCK
    const seen: string[] = []
    const provider = llmDeps.fetch
    llmDeps.fetch = async (url, init) => {
      seen.push(url)
      return provider(url, init)
    }
    const done = await lessonCall()
    expect(done.provider).toBe("groq")
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/\/chat\/completions$/)
    expect((await call("GET", "/session", SARA)).json.aiMock).toBe(false)
  })
})

describe("demo mock AI: refused where it must not run", () => {
  for (const [label, env] of [
    ["NODE_ENV=production", { NODE_ENV: "production" }],
    ["demo mode off", { WASL_DEMO_MODE: "false" }],
    ["an unrecognised value", { WASL_AI_MOCK: "yes" }],
  ] as const) {
    it(`${label}: blocked — no mock answer, no provider request, AI reported unavailable`, async () => {
      mockOn()
      Object.assign(process.env, env)
      expect(aiMockState()).toBe("blocked")
      expect(aiConfigured()).toBe(false)
      await expect(lessonCall()).rejects.toMatchObject({ kind: "auth" })
      expect(providerRequests).toEqual([])
      expect((await call("GET", "/session", SARA)).json.aiMock).toBe(false)
    })
  }

  it("the server refuses to start with WASL_AI_MOCK=true under NODE_ENV=production", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, WASL_AI_MOCK: "true", NODE_ENV: "production", PORT: "0", WASL_DB_PATH: join(testDir, "refused.db") }
    const child = spawn(process.execPath, ["server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()))
    const timer = setTimeout(() => child.kill(), 10_000) // if it started, this test fails below instead of hanging
    const code = await new Promise<number | null>((r) => child.on("exit", (c) => r(c)))
    clearTimeout(timer)
    expect(code).toBe(1)
    expect(stderr).toContain("demo mock AI is only allowed for local demo rehearsal")
  })
})
