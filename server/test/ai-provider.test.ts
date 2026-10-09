// helpers.ts must load first: it points WASL_DB_PATH at a throwaway database before db.ts reads it.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getDb, llmDeps, resetDatabase } from "./helpers.ts"
import { AiError, checkProviderHealth, completeJson, configuredProviders, describeAiError, MAX_RATE_LIMIT_WAIT_MS, redact, retryAfterMs } from "../ai/provider.ts"
import { arr, bool, int, num, obj, oneOf, output, SchemaError, str, toGeminiSchema } from "../ai/schema.ts"

// The provider layer, with the network replaced. These tests pin down what is sent to a provider, what comes back, and what
// happens when it goes wrong.

const ANSWER = output("answer", obj({ verdict: oneOf(["yes", "no"] as const), score: int({ min: 0, max: 3 }), note: str({ min: 1, max: 20 }), tags: arr(str({ min: 1, max: 10 }), { max: 2 }) }))
const GOOD = { verdict: "yes", score: 2, note: "fine", tags: ["a", "b"] }
const groqReply = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] })
const geminiReply = (value: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] })

interface Sent {
  url: string
  headers: Record<string, string>
  body: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
let sent: Sent[]
let sleeps: number[]
let script: ((url: string, n: number) => Response | Promise<Response>)[]
const original = { fetch: llmDeps.fetch, sleep: llmDeps.sleep }

beforeEach(() => {
  resetDatabase()
  sent = []
  sleeps = []
  script = []
  process.env.GROQ_API_KEY = "gsk_unit_test_key_0123456789abcdef"
  delete process.env.GEMINI_API_KEY
  delete process.env.WASL_AI_PROVIDER
  llmDeps.sleep = async (ms) => {
    sleeps.push(ms)
  }
  llmDeps.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    const next = script.shift()
    if (!next) throw new Error("unexpected extra request")
    return next(url, sent.length)
  }
})
afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.WASL_AI_PROVIDER
  llmDeps.fetch = original.fetch
  llmDeps.sleep = original.sleep
})

const ask = () => completeJson({ purpose: "unit", promptVersion: "unit.v1", system: "SYSTEM", user: "USER", output: ANSWER, subject: { type: "test", id: "t1" } })
const calls = () => getDb().prepare("SELECT purpose, provider, model, prompt_version, ok, error_kind, attempts, subject_type, subject_id FROM ai_calls ORDER BY rowid").all() as Record<string, unknown>[]

describe("what is sent", () => {
  it("asks Groq for strict JSON matching the schema, with the key only in the header", async () => {
    script = [() => groqReply(GOOD)]
    const done = await ask()
    expect(done).toMatchObject({ value: GOOD, provider: "groq", attempts: 1 })
    const req = sent[0]
    expect(req.url).toBe("https://api.groq.com/openai/v1/chat/completions")
    expect(req.headers.Authorization).toBe("Bearer gsk_unit_test_key_0123456789abcdef")
    expect(JSON.stringify(req.body)).not.toContain("gsk_unit_test_key")
    expect(req.body.model).toBe("openai/gpt-oss-120b")
    expect(req.body.temperature).toBe(0)
    expect(req.body.reasoning_effort).toBe("low")
    expect(req.body.messages).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "USER" },
    ])
    expect(req.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "answer", strict: true } })
    const schema = req.body.response_format.json_schema.schema
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["verdict", "score", "note", "tags"] })
    expect(schema.properties.verdict).toEqual({ type: "string", enum: ["yes", "no"] })
  })

  it("only sends reasoning_effort to models that take it", async () => {
    process.env.GROQ_MODEL = "llama-3.3-70b-versatile"
    script = [() => groqReply(GOOD)]
    await ask()
    expect(sent[0].body.reasoning_effort).toBeUndefined()
    delete process.env.GROQ_MODEL
  })

  it("speaks Gemini's dialect to the backup provider", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    script = [() => new Response("{}", { status: 500 }), () => new Response("{}", { status: 500 }), () => geminiReply(GOOD)]
    const done = await ask()
    expect(done.provider).toBe("gemini")
    const req = sent[2]
    expect(req.url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent")
    expect(req.headers["x-goog-api-key"]).toBe("AIzaSyUnitTestKey0123456789abcdefghijk")
    expect(req.body.systemInstruction.parts[0].text).toBe("SYSTEM")
    expect(req.body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0 })
    expect(req.body.generationConfig.responseSchema.type).toBe("OBJECT")
    expect(JSON.stringify(req.body.generationConfig.responseSchema)).not.toContain("additionalProperties")
  })

  it("can be told which provider to try first, and where to find it (for tests and mock servers)", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    process.env.WASL_AI_PROVIDER = "gemini"
    process.env.WASL_GEMINI_BASE_URL = "http://127.0.0.1:9999/v1beta/"
    script = [() => geminiReply(GOOD)]
    await ask()
    expect(sent[0].url).toBe("http://127.0.0.1:9999/v1beta/models/gemini-flash-latest:generateContent")
    expect(configuredProviders().map((p) => p.id)).toEqual(["gemini", "groq"])
    delete process.env.WASL_GEMINI_BASE_URL
  })
})

