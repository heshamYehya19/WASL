import type { IncomingMessage, ServerResponse } from "node:http"
import type { DatabaseSync } from "node:sqlite"
import { one } from "./sql.ts"

export class ApiError extends Error {
  status: number
  /** The form field this error belongs to, so the client can show it inline next to that field. */
  field?: string
  /** Extra structured detail for the client (e.g. which phases are still open). */
  detail?: unknown
  constructor(status: number, message: string, field?: string, detail?: unknown) {
    super(message)
    this.status = status
    this.field = field
    this.detail = detail
  }
}

/**
 * DEMO AUTH, not production auth. `X-WASL-Actor: role:id` is trusted as-is once the id is confirmed to exist in the database
 * — there is no password, session or signed token anywhere in this app. A real deployment needs server-issued sessions (or
 * signed tokens) and CSRF protection on mutating routes instead of a client-supplied header. Every route still derives
 * ownership from the actor resolved here, never from ids in the request body, so the authorization rules are real; what
 * is missing for production is proof that the request came from that account.
 */
export type Actor = { role: "guest" } | { role: "student"; id: string } | { role: "company"; id: string }

export function resolveActor(db: DatabaseSync, header: string | undefined): Actor {
  if (!header) return { role: "guest" }
  const [role, id] = header.split(":")
  const table = role === "student" ? "candidates" : role === "company" ? "companies" : null
  if (!table || !id) return { role: "guest" }
  // An account that no longer exists (e.g. after a reset) is treated as signed out.
  if (!one(db, `SELECT id FROM ${table} WHERE id = ?`, id)) return { role: "guest" }
  return { role, id } as Actor
}

export function requireRole<R extends Actor["role"]>(actor: Actor, role: R): Extract<Actor, { role: R }> {
  if (actor.role === "guest") throw new ApiError(401, "Sign in to do this.")
  if (actor.role !== role) throw new ApiError(403, `Only ${role === "student" ? "a student or graduate" : "a company"} account can do this.`)
  return actor as Extract<Actor, { role: R }>
}

export type Body = Record<string, unknown>

// A CV upload arrives base64-encoded (~4/3 of its size).
const MAX_BODY_BYTES = 12 * 1024 * 1024

export async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size <= MAX_BODY_BYTES) chunks.push(chunk as Buffer)
  }
  if (size > MAX_BODY_BYTES) throw new ApiError(413, "That request is too large.")
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : {}
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.")
  }
}

export function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.end(JSON.stringify(payload))
}

export function sendAttachment(res: ServerResponse, file: { name: string; mime: string; data: Uint8Array }) {
  res.statusCode = 200
  res.setHeader("Content-Type", file.mime)
  // oxlint-disable-next-line no-control-regex -- header-safe file name
  res.setHeader("Content-Disposition", `attachment; filename="${file.name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`)
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Cache-Control", "no-store")
  res.end(Buffer.from(file.data))
}

// ------------------------------------------------------------------ validation
// Every message names the field and says what to do next. `key` tags the error with the form field it belongs to.

export function text(v: unknown, field: string, { required = false, min = 0, max = 4000, key }: { required?: boolean; min?: number; max?: number; key?: string } = {}): string {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""
  if (required && !s) throw new ApiError(400, `${field} is required — fill it in and try again.`, key)
  if (s && s.length < min) throw new ApiError(400, `${field} is too short (${s.length} characters; at least ${min} are needed). Add some detail and try again.`, key)
  if (s.length > max) throw new ApiError(400, `${field} is too long (${s.length} characters; the limit is ${max}). Shorten it and try again.`, key)
  return s
}

export function enumValue<const V extends readonly string[]>(v: unknown, allowed: V, field: string, opts: { fallback?: V[number]; key?: string } = {}): V[number] {
  if ((v === undefined || v === null || v === "") && opts.fallback !== undefined) return opts.fallback
  if (typeof v !== "string" || !allowed.includes(v)) throw new ApiError(400, `${field} must be one of: ${allowed.join(", ")}.`, opts.key)
  return v as V[number]
}

export function wholeNumber(v: unknown, field: string, { min, max, key }: { min: number; max: number; key?: string }): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `${field} must be a whole number between ${min} and ${max}.`, key)
  return n
}

export function stringList(v: unknown, field: string, { max = 10, itemMax = 60, min = 0, key }: { max?: number; itemMax?: number; min?: number; key?: string } = {}): string[] {
  const list = v === undefined || v === null ? [] : Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n;]/) : null
  if (list === null) throw new ApiError(400, `${field} must be a list.`, key)
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const s = typeof item === "string" ? item.trim() : ""
    if (!s) continue
    if (s.length > itemMax) throw new ApiError(400, `Each item in ${field.toLowerCase()} must be at most ${itemMax} characters.`, key)
    if (seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  if (out.length > max) throw new ApiError(400, `${field} can have at most ${max} items.`, key)
  if (out.length < min) throw new ApiError(400, `${field} needs at least ${min} item${min === 1 ? "" : "s"}.`, key)
  return out
}

export function decodeParam(value: string, what: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ApiError(404, `${what} not found.`)
  }
}
