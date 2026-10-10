// The one door to a language model. Every AI feature in WASL (challenge generation, review, interview, assessment, lessons)
// calls `completeJson` and gets back a value that has been parsed against its schema — or an AiError. Nothing else in the
// codebase talks to a provider.
//
// Settings (environment variables on the server; see .env.example):
//   GROQ_API_KEY      use Groq (tried first when both keys are set)
//   GROQ_MODEL        optional, defaults to "openai/gpt-oss-120b"
//   GEMINI_API_KEY    use Gemini (the backup provider)
//   GEMINI_MODEL      optional, defaults to "gemini-flash-latest"
//   WASL_AI_PROVIDER  optional, "groq" or "gemini", to choose which is tried first
//   WASL_AI_TIMEOUT_MS            optional per-request timeout (default 45000)
//   WASL_GROQ_BASE_URL / WASL_GEMINI_BASE_URL   development and test only: point a provider at a local mock server
//   WASL_AI_MOCK      "true" for local demo rehearsal only: scripted answers, no provider is ever contacted (see aiMockState)
// With no key, AI features that need a model report that honestly; they never fall back to invented output.

import { getDb } from "../db.ts"
import { exec, newId, nowIso } from "../sql.ts"
import { FakeAi } from "../testing/fake-ai.ts"
import { toGeminiSchema } from "./schema.ts"
import type { OutputSpec } from "./schema.ts"
import { SchemaError } from "./schema.ts"

// Local development convenience: load keys from a git-ignored .env in the project root, if one exists. Deployments set the
// variables directly, so a missing file is not an error.
try {
  process.loadEnvFile()
} catch {
  // No .env file — keys may already be set in the environment.
}

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest"
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
const DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
const DEFAULT_GROQ_BASE = "https://api.groq.com/openai/v1"

