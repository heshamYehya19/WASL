import type { IncomingMessage, ServerResponse } from "node:http"
import { AiError, describeAiError } from "./ai/provider.ts"
import { getDb } from "./db.ts"
import { ApiError, readBody, resolveActor, send } from "./http.ts"
import { companyRoutes } from "./routes/company.ts"
import { publicRoutes } from "./routes/public.ts"
import { studentRoutes } from "./routes/student.ts"
import { talentRoutes } from "./routes/talent.ts"
import type { Route } from "./routes/types.ts"

// Every route lives in server/routes/*. This file only turns an HTTP request into a RouteContext: it resolves the actor from
// the X-WASL-Actor header (see http.ts for what that is and is not), finds the route, and shapes errors.
const ROUTES: Route[] = [...publicRoutes, ...companyRoutes, ...talentRoutes, ...studentRoutes]

/** Handles any `/api/*` request. Returns false for anything else so the caller can fall through. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (!url.pathname.startsWith("/api/")) return false
  const path = url.pathname.slice(4)

  try {
    const db = getDb()
    const rawHeader = req.headers["x-wasl-actor"]
    const actor = resolveActor(db, Array.isArray(rawHeader) ? rawHeader[0] : rawHeader)

    for (const route of ROUTES) {
      if (route.method !== req.method) continue
      const match = route.pattern.exec(path)
      if (!match) continue
      if (!route.open && actor.role === "guest") throw new ApiError(401, "Sign in to continue.")
      const params = match.slice(1).map((p) => {
        try {
          return decodeURIComponent(p)
        } catch {
          throw new ApiError(404, "Not found.")
        }
      })
      const body = req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req)
      const result = await route.handler({ db, actor, params, body, url, res })
      if (!route.raw) send(res, 200, result ?? { ok: true })
      return true
    }
    send(res, 404, { error: "Not found." })
  } catch (err) {
    if (err instanceof ApiError) send(res, err.status, { error: err.message, ...(err.field ? { field: err.field } : {}), ...(err.detail !== undefined ? { detail: err.detail } : {}) })
    else if (err instanceof AiError) {
      // A model call failed and the request could not be completed without it. Nothing was invented in its place.
      send(res, 503, { error: describeAiError(err), detail: { aiError: err.kind, templateAvailable: true } })
    } else {
      console.error("[wasl-api]", err)
      send(res, 500, { error: "Something went wrong on the server." })
    }
  }
  return true
}
