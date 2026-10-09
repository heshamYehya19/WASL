import type { DatabaseSync } from "node:sqlite"
import { canonicalSkillList } from "../domain/skills.ts"
import { ApiError, enumValue, stringList, text } from "../http.ts"
import type { Body } from "../http.ts"
import { all, exec, newId, nowIso, one } from "../sql.ts"
import { notify } from "./notifications.ts"
import { AVAILABILITY, AVAILABILITY_LABELS, CANDIDATE_STATUS, evidenceProfile } from "./profile.ts"
import type { CandidateLink, EvidenceItem } from "./profile.ts"

export interface TalentQuery {
  skills: string[]
  match: "all" | "any"
  /** Count only skills the candidate has demonstrated, not ones they have declared. */
  demonstratedOnly: boolean
  availability: string
  status: string
  location: string
}

export function parseTalentQuery(params: URLSearchParams): TalentQuery {
  const skills = canonicalSkillList(stringList(params.get("skills") ?? "", "Skills", { max: 8, key: "skills" }), 8)
  return {
    skills,
    match: params.get("match") === "any" ? "any" : "all",
    demonstratedOnly: params.get("demonstrated") === "1",
    availability: params.get("availability") ? enumValue(params.get("availability"), AVAILABILITY, "Availability") : "",
    status: params.get("status") ? enumValue(params.get("status"), CANDIDATE_STATUS, "Status") : "",
    location: text(params.get("location"), "Location", { max: 80 }),
  }
}

export interface SkillMatch {
  skill: string
  status: "demonstrated" | "declared" | "none"
  evidence: EvidenceItem[]
}

/** A candidate a company may look at: discoverable, or a participant in one of the company's own challenges. */
function visibleTo(db: DatabaseSync, companyId: string, candidateId: string): boolean {
  const c = one(db, "SELECT discoverable FROM candidates WHERE id = ?", candidateId)
  if (!c) return false
  if (c.discoverable === 1) return true
  return !!one(
    db,
    `SELECT 1 FROM runs r JOIN challenges ch ON ch.id = r.challenge_id
     WHERE r.candidate_id = ? AND ch.company_id = ? AND r.share_scope IN ('challenge_owner', 'employers')`,
    candidateId, companyId,
  )
}

function summary(db: DatabaseSync, companyId: string, row: Record<string, unknown>) {
  const evidence = evidenceProfile(db, String(row.id), { kind: "company", companyId })
  const action = all(db, "SELECT kind FROM company_actions WHERE company_id = ? AND candidate_id = ?", companyId, String(row.id)).map((a) => String(a.kind))
  return {
    id: String(row.id),
    name: String(row.name),
    headline: String(row.headline),
    location: String(row.location),
    status: row.status as (typeof CANDIDATE_STATUS)[number],
    education: String(row.education),
    availability: row.availability as (typeof AVAILABILITY)[number],
    availabilityLabel: AVAILABILITY_LABELS[row.availability as (typeof AVAILABILITY)[number]],
    bio: String(row.bio),
    links: JSON.parse(String(row.links)) as CandidateLink[],
    cvAvailable: row.cv_shared === 1 && !!one(db, "SELECT 1 FROM candidate_cv_files WHERE candidate_id = ?", String(row.id)),
    isDemoFixture: row.is_demo_fixture === 1,
    evidence,
    saved: action.includes("saved"),
    interestSent: action.includes("interested"),
  }
}

export function searchTalent(db: DatabaseSync, companyId: string, q: TalentQuery) {
  const rows = all(db, "SELECT * FROM candidates WHERE discoverable = 1 ORDER BY name")
  const results = []
  for (const row of rows) {
    if (q.availability && row.availability !== q.availability) continue
    if (q.status && row.status !== q.status) continue
    if (q.location && !String(row.location).toLowerCase().includes(q.location.toLowerCase())) continue
    const profile = summary(db, companyId, row)
    const matches: SkillMatch[] = q.skills.map((skill) => {
      const found = profile.evidence.skills.find((s) => s.skill.toLowerCase() === skill.toLowerCase())
      if (found?.status === "demonstrated") return { skill, status: "demonstrated" as const, evidence: found.evidence }
      if (found?.declared && !q.demonstratedOnly) return { skill, status: "declared" as const, evidence: [] }
      return { skill, status: "none" as const, evidence: [] }
    })
    if (q.skills.length > 0) {
      const hit = matches.filter((m) => m.status !== "none").length
      if (q.match === "all" ? hit < matches.length : hit === 0) continue
    }
    // Transparent scoring: a demonstrated skill counts 3 (+0.5 for each extra piece of evidence, up to 1); a declared one counts 1.
    const score = matches.reduce((sum, m) => sum + (m.status === "demonstrated" ? 3 + Math.min(m.evidence.length - 1, 2) * 0.5 : m.status === "declared" ? 1 : 0), 0)
    results.push({ candidate: profile, matches, score })
  }
  results.sort((a, b) => b.score - a.score || b.candidate.evidence.demonstratedCount - a.candidate.evidence.demonstratedCount || a.candidate.name.localeCompare(b.candidate.name))
  return {
    query: q,
    results,
    scoring:
      "Candidates are ranked by how well their evidence matches the skills you searched for: a skill demonstrated through a passed Proof Engine assessment counts for more than one the candidate only declared. Nothing else — not names, schools or photos — affects the order.",
  }
}

