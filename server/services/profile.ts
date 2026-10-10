import type { DatabaseSync } from "node:sqlite"
import { canonicalSkillList } from "../domain/skills.ts"
import { ApiError, enumValue, stringList, text } from "../http.ts"
import type { Body } from "../http.ts"
import { prepareFile, UploadError } from "../screening.ts"
import { all, exec, nowIso, one, parseList } from "../sql.ts"
import { listCandidateRuns } from "./runs.ts"

export const AVAILABILITY = ["open_to_work", "open_to_internships", "not_available"] as const
export const AVAILABILITY_LABELS: Record<(typeof AVAILABILITY)[number], string> = {
  open_to_work: "Open to work",
  open_to_internships: "Open to internships",
  not_available: "Not available",
}
export const CANDIDATE_STATUS = ["student", "graduate"] as const
const MAX_CV_BYTES = 8 * 1024 * 1024

export interface CandidateLink {
  label: string
  url: string
}

function parseLinks(raw: unknown): CandidateLink[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ApiError(400, "Links must be a list.", "links")
  if (raw.length > 5) throw new ApiError(400, "You can add up to 5 links.", "links")
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>
    const label = text(o.label, "A link label", { required: true, max: 40, key: "links" })
    const url = text(o.url, "A link address", { required: true, max: 300, key: "links" })
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ApiError(400, `“${url}” isn't a valid address. Start with https://`, "links")
    }
    if (parsed.protocol !== "https:") throw new ApiError(400, "Links must start with https://", "links")
    return { label, url: parsed.href }
  })
}

export function updateProfile(db: DatabaseSync, candidateId: string, body: Body): void {
  const current = one(db, "SELECT * FROM candidates WHERE id = ?", candidateId)!
  const pick = <T>(key: string, parse: (v: unknown) => T, fallback: T): T => (key in body ? parse(body[key]) : fallback)
  const name = pick("name", (v) => text(v, "Your name", { required: true, min: 2, max: 80, key: "name" }), String(current.name))
  const headline = pick("headline", (v) => text(v, "Your headline", { max: 120, key: "headline" }), String(current.headline))
  const bio = pick("bio", (v) => text(v, "Your bio", { max: 1200, key: "bio" }), String(current.bio))
  const location = pick("location", (v) => text(v, "Your location", { max: 80, key: "location" }), String(current.location))
  const education = pick("education", (v) => text(v, "Your education", { max: 200, key: "education" }), String(current.education))
  const status = pick("status", (v) => enumValue(v, CANDIDATE_STATUS, "Status", { key: "status" }), current.status as (typeof CANDIDATE_STATUS)[number])
  const availability = pick("availability", (v) => enumValue(v, AVAILABILITY, "Availability", { key: "availability" }), current.availability as (typeof AVAILABILITY)[number])
  const declared = pick("declaredSkills", (v) => canonicalSkillList(stringList(v, "Skills", { max: 20, key: "declaredSkills" }), 20), parseList(current.declared_skills))
  const links = pick("links", parseLinks, JSON.parse(String(current.links)) as CandidateLink[])
  const discoverable = pick("discoverable", (v) => v === true, current.discoverable === 1)
  const cvShared = pick("cvShared", (v) => v === true, current.cv_shared === 1)
  exec(
    db,
    `UPDATE candidates SET name = ?, headline = ?, bio = ?, location = ?, education = ?, status = ?, availability = ?, declared_skills = ?, links = ?, discoverable = ?, cv_shared = ?, updated_at = ? WHERE id = ?`,
    name, headline, bio, location, education, status, availability, JSON.stringify(declared), JSON.stringify(links), discoverable ? 1 : 0, cvShared ? 1 : 0, nowIso(), candidateId,
  )
}

