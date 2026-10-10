// Types shared by the server and the interface. Rules, labels and enumerations come from the server's domain modules, so the
// interface cannot disagree with what the server enforces; the response shapes below mirror the API.

export type { ChallengeStatus } from "../server/domain/lifecycle.ts"
export { CHALLENGE_STATUS_LABELS } from "../server/domain/lifecycle.ts"
export type { PhaseState } from "../server/domain/phases.ts"
export { PHASE_STATE_LABELS } from "../server/domain/phases.ts"
export { PASS_RULE, RATING_LABELS, MIN_ANSWERED_QUESTIONS, MAX_QUESTIONS } from "../server/domain/decision.ts"
export type { ChallengeSpec, PhaseSpec, Difficulty, Dimension } from "../server/domain/spec.ts"
export { DIMENSION_LABELS, DIFFICULTIES, MIN_PHASES, MAX_PHASES } from "../server/domain/spec.ts"

import type { ChallengeStatus } from "../server/domain/lifecycle.ts"
import type { PhaseState } from "../server/domain/phases.ts"
import type { ChallengeSpec, Difficulty, Dimension } from "../server/domain/spec.ts"

export type Role = "student" | "company"
export type ShareScope = "private" | "challenge_owner" | "employers"
export type Availability = "open_to_work" | "open_to_internships" | "not_available"

export type ScreeningKind = "phone" | "email" | "nationalId" | "address" | "birthDate" | "card" | "iban" | "personName" | "unreadable"
/** Personal data WASL's automatic screening found in a challenge brief. */
export interface ScreeningFinding {
  kind: ScreeningKind
  label: string
  count: number
  sources: string[]
  examples: string[]
}
export type ChallengeFileKind = "description" | "dataset"

// ----------------------------------------------------------------- session & health

