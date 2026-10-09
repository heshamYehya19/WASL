import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { runStaticChecks } from "../analysis/static-checks.ts"
import type { StaticCheck } from "../analysis/static-checks.ts"
import { redactSecrets } from "../analysis/secrets.ts"
import type { Artifact } from "../analysis/grounding.ts"
import type { Grounding, Turn } from "../ai/interviewer.ts"
import type { ReviewCriterion, ReviewFinding } from "../ai/reviewer.ts"
import type { PhaseSpec } from "../domain/spec.ts"
import { parseGithubLink } from "../github.ts"
import type { RepoFile } from "../github.ts"
import { ApiError, text } from "../http.ts"
import type { Body } from "../http.ts"
import { all, one } from "../sql.ts"

export const SUBMISSION_LIMITS = { code: 24_000, note: 1_500, language: 40, url: 300, answer: 3_000 } as const
const LANGUAGE = /^[A-Za-z0-9+#.\- ]{1,40}$/

export interface SubmissionInput {
  language: string
  code: string
  githubUrl: string
  note: string
}

/** Validates the shape of a submission. Problems here are the candidate's to fix and never use up an attempt. */
export function parseSubmissionInput(body: Body): SubmissionInput {
  const code = typeof body.code === "string" ? body.code.replace(/\r\n/g, "\n") : ""
  // oxlint-disable-next-line no-control-regex -- detecting binary content is the point
  if (/[\u0000]/.test(code)) throw new ApiError(400, "That looks like a binary file, not source code. Paste text, or link a repository.", "code")
  if (code.length > SUBMISSION_LIMITS.code) {
    throw new ApiError(400, `The pasted code is too long (${code.length.toLocaleString()} characters; the limit is ${SUBMISSION_LIMITS.code.toLocaleString()}). Submit the most relevant files, or link a GitHub repository.`, "code")
  }
  const language = text(body.language, "The language", { max: SUBMISSION_LIMITS.language, key: "language" })
  if (language && !LANGUAGE.test(language)) throw new ApiError(400, "The language can only contain letters, numbers and + # . - characters.", "language")
  const note = text(body.note, "The note", { max: SUBMISSION_LIMITS.note, key: "note" })
  let githubUrl = text(body.githubUrl, "The GitHub link", { max: SUBMISSION_LIMITS.url, key: "githubUrl" })
  if (githubUrl) {
    if (!parseGithubLink(githubUrl)) throw new ApiError(400, "That doesn't look like a GitHub repository link. Use a link such as https://github.com/owner/repository.", "githubUrl")
    githubUrl = `https://${githubUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "")}`
  }
  if (!code.trim() && !githubUrl) throw new ApiError(400, "Paste your code or add a link to a public GitHub repository.", "code")
  return { language, code: code.trim() ? code : "", githubUrl, note }
}

const EXTENSIONS: Record<string, string> = {
  python: "py", javascript: "js", typescript: "ts", java: "java", kotlin: "kt", go: "go", golang: "go", rust: "rs", "c#": "cs", "c++": "cpp", c: "c",
  ruby: "rb", php: "php", swift: "swift", sql: "sql", r: "r", bash: "sh", shell: "sh", scala: "scala", dart: "dart", html: "html", css: "css", json: "json", markdown: "md",
}

function guessExtension(language: string, code: string): string {
  const named = EXTENSIONS[language.trim().toLowerCase()]
  if (named) return named
  if (/^\s*(?:def |import \w+|from \w+ import|class \w+:)/m.test(code)) return "py"
  if (/\b(?:function\s+\w+|const\s+\w+\s*=|=>|console\.log)/.test(code)) return "js"
  if (/\bpublic\s+(?:static\s+)?(?:class|void)\b/.test(code)) return "java"
  if (/^\s*[{[]/.test(code)) return "json"
  return "txt"
}

export interface BuiltArtifact extends Artifact {
  source: "pasted" | "repository"
  size: number
  truncated: boolean
  redactions: number
}

/** Pasted code and repository files as stored artifacts: secrets removed, nothing else altered. */
export function buildArtifacts(input: SubmissionInput, repoFiles: RepoFile[]): { artifacts: BuiltArtifact[]; redactions: { count: number; kinds: string[] } } {
  const artifacts: BuiltArtifact[] = []
  const kinds = new Set<string>()
  let count = 0
  const add = (path: string, content: string, source: "pasted" | "repository", size: number, truncated: boolean) => {
    const redacted = redactSecrets(content)
    redacted.kinds.forEach((k) => kinds.add(k))
    count += redacted.count
    artifacts.push({ path, content: redacted.text, source, size, truncated, redactions: redacted.count })
  }
  if (input.code.trim()) add(`solution.${guessExtension(input.language, input.code)}`, input.code, "pasted", input.code.length, false)
  for (const f of repoFiles) add(f.path, f.content, "repository", f.size, f.truncated)
  return { artifacts, redactions: { count, kinds: [...kinds] } }
}

export function taskText(phase: PhaseSpec): string {
  return [phase.title, phase.objective, phase.instructions, ...phase.acceptanceCriteria.map((c) => c.text), ...phase.deliverables].join("\n")
}

export function checksFor(input: SubmissionInput, artifacts: BuiltArtifact[], redactions: { count: number; kinds: string[] }, phase: PhaseSpec): StaticCheck[] {
  return runStaticChecks({ artifacts, language: input.language, taskText: taskText(phase), redactions })
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

export const contentHash = (artifacts: Artifact[]) => sha256(JSON.stringify(artifacts.map((a) => [a.path, a.content])))

// ------------------------------------------------------------------ loading

export interface SubmissionRow {
  id: string
  runPhaseId: string
  attempt: number
  language: string
  codeText: string
  githubUrl: string
  note: string
  contentHash: string
  stage: "received" | "rejected" | "checked" | "reviewed" | "interviewing" | "assessed"
  problems: string[]
  pipelineError: string
  createdAt: string
}

const toSubmission = (r: Record<string, unknown>): SubmissionRow => ({
  id: String(r.id),
  runPhaseId: String(r.run_phase_id),
  attempt: Number(r.attempt),
  language: String(r.language),
  codeText: String(r.code_text),
  githubUrl: String(r.github_url),
  note: String(r.note),
  contentHash: String(r.content_hash),
  stage: r.stage as SubmissionRow["stage"],
  problems: JSON.parse(String(r.problems || "[]")) as string[],
  pipelineError: String(r.pipeline_error),
  createdAt: String(r.created_at),
})

export function loadSubmission(db: DatabaseSync, submissionId: string): SubmissionRow | null {
  const r = one(db, "SELECT * FROM submissions WHERE id = ?", submissionId)
  return r ? toSubmission(r) : null
}

export function loadArtifacts(db: DatabaseSync, submissionId: string): BuiltArtifact[] {
  return all(db, "SELECT path, source, content, size, truncated, redactions FROM submission_artifacts WHERE submission_id = ? ORDER BY rowid", submissionId).map((r) => ({
    path: String(r.path),
    source: r.source as "pasted" | "repository",
    content: String(r.content),
    size: Number(r.size),
    truncated: r.truncated === 1,
    redactions: Number(r.redactions),
  }))
}

export interface StoredReview {
  summary: string
  findings: ReviewFinding[]
  criteria: ReviewCriterion[]
  staticChecks: StaticCheck[]
  injectionFlagged: boolean
  inputHash: string
  promptVersion: string
  provider: string
  model: string
  createdAt: string
}

export function loadReview(db: DatabaseSync, submissionId: string): StoredReview | null {
  const r = one(db, "SELECT * FROM reviews WHERE submission_id = ?", submissionId)
  if (!r) return null
  return {
    summary: String(r.summary),
    findings: JSON.parse(String(r.findings)) as ReviewFinding[],
    criteria: JSON.parse(String(r.criteria)) as ReviewCriterion[],
    staticChecks: JSON.parse(String(r.static_checks)) as StaticCheck[],
    injectionFlagged: r.injection_flagged === 1,
    inputHash: String(r.input_hash),
    promptVersion: String(r.prompt_version),
    provider: String(r.provider),
    model: String(r.model),
    createdAt: String(r.created_at),
  }
}

export interface InterviewMessage {
  id: string
  seq: number
  role: "interviewer" | "candidate"
  content: string
  grounding: Grounding | null
  isFollowup: boolean
  injectionFlagged: boolean
  createdAt: string
}

export function loadSession(db: DatabaseSync, submissionId: string): { id: string; status: "in_progress" | "completed"; messages: InterviewMessage[] } | null {
  const s = one(db, "SELECT id, status FROM interview_sessions WHERE submission_id = ?", submissionId)
  if (!s) return null
  const messages = all(db, "SELECT * FROM interview_messages WHERE session_id = ? ORDER BY seq", String(s.id)).map((m) => ({
    id: String(m.id),
    seq: Number(m.seq),
    role: m.role as "interviewer" | "candidate",
    content: String(m.content),
    grounding: m.role === "interviewer" ? (JSON.parse(String(m.grounding || "{}")) as Grounding) : null,
    isFollowup: m.is_followup === 1,
    injectionFlagged: m.injection_flagged === 1,
    createdAt: String(m.created_at),
  }))
  return { id: String(s.id), status: s.status as "in_progress" | "completed", messages }
}

export const toTranscript = (messages: InterviewMessage[]): Turn[] =>
  messages.map((m) => ({ role: m.role, content: m.content, ...(m.grounding ? { grounding: m.grounding } : {}), isFollowup: m.isFollowup }))