/** Swappable for tests, so they never reach the network or wait on real timers. */
export const llmDeps = {
  fetch: (input: string, init: RequestInit): Promise<Response> => fetch(input, init),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface Provider {
  id: "groq" | "gemini"
  label: string
  apiKey: string
  model: string
}

export function configuredProviders(): Provider[] {
  const groqKey = process.env.GROQ_API_KEY?.trim()
  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  const groq = groqKey ? { id: "groq" as const, label: "Groq", apiKey: groqKey, model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL } : null
  const gemini = geminiKey
    ? { id: "gemini" as const, label: "Gemini", apiKey: geminiKey, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL }
    : null
  const wanted = process.env.WASL_AI_PROVIDER?.trim().toLowerCase()
  const ordered = wanted === "gemini" ? [gemini, groq] : [groq, gemini]
  return ordered.filter((p): p is Provider => p !== null)
}

// ------------------------------------------------------------------ demo mock mode

/** What every mock call is recorded and shown as, so its output can't be mistaken for a real model's. */
export const MOCK_PROVIDER = "mock"
export const MOCK_MODEL = "wasl-demo-mock"

/**
 * Demo mock mode, for rehearsing a presentation without spending provider quota. Off unless WASL_AI_MOCK is exactly "true".
 * "blocked" when it was asked for where it must not run — production (NODE_ENV=production), demo mode switched off
 * (WASL_DEMO_MODE=false) — or with a value that isn't "true"/"false". Blocked fails closed: the server refuses to start and
 * every AI call fails, rather than quietly using the mock OR quietly spending real quota.
 */
export function aiMockState(): "off" | "on" | "blocked" {
  const v = process.env.WASL_AI_MOCK?.trim().toLowerCase()
  if (!v || v === "false") return "off"
  if (v !== "true") return "blocked"
  if (process.env.NODE_ENV === "production" || process.env.WASL_DEMO_MODE === "false") return "blocked"
  return "on"
}
export const aiMockOn = () => aiMockState() === "on"
export const AI_MOCK_BLOCKED_MESSAGE =
  "WASL_AI_MOCK is set, but demo mock AI is only allowed for local demo rehearsal (WASL_AI_MOCK=true, demo mode on, NODE_ENV not production). Unset WASL_AI_MOCK to use the real providers."

// Scripted, deterministic answers (always the "strong" behaviour).
const mockAi = new FakeAi()

export const configuredProvider = (): Provider | null => configuredProviders()[0] ?? null
export const aiConfigured = () => {
  const mock = aiMockState()
  return mock === "on" ? true : mock === "blocked" ? false : configuredProviders().length > 0
}

const groqBase = () => (process.env.WASL_GROQ_BASE_URL?.trim() || DEFAULT_GROQ_BASE).replace(/\/$/, "")
const geminiBase = () => (process.env.WASL_GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE).replace(/\/$/, "")
const timeoutMs = () => {
  const n = Number(process.env.WASL_AI_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 1000 ? n : 45_000
}

export type AiErrorKind = "unconfigured" | "network" | "timeout" | "rate_limit" | "auth" | "http" | "bad_json" | "schema" | "refused"

export class AiError extends Error {
  kind: AiErrorKind
  retryAfterMs?: number
  constructor(kind: AiErrorKind, message: string, retryAfterMs?: number) {
    super(message)
    this.kind = kind
    this.retryAfterMs = retryAfterMs
  }
}

/** Provider errors can name the account's organization, and a key must never appear in any message we keep or show. */
export function redact(message: string): string {
  let out = message.replace(/\borg_[A-Za-z0-9]+/g, "org_…")
  for (const p of configuredProviders()) if (p.apiKey.length >= 8) out = out.split(p.apiKey).join("[key]")
  return out.replace(/\b(gsk_|AIza|sk-)[A-Za-z0-9_-]{8,}/g, "[key]")
}

/** "about 12 seconds" / "about 2 minutes", or "a minute" when the provider gave no guidance. */
export const waitPhrase = (ms?: number) => {
  if (!ms || ms <= 0) return "a minute"
  const s = Math.max(1, Math.ceil(ms / 1000))
  return s < 90 ? `about ${s} second${s === 1 ? "" : "s"}` : `about ${Math.ceil(s / 60)} minutes`
}

/** What to tell a person when a model call failed: honest, recoverable, never a result. Each kind of failure is named. */
export function describeAiError(err: unknown): string {
  if (!(err instanceof AiError)) return "Something went wrong while processing this step. Your work is saved — try again."
  switch (err.kind) {
    case "unconfigured":
      return "The AI review isn't available on this server right now (no AI provider is configured). Your work is saved; nothing has been assessed. Try again later."
    case "rate_limit":
      return `The AI service is handling too many requests right now. Your work is saved; nothing has been assessed. Try again in ${waitPhrase(err.retryAfterMs)}.`
    case "timeout":
      return "The AI service took too long to answer. Your work is saved; nothing has been assessed. Try again in a minute."
    case "network":
    case "http":
      return "The AI service couldn't be reached or returned an error. Your work is saved; nothing has been assessed. Try again in a minute."
    case "auth":
      return "The AI service is not available because of a configuration problem on the server. Your work is saved; nothing has been assessed."
    default:
      return "The AI's answer couldn't be validated, so no assessment was made. Your work is saved — try again."
  }
}

export interface CompleteJsonOptions<T> {
  /** What this call is for — recorded in ai_calls (never the content). */
  purpose: string
  promptVersion: string
  system: string
  user: string
  output: OutputSpec<T>
  temperature?: number
  maxTokens?: number
  reasoning?: "low" | "medium" | "high"
  /** What the call concerns, for traceability: e.g. { type: "submission", id }. */
  subject?: { type: string; id: string }
}

export interface Completion<T> {
  value: T
  provider: string
  model: string
  attempts: number
}

const RETRYABLE: AiErrorKind[] = ["network", "timeout", "bad_json", "schema", "http"]
/** The longest a request will wait on a provider's retry guidance, and it waits at most once. Longer waits are reported instead. */
export const MAX_RATE_LIMIT_WAIT_MS = 8_000

/**
 * Asks for a JSON answer matching `output`. Providers are tried in order (Groq, then Gemini by default); a retryable failure
 * (network, timeout, malformed JSON, schema mismatch, 5xx) is retried once on the same provider, a rate limit or auth failure
 * moves on to the next one. If every provider failed and one of them was rate-limited with a short retry window, the request
 * waits that window once (never more than MAX_RATE_LIMIT_WAIT_MS) and tries that provider once more. Throws AiError when
 * nothing produced a valid answer — callers must treat that as "unavailable", never as a result.
 */
export async function completeJson<T>(opts: CompleteJsonOptions<T>): Promise<Completion<T>> {
  const started = Date.now()
  // Checked before any provider is chosen, so in mock mode no request can reach Groq, Gemini or anything else.
  const mock = aiMockState()
  if (mock === "on") return completeMock(opts, started)
  if (mock === "blocked") {
    record(opts, { ok: false, provider: MOCK_PROVIDER, model: "", errorKind: "auth", attempts: 0, started })
    throw new AiError("auth", AI_MOCK_BLOCKED_MESSAGE)
  }
  const providers = configuredProviders()
  if (providers.length === 0) {
    record(opts, { ok: false, provider: "", model: "", errorKind: "unconfigured", attempts: 0, started })
    throw new AiError("unconfigured", "No AI provider is configured on this server (set GROQ_API_KEY or GEMINI_API_KEY).")
  }
  let attempts = 0
  let last: AiError = new AiError("network", "No provider answered.")
  let lastProvider = providers[providers.length - 1]
  let shortWait: { provider: Provider; ms: number } | null = null
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts++
      try {
        const value = await callOnce(provider, opts)
        record(opts, { ok: true, provider: provider.id, model: provider.model, errorKind: "", attempts, started })
        return { value, provider: provider.id, model: provider.model, attempts }
      } catch (err) {
        last = toAiError(err)
        lastProvider = provider
        if (last.kind === "rate_limit") {
          const ms = last.retryAfterMs
          if (ms && ms <= MAX_RATE_LIMIT_WAIT_MS && (!shortWait || ms < shortWait.ms)) shortWait = { provider, ms }
        }
        if (last.kind === "rate_limit" || last.kind === "auth" || last.kind === "refused") break // next provider
        if (!RETRYABLE.includes(last.kind)) break
      }
    }
  }
  // Every provider failed. A short rate-limit window is worth waiting out once — bounded, and only once per request.
  if (shortWait) {
    await llmDeps.sleep(shortWait.ms)
    attempts++
    try {
      const value = await callOnce(shortWait.provider, opts)
      record(opts, { ok: true, provider: shortWait.provider.id, model: shortWait.provider.model, errorKind: "", attempts, started })
      return { value, provider: shortWait.provider.id, model: shortWait.provider.model, attempts }
    } catch (err) {
      last = toAiError(err)
      lastProvider = shortWait.provider
    }
  }
  record(opts, { ok: false, provider: lastProvider.id, model: lastProvider.model, errorKind: last.kind, attempts, started })
  throw last
}

