import { describe, expect, it } from "vitest"
import { availability, canTransition, completion, IllegalTransition, isConcluded, PHASE_STATES, transition, validatePhaseGraph } from "../domain/phases.ts"
import type { PhaseNode, PhaseState } from "../domain/phases.ts"
import { decide, MIN_ANSWERED_QUESTIONS, PASS_RULE } from "../domain/decision.ts"
import { canChallengeTransition, challengeTransition, IllegalChallengeTransition } from "../domain/lifecycle.ts"

// The phase rules are pure functions, so they are tested directly, without a server.

const phases: PhaseNode[] = [
  { id: "a", key: "p1", position: 1, dependsOn: [] },
  { id: "b", key: "p2", position: 2, dependsOn: ["p1"] },
  { id: "c", key: "p3", position: 3, dependsOn: ["p2"] },
  { id: "d", key: "p4", position: 4, dependsOn: ["p1"] }, // a parallel branch: needs only p1
]
const states = (s: Record<string, PhaseState>) => new Map(Object.entries(s))

describe("which phases are open", () => {
  it("opens only the first phase before anything is done", () => {
    const a = availability(phases, states({}))
    expect(a.get("a")!.available).toBe(true)
    expect(a.get("b")!.available).toBe(false)
    expect(a.get("b")!.blockedBy).toEqual(["p1"])
  })

  it("opens a phase once its dependency has passed", () => {
    expect(availability(phases, states({ a: "passed" })).get("b")!.available).toBe(true)
  })

  it("a FAILED phase does not block the phases after it", () => {
    const a = availability(phases, states({ a: "failed" }))
    expect(a.get("b")!.available).toBe(true)
    expect(a.get("d")!.available).toBe(true)
  })

  it("a phase that is only submitted, under review or in interview is not concluded, so it still blocks", () => {
    for (const s of ["submitted", "under_review", "interview_in_progress", "revision_needed", "assessment_unavailable", "in_progress"] as const) {
      expect(isConcluded(s), s).toBe(false)
      expect(availability(phases, states({ a: s })).get("b")!.available, s).toBe(false)
    }
  })

  it("a phase on a parallel branch is not held up by an unrelated one", () => {
    const a = availability(phases, states({ a: "passed", b: "failed" }))
    expect(a.get("d")!.available).toBe(true)
    expect(a.get("c")!.available).toBe(true) // p2 is concluded (failed), so p3 is open
  })
})

describe("when the whole solution is complete", () => {
  it("needs EVERY phase to have passed", () => {
    expect(completion(phases, states({ a: "passed", b: "passed", c: "passed", d: "passed" })).complete).toBe(true)
  })

  it("is not complete while any phase has failed — even though later phases were reachable", () => {
    const c = completion(phases, states({ a: "passed", b: "failed", c: "passed", d: "passed" }))
    expect(c.complete).toBe(false)
    expect(c.remaining).toEqual(["b"])
    expect(c.passed).toBe(3)
  })

  it("is not complete when a phase was never attempted, or has no phases at all", () => {
    expect(completion(phases, states({ a: "passed" })).complete).toBe(false)
    expect(completion([], states({})).complete).toBe(false)
  })

  it("becomes complete once the failed phase is later passed", () => {
    expect(completion(phases, states({ a: "passed", b: "passed", c: "passed", d: "passed" })).complete).toBe(true)
  })
})

describe("the phase state machine", () => {
  it("knows all nine states", () => {
    expect([...PHASE_STATES]).toEqual(["not_started", "in_progress", "submitted", "under_review", "interview_in_progress", "passed", "failed", "revision_needed", "assessment_unavailable"])
  })

  it("walks the happy path", () => {
    let s: PhaseState = "not_started"
    for (const [event, next] of [
      ["start", "in_progress"],
      ["submit", "submitted"],
      ["review_started", "under_review"],
      ["interview_started", "interview_in_progress"],
      ["assessed_passed", "passed"],
    ] as const) {
      s = transition(s, event)
      expect(s).toBe(next)
    }
  })

  it("allows resubmitting after a fail, a revision request or an unavailable assessment — but not after a pass", () => {
    for (const s of ["failed", "revision_needed", "assessment_unavailable", "not_started", "in_progress"] as const) expect(canTransition(s, "submit"), s).toBe(true)
    expect(canTransition("passed", "submit")).toBe(false)
  })

  it("does not allow submitting while a submission is being processed", () => {
    for (const s of ["submitted", "under_review", "interview_in_progress"] as const) expect(canTransition(s, "submit"), s).toBe(false)
  })

  it("only an assessment can pass or fail a phase, and only from the interview", () => {
    for (const s of PHASE_STATES) {
      expect(canTransition(s, "assessed_passed"), s).toBe(s === "interview_in_progress")
      expect(canTransition(s, "assessed_failed"), s).toBe(s === "interview_in_progress")
    }
  })

  it("an AI failure makes a phase unavailable — never passed or failed", () => {
    for (const s of ["submitted", "under_review", "interview_in_progress"] as const) expect(transition(s, "pipeline_failed")).toBe("assessment_unavailable")
    expect(() => transition("passed", "pipeline_failed")).toThrow(IllegalTransition)
  })

  it("explains an illegal move in plain words", () => {
    expect(() => transition("passed", "submit")).toThrow(/passed cannot submit/)
  })
})