export async function saveCv(db: DatabaseSync, candidateId: string, body: Body): Promise<void> {
  const name = text(body.name, "The file name", { required: true, max: 200, key: "file" })
  const data = typeof body.data === "string" ? Buffer.from(body.data, "base64") : Buffer.alloc(0)
  if (data.length > MAX_CV_BYTES) throw new ApiError(400, "That file is larger than 8 MB.", "file")
  try {
    const file = await prepareFile("evidence", name, data)
    exec(
      db,
      `INSERT INTO candidate_cv_files (candidate_id, name, mime, size, data, text, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size, data = excluded.data, text = excluded.text, uploaded_at = excluded.uploaded_at`,
      candidateId, file.name, file.mime, file.data.length, file.data, file.text, nowIso(),
    )
  } catch (err) {
    if (err instanceof UploadError) throw new ApiError(400, err.message, "file")
    throw err
  }
}

export const deleteCv = (db: DatabaseSync, candidateId: string) => exec(db, "DELETE FROM candidate_cv_files WHERE candidate_id = ?", candidateId)

export function cvFile(db: DatabaseSync, candidateId: string) {
  const f = one(db, "SELECT name, mime, data FROM candidate_cv_files WHERE candidate_id = ?", candidateId)
  return f ? { name: String(f.name), mime: String(f.mime), data: f.data as Uint8Array } : null
}

// ------------------------------------------------------------------ evidence profile

export interface EvidenceItem {
  skill: string
  outcome: "passed" | "failed"
  runId: string
  runTitle: string
  kind: "company" | "practice"
  companyName: string | null
  phaseTitle: string
  ratings: { correctness: number; codeQuality: number; understanding: number }
  assessedAt: string
  origin: "ai" | "demo_fixture"
  isDemoFixture: boolean
}

export type Viewer = { kind: "self" } | { kind: "company"; companyId: string }

/**
 * Whether a viewer may see work from a run: the candidate always; a company only what the candidate shared with it. "Employers"
 * sharing applies only while the candidate is discoverable; sharing with the challenge owner applies to that company alone.
 */
export function runVisibleTo(viewer: Viewer, run: { kind: string; shareScope: string; challengeCompanyId: string | null; candidateDiscoverable: boolean }): boolean {
  if (viewer.kind === "self") return true
  if (run.shareScope === "employers" && run.candidateDiscoverable) return true
  return (run.shareScope === "challenge_owner" || run.shareScope === "employers") && run.kind === "company" && run.challengeCompanyId === viewer.companyId
}

export function evidenceItems(db: DatabaseSync, candidateId: string, viewer: Viewer): EvidenceItem[] {
  const rows = all(
    db,
    `SELECT a.outcome, a.correctness, a.code_quality, a.understanding, a.created_at, a.origin,
            r.id AS run_id, r.kind, r.share_scope, r.is_demo_fixture, r.challenge_id, v.title AS run_title, p.id AS phase_id, p.title AS phase_title, p.skills,
            c.company_id, co.name AS company_name
     FROM assessments a
     JOIN submissions s ON s.id = a.submission_id
     JOIN run_phases rp ON rp.id = s.run_phase_id
     JOIN runs r ON r.id = rp.run_id
     JOIN phases p ON p.id = rp.phase_id
     JOIN challenge_versions v ON v.id = r.version_id
     LEFT JOIN challenges c ON c.id = r.challenge_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE r.candidate_id = ? ORDER BY a.created_at`,
    candidateId,
  )
  const discoverable = one(db, "SELECT discoverable FROM candidates WHERE id = ?", candidateId)?.discoverable === 1
  // One item per (run, phase): the passing attempt if there is one, otherwise the latest.
  const best = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (!runVisibleTo(viewer, { kind: String(r.kind), shareScope: String(r.share_scope), challengeCompanyId: (r.company_id as string | null) ?? null, candidateDiscoverable: discoverable })) continue
    const key = `${r.run_id}|${r.phase_id}`
    const prev = best.get(key)
    // Keep a passing attempt over a non-passing one; among equals, the later attempt.
    if (!prev || (r.outcome === "passed" ? 1 : 0) >= (prev.outcome === "passed" ? 1 : 0)) best.set(key, r)
  }
  const items: EvidenceItem[] = []
  for (const r of best.values()) {
    // Employers see what a candidate has demonstrated. Attempts that haven't passed are the candidate's own business.
    if (viewer.kind === "company" && r.outcome !== "passed") continue
    for (const skill of parseList(r.skills)) {
      items.push({
        skill,
        outcome: r.outcome as "passed" | "failed",
        runId: String(r.run_id),
        runTitle: String(r.run_title),
        kind: r.kind as "company" | "practice",
        companyName: (r.company_name as string | null) ?? null,
        phaseTitle: String(r.phase_title),
        ratings: { correctness: Number(r.correctness), codeQuality: Number(r.code_quality), understanding: Number(r.understanding) },
        assessedAt: String(r.created_at),
        origin: r.origin as "ai" | "demo_fixture",
        // Demonstration data — a seeded run, or an assessment made by the demo mock — is always labelled as such.
        isDemoFixture: r.is_demo_fixture === 1 || r.origin === "demo_fixture",
      })
    }
  }
  return items
}