/**
 * A scripted answer, built in-process from the same prompt a provider would get, then parsed against the same schema as a
 * real answer — so everything downstream (grounding, evidence checks, the decision rule) runs unchanged. No network.
 */
function completeMock<T>(opts: CompleteJsonOptions<T>, started: number): Completion<T> {
  const out = mockAi.respond({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: { json_schema: { name: opts.output.name } },
  })
  mockAi.calls.length = 0 // the fake keeps a call log for tests; a long rehearsal shouldn't grow it
  try {
    const text = (out.body as { choices: { message: { content: string } }[] }).choices[0].message.content
    const value = opts.output.field.parse(JSON.parse(text), "")
    record(opts, { ok: true, provider: MOCK_PROVIDER, model: MOCK_MODEL, errorKind: "", attempts: 1, started })
    return { value, provider: MOCK_PROVIDER, model: MOCK_MODEL, attempts: 1 }
  } catch (err) {
    const e = err instanceof SyntaxError ? new AiError("bad_json", "The demo mock returned a response that isn't valid JSON.") : toAiError(err)
    record(opts, { ok: false, provider: MOCK_PROVIDER, model: MOCK_MODEL, errorKind: e.kind, attempts: 1, started })
    throw e
  }
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err instanceof SchemaError) return new AiError("schema", redact(`The model's answer did not match the expected format (${err.message}).`))
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) return new AiError("timeout", "The model took too long to answer.")
  return new AiError("network", redact(err instanceof Error ? err.message : String(err)).slice(0, 300))
}