describe("what comes back", () => {
  it("rejects a response that does not match the schema, retries once, then gives up", async () => {
    script = [() => groqReply({ ...GOOD, score: 9 }), () => groqReply({ verdict: "maybe" })]
    const err = await ask().catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.kind).toBe("schema")
    expect(sent).toHaveLength(2)
    expect(calls()[0]).toMatchObject({ ok: 0, error_kind: "schema", attempts: 2 })
  })

  it("succeeds on the retry when the second answer is valid", async () => {
    script = [() => groqReply({ nonsense: true }), () => groqReply(GOOD)]
    const done = await ask()
    expect(done.attempts).toBe(2)
    expect(calls()[0]).toMatchObject({ ok: 1, attempts: 2 })
  })

  it("treats text that is not JSON, a cut-off answer and a refusal as failures", async () => {
    script = [() => new Response(JSON.stringify({ choices: [{ message: { content: "sorry, here you go: {" } }] })), () => new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"ye' }, finish_reason: "length" }] }))]
    expect((await ask().catch((e) => e)).kind).toBe("bad_json")
    script = [() => Response.json({ choices: [{ message: { refusal: "I can't help with that" } }] })]
    expect((await ask().catch((e) => e)).kind).toBe("refused")
  })

  it("treats Groq's 400 'Failed to validate JSON' (how its strict mode reports a cut-off answer) as an invalid answer, not an outage", async () => {
    // Observed live: with strict json_schema, an answer cut off by the token limit comes back as HTTP 400, never finish_reason "length".
    const invalid = (message: string, code?: string) => () => Response.json({ error: { message, type: "invalid_request_error", ...(code ? { code } : {}) } }, { status: 400 })
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    script = [invalid("Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.", "json_validate_failed"), invalid("Generated JSON does not match the expected schema. Please adjust your prompt."), () => geminiReply(GOOD)]
    const done = await ask()
    expect(done).toMatchObject({ provider: "gemini", attempts: 3 }) // retried once on Groq, then the backup answered
    expect(calls()[0]).toMatchObject({ ok: 1, provider: "gemini" })

    delete process.env.GEMINI_API_KEY
    script = [invalid("Failed to validate JSON. Please adjust your prompt."), invalid("Failed to validate JSON. Please adjust your prompt.")]
    const err = await ask().catch((e) => e)
    expect(err.kind).toBe("bad_json")
    expect(describeAiError(err)).toMatch(/couldn't be validated/)
    expect(describeAiError(err)).not.toMatch(/didn't respond in time/)
    expect(calls()[1]).toMatchObject({ ok: 0, error_kind: "bad_json", attempts: 2 })

    // Any other 400 is still an HTTP error.
    script = [() => Response.json({ error: { message: "model not found" } }, { status: 400 }), () => Response.json({ error: { message: "model not found" } }, { status: 400 })]
    expect((await ask().catch((e) => e)).kind).toBe("http")
  })

  it("truncates over-long text and extra list items instead of failing, but never accepts an empty required field", () => {
    expect(ANSWER.field.parse({ ...GOOD, note: "x".repeat(50), tags: ["a", "b", "c"] }, "")).toMatchObject({ note: "x".repeat(20), tags: ["a", "b"] })
    expect(() => ANSWER.field.parse({ ...GOOD, note: "   " }, "")).toThrow(SchemaError)
    expect(() => ANSWER.field.parse({ ...GOOD, score: 1.5 }, "")).toThrow(/whole number/)
    expect(() => ANSWER.field.parse({ ...GOOD, tags: "a" }, "")).toThrow(/expected a list/)
    expect(() => ANSWER.field.parse({ verdict: "yes" }, "")).toThrow(/score: is missing/)
    expect(ANSWER.field.parse({ ...GOOD, extra: "dropped" }, "")).not.toHaveProperty("extra")
  })

  it("has combinators that agree with the schema they publish", () => {
    expect(num({ min: 0, max: 1 }).parse(0.5, "x")).toBe(0.5)
    expect(() => num({ min: 0, max: 1 }).parse(2, "x")).toThrow()
    expect(bool().parse(true, "x")).toBe(true)
    expect(() => bool().parse("yes", "x")).toThrow()
    expect(toGeminiSchema(ANSWER.field.schema)).toMatchObject({ type: "OBJECT", properties: { verdict: { type: "STRING", enum: ["yes", "no"] }, score: { type: "INTEGER" }, tags: { type: "ARRAY", items: { type: "STRING" } } } })
  })
})

describe("when a provider fails", () => {
  it("retries a server error once on the same provider", async () => {
    script = [() => new Response("{}", { status: 503 }), () => groqReply(GOOD)]
    expect((await ask()).attempts).toBe(2)
  })

  it("retries a timeout", async () => {
    script = [() => Promise.reject(new DOMException("timed out", "TimeoutError")), () => groqReply(GOOD)]
    expect((await ask()).attempts).toBe(2)
  })

  it("moves straight to the next provider on a rate limit or a rejected key", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    script = [() => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "retry-after": "30" } }), () => geminiReply(GOOD)]
    const done = await ask()
    expect(done.provider).toBe("gemini")
    expect(sent).toHaveLength(2) // no wasted retry against Groq
    expect(sleeps).toEqual([])

    sent = []
    script = [() => new Response("{}", { status: 401 }), () => geminiReply(GOOD)]
    expect((await ask()).provider).toBe("gemini")
    expect(sent).toHaveLength(2)
  })

  it("waits out a short rate limit when there is no other provider", async () => {
    script = [() => new Response("{}", { status: 429, headers: { "retry-after": "2" } }), () => groqReply(GOOD)]
    expect((await ask()).value).toEqual(GOOD)
    expect(sleeps).toEqual([2000])
  })

  it("does not wait out a long one", async () => {
    script = [() => new Response("{}", { status: 429, headers: { "retry-after": "120" } })]
    expect((await ask().catch((e) => e)).kind).toBe("rate_limit")
    expect(sleeps).toEqual([])
  })

  it("reports 'not configured' without contacting anyone", async () => {
    delete process.env.GROQ_API_KEY
    const err = await ask().catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.kind).toBe("unconfigured")
    expect(sent).toHaveLength(0)
    expect(calls()[0]).toMatchObject({ ok: 0, error_kind: "unconfigured", attempts: 0 })
  })

  it("records every call — who, which prompt version, how it went — but never the content or the key", async () => {
    script = [() => groqReply(GOOD)]
    await ask()
    const log = calls()
    expect(log).toEqual([{ purpose: "unit", provider: "groq", model: "openai/gpt-oss-120b", prompt_version: "unit.v1", ok: 1, error_kind: "", attempts: 1, subject_type: "test", subject_id: "t1" }])
    const columns = (getDb().prepare("PRAGMA table_info(ai_calls)").all() as { name: string }[]).map((c) => c.name)
    expect(columns).not.toEqual(expect.arrayContaining(["prompt", "content", "response", "api_key"]))
  })

  it("never lets a key into an error message", async () => {
    script = [() => new Response(JSON.stringify({ error: { message: "Invalid API key gsk_unit_test_key_0123456789abcdef for org_abc123XYZ" } }), { status: 500 }), () => new Response(JSON.stringify({ error: { message: "Invalid API key gsk_unit_test_key_0123456789abcdef for org_abc123XYZ" } }), { status: 500 })]
    const err = (await ask().catch((e) => e)) as AiError
    expect(err.message).not.toContain("gsk_unit_test_key")
    expect(err.message).not.toContain("org_abc123XYZ")
    expect(redact("key gsk_unit_test_key_0123456789abcdef and AIzaSyUnitTestKey0123456789abcdefghijk")).not.toMatch(/gsk_unit|AIzaSy/)
  })

  it("reads a provider's retry guidance from the header, Gemini's RetryInfo, or Groq's message — and ignores nonsense", () => {
    const r = (headers: Record<string, string> = {}) => new Response("{}", { status: 429, headers })
    expect(retryAfterMs(r({ "retry-after": "7" }), null)).toBe(7000)
    expect(retryAfterMs(r({ "retry-after": "2.5" }), null)).toBe(2500)
    const at = retryAfterMs(r({ "retry-after": new Date(Date.now() + 20_000).toUTCString() }), null)!
    expect(at).toBeGreaterThan(15_000)
    expect(at).toBeLessThanOrEqual(20_000)
    expect(retryAfterMs(r(), { error: { details: [{}, { retryDelay: "6s" }] } })).toBe(6000)
    expect(retryAfterMs(r(), { error: { message: "Rate limit reached … Please try again in 6.0075s. Need more tokens?" } })).toBe(6007.5)
    expect(retryAfterMs(r(), { error: { message: "Please try again in 1m2.5s." } })).toBe(62_500)
    for (const bad of ["soon", "-3", "0"]) expect(retryAfterMs(r({ "retry-after": bad }), null), bad).toBeUndefined()
    expect(retryAfterMs(r(), { error: { message: "rate limited" } })).toBeUndefined()
    expect(retryAfterMs(r({ "retry-after": "999999" }), null)).toBe(3_600_000) // capped
  })

  it("with BOTH providers rate-limited, waits the shortest short window once and retries that provider once", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    const limited = (headers: Record<string, string>) => () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers })
    script = [limited({ "retry-after": "6" }), limited({ "retry-after": "3" }), () => geminiReply(GOOD)]
    const done = await ask()
    expect(done.provider).toBe("gemini")
    expect(sleeps).toEqual([3000])
    expect(sent.map((s) => (s.url.includes("groq") ? "groq" : "gemini"))).toEqual(["groq", "gemini", "gemini"])
    expect(calls()[0]).toMatchObject({ ok: 1, provider: "gemini", attempts: 3 })
  })

  it("never waits more than once, and never for long: a second limit, or a long window, is reported with the wait", async () => {
    script = [() => new Response("{}", { status: 429, headers: { "retry-after": "2" } }), () => new Response("{}", { status: 429, headers: { "retry-after": "2" } })]
    const err = await ask().catch((e) => e)
    expect(err.kind).toBe("rate_limit")
    expect(sleeps).toEqual([2000]) // one bounded wait, then give up
    expect(sent).toHaveLength(2)

    sleeps = []
    sent = []
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey0123456789abcdefghijk"
    script = [() => new Response("{}", { status: 429, headers: { "retry-after": "45" } }), () => Response.json({ error: { message: "quota", details: [{ retryDelay: "30s" }] } }, { status: 429 })]
    const long = await ask().catch((e) => e)
    expect(sleeps).toEqual([]) // nothing synchronous over MAX_RATE_LIMIT_WAIT_MS
    expect(MAX_RATE_LIMIT_WAIT_MS).toBe(8000)
    expect(long.kind).toBe("rate_limit")
    expect(describeAiError(long)).toMatch(/too many requests.*Try again in about 30 seconds/)
  })

  it("names each kind of failure differently, so a rate limit is not reported as a timeout or an outage", () => {
    const msg = (kind: AiError["kind"], retry?: number) => describeAiError(new AiError(kind, "x", retry))
    expect(msg("rate_limit", 12_400)).toMatch(/too many requests.*about 13 seconds/)
    expect(msg("rate_limit")).toMatch(/too many requests.*in a minute/)
    expect(msg("timeout")).toMatch(/took too long/)
    expect(msg("http")).toMatch(/couldn't be reached or returned an error/)
    expect(msg("network")).toMatch(/couldn't be reached or returned an error/)
    expect(msg("bad_json")).toMatch(/couldn't be validated/)
    expect(msg("auth")).toMatch(/configuration problem/)
    expect(new Set(["rate_limit", "timeout", "http", "bad_json", "auth"].map((k) => msg(k as AiError["kind"]))).size).toBe(5)
  })

  it("describes each failure honestly — as 'nothing was assessed', never as a result", () => {
    for (const kind of ["unconfigured", "rate_limit", "timeout", "network", "http", "auth", "schema", "bad_json", "refused"] as const) {
      const message = describeAiError(new AiError(kind, "x"))
      expect(message, kind).toMatch(/nothing has been assessed|no assessment was made/i)
      expect(message, kind).not.toMatch(/\bpassed\b|\bfailed\b/i)
    }
  })
})

describe("health check", () => {
  it("reports a working key and a broken one, and reuses the answer for a minute", async () => {
    script = [() => groqReply("OK")]
    const provider = configuredProviders()[0]
    expect(await checkProviderHealth(provider)).toEqual({ ok: true })
    expect(await checkProviderHealth(provider)).toEqual({ ok: true })
    expect(sent).toHaveLength(1)

    sent = []
    process.env.GROQ_API_KEY = "gsk_another_test_key_0123456789abcdef"
    script = [() => new Response(JSON.stringify({ error: { message: "bad key for org_secret99" } }), { status: 401 })]
    const broken = await checkProviderHealth(configuredProviders()[0])
    expect(broken.ok).toBe(false)
    expect(broken.message).toContain("HTTP 401")
    expect(broken.message).not.toContain("org_secret99")
  })
})
