import { mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

// server/db.ts reads WASL_DB_PATH at module-load time, so it must be set before db.ts/api.ts are ever imported — hence the
// dynamic imports below instead of static ones. Each test FILE gets its own fresh module registry under vitest's default
// per-file isolation, so each file gets its own temp database and its own in-memory getDb() singleton — no cross-file
// contamination. Test files must import this module before any server module.
export const testDir = mkdtempSync(join(tmpdir(), "wasl-test-"))
process.env.WASL_DB_PATH = join(testDir, "wasl.db")
process.env.WASL_DEMO_MODE = "true"
delete process.env.WASL_SEED_DEMO_DATA

export const { resetDatabase, getDb } = await import("../db.ts")
export const { handleApi } = await import("../api.ts")
const { llmDeps } = await import("../ai/provider.ts")
const { githubDeps } = await import("../github.ts")
const { learningDeps, clearLinkChecks } = await import("../services/learning.ts")
const { FakeAi } = await import("../testing/fake-ai.ts")
export type { FakeBehavior } from "../testing/fake-ai.ts"

// provider.ts loads a developer's real .env on import. Tests must never reach a live model (slow, flaky, and it spends a real
// quota), so drop any keys it loaded — a test that needs a provider calls useFakeAi() or sets a fake key and mocks llmDeps.
for (const k of ["GROQ_API_KEY", "GROQ_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "WASL_AI_PROVIDER", "WASL_GROQ_BASE_URL", "WASL_GEMINI_BASE_URL", "GITHUB_TOKEN"]) delete process.env[k]

export { llmDeps, githubDeps, learningDeps, clearLinkChecks }

/** The scriptable provider. `useFakeAi()` points the real provider layer at it; behaviours are switched on `fakeAi.behavior`. */
export const fakeAi = new FakeAi()

export function useFakeAi(): void {
  process.env.GROQ_API_KEY = "test-groq-key-0123456789"
  delete process.env.GEMINI_API_KEY
  fakeAi.reset()
  llmDeps.sleep = async () => undefined
  llmDeps.fetch = async (url, init) => {
    if (!url.endsWith("/chat/completions")) return new Response(JSON.stringify({ error: { message: "not mocked" } }), { status: 500 })
    const out = fakeAi.respond(JSON.parse(String(init.body)))
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } })
  }
}

/** No provider configured, and any attempt to reach one fails loudly. */
export function noAi(): void {
  delete process.env.GROQ_API_KEY
  delete process.env.GEMINI_API_KEY
  llmDeps.fetch = async () => {
    throw new Error("A test reached for the network with no provider configured")
  }
}

/** Every link check succeeds (the default for tests), unless a test overrides learningDeps.fetch. */
export function linksOk(): void {
  clearLinkChecks()
  learningDeps.fetch = async () => new Response("", { status: 200 })
}

/** A public repository, served through the same two GitHub hosts the real reader contacts. */
export function mockRepo(owner: string, repo: string, files: Record<string, string>, ref = "main"): void {
  githubDeps.fetch = async (input) => {
    const url = new URL(input)
    if (url.hostname === "api.github.com") {
      if (url.pathname === `/repos/${owner}/${repo}`) return Response.json({ default_branch: ref })
      if (url.pathname.startsWith(`/repos/${owner}/${repo}/git/trees/`)) {
        return Response.json({ tree: Object.entries(files).map(([path, content]) => ({ path, type: "blob", size: content.length })) })
      }
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const prefix = `/${owner}/${repo}/${ref}/`
      if (url.pathname.startsWith(prefix)) {
        const path = decodeURIComponent(url.pathname.slice(prefix.length))
        if (path in files) return new Response(files[path])
      }
    }
    return new Response("not found", { status: 404 })
  }
}

githubDeps.fetch = async () => new Response("not found", { status: 404 })
linksOk()
noAi()

export interface TestResponse {
  status: number
  json: Record<string, unknown>
}

export interface TestServer {
  close: () => Promise<void>
  /** Calls `/api{path}` against a real ephemeral http server — the exact same handleApi contract server/index.ts and
   * vite.config.ts use in production/dev. */
  call: (method: string, path: string, actor?: string, body?: unknown) => Promise<TestResponse>
  /** A raw GET of `/api{path}`, for responses that aren't JSON (file downloads). */
  fetch: (path: string, actor?: string) => Promise<Response>
}