async function callOnce<T>(provider: Provider, opts: CompleteJsonOptions<T>): Promise<T> {
  const text = provider.id === "groq" ? await callGroq(provider, opts) : await callGemini(provider, opts)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AiError("bad_json", `${provider.label} returned a response that isn't valid JSON.`)
  }
  return opts.output.field.parse(parsed, "")
}

async function callGroq<T>(p: Provider, opts: CompleteJsonOptions<T>): Promise<string> {
  const res = await llmDeps.fetch(`${groqBase()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      temperature: opts.temperature ?? 0,
      max_completion_tokens: opts.maxTokens ?? 4096,
      // gpt-oss models are reasoning models; the setting is rejected by others.
      ...(p.model.includes("gpt-oss") ? { reasoning_effort: opts.reasoning ?? "low" } : {}),
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: opts.output.name, strict: true, schema: opts.output.field.schema } },
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  await throwIfFailed(p, res)
  const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[] }
  const choice = data.choices?.[0]
  if (choice?.message?.refusal) throw new AiError("refused", `${p.label} declined to answer.`)
  if (choice?.finish_reason === "length") throw new AiError("bad_json", `${p.label}'s answer was cut off.`)
  return choice?.message?.content ?? ""
}

async function callGemini<T>(p: Provider, opts: CompleteJsonOptions<T>): Promise<string> {
  const res = await llmDeps.fetch(`${geminiBase()}/models/${encodeURIComponent(p.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": p.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxTokens ?? 4096,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(opts.output.field.schema),
      },
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  })
  await throwIfFailed(p, res)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
  if (data.promptFeedback?.blockReason) throw new AiError("refused", `${p.label} declined to answer.`)
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === "MAX_TOKENS") throw new AiError("bad_json", `${p.label}'s answer was cut off.`)
  return candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
}

/**
 * A provider's retry guidance, in ms, from (in order): the Retry-After header (seconds or an HTTP date), Gemini's
 * RetryInfo.retryDelay ("6s"), or Groq's "Please try again in 1m2.5s" in the message. Undefined when there is none or it is
 * not a sensible positive duration (capped at an hour so a garbled value can't park a submission).
 */
export function retryAfterMs(res: Response, body: { error?: { message?: string; details?: { retryDelay?: string }[] } } | null): number | undefined {
  const sane = (ms: number) => (Number.isFinite(ms) && ms > 0 ? Math.min(ms, 3_600_000) : undefined)
  const header = res.headers.get("retry-after")?.trim()
  if (header) {
    if (/^\d+(\.\d+)?$/.test(header)) return sane(Number(header) * 1000)
    const at = Date.parse(header)
    if (!Number.isNaN(at)) return sane(at - Date.now())
  }
  const delay = body?.error?.details?.find((d) => typeof d?.retryDelay === "string")?.retryDelay
  const fromDelay = delay ? /^(\d+(?:\.\d+)?)s$/.exec(delay.trim()) : null
  if (fromDelay) return sane(Number(fromDelay[1]) * 1000)
  const inText = /try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i.exec(body?.error?.message ?? "")
  if (inText) return sane((Number(inText[1] ?? 0) * 60 + Number(inText[2])) * 1000)
  return undefined
}

async function throwIfFailed(p: Provider, res: Response): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string; details?: { retryDelay?: string }[] } } | null
  const detail = body?.error?.message ? `: ${redact(body.error.message).slice(0, 200)}` : ""
  const message = `${p.label} returned HTTP ${res.status}${detail}`
  // Groq's strict json_schema mode reports an answer it could not validate — including one cut off by the token limit — as a
  // 400 rather than finish_reason "length". That is an invalid answer (retried the same way), not a service outage.
  if (p.id === "groq" && res.status === 400 && (body?.error?.code === "json_validate_failed" || /failed to validate json|does not match the expected schema/i.test(body?.error?.message ?? ""))) {
    throw new AiError("bad_json", `${p.label}'s answer could not be validated as JSON (it may have been cut off).`)
  }
  if (res.status === 429) throw new AiError("rate_limit", message, retryAfterMs(res, body))
  if (res.status === 401 || res.status === 403) throw new AiError("auth", message)
  throw new AiError("http", message)
}

