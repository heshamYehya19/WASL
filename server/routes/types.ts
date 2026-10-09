import type { ServerResponse } from "node:http"
import type { DatabaseSync } from "node:sqlite"
import type { Actor, Body } from "../http.ts"

export interface RouteContext {
  db: DatabaseSync
  actor: Actor
  params: string[]
  body: Body
  url: URL
  res: ServerResponse
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE"
  pattern: RegExp
  /** Returns the JSON body. A `raw` route writes its own response (a file download) and returns nothing. */
  handler: (c: RouteContext) => unknown | Promise<unknown>
  raw?: boolean
  /** Routes that need no signed-in account. */
  open?: boolean
}