export function evidenceProfile(db: DatabaseSync, candidateId: string, viewer: Viewer) {
  const c = one(db, "SELECT declared_skills FROM candidates WHERE id = ?", candidateId)!
  const declared = parseList(c.declared_skills)
  const items = evidenceItems(db, candidateId, viewer)
  const skills = new Map<string, { skill: string; status: "demonstrated" | "building" | "declared"; declared: boolean; evidence: EvidenceItem[] }>()
  const entry = (skill: string) => {
    const key = skill.toLowerCase()
    if (!skills.has(key)) skills.set(key, { skill, status: "declared", declared: false, evidence: [] })
    return skills.get(key)!
  }
  for (const skill of declared) entry(skill).declared = true
  for (const item of items) {
    const e = entry(item.skill)
    e.evidence.push(item)
    if (item.outcome === "passed") e.status = "demonstrated"
    else if (e.status !== "demonstrated") e.status = "building"
  }
  const list = [...skills.values()].sort((a, b) => {
    const rank = { demonstrated: 0, building: 1, declared: 2 }
    return rank[a.status] - rank[b.status] || b.evidence.length - a.evidence.length || a.skill.localeCompare(b.skill)
  })
  const passed = items.filter((i) => i.outcome === "passed")
  return {
    declaredSkills: declared,
    skills: list,
    demonstratedCount: list.filter((s) => s.status === "demonstrated").length,
    phasesPassed: new Set(passed.map((i) => `${i.runId}|${i.phaseTitle}`)).size,
    explanation:
      "“Demonstrated” means a Proof Engine assessment of the candidate's own submission and interview passed for a phase that exercises the skill. “Declared” is self-reported and unverified.",
  }
}

export function ownProfile(db: DatabaseSync, candidateId: string) {
  const c = one(db, "SELECT * FROM candidates WHERE id = ?", candidateId)!
  const cv = one(db, "SELECT name, size, uploaded_at FROM candidate_cv_files WHERE candidate_id = ?", candidateId)
  return {
    id: String(c.id),
    name: String(c.name),
    headline: String(c.headline),
    bio: String(c.bio),
    location: String(c.location),
    education: String(c.education),
    status: c.status as (typeof CANDIDATE_STATUS)[number],
    availability: c.availability as (typeof AVAILABILITY)[number],
    availabilityLabel: AVAILABILITY_LABELS[c.availability as (typeof AVAILABILITY)[number]],
    declaredSkills: parseList(c.declared_skills),
    links: JSON.parse(String(c.links)) as CandidateLink[],
    discoverable: c.discoverable === 1,
    cvShared: c.cv_shared === 1,
    isDemoFixture: c.is_demo_fixture === 1,
    cv: cv ? { name: String(cv.name), size: Number(cv.size), uploadedAt: String(cv.uploaded_at) } : null,
    evidence: evidenceProfile(db, candidateId, { kind: "self" }),
    work: listCandidateRuns(db, candidateId),
    sharingNotice:
      "Employers see your profile only when “Discoverable” is on, and then only the work you have chosen to share with employers. Practice work is private unless you share it.",
  }
}