function record(
  opts: CompleteJsonOptions<unknown>,
  r: { ok: boolean; provider: string; model: string; errorKind: string; attempts: number; started: number },
): void {
  try {
    exec(
      getDb(),
      `INSERT INTO ai_calls (id, purpose, provider, model, prompt_version, ok, error_kind, attempts, latency_ms, subject_type, subject_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("aic"), opts.purpose, r.provider, r.model, opts.promptVersion, r.ok ? 1 : 0, r.errorKind, r.attempts,
      Date.now() - r.started, opts.subject?.type ?? "", opts.subject?.id ?? "", nowIso(),
    )
  } catch {
    // Traceability must never break the feature it describes.
  }
  lastOutcome = { ok: r.ok, at: nowIso(), purpose: opts.purpose, ...(r.ok ? {} : { message: r.errorKind }) }
}

export interface CallOutcome {
  ok: boolean
  at: string
  purpose: string
  message?: string
}
let lastOutcome: CallOutcome | null = null
/** The most recent model call since the server started, for GET /api/health. */
export const lastCallOutcome = (): CallOutcome | null => lastOutcome

// The endpoint is public, so a burst of requests reuses one check instead of each spending tokens.
const HEALTH_CACHE_MS = 60_000
let lastHealth: { key: string; at: number; result: { ok: boolean; message?: string } } | null = null

/** Whether the configured key and model respond: a real request for a few tokens, reused for a minute. */
export async function checkProviderHealth(provider: Provider): Promise<{ ok: boolean; message?: string }> {
  const key = `${provider.id}:${provider.model}:${provider.apiKey}`
  if (lastHealth && lastHealth.key === key && Date.now() - lastHealth.at < HEALTH_CACHE_MS) return lastHealth.result
  const result = await probe(provider)
  lastHealth = { key, at: Date.now(), result }
  return result
}

async function probe(provider: Provider): Promise<{ ok: boolean; message?: string }> {
  try {
    const signal = AbortSignal.timeout(10_000)
    const res =
      provider.id === "groq"
        ? await llmDeps.fetch(`${groqBase()}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify({ model: provider.model, max_completion_tokens: 16, messages: [{ role: "user", content: "Reply with OK." }] }),
            signal,
          })
        : await llmDeps.fetch(`${geminiBase()}/models/${encodeURIComponent(provider.model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }], generationConfig: { maxOutputTokens: 16 } }),
            signal,
          })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    const detail = body?.error?.message ? redact(body.error.message).slice(0, 200) : ""
    return { ok: false, message: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` }
  } catch (err) {
    return { ok: false, message: redact(err instanceof Error ? err.message : String(err)) }
  }
}