describe("phase graphs", () => {
  it("accepts a valid graph", () => {
    expect(validatePhaseGraph([{ key: "p1", dependsOn: [] }, { key: "p2", dependsOn: ["p1"] }])).toEqual([])
  })
  it("rejects a cycle, a self-dependency, an unknown dependency and a duplicate key", () => {
    expect(validatePhaseGraph([{ key: "p1", dependsOn: ["p2"] }, { key: "p2", dependsOn: ["p1"] }]).join(" ")).toMatch(/cycle/)
    expect(validatePhaseGraph([{ key: "p1", dependsOn: ["p1"] }]).join(" ")).toMatch(/depends on itself/)
    expect(validatePhaseGraph([{ key: "p1", dependsOn: ["zz"] }]).join(" ")).toMatch(/does not exist/)
    expect(validatePhaseGraph([{ key: "p1", dependsOn: [] }, { key: "p1", dependsOn: [] }]).join(" ")).toMatch(/share the key/)
  })
})

describe("the pass/fail decision rule", () => {
  const full = (c: number, q: number, u: number) => ({
    correctness: { rating: c as 0 | 1 | 2 | 3, verifiedEvidence: 2 },
    codeQuality: { rating: q as 0 | 1 | 2 | 3, verifiedEvidence: 2 },
    understanding: { rating: u as 0 | 1 | 2 | 3, verifiedEvidence: 2 },
    interviewCompleted: true,
    answeredQuestions: 4,
  })

  it("passes when every dimension meets its bar", () => {
    expect(decide(full(PASS_RULE.correctness, PASS_RULE.codeQuality, PASS_RULE.understanding)).kind).toBe("passed")
    expect(decide(full(3, 3, 3)).kind).toBe("passed")
  })

  it("fails — with the reason — when any one dimension falls short", () => {
    const lowCorrectness = decide(full(1, 3, 3))
    expect(lowCorrectness.kind).toBe("failed")
    expect(lowCorrectness.reason).toMatch(/correctness/)
    const lowUnderstanding = decide(full(3, 3, 1))
    expect(lowUnderstanding.kind).toBe("failed")
    expect(lowUnderstanding.reason).toMatch(/understanding/)
    expect(decide(full(3, 0, 3)).kind).toBe("failed")
  })

  it("code that works but that the candidate cannot explain does not pass", () => {
    expect(decide(full(3, 3, 0)).kind).toBe("failed")
  })

  it("makes NO decision before the interview is complete", () => {
    expect(decide({ ...full(3, 3, 3), interviewCompleted: false }).kind).toBe("insufficient")
  })

  it("makes no decision on too few answers", () => {
    expect(decide({ ...full(3, 3, 3), answeredQuestions: MIN_ANSWERED_QUESTIONS - 1 }).kind).toBe("insufficient")
  })

  it("makes no decision — pass or fail — when a dimension has no verified evidence", () => {
    const d = decide({ ...full(3, 3, 3), understanding: { rating: 3, verifiedEvidence: 0 } })
    expect(d.kind).toBe("insufficient")
    expect(d.reason).toMatch(/understanding/)
    expect(decide({ ...full(0, 0, 0), correctness: { rating: 0, verifiedEvidence: 0 } }).kind).toBe("insufficient")
  })
})

describe("the challenge lifecycle", () => {
  it("runs draft → generated → reviewed → published → in progress → completed", () => {
    let s = challengeTransition("draft", "generate")
    expect(s).toBe("generated")
    s = challengeTransition(s, "review")
    expect(s).toBe("reviewed")
    s = challengeTransition(s, "publish")
    expect(s).toBe("published")
    s = challengeTransition(s, "start")
    expect(s).toBe("in_progress")
    expect(challengeTransition(s, "start")).toBe("in_progress")
    expect(challengeTransition(s, "complete")).toBe("completed")
  })

  it("cannot publish what has not been reviewed, and an edit sends a reviewed challenge back for review", () => {
    expect(canChallengeTransition("generated", "publish")).toBe(false)
    expect(canChallengeTransition("draft", "publish")).toBe(false)
    expect(challengeTransition("reviewed", "edit")).toBe("generated")
  })

  it("cannot be edited or regenerated once published; can always be archived (once)", () => {
    for (const s of ["published", "in_progress", "completed", "archived"] as const) {
      expect(canChallengeTransition(s, "edit"), s).toBe(false)
      expect(canChallengeTransition(s, "generate"), s).toBe(false)
    }
    expect(canChallengeTransition("published", "archive")).toBe(true)
    expect(canChallengeTransition("archived", "archive")).toBe(false)
    expect(() => challengeTransition("archived", "publish")).toThrow(IllegalChallengeTransition)
  })
})
