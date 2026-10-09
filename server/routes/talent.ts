import { ApiError, requireRole, sendAttachment } from "../http.ts"
import { companyShortlist, expressInterest, parseTalentQuery, saveCandidate, searchTalent, talentCandidate } from "../services/discovery.ts"
import { cvFile } from "../services/profile.ts"
import { one } from "../sql.ts"
import type { Route } from "./types.ts"

const company = (c: { actor: Parameters<typeof requireRole>[0] }) => requireRole(c.actor, "company")

export const talentRoutes: Route[] = [
  { method: "GET", pattern: /^\/talent$/, handler: ({ db, actor, url }) => searchTalent(db, company({ actor }).id, parseTalentQuery(url.searchParams)) },
  { method: "GET", pattern: /^\/talent\/shortlist$/, handler: ({ db, actor }) => ({ shortlist: companyShortlist(db, company({ actor }).id) }) },
  { method: "GET", pattern: /^\/talent\/([^/]+)$/, handler: ({ db, actor, params }) => ({ candidate: talentCandidate(db, company({ actor }).id, params[0]) }) },
  { method: "POST", pattern: /^\/talent\/([^/]+)\/save$/, handler: ({ db, actor, params }) => saveCandidate(db, company({ actor }).id, params[0]) },
  {
    method: "POST",
    pattern: /^\/talent\/([^/]+)\/interest$/,
    handler: ({ db, actor, params, body }) => {
      expressInterest(db, company({ actor }).id, params[0], body)
      return { ok: true }
    },
  },
  {
    method: "GET",
    pattern: /^\/talent\/([^/]+)\/cv$/,
    raw: true,
    handler: ({ db, actor, params, res }) => {
      const me = company({ actor })
      // The CV is downloadable only if the candidate is visible to this company AND chose to share it.
      const candidate = talentCandidate(db, me.id, params[0])
      const shared = one(db, "SELECT cv_shared FROM candidates WHERE id = ?", candidate.id)
      const file = shared?.cv_shared === 1 ? cvFile(db, candidate.id) : null
      if (!file) throw new ApiError(404, "This candidate hasn't shared a CV.")
      sendAttachment(res, file)
    },
  },
]
