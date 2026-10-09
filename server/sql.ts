import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

export type Row = Record<string, unknown>
export type Param = string | number | null | Uint8Array

/** One row, or undefined. */
export function one(db: DatabaseSync, sql: string, ...params: Param[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined
}

export function all(db: DatabaseSync, sql: string, ...params: Param[]): Row[] {
  return db.prepare(sql).all(...params) as Row[]
}

export function exec(db: DatabaseSync, sql: string, ...params: Param[]) {
  db.prepare(sql).run(...params)
}

/** Runs `fn` atomically: commits when it returns, rolls back when it throws. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}

export const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`
export const nowIso = () => new Date().toISOString()
export const parseList = (v: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(v ?? "[]"))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