export async function startServer(): Promise<TestServer> {
  const server = createServer((req, res) => {
    handleApi(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404
        res.end()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    fetch: (path, actor) => fetch(`http://localhost:${port}/api${path}`, { headers: actor ? { "X-WASL-Actor": actor } : {} }),
    call: async (method, path, actor, body) => {
      const res = await fetch(`http://localhost:${port}/api${path}`, {
        method,
        headers: { ...(actor ? { "X-WASL-Actor": actor } : {}), "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { status: res.status, json }
    },
  }
}

// ------------------------------------------------------------------ scenario helpers

export const SARA = "student:cand-sara"
export const LAYLA = "student:cand-layla"
export const OMAR = "student:cand-omar"
export const NAHLA = "company:co-nahla"
export const ORBIT = "company:co-orbit"

export const BRIEF = {
  problemDescription: "Our support team sorts incoming tickets by hand. We want a small tool that reads a ticket and suggests which queue it belongs in, with the reason.",
  requiredSkills: ["python", "software testing"],
  difficulty: "beginner",
  expectedDeliverables: "A Python function with tests and a short note about its limits.",
  timeHours: 6,
}

export const GOOD_CODE = [
  "BILLING = {'invoice', 'refund', 'payment'}",
  "",
  "def route_ticket(ticket):",
  "    text = f\"{ticket.get('subject', '')} {ticket.get('body', '')}\".lower()",
  "    if ticket.get('tier') == 'enterprise':",
  "        return {'queue': 'priority', 'reason': 'enterprise tier'}",
  "    if any(word in text for word in BILLING):",
  "        return {'queue': 'billing', 'reason': 'billing keyword'}",
  "    return {'queue': 'general', 'reason': 'no keyword matched'}",
].join("\n")

export const GOOD_ANSWER =
  "When route_ticket runs it lowercases the subject and body, checks the enterprise tier first because those customers always go to the priority queue, and then looks for billing words. Anything else falls to general."

type Call = TestServer["call"]

/** A company that drafts, generates, reviews and publishes a challenge. Returns its id. */
export async function publishChallenge(call: Call, company = NAHLA, brief: Record<string, unknown> = BRIEF): Promise<string> {
  const created = await call("POST", "/company/challenges", company, brief)
  if (created.status !== 200) throw new Error(`create failed: ${JSON.stringify(created.json)}`)
  const id = String(created.json.id)
  const generated = await call("POST", `/company/challenges/${id}/generate`, company, {})
  if (generated.status !== 200) throw new Error(`generate failed: ${JSON.stringify(generated.json)}`)
  await call("POST", `/company/challenges/${id}/review`, company)
  const published = await call("POST", `/company/challenges/${id}/publish`, company, { acknowledgeEvaluationUse: true })
  if (published.status !== 200) throw new Error(`publish failed: ${JSON.stringify(published.json)}`)
  return id
}

export async function startRun(call: Call, challengeId: string, student = SARA): Promise<string> {
  const res = await call("POST", `/challenges/${challengeId}/start`, student, { acknowledgeSharing: true })
  if (res.status !== 200) throw new Error(`start failed: ${JSON.stringify(res.json)}`)
  return String(res.json.id)
}

export async function submit(call: Call, runId: string, key: string, body: Record<string, unknown> = { code: GOOD_CODE, language: "Python" }, student = SARA) {
  return call("POST", `/work/${runId}/phases/${key}/submissions`, student, body)
}

/** Answers every interview question until the interview ends. Returns the final response. */
export async function finishInterview(call: Call, submissionId: string, student = SARA, answer = GOOD_ANSWER) {
  let last: TestResponse = { status: 200, json: {} }
  for (let i = 0; i < 8; i++) {
    const detail = await call("GET", `/submissions/${submissionId}`, student)
    const sub = detail.json.submission as { interview: { awaitingAnswer: boolean } | null; state: string }
    if (!sub.interview?.awaitingAnswer) break
    last = await call("POST", `/submissions/${submissionId}/answer`, student, { answer })
  }
  return last
}

/** Submit a phase and take its interview to the end. Returns the submission id and the final detail. */
export async function passPhase(call: Call, runId: string, key: string, student = SARA) {
  const out = await submit(call, runId, key, undefined, student)
  const submissionId = String(out.json.submissionId)
  await finishInterview(call, submissionId, student)
  const detail = await call("GET", `/submissions/${submissionId}`, student)
  return { submissionId, detail: detail.json.submission as { state: string; assessment: { outcome: string } | null } }
}