export interface ActorInfo {
  role: Role
  id: string
  name: string
}
export interface SessionInfo {
  actor: ActorInfo | null
  demoMode: boolean
  /** Demo mock AI is on: reviews, interviews and assessments are scripted, not real AI output. */
  aiMock?: boolean
}
export interface Health {
  ai: { configured: boolean; provider: string | null; backup: string | null; model: string | null; keyWorks: boolean; message: string | null; lastCall: { ok: boolean; at: string; purpose: string; message?: string } | null }
  demoMode: boolean
  aiMock?: boolean
}
export interface DemoAccounts {
  demoMode: boolean
  companies: { id: string; name: string; industry: string }[]
  students: { id: string; name: string; status: string; headline: string; isDemoFixture: boolean }[]
}
export interface AppNotification {
  id: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

// ----------------------------------------------------------------- company challenges

export interface Brief {
  problemDescription: string
  requiredSkills: string[]
  difficulty: Difficulty
  expectedDeliverables: string
  timeHours: number
}
export interface ChallengeSummary {
  id: string
  title: string
  status: ChallengeStatus
  statusLabel: string
  difficulty: Difficulty
  skills: string[]
  timeHours: number
  phaseCount: number
  candidatesStarted: number
  candidatesCompleted: number
  isDemoFixture: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}
export interface VersionMeta {
  id: string
  version: number
  origin: "ai" | "offline_template" | "company_edit" | "demo_fixture"
  provider: string
  model: string
  promptVersion: string
  createdAt: string
  originLabel: string
}
export interface ChallengeDetail extends ChallengeSummary {
  brief: Brief
  evaluationUseAcknowledged: boolean
  evaluationNotice: string
  current: { meta: VersionMeta; spec: ChallengeSpec } | null
  publishedVersionId: string | null
  publishedMatchesCurrent: boolean
  versions: VersionMeta[]
  history: { status: ChallengeStatus; at: string; note: string | null }[]
  frozen: boolean
}

// ----------------------------------------------------------------- candidate-facing challenges & work

export interface PublicPhase {
  key: string
  title: string
  objective: string
  instructions: string
  skills: string[]
  acceptanceCriteria: { id: string; text: string }[]
  rubric: { id: string; dimension: Dimension; criterion: string }[]
  deliverables: string[]
  dependsOn: string[]
  estimatedHours: number
}
export interface OpenChallenge {
  id: string
  status: ChallengeStatus
  company: { id: string; name: string; industry: string; location: string; logoInitials: string }
  title: string
  summary: string
  scenario: string
  learningGoals: string[]
  skills: string[]
  difficulty: Difficulty
  estimatedHours: number
  expectedDeliverables: string
  phases: PublicPhase[]
  evaluationNotice: string
  isDemoFixture: boolean
  publishedAt: string | null
  origin: string
  runId: string | null
  sharingNotice?: string
}
export interface AssessmentSummary {
  outcome: "passed" | "failed"
  outcomeReason: string
  summary: string
  ratings: { correctness: number; codeQuality: number; understanding: number }
  origin: "ai" | "demo_fixture"
  model: string
  createdAt: string
}
export interface RunPhaseView extends PublicPhase {
  position: number
  runPhaseId: string
  state: PhaseState
  stateLabel: string
  available: boolean
  blockedBy: { key: string; title: string }[]
  attempts: number
  latestSubmission: { id: string; attempt: number; stage: string; createdAt: string; assessment: AssessmentSummary | null } | null
  attemptList?: { id: string; attempt: number; stage: string; createdAt: string; outcome: string | null }[]
}
export interface RunView {
  id: string
  kind: "company" | "practice"
  status: "in_progress" | "completed"
  shareScope: ShareScope
  shareScopeLabel: string
  isDemoFixture: boolean
  startedAt: string
  completedAt: string | null
  completionNote: string
  challengeId: string | null
  practiceId: string | null
  company: { id: string; name: string; logoInitials: string } | null
  challenge: { title: string; summary: string; scenario: string; learningGoals: string[]; skills: string[]; difficulty: Difficulty; estimatedHours: number; origin: string }
  progress: { passed: number; total: number; complete: boolean }
  canComplete: boolean
  phases: RunPhaseView[]
}
export interface WorkItem {
  id: string
  kind: "company" | "practice"
  title: string
  companyName: string | null
  skills: string[]
  difficulty: Difficulty
  status: "in_progress" | "completed"
  shareScope: ShareScope
  progress: { passed: number; total: number }
  startedAt: string
  isDemoFixture: boolean
}

// ----------------------------------------------------------------- the Proof Engine

export interface StaticCheck {
  id: string
  label: string
  status: "pass" | "warn" | "fail" | "info"
  detail: string
  path?: string
}
export interface ReviewFinding {
  id: string
  severity: "info" | "minor" | "major"
  title: string
  detail: string
  path: string
  quote: string
  line: number | null
  anchored: boolean
}
export interface ReviewCriterion {
  criterionId: string
  status: "met" | "partial" | "unmet" | "unclear"
  note: string
  quote: string
  path: string
  line: number | null
  text: string
}
export interface InterviewMessage {
  seq: number
  role: "interviewer" | "candidate"
  content: string
  isFollowup: boolean
  grounding: { kind: "finding" | "criterion" | "code" | "answer"; ref: string; path: string; line: number | null; quote: string; why: string } | null
  injectionFlagged: boolean
  createdAt: string
}
export interface EvidenceCitation {
  source: "code" | "answer" | "check" | "review"
  ref: string
  quote: string
  note: string
  path: string
  line: number | null
}
export interface AssessmentDimension {
  key: "correctness" | "code_quality" | "understanding"
  label: string
  rating: number
  ratingLabel: string
  needed: number
  rationale: string
  adjustment: string
  dropped: number
  evidence: EvidenceCitation[]
}
export interface AssessmentDetail {
  outcome: "passed" | "failed"
  outcomeLabel: string
  outcomeReason: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  dimensions: AssessmentDimension[]
  origin: "ai" | "demo_fixture"
  provider: string
  model: string
  promptVersion: string
  createdAt: string
}
export interface SubmissionDetail {
  id: string
  attempt: number
  createdAt: string
  language: string
  githubUrl: string
  note: string
  stage: "received" | "rejected" | "checked" | "reviewed" | "interviewing" | "assessed"
  isLatest: boolean
  phase: { key: string; title: string }
  state: PhaseState
  stateLabel: string
  problems: string[]
  pipelineMessage: string
  canRetry: boolean
  analysis: { executed: boolean; note: string }
  artifacts: { path: string; source: "pasted" | "repository"; content: string; truncated: boolean; redactions: number }[]
  checks: StaticCheck[]
  review: {
    summary: string
    findings: ReviewFinding[]
    criteria: ReviewCriterion[]
    injectionFlagged: boolean
    provider: string
    model: string
    promptVersion: string
  } | null
  interview: { status: "in_progress" | "completed"; answered: number; minQuestions: number; maxQuestions: number; awaitingAnswer: boolean; messages: InterviewMessage[] } | null
  assessment: AssessmentDetail | null
}

// ----------------------------------------------------------------- improvement

export interface GapListItem {
  id: string
  skill: string
  title: string
  detail: string
  severity: "minor" | "moderate" | "significant"
  phaseTitle: string
  challengeTitle: string
  runId: string
  resolved: boolean
  hasLesson: boolean
  hasExercise: boolean
  createdAt: string
}
export interface GapDetail {
  id: string
  skill: string
  title: string
  detail: string
  severity: "minor" | "moderate" | "significant"
  evidence: { source: string; quote: string; path: string; line: number | null }
  /** "evidence": the lesson and exercise are aimed at a verified line of the learner's work; "general": a labelled general lesson. */
  basis: { kind: "evidence" | "general"; label: string }
  resolved: boolean
  runId: string
  recommendations: { id: string; title: string; provider: string; url: string; kind: "catalog" | "search"; verified: boolean; verifiedAt: string | null; note: string; why: string }[]
  lesson: { title: string; body: string; keyPoints: string[]; model: string; createdAt: string } | null
  exercise: {
    id: string
    prompt: string
    hints: string[]
    model: string
    responses: { id: string; answer: string; feedback: { looksCorrect: "yes" | "partly" | "no"; whatWorked: string[]; toImprove: string[]; nextStep: string }; createdAt: string }[]
  } | null
  notAnAssessment: string
}

// ----------------------------------------------------------------- profile & talent

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
export interface SkillEvidence {
  skill: string
  status: "demonstrated" | "building" | "declared"
  declared: boolean
  evidence: EvidenceItem[]
}
export interface EvidenceProfile {
  declaredSkills: string[]
  skills: SkillEvidence[]
  demonstratedCount: number
  phasesPassed: number
  explanation: string
}
export interface CandidateLink {
  label: string
  url: string
}
export interface OwnProfile {
  id: string
  name: string
  headline: string
  bio: string
  location: string
  education: string
  status: "student" | "graduate"
  availability: Availability
  availabilityLabel: string
  declaredSkills: string[]
  links: CandidateLink[]
  discoverable: boolean
  cvShared: boolean
  isDemoFixture: boolean
  cv: { name: string; size: number; uploadedAt: string } | null
  evidence: EvidenceProfile
  work: WorkItem[]
  sharingNotice: string
}
export interface TalentCandidate {
  id: string
  name: string
  headline: string
  location: string
  status: "student" | "graduate"
  education: string
  availability: Availability
  availabilityLabel: string
  bio: string
  links: CandidateLink[]
  cvAvailable: boolean
  isDemoFixture: boolean
  evidence: EvidenceProfile
  saved: boolean
  interestSent: boolean
}
export interface TalentResult {
  candidate: TalentCandidate
  matches: { skill: string; status: "demonstrated" | "declared" | "none"; evidence: EvidenceItem[] }[]
  score: number
}
export interface TalentSearch {
  query: { skills: string[]; match: "all" | "any"; demonstratedOnly: boolean; availability: string; status: string; location: string }
  results: TalentResult[]
  scoring: string
}
export interface Participant {
  runId: string
  candidate: { id: string; name: string; headline: string; location: string }
  status: "in_progress" | "completed"
  startedAt: string
  completedAt: string | null
  progress: { passed: number; total: number; complete: boolean }
  isDemoFixture: boolean
  phases: { key: string; title: string; state: PhaseState; stateLabel: string; attempts: number; ratings: { correctness: number; codeQuality: number; understanding: number } | null }[]
}
