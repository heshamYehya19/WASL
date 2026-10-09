import { requireRole, text } from "../http.ts"
import {
  archive,
  companyChallengeDetail,
  complete,
  createChallenge,
  generateForChallenge,
  listCompanyChallenges,
  markReviewed,
  parseBrief,
  publish,
  saveEdit,
  updateBrief,
} from "../services/challenges.ts"
import { listNotifications, markAllRead } from "../services/notifications.ts"
import { participantList, participantRun, participantSubmission } from "../services/participants.ts"
import { exec, one } from "../sql.ts"
import type { Route } from "./types.ts"

const company = (c: { actor: Parameters<typeof requireRole>[0] }) => requireRole(c.actor, "company")

export const companyRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/company\/me$/,
    handler: ({ db, actor }) => {
      const { id } = requireRole(actor, "company")
      const row = one(db, "SELECT * FROM companies WHERE id = ?", id)!
      const challenges = listCompanyChallenges(db, id)
      return {
        company: { id, name: String(row.name), industry: String(row.industry), location: String(row.location), about: String(row.about), website: String(row.website), logoInitials: String(row.logo_initials) },
        counts: {
          challenges: challenges.length,
          published: challenges.filter((c) => c.status === "published" || c.status === "in_progress").length,
          candidates: challenges.reduce((n, c) => n + c.candidatesStarted, 0),
        },
      }
    },
  },
  {
    method: "PUT",
    pattern: /^\/company\/me$/,
    handler: ({ db, actor, body }) => {
      const { id } = requireRole(actor, "company")
      const current = one(db, "SELECT * FROM companies WHERE id = ?", id)!
      const field = (key: string, label: string, max: number) => (key in body ? text(body[key], label, { max, key }) : String(current[key]))
      exec(
        db,
        "UPDATE companies SET industry = ?, location = ?, about = ?, website = ? WHERE id = ?",
        field("industry", "Industry", 80), field("location", "Location", 80), field("about", "About", 1500), field("website", "Website", 200), id,
      )
      return { ok: true }
    },
  },
  { method: "GET", pattern: /^\/company\/challenges$/, handler: ({ db, actor }) => ({ challenges: listCompanyChallenges(db, company({ actor }).id) }) },
  {
    method: "POST",
    pattern: /^\/company\/challenges$/,
    handler: ({ db, actor, body }) => {
      const { id } = company({ actor })
      const { brief, warnings } = parseBrief(body)
      return { id: createChallenge(db, id, brief), warnings }
    },
  },
  { method: "GET", pattern: /^\/company\/challenges\/([^/]+)$/, handler: ({ db, actor, params }) => ({ challenge: companyChallengeDetail(db, company({ actor }).id, params[0]) }) },
  {
    method: "PUT",
    pattern: /^\/company\/challenges\/([^/]+)\/brief$/,
    handler: ({ db, actor, params, body }) => {
      const { brief, warnings } = parseBrief(body)
      updateBrief(db, company({ actor }).id, params[0], brief)
      return { warnings }
    },
  },
  {
    method: "POST",
    pattern: /^\/company\/challenges\/([^/]+)\/generate$/,
    handler: ({ db, actor, params, body }) => generateForChallenge(db, company({ actor }).id, params[0], { useTemplate: body.useTemplate === true }),
  },
  { method: "PUT", pattern: /^\/company\/challenges\/([^/]+)\/version$/, handler: ({ db, actor, params, body }) => saveEdit(db, company({ actor }).id, params[0], body) },
  {
    method: "POST",
    pattern: /^\/company\/challenges\/([^/]+)\/review$/,
    handler: ({ db, actor, params }) => {
      markReviewed(db, company({ actor }).id, params[0])
      return { ok: true }
    },
  },
  {
    method: "POST",
    pattern: /^\/company\/challenges\/([^/]+)\/publish$/,
    handler: ({ db, actor, params, body }) => {
      publish(db, company({ actor }).id, params[0], body)
      return { ok: true }
    },
  },
  {
    method: "POST",
    pattern: /^\/company\/challenges\/([^/]+)\/archive$/,
    handler: ({ db, actor, params }) => {
      archive(db, company({ actor }).id, params[0])
      return { ok: true }
    },
  },
  {
    method: "POST",
    pattern: /^\/company\/challenges\/([^/]+)\/complete$/,
    handler: ({ db, actor, params }) => {
      complete(db, company({ actor }).id, params[0])
      return { ok: true }
    },
  },
  { method: "GET", pattern: /^\/company\/challenges\/([^/]+)\/participants$/, handler: ({ db, actor, params }) => participantList(db, company({ actor }).id, params[0]) },
  { method: "GET", pattern: /^\/company\/challenges\/([^/]+)\/participants\/([^/]+)$/, handler: ({ db, actor, params }) => participantRun(db, company({ actor }).id, params[0], params[1]) },
  {
    method: "GET",
    pattern: /^\/company\/challenges\/([^/]+)\/participants\/([^/]+)\/submissions\/([^/]+)$/,
    handler: ({ db, actor, params }) => ({ submission: participantSubmission(db, company({ actor }).id, params[0], params[1], params[2]) }),
  },
  {
    method: "GET",
    pattern: /^\/company\/notifications$/,
    handler: ({ db, actor }) => ({ notifications: listNotifications(db, "company", company({ actor }).id) }),
  },
  {
    method: "POST",
    pattern: /^\/company\/notifications\/read$/,
    handler: ({ db, actor }) => {
      markAllRead(db, "company", company({ actor }).id)
      return { ok: true }
    },
  },
]
