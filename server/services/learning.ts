import type { DatabaseSync } from "node:sqlite"
import { giveFeedback, LESSON_BASIS_LABELS, lessonBasis, writeExercise, writeLesson } from "../ai/learning.ts"
import type { GapContext } from "../ai/learning.ts"
import { quoteInText } from "../analysis/grounding.ts"
import { ApiError, text } from "../http.ts"
import type { Body } from "../http.ts"
import { CATALOG_HOSTS, matchCatalog, SEARCH_HOST, searchUrl } from "../learning/catalog.ts"
import { all, exec, newId, nowIso, one } from "../sql.ts"
import { loadSession } from "./submissions.ts"
import { loadVersion } from "./versions.ts"

/** Swappable for tests, so they never reach the network. */
export const learningDeps = {
  fetch: (input: string, init?: RequestInit): Promise<Response> => fetch(input, init),
}

const CHECK_TTL_MS = 24 * 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 6_000
const checked = new Map<string, { at: number; status: "verified" | "broken" | "unknown"; note: string }>()

export type LinkStatus = "verified" | "broken" | "unknown"

/**
 * Whether a resource link still works. Only https links on the catalog's own hosts are ever contacted (so a recommendation can
 * never make this server fetch an arbitrary address). 2xx/3xx = verified; 404/410 = broken (the link is dropped); anything else,
 * including a network failure, = unknown (shown, but not labelled verified).
 */
