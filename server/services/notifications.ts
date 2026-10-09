import type { DatabaseSync } from "node:sqlite"
import { all, exec, newId, nowIso } from "../sql.ts"

export function notify(db: DatabaseSync, role: "student" | "company", recipientId: string, title: string, body: string, link: string | null): void {
  exec(db, "INSERT INTO notifications (id, recipient_role, recipient_id, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)", newId("ntf"), role, recipientId, title, body, link, nowIso())
}

export function listNotifications(db: DatabaseSync, role: "student" | "company", id: string) {
  return all(db, "SELECT id, title, body, link, read, created_at FROM notifications WHERE recipient_role = ? AND recipient_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50", role, id).map((n) => ({
    id: String(n.id),
    title: String(n.title),
    body: String(n.body),
    link: (n.link as string | null) ?? null,
    read: n.read === 1,
    createdAt: String(n.created_at),
  }))
}

export function markAllRead(db: DatabaseSync, role: "student" | "company", id: string): void {
  exec(db, "UPDATE notifications SET read = 1 WHERE recipient_role = ? AND recipient_id = ?", role, id)
}
