// The only place the interface talks to the server. The signed-in account is sent as the X-WASL-Actor header — demo sign-in,
// not production authentication (see server/http.ts and the README).

export class ApiRequestError extends Error {
  status: number
  /** The form field the server says this error belongs to, if any. */
  field?: string
  /** Extra structured detail (for example, the notice a person has to acknowledge). */
  detail?: unknown
  constructor(message: string, status = 0, field?: string, detail?: unknown) {
    super(message)
    this.status = status
    this.field = field
    this.detail = detail
  }
}

let actorHeader: string | null = null
/** Set by the session provider whenever the signed-in account changes. */
export function setActor(role: string | null, id: string | null) {
  actorHeader = role && id ? `${role}:${id}` : null
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(actorHeader ? { "X-WASL-Actor": actorHeader } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiRequestError("Can't reach the WASL server. Is it running?")
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(data?.error ?? `Request failed (${res.status}).`, res.status, typeof data?.field === "string" ? data.field : undefined, data?.detail)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  del: <T = { ok: true }>(path: string) => request<T>("DELETE", path),
}

/** Downloads a file. A plain link can't carry the actor header, so fetch it and hand the browser a blob. */
export async function download(path: string, fallbackName: string) {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { headers: actorHeader ? { "X-WASL-Actor": actorHeader } : {} })
  } catch {
    throw new ApiRequestError("Can't reach the WASL server. Is it running?")
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiRequestError(data?.error ?? `Download failed (${res.status}).`, res.status)
  }
  const disposition = res.headers.get("content-disposition") ?? ""
  const name = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const url = URL.createObjectURL(await res.blob())
  const a = Object.assign(document.createElement("a"), { href: url, download: name ? decodeURIComponent(name) : fallbackName })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Reads a File as base64 (what the upload endpoints expect). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(new ApiRequestError("Couldn't read that file."))
    reader.readAsDataURL(file)
  })
}