export async function verifyResourceUrl(rawUrl: string): Promise<{ status: LinkStatus; note: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { status: "broken", note: "Not a valid address." }
  }
  if (url.protocol !== "https:" || !(CATALOG_HOSTS.has(url.hostname) || url.hostname === SEARCH_HOST)) return { status: "broken", note: "Not an allowed address." }
  if (url.hostname === SEARCH_HOST) return { status: "verified", note: "A search link, not a course." }
  const cached = checked.get(url.href)
  if (cached && Date.now() - cached.at < CHECK_TTL_MS) return { status: cached.status, note: cached.note }
  let result: { status: LinkStatus; note: string }
  try {
    const res = await learningDeps.fetch(url.href, { method: "GET", redirect: "follow", headers: { "User-Agent": "wasl-link-check", Range: "bytes=0-0" }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    await res.body?.cancel().catch(() => undefined)
    if (res.ok || (res.status >= 300 && res.status < 400)) result = { status: "verified", note: `Reachable (HTTP ${res.status}).` }
    else if (res.status === 404 || res.status === 410) result = { status: "broken", note: `The page no longer exists (HTTP ${res.status}).` }
    else result = { status: "unknown", note: `The site answered HTTP ${res.status}, so the link couldn't be confirmed.` }
  } catch {
    result = { status: "unknown", note: "The link couldn't be checked just now." }
  }
  checked.set(url.href, { at: Date.now(), ...result })
  return result
}

/** Test helper: forget cached link checks. */
export const clearLinkChecks = () => checked.clear()

// ------------------------------------------------------------------ gaps

interface GapRow {
  id: string
  candidateId: string
  runId: string
  phaseId: string
  submissionId: string
  skill: string
  title: string
  detail: string
  evidence: { source: string; quote: string; path: string; line: number | null }
  severity: "minor" | "moderate" | "significant"
  createdAt: string
}

const toGap = (r: Record<string, unknown>): GapRow => ({
  id: String(r.id),
  candidateId: String(r.candidate_id),
  runId: String(r.run_id),
  phaseId: String(r.phase_id),
  submissionId: String(r.submission_id),
  skill: String(r.skill),
  title: String(r.title),
  detail: String(r.detail),
  evidence: JSON.parse(String(r.evidence || "{}")) as GapRow["evidence"],
  severity: r.severity as GapRow["severity"],
  createdAt: String(r.created_at),
})

function ownedGap(db: DatabaseSync, candidateId: string, gapId: string): GapRow {
  const r = one(db, "SELECT * FROM skill_gaps WHERE id = ? AND candidate_id = ?", gapId, candidateId)
  if (!r) throw new ApiError(404, "That skill gap wasn't found.")
  return toGap(r)
}

/** Whether the phase the gap came from has since passed — the gap is then shown as worked through, not removed. */
function resolved(db: DatabaseSync, gap: GapRow): boolean {
  const rp = one(db, "SELECT state FROM run_phases WHERE run_id = ? AND phase_id = ?", gap.runId, gap.phaseId)
  return rp?.state === "passed"
}

/** Everything the learning material is grounded in: the gap, its VERIFIED evidence and where it came from, and the phase. */
function gapContext(db: DatabaseSync, gap: GapRow): GapContext {
  const run = one(db, "SELECT version_id FROM runs WHERE id = ?", gap.runId)!
  const version = loadVersion(db, String(run.version_id))!
  const sub = one(db, "SELECT language FROM submissions WHERE id = ?", gap.submissionId)
  const phase = one(db, "SELECT title, objective FROM phases WHERE id = ?", gap.phaseId)
  const assessment = one(db, "SELECT weaknesses FROM assessments WHERE submission_id = ?", gap.submissionId)
  const source = gap.evidence.source === "code" || gap.evidence.source === "answer" ? gap.evidence.source : "none"
  const quote = gap.evidence.quote ?? ""
  // For an answer, the question it replied to: what the learner was actually asked when the gap showed.
  let askedQuestion = ""
  if (source === "answer" && quote) {
    const messages = loadSession(db, gap.submissionId)?.messages ?? []
    const i = messages.findIndex((m) => m.role === "candidate" && quoteInText(quote, m.content))
    if (i > 0 && messages[i - 1].role === "interviewer") askedQuestion = messages[i - 1].content
  }
  let weaknesses: string[] = []
  try {
    weaknesses = (JSON.parse(String(assessment?.weaknesses ?? "[]")) as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 5)
  } catch {
    weaknesses = []
  }
  return {
    skill: gap.skill,
    title: gap.title,
    detail: gap.detail,
    severity: gap.severity,
    difficulty: version.spec.difficulty,
    language: String(sub?.language ?? ""),
    evidenceQuote: quote,
    evidenceSource: source,
    evidenceLocation: source === "code" && gap.evidence.path ? `${gap.evidence.path}${gap.evidence.line ? ` line ${gap.evidence.line}` : ""}` : "",
    askedQuestion,
    phaseTitle: String(phase?.title ?? ""),
    phaseObjective: String(phase?.objective ?? ""),
    weaknesses,
    gapId: gap.id,
  }
}

export function listGaps(db: DatabaseSync, candidateId: string) {
  const rows = all(db, "SELECT * FROM skill_gaps WHERE candidate_id = ? ORDER BY created_at DESC, rowid DESC", candidateId).map(toGap)
  const seen = new Set<string>()
  const latest: GapRow[] = []
  for (const g of rows) {
    // Repeated attempts report the same gap again; show each (skill, gap) once, from the most recent attempt.
    const key = `${g.runId}|${g.phaseId}|${g.skill}|${g.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    latest.push(g)
  }
  return latest.map((g) => {
    const phase = one(db, "SELECT p.title AS phase_title, v.title AS challenge_title FROM phases p JOIN challenge_versions v ON v.id = p.version_id WHERE p.id = ?", g.phaseId)
    return {
      id: g.id,
      skill: g.skill,
      title: g.title,
      detail: g.detail,
      severity: g.severity,
      phaseTitle: String(phase?.phase_title ?? ""),
      challengeTitle: String(phase?.challenge_title ?? ""),
      runId: g.runId,
      resolved: resolved(db, g),
      hasLesson: !!one(db, "SELECT 1 FROM lessons WHERE gap_id = ?", g.id),
      hasExercise: !!one(db, "SELECT 1 FROM exercises WHERE gap_id = ?", g.id),
      createdAt: g.createdAt,
    }
  })
}

async function ensureRecommendations(db: DatabaseSync, gap: GapRow, difficulty: GapContext["difficulty"]) {
  if (one(db, "SELECT 1 FROM recommendations WHERE gap_id = ?", gap.id)) return
  const entries = matchCatalog(gap.skill, `${gap.title} ${gap.detail}`, difficulty)
  let added = 0
  for (const entry of entries) {
    const check = await verifyResourceUrl(entry.url)
    if (check.status === "broken") continue // never recommend a link we know is dead
    exec(
      db,
      "INSERT INTO recommendations (id, gap_id, title, provider, url, kind, verified, verified_at, verify_note, why) VALUES (?, ?, ?, ?, ?, 'catalog', ?, ?, ?, ?)",
      newId("rec"), gap.id, entry.title, entry.provider, entry.url, check.status === "verified" ? 1 : 0, check.status === "verified" ? nowIso() : null, check.note, entry.summary,
    )
    added++
  }
  if (added === 0) {
    // No catalog match: say so, and offer a search — labelled as a search, never as a course.
    const query = `${gap.skill} ${gap.title} tutorial`.slice(0, 120)
    exec(
      db,
      "INSERT INTO recommendations (id, gap_id, title, provider, url, kind, verified, verified_at, verify_note, why) VALUES (?, ?, ?, ?, ?, 'search', 0, NULL, 'A search link, not a course.', ?)",
      newId("rec"), gap.id, `Search the web: ${gap.skill} — ${gap.title}`, "Web search (DuckDuckGo)", searchUrl(query), "We don't have a curated resource for this yet, so here is a search to start from.",
    )
  }
}

export async function gapDetail(db: DatabaseSync, candidateId: string, gapId: string) {
  const gap = ownedGap(db, candidateId, gapId)
  const ctx = gapContext(db, gap)
  await ensureRecommendations(db, gap, ctx.difficulty)
  const lesson = one(db, "SELECT * FROM lessons WHERE gap_id = ?", gapId)
  const exercise = one(db, "SELECT * FROM exercises WHERE gap_id = ?", gapId)
  return {
    id: gap.id,
    skill: gap.skill,
    title: gap.title,
    detail: gap.detail,
    severity: gap.severity,
    evidence: gap.evidence,
    /** Whether the lesson and exercise can be aimed at the learner's own work, or are a labelled general lesson. */
    basis: { kind: lessonBasis(ctx), label: LESSON_BASIS_LABELS[lessonBasis(ctx)] },
    resolved: resolved(db, gap),
    runId: gap.runId,
    recommendations: all(db, "SELECT * FROM recommendations WHERE gap_id = ? ORDER BY rowid", gapId).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      provider: String(r.provider),
      url: String(r.url),
      kind: r.kind as "catalog" | "search",
      verified: r.verified === 1,
      verifiedAt: (r.verified_at as string | null) ?? null,
      note: String(r.verify_note),
      why: String(r.why),
    })),
    lesson: lesson
      ? { title: String(lesson.title), body: String(lesson.body), keyPoints: JSON.parse(String(lesson.key_points)) as string[], model: String(lesson.model), createdAt: String(lesson.created_at) }
      : null,
    exercise: exercise
      ? {
          id: String(exercise.id),
          prompt: String(exercise.prompt),
          hints: JSON.parse(String(exercise.hints)) as string[],
          model: String(exercise.model),
          responses: all(db, "SELECT * FROM exercise_responses WHERE exercise_id = ? ORDER BY created_at DESC", String(exercise.id)).map((r) => ({
            id: String(r.id),
            answer: String(r.answer),
            feedback: JSON.parse(String(r.feedback || "{}")) as unknown,
            createdAt: String(r.created_at),
          })),
        }
      : null,
    notAnAssessment: "Lessons, exercises and their feedback are practice material. They do not change any phase result or your profile.",
  }
}

export async function createLesson(db: DatabaseSync, candidateId: string, gapId: string): Promise<void> {
  const gap = ownedGap(db, candidateId, gapId)
  if (one(db, "SELECT 1 FROM lessons WHERE gap_id = ?", gapId)) return
  const lesson = await writeLesson(gapContext(db, gap))
  exec(db, "INSERT OR IGNORE INTO lessons (id, gap_id, title, body, key_points, provider, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", newId("les"), gapId, lesson.title, lesson.body, JSON.stringify(lesson.keyPoints), lesson.provider, lesson.model, lesson.promptVersion, nowIso())
}

export async function createExercise(db: DatabaseSync, candidateId: string, gapId: string): Promise<void> {
  const gap = ownedGap(db, candidateId, gapId)
  if (one(db, "SELECT 1 FROM exercises WHERE gap_id = ?", gapId)) return
  const ex = await writeExercise(gapContext(db, gap))
  exec(db, "INSERT OR IGNORE INTO exercises (id, gap_id, prompt, hints, provider, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId("exe"), gapId, ex.prompt, JSON.stringify(ex.hints), ex.provider, ex.model, ex.promptVersion, nowIso())
}

export async function answerExercise(db: DatabaseSync, candidateId: string, exerciseId: string, body: Body) {
  const ex = one(db, "SELECT e.*, g.candidate_id FROM exercises e JOIN skill_gaps g ON g.id = e.gap_id WHERE e.id = ?", exerciseId)
  if (!ex || ex.candidate_id !== candidateId) throw new ApiError(404, "That exercise wasn't found.")
  const answer = text(body.answer, "Your answer", { required: true, min: 5, max: 4000, key: "answer" })
  const gap = ownedGap(db, candidateId, String(ex.gap_id))
  const feedback = await giveFeedback(gapContext(db, gap), String(ex.prompt), answer)
  const id = newId("exr")
  exec(db, "INSERT INTO exercise_responses (id, exercise_id, answer, feedback, created_at) VALUES (?, ?, ?, ?, ?)", id, exerciseId, answer, JSON.stringify(feedback), nowIso())
  return { id, feedback }
}
