import type { DatabaseSync } from "node:sqlite"
import { ApiError } from "../http.ts"
import { all, one } from "../sql.ts"
import { ownedChallenge } from "./challenges.ts"
import { contextFor } from "./pipeline.ts"
import { runById, runView } from "./runs.ts"
import { attemptList, submissionDetail } from "./submission-view.ts"

// What a company sees about candidates working on ITS challenge. A candidate's sharing choice decides: runs shared only with
// themselves are counted, never named; runs shared with the challenge owner (or employers) are visible here.

export function participantList(db: DatabaseSync, companyId: string, challengeId: string) {
  ownedChallenge(db, companyId, challengeId)
  const runs = all(
    db,
    `SELECT r.id, r.share_scope, r.status, r.started_at, r.completed_at, r.is_demo_fixture, c.id AS candidate_id, c.name, c.headline, c.location
     FROM runs r JOIN candidates c ON c.id = r.candidate_id WHERE r.challenge_id = ? ORDER BY r.started_at DESC`,
    challengeId,
  )
  const visible = runs.filter((r) => r.share_scope !== "private")
  return {
    privateCount: runs.length - visible.length,
    participants: visible.map((r) => {
      const view = runView(db, runById(db, String(r.id))!)
      return {
        runId: String(r.id),
        candidate: { id: String(r.candidate_id), name: String(r.name), headline: String(r.headline), location: String(r.location) },
        status: r.status as "in_progress" | "completed",
        startedAt: String(r.started_at),
        completedAt: (r.completed_at as string | null) ?? null,
        progress: view.progress,
        isDemoFixture: r.is_demo_fixture === 1,
        phases: view.phases.map((p) => ({
          key: p.key,
          title: p.title,
          state: p.state,
          stateLabel: p.stateLabel,
          attempts: p.attempts,
          ratings: p.latestSubmission?.assessment?.ratings ?? null,
        })),
      }
    }),
  }
}

function visibleRun(db: DatabaseSync, companyId: string, challengeId: string, runId: string) {
  ownedChallenge(db, companyId, challengeId)
  const run = runById(db, runId)
  if (!run || run.challengeId !== challengeId || run.shareScope === "private") throw new ApiError(404, "That candidate's work isn't available to you.")
  return run
}

export function participantRun(db: DatabaseSync, companyId: string, challengeId: string, runId: string) {
  const run = visibleRun(db, companyId, challengeId, runId)
  const candidate = one(db, "SELECT id, name, headline, location, bio FROM candidates WHERE id = ?", run.candidateId)!
  const view = runView(db, run)
  return {
    candidate: { id: String(candidate.id), name: String(candidate.name), headline: String(candidate.headline), location: String(candidate.location), bio: String(candidate.bio) },
    run: {
      ...view,
      phases: view.phases.map((p) => ({ ...p, attemptList: attemptList(db, p.runPhaseId) })),
    },
  }
}

export function participantSubmission(db: DatabaseSync, companyId: string, challengeId: string, runId: string, submissionId: string) {
  const run = visibleRun(db, companyId, challengeId, runId)
  const ctx = contextFor(db, submissionId)
  if (ctx.run.id !== run.id) throw new ApiError(404, "That submission wasn't found.")
  return submissionDetail(db, ctx, { audience: "company" })
}
