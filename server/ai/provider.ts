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
// With no key, AI features that need a model report that honestly; they never fall back to invented output.

import { getDb } from "../db.ts"
import { exec, newId, nowIso } from "../sql.ts"
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

export const configuredProvider = (): Provider | null => configuredProviders()[0] ?? null
export const aiConfigured = () => configuredProviders().length > 0

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

/** What to tell a person when a model call failed: honest, recoverable, never a result. */
export function describeAiError(err: unknown): string {
  if (!(err instanceof AiError)) return "Something went wrong while processing this step. Your work is saved — try again."
  switch (err.kind) {
    case "unconfigured":
      return "The AI review isn't available on this server right now (no AI provider is configured). Your work is saved; nothing has been assessed. Try again later."
    case "rate_limit":
    case "timeout":
    case "network":
    case "http":
      return "The AI service didn't respond in time. Your work is saved; nothing has been assessed. Try again in a minute."
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

/**
 * Asks for a JSON answer matching `output`. Providers are tried in order (Groq, then Gemini by default); a retryable failure
 * (network, timeout, malformed JSON, schema mismatch, 5xx) is retried once on the same provider, a rate limit or auth failure
 * moves on to the next one. Throws AiError when nothing produced a valid answer — callers must treat that as "unavailable",
 * never as a result.
 */
export async function completeJson<T>(opts: CompleteJsonOptions<T>): Promise<Completion<T>> {
  const providers = configuredProviders()
  const started = Date.now()
  if (providers.length === 0) {
    record(opts, { ok: false, provider: "", model: "", errorKind: "unconfigured", attempts: 0, started })
    throw new AiError("unconfigured", "No AI provider is configured on this server (set GROQ_API_KEY or GEMINI_API_KEY).")
  }
  let attempts = 0
  let last: AiError = new AiError("network", "No provider answered.")
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts++
      try {
        const value = await callOnce(provider, opts)
        record(opts, { ok: true, provider: provider.id, model: provider.model, errorKind: "", attempts, started })
        return { value, provider: provider.id, model: provider.model, attempts }
      } catch (err) {
        last = toAiError(err)
        if (last.kind === "rate_limit" || last.kind === "auth" || last.kind === "refused") break // next provider
        if (!RETRYABLE.includes(last.kind)) break
      }
    }
    // A short rate-limit window on the only provider is worth waiting out once.
    if (last.kind === "rate_limit" && providers.length === 1 && last.retryAfterMs && last.retryAfterMs <= 8_000) {
      await llmDeps.sleep(last.retryAfterMs)
      attempts++
      try {
        const value = await callOnce(provider, opts)
        record(opts, { ok: true, provider: provider.id, model: provider.model, errorKind: "", attempts, started })
        return { value, provider: provider.id, model: provider.model, attempts }
      } catch (err) {
        last = toAiError(err)
      }
    }
  }
  const lastProvider = providers[providers.length - 1]
  record(opts, { ok: false, provider: lastProvider.id, model: lastProvider.model, errorKind: last.kind, attempts, started })
  throw last
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

async function throwIfFailed(p: Provider, res: Response): Promise<void> {
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  const detail = body?.error?.message ? `: ${redact(body.error.message).slice(0, 200)}` : ""
  const message = `${p.label} returned HTTP ${res.status}${detail}`
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"))
    throw new AiError("rate_limit", message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined)
  }
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
