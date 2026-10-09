import type { DatabaseSync } from "node:sqlite"
import { generatePracticeChallenge } from "../ai/challenge-generator.ts"
import type { PracticeRequest } from "../ai/challenge-generator.ts"
import { canonicalSkillList } from "../domain/skills.ts"
import { DIFFICULTIES } from "../domain/spec.ts"
import { ApiError, enumValue, stringList, text } from "../http.ts"
import type { Body } from "../http.ts"
import { exec, newId, nowIso, one, transaction } from "../sql.ts"
import { createRun } from "./runs.ts"
import { insertVersion } from "./versions.ts"

export const PRACTICE_LIMITS = { skills: { min: 1, max: 6 }, description: 1500, language: 40 } as const
const DEFAULT_HOURS = { beginner: 3, intermediate: 5, advanced: 8 } as const
const LANGUAGE = /^[A-Za-z0-9+#.\- ]{1,40}$/

export function parsePracticeRequest(body: Body): PracticeRequest {
  const skills = canonicalSkillList(stringList(body.skills, "Skills", { ...PRACTICE_LIMITS.skills, key: "skills" }), PRACTICE_LIMITS.skills.max)
  const difficulty = enumValue(body.difficulty, DIFFICULTIES, "Difficulty", { key: "difficulty" })
  const description = text(body.description, "The description", { max: PRACTICE_LIMITS.description, key: "description" })
  const language = text(body.language, "The language", { max: PRACTICE_LIMITS.language, key: "language" })
  if (language && !LANGUAGE.test(language)) throw new ApiError(400, "The language can only contain letters, numbers and + # . - characters.", "language")
  return { skills, difficulty, description, language, timeHours: DEFAULT_HOURS[difficulty] }
}

/** Generates a private practice challenge and opens it for the student. Nothing is stored unless generation succeeded. */
export async function createPractice(db: DatabaseSync, candidateId: string, req: PracticeRequest, opts: { useTemplate?: boolean } = {}): Promise<{ runId: string; practiceId: string }> {
  const generated = await generatePracticeChallenge(req, { useTemplate: opts.useTemplate, subject: { type: "candidate", id: candidateId } })
  return transaction(db, () => {
    const practiceId = newId("prc")
    exec(db, "INSERT INTO practice_challenges (id, candidate_id, skills, difficulty, description, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", practiceId, candidateId, JSON.stringify(req.skills), req.difficulty, req.description, req.language, nowIso())
    const versionId = insertVersion(db, { kind: "practice", practiceId, spec: generated.spec, origin: generated.origin, provider: generated.provider, model: generated.model, promptVersion: generated.promptVersion })
    exec(db, "UPDATE practice_challenges SET current_version_id = ? WHERE id = ?", versionId, practiceId)
    // Practice work is private until the student says otherwise.
    const runId = createRun(db, { candidateId, kind: "practice", practiceId, versionId, shareScope: "private" })
    return { runId, practiceId }
  })
}

/** Deletes a practice challenge and everything attached to it. It is the student's own private data. */
export function deletePractice(db: DatabaseSync, candidateId: string, practiceId: string): void {
  if (!one(db, "SELECT 1 FROM practice_challenges WHERE id = ? AND candidate_id = ?", practiceId, candidateId)) throw new ApiError(404, "That practice challenge wasn't found.")
  transaction(db, () => {
    // Runs first: they point at the versions that the practice challenge's own delete would cascade to.
    exec(db, "DELETE FROM runs WHERE practice_id = ?", practiceId)
    exec(db, "DELETE FROM practice_challenges WHERE id = ?", practiceId)
  })
}
