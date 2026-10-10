import { randomUUID } from "node:crypto"
import { AI_MOCK_BLOCKED_MESSAGE, aiMockOn, aiMockState, checkProviderHealth, configuredProvider, configuredProviders, lastCallOutcome, MOCK_MODEL, MOCK_PROVIDER } from "../ai/provider.ts"
import { resetDatabase } from "../db.ts"
import { ApiError, text } from "../http.ts"
import { all, exec, newId, nowIso, one } from "../sql.ts"
import type { Route } from "./types.ts"

/** Demo mode gates the one destructive action (reset) and the account switcher. It is not an authentication mechanism. */
export const isDemoMode = () => process.env.WASL_DEMO_MODE !== "false"

const MAX_ACCOUNTS = 2000

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")

export const publicRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/health$/,
    open: true,
    handler: async () => {
      // Demo mock mode: report it, and never probe a provider (that would spend quota).
      const mock = aiMockState()
      if (mock !== "off") {
        return {
          ai: { configured: mock === "on", provider: mock === "on" ? MOCK_PROVIDER : null, backup: null, model: mock === "on" ? MOCK_MODEL : null, keyWorks: mock === "on", message: mock === "on" ? "Demo mock AI: scripted answers, no provider is contacted." : AI_MOCK_BLOCKED_MESSAGE, lastCall: lastCallOutcome() },
          demoMode: isDemoMode(),
          aiMock: mock === "on",
        }
      }
      const provider = configuredProvider()
      const health = provider ? await checkProviderHealth(provider) : { ok: false, message: "No GROQ_API_KEY or GEMINI_API_KEY is configured. Challenge generation falls back to a labelled template; review, interview and assessment are unavailable." }
      return {
        ai: {
          configured: provider !== null,
          provider: provider?.id ?? null,
          backup: configuredProviders()[1]?.id ?? null,
          model: provider?.model ?? null,
          keyWorks: health.ok,
          message: health.message ?? null,
          lastCall: lastCallOutcome(),
        },
        demoMode: isDemoMode(),
        aiMock: false,
      }
    },
  },
  {
    method: "GET",
    pattern: /^\/session$/,
    open: true,
    handler: ({ db, actor }) => {
      if (actor.role === "student") {
        const c = one(db, "SELECT id, name, is_demo_fixture FROM candidates WHERE id = ?", actor.id)!
        return { actor: { role: "student", id: actor.id, name: String(c.name) }, demoMode: isDemoMode(), aiMock: aiMockOn() }
      }
      if (actor.role === "company") {
        const c = one(db, "SELECT id, name FROM companies WHERE id = ?", actor.id)!
        return { actor: { role: "company", id: actor.id, name: String(c.name) }, demoMode: isDemoMode(), aiMock: aiMockOn() }
      }
      return { actor: null, demoMode: isDemoMode(), aiMock: aiMockOn() }
    },
  },
  {
    // The demo login: lists accounts so a visitor can pick one. Only in demo mode.
    method: "GET",
    pattern: /^\/demo-accounts$/,
    open: true,
    handler: ({ db }) => {
      if (!isDemoMode()) return { demoMode: false, companies: [], students: [] }
      return {
        demoMode: true,
        companies: all(db, "SELECT id, name, industry FROM companies ORDER BY name").map((c) => ({ id: String(c.id), name: String(c.name), industry: String(c.industry) })),
        students: all(db, "SELECT id, name, status, headline, is_demo_fixture FROM candidates ORDER BY is_demo_fixture, name LIMIT 100").map((c) => ({
          id: String(c.id),
          name: String(c.name),
          status: String(c.status),
          headline: String(c.headline),
          isDemoFixture: c.is_demo_fixture === 1,
        })),
      }
    },
  },
  {
    // Demo sign-up: creates an account and returns its id for the X-WASL-Actor header. A real deployment needs real accounts.
    method: "POST",
    pattern: /^\/accounts$/,
    open: true,
    handler: ({ db, body }) => {
      if (!isDemoMode()) throw new ApiError(403, "Sign-up is only available in demo mode.")
      const role = body.role === "company" ? "company" : body.role === "student" ? "student" : null
      if (!role) throw new ApiError(400, "Choose whether you are a student/graduate or a company.", "role")
      const name = text(body.name, role === "company" ? "The company name" : "Your name", { required: true, min: 2, max: 80, key: "name" })
      const total = Number(one(db, "SELECT (SELECT COUNT(*) FROM candidates) + (SELECT COUNT(*) FROM companies) AS n")!.n)
      if (total >= MAX_ACCOUNTS) throw new ApiError(429, "This demo has reached its account limit.")
      const now = nowIso()
      if (role === "company") {
        if (one(db, "SELECT 1 FROM companies WHERE lower(name) = lower(?)", name)) throw new ApiError(409, "A company with that name already exists. Pick it from the demo accounts instead.", "name")
        const id = newId("co")
        exec(db, "INSERT INTO companies (id, name, logo_initials, created_at) VALUES (?, ?, ?, ?)", id, name, initials(name), now)
        return { id, role }
      }
      const id = `cand-${randomUUID().slice(0, 8)}`
      exec(db, "INSERT INTO candidates (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, name, body.status === "graduate" ? "graduate" : "student", now, now)
      return { id, role }
    },
  },
  {
    method: "POST",
    pattern: /^\/reset$/,
    open: true,
    handler: () => {
      if (!isDemoMode()) throw new ApiError(403, "Reset is only available in demo mode.")
      resetDatabase()
      return { ok: true }
    },
  },
]
