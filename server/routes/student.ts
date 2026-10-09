import { ApiError, requireRole, sendAttachment } from "../http.ts"
import { candidateChallengeView, challengeById, listOpenChallenges } from "../services/challenges.ts"
import { CHALLENGE_SHARING_NOTICE, completeRun, listCandidateRuns, ownedRun, runView, setShareScope, SHARE_SCOPE_LABELS, startCompanyRun } from "../services/runs.ts"
import { answerExercise, createExercise, createLesson, gapDetail, listGaps } from "../services/learning.ts"
import { listNotifications, markAllRead } from "../services/notifications.ts"
import { createPractice, deletePractice, parsePracticeRequest } from "../services/practice.ts"
import { answerInterview, ownedContext, retrySubmission, startPhase, submitSolution } from "../services/pipeline.ts"
import { cvFile, deleteCv, ownProfile, saveCv, updateProfile } from "../services/profile.ts"
import { interestReceived } from "../services/discovery.ts"
import { attemptList, submissionDetail } from "../services/submission-view.ts"
import { runPhaseRows } from "../services/runs.ts"
import { all, one } from "../sql.ts"
import type { Route } from "./types.ts"

const student = (c: { actor: Parameters<typeof requireRole>[0] }) => requireRole(c.actor, "student")

export const studentRoutes: Route[] = [
  // ---- company challenges (browse & start)
  {
    method: "GET",
    pattern: /^\/challenges$/,
    handler: ({ db, actor }) => {
      const me = student({ actor })
      const started = new Map(all(db, "SELECT challenge_id, id FROM runs WHERE candidate_id = ? AND challenge_id IS NOT NULL", me.id).map((r) => [String(r.challenge_id), String(r.id)]))
      return { challenges: listOpenChallenges(db).map((c) => ({ ...c, runId: started.get(c.id) ?? null })) }
    },
  },
  {
    method: "GET",
    pattern: /^\/challenges\/([^/]+)$/,
    handler: ({ db, actor, params }) => {
      const me = student({ actor })
      const row = challengeById(db, params[0])
      const run = one(db, "SELECT id FROM runs WHERE candidate_id = ? AND challenge_id = ?", me.id, params[0])
      // Published challenges are public to students; one the student already started stays reachable after it is archived.
      const view = row && (row.status === "published" || row.status === "in_progress" || run) ? candidateChallengeView(db, row) : null
      if (!view) throw new ApiError(404, "That challenge isn't open.")
      return { challenge: { ...view, runId: run ? String(run.id) : null, sharingNotice: CHALLENGE_SHARING_NOTICE(view.company.name) } }
    },
  },
  { method: "POST", pattern: /^\/challenges\/([^/]+)\/start$/, handler: ({ db, actor, params, body }) => startCompanyRun(db, student({ actor }).id, params[0], body) },

  // ---- practice lab
  {
    method: "POST",
    pattern: /^\/practice$/,
    handler: ({ db, actor, body }) => createPractice(db, student({ actor }).id, parsePracticeRequest(body), { useTemplate: body.useTemplate === true }),
  },
  {
    method: "DELETE",
    pattern: /^\/practice\/([^/]+)$/,
    handler: ({ db, actor, params }) => {
      deletePractice(db, student({ actor }).id, params[0])
      return { ok: true }
    },
  },

  // ---- work (runs)
  {
    method: "GET",
    pattern: /^\/work$/,
    handler: ({ db, actor, url }) => {
      const kind = url.searchParams.get("kind")
      return { work: listCandidateRuns(db, student({ actor }).id, kind === "company" || kind === "practice" ? kind : undefined) }
    },
  },
  { method: "GET", pattern: /^\/work\/([^/]+)$/, handler: ({ db, actor, params }) => ({ run: runView(db, ownedRun(db, student({ actor }).id, params[0])), shareScopes: SHARE_SCOPE_LABELS }) },
  {
    method: "POST",
    pattern: /^\/work\/([^/]+)\/share$/,
    handler: ({ db, actor, params, body }) => ({ shareScope: setShareScope(db, student({ actor }).id, params[0], body.scope) }),
  },
  {
    method: "POST",
    pattern: /^\/work\/([^/]+)\/complete$/,
    handler: ({ db, actor, params, body }) => {
      completeRun(db, student({ actor }).id, params[0], body)
      return { ok: true }
    },
  },
  {
    method: "POST",
    pattern: /^\/work\/([^/]+)\/phases\/([^/]+)\/start$/,
    handler: async ({ db, actor, params }) => {
      await startPhase(db, student({ actor }).id, params[0], params[1])
      return { ok: true }
    },
  },
  {
    method: "POST",
    pattern: /^\/work\/([^/]+)\/phases\/([^/]+)\/submissions$/,
    handler: ({ db, actor, params, body }) => submitSolution(db, student({ actor }).id, params[0], params[1], body),
  },
  {
    method: "GET",
    pattern: /^\/work\/([^/]+)\/phases\/([^/]+)\/attempts$/,
    handler: ({ db, actor, params }) => {
      const run = ownedRun(db, student({ actor }).id, params[0])
      const row = runPhaseRows(db, run.id).find((r) => r.key === params[1])
      if (!row) throw new ApiError(404, "That phase wasn't found.")
      return { attempts: attemptList(db, row.id) }
    },
  },
  { method: "GET", pattern: /^\/submissions\/([^/]+)$/, handler: ({ db, actor, params }) => ({ submission: submissionDetail(db, ownedContext(db, student({ actor }).id, params[0]), { audience: "candidate" }) }) },
  { method: "POST", pattern: /^\/submissions\/([^/]+)\/answer$/, handler: ({ db, actor, params, body }) => answerInterview(db, student({ actor }).id, params[0], body) },
  { method: "POST", pattern: /^\/submissions\/([^/]+)\/retry$/, handler: ({ db, actor, params }) => retrySubmission(db, student({ actor }).id, params[0]) },

  // ---- improvement
  { method: "GET", pattern: /^\/learning$/, handler: ({ db, actor }) => ({ gaps: listGaps(db, student({ actor }).id) }) },
  { method: "GET", pattern: /^\/learning\/gaps\/([^/]+)$/, handler: async ({ db, actor, params }) => ({ gap: await gapDetail(db, student({ actor }).id, params[0]) }) },
  {
    method: "POST",
    pattern: /^\/learning\/gaps\/([^/]+)\/lesson$/,
    handler: async ({ db, actor, params }) => {
      await createLesson(db, student({ actor }).id, params[0])
      return { gap: await gapDetail(db, student({ actor }).id, params[0]) }
    },
  },
  {
    method: "POST",
    pattern: /^\/learning\/gaps\/([^/]+)\/exercise$/,
    handler: async ({ db, actor, params }) => {
      await createExercise(db, student({ actor }).id, params[0])
      return { gap: await gapDetail(db, student({ actor }).id, params[0]) }
    },
  },
  { method: "POST", pattern: /^\/learning\/exercises\/([^/]+)\/answers$/, handler: ({ db, actor, params, body }) => answerExercise(db, student({ actor }).id, params[0], body) },

  // ---- profile
  { method: "GET", pattern: /^\/profile$/, handler: ({ db, actor }) => ({ profile: ownProfile(db, student({ actor }).id) }) },
  {
    method: "PUT",
    pattern: /^\/profile$/,
    handler: ({ db, actor, body }) => {
      const me = student({ actor })
      updateProfile(db, me.id, body)
      return { profile: ownProfile(db, me.id) }
    },
  },
  {
    method: "PUT",
    pattern: /^\/profile\/cv$/,
    handler: async ({ db, actor, body }) => {
      const me = student({ actor })
      await saveCv(db, me.id, body)
      return { profile: ownProfile(db, me.id) }
    },
  },
  {
    method: "DELETE",
    pattern: /^\/profile\/cv$/,
    handler: ({ db, actor }) => {
      const me = student({ actor })
      deleteCv(db, me.id)
      return { profile: ownProfile(db, me.id) }
    },
  },
  {
    method: "GET",
    pattern: /^\/profile\/cv$/,
    raw: true,
    handler: ({ db, actor, res }) => {
      const file = cvFile(db, student({ actor }).id)
      if (!file) throw new ApiError(404, "You haven't uploaded a CV.")
      sendAttachment(res, file)
    },
  },
  { method: "GET", pattern: /^\/interest$/, handler: ({ db, actor }) => ({ interest: interestReceived(db, student({ actor }).id) }) },
  { method: "GET", pattern: /^\/notifications$/, handler: ({ db, actor }) => ({ notifications: listNotifications(db, "student", student({ actor }).id) }) },
  {
    method: "POST",
    pattern: /^\/notifications\/read$/,
    handler: ({ db, actor }) => {
      markAllRead(db, "student", student({ actor }).id)
      return { ok: true }
    },
  },
]