export function talentCandidate(db: DatabaseSync, companyId: string, candidateId: string) {
  if (!visibleTo(db, companyId, candidateId)) throw new ApiError(404, "That candidate isn't available to you.")
  return summary(db, companyId, one(db, "SELECT * FROM candidates WHERE id = ?", candidateId)!)
}

export function saveCandidate(db: DatabaseSync, companyId: string, candidateId: string): { saved: boolean } {
  if (!visibleTo(db, companyId, candidateId)) throw new ApiError(404, "That candidate isn't available to you.")
  const existing = one(db, "SELECT id FROM company_actions WHERE company_id = ? AND candidate_id = ? AND kind = 'saved'", companyId, candidateId)
  if (existing) {
    exec(db, "DELETE FROM company_actions WHERE id = ?", String(existing.id))
    return { saved: false }
  }
  exec(db, "INSERT INTO company_actions (id, company_id, candidate_id, kind, created_at) VALUES (?, ?, ?, 'saved', ?)", newId("act"), companyId, candidateId, nowIso())
  return { saved: true }
}

const MAX_INTERESTS_PER_DAY = 25

/** The "express interest" workflow: one expression per company and candidate, visible to the candidate as a notification. */
export function expressInterest(db: DatabaseSync, companyId: string, candidateId: string, body: Body): void {
  if (!visibleTo(db, companyId, candidateId)) throw new ApiError(404, "That candidate isn't available to you.")
  const message = text(body.message, "Your message", { max: 500, key: "message" })
  if (one(db, "SELECT 1 FROM company_actions WHERE company_id = ? AND candidate_id = ? AND kind = 'interested'", companyId, candidateId)) {
    throw new ApiError(409, "You've already expressed interest in this candidate.")
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const sent = one(db, "SELECT COUNT(*) AS n FROM company_actions WHERE company_id = ? AND kind = 'interested' AND created_at > ?", companyId, since)!
  if (Number(sent.n) >= MAX_INTERESTS_PER_DAY) throw new ApiError(429, `You can express interest in up to ${MAX_INTERESTS_PER_DAY} candidates a day. Try again tomorrow.`)
  const company = one(db, "SELECT name FROM companies WHERE id = ?", companyId)!
  exec(db, "INSERT INTO company_actions (id, company_id, candidate_id, kind, message, created_at) VALUES (?, ?, ?, 'interested', ?, ?)", newId("act"), companyId, candidateId, message, nowIso())
  notify(db, "student", candidateId, `${String(company.name)} is interested in you`, message ? `“${message}”` : "They'd like to talk about opportunities. You can reply through the contact details on your profile.", "/student/interest")
}

export function companyShortlist(db: DatabaseSync, companyId: string) {
  return all(
    db,
    `SELECT a.kind, a.message, a.created_at, c.* FROM company_actions a JOIN candidates c ON c.id = a.candidate_id WHERE a.company_id = ? ORDER BY a.created_at DESC`,
    companyId,
  )
    .filter((r) => visibleTo(db, companyId, String(r.id)))
    .map((r) => ({ kind: r.kind as "saved" | "interested", message: String(r.message), at: String(r.created_at), candidate: summary(db, companyId, r) }))
}

export function interestReceived(db: DatabaseSync, candidateId: string) {
  return all(
    db,
    `SELECT a.message, a.created_at, co.id AS company_id, co.name, co.industry, co.location, co.logo_initials
     FROM company_actions a JOIN companies co ON co.id = a.company_id WHERE a.candidate_id = ? AND a.kind = 'interested' ORDER BY a.created_at DESC`,
    candidateId,
  ).map((r) => ({
    company: { id: String(r.company_id), name: String(r.name), industry: String(r.industry), location: String(r.location), logoInitials: String(r.logo_initials) },
    message: String(r.message),
    at: String(r.created_at),
  }))
}
