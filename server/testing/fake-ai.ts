// A scriptable stand-in for a model provider, used by the integration tests and the end-to-end tests (through
// scripts/mock-ai-server.ts). It is NOT part of the product: it exists so the real pipeline — prompts, schema validation,
// grounding, decision rule, state machine — can be exercised without a network or a key. It reads the same prompts a real
// model would and answers in the same JSON shapes, with quotes taken from the actual submission, so every check the server
// applies to a real model's output applies to this one too. Behaviours can be switched to produce the bad outputs a real
// model might: unverifiable quotes, malformed JSON, outages.

export interface FakeBehavior {
  /** How the assessor rates the work. "unsupported" cites evidence that is not there. */
  assessment: "strong" | "weak" | "unsupported"
  /** Purposes (response_format names) that answer with an HTTP error. */
  fail: string[]
  /** Purposes that answer with text that is not JSON. */
  garbage: string[]
  /** Make the review cite a line that is not in the submission. */
  reviewFabricates: boolean
  /** Purposes that fail only for the next N calls. */
  failTimes: Record<string, number>
}

export const defaultBehavior = (): FakeBehavior => ({ assessment: "strong", fail: [], garbage: [], reviewFabricates: false, failTimes: {} })

export interface FakeCall {
  name: string
  system: string
  user: string
}

export class FakeAi {
  behavior: FakeBehavior = defaultBehavior()
  calls: FakeCall[] = []

  reset(): void {
    this.behavior = defaultBehavior()
    this.calls = []
  }

  callsFor(name: string): FakeCall[] {
    return this.calls.filter((c) => c.name === name)
  }

  /** Answers a Groq-style chat completion request. Returns the HTTP status and body. */
  respond(body: unknown): { status: number; body: unknown } {
    const req = body as { messages?: { role: string; content: string }[]; response_format?: { json_schema?: { name?: string } } }
    const name = req.response_format?.json_schema?.name ?? "health"
    const system = req.messages?.find((m) => m.role === "system")?.content ?? ""
    const user = req.messages?.find((m) => m.role === "user")?.content ?? ""
    if (name === "health") return { status: 200, body: this.wrap("OK") }
    this.calls.push({ name, system, user })

    const remaining = this.behavior.failTimes[name] ?? 0
    if (remaining > 0) {
      this.behavior.failTimes[name] = remaining - 1
      return { status: 503, body: { error: { message: "Service temporarily unavailable" } } }
    }
    if (this.behavior.fail.includes(name)) return { status: 500, body: { error: { message: "The fake provider is down" } } }
    if (this.behavior.garbage.includes(name)) return { status: 200, body: this.wrap("this is not json {") }
    const value = this.value(name, user)
    return { status: 200, body: this.wrap(JSON.stringify(value)) }
  }

  private wrap(content: string) {
    return { choices: [{ message: { content }, finish_reason: "stop" }] }
  }

  private value(name: string, user: string): unknown {
    switch (name) {
      case "challenge":
        return this.challenge(user)
      case "submission_review":
        return this.review(user)
      case "interview_turn":
        return this.interview(user)
      case "assessment":
        return this.assessment(user)
      case "lesson":
        return {
          title: "Handling empty and malformed input",
          body: "When a function receives input it did not expect, the safest approach is to decide in advance what a sensible result is, and to return it explicitly instead of letting an exception escape. ".repeat(2) + "Start by listing the ways input can be wrong, then write one check for each, close to where the input is first used.",
          keyPoints: ["List the ways input can be wrong", "Check at the boundary", "Return a clear, explicit result"],
        }
      case "exercise":
        return { prompt: "Write a function that takes a list of numbers and returns their average, returning None for an empty list. Explain in one sentence why you chose None.", hints: ["Think about what the average of nothing should be", "Check the empty case first"] }
      case "exercise_feedback":
        return { looksCorrect: "yes", whatWorked: ["You handled the empty list first"], toImprove: ["Add a test for a list with one number"], nextStep: "Write two tests that would fail if the empty check were removed." }
      default:
        return {}
    }
  }

  // ------------------------------------------------------------ challenge generation

  private challenge(user: string) {
    const skills = (/(?:Required skills\/technologies|Skills to practise): (.+)/.exec(user)?.[1] ?? "Python").split(",").map((s) => s.trim()).filter(Boolean)
    const difficulty = /Difficulty: (\w+)/.exec(user)?.[1] ?? "beginner"
    const hours = Number(/(?:for one candidate|Time available): (\d+)/.exec(user)?.[1] ?? 6)
    const phase = (n: number, title: string, deps: string[], h: number) => ({
      key: `p${n}`,
      title,
      objective: `Show that you can ${title.toLowerCase()} for this problem.`,
      instructions: `${title}: read the problem carefully and deliver this part of the solution, explaining your reasoning in a short note. Keep it small enough to finish in one sitting and make sure you can explain every line you submit.`,
      skills: n === 1 ? skills : skills.slice(0, Math.max(1, skills.length - (n === 3 ? 1 : 0))),
      acceptanceCriteria: [`The ${title.toLowerCase()} addresses what the problem asks`, "Edge cases such as empty input are handled", "The work is explained in plain language"],
      rubric: [
        { dimension: "correctness", criterion: `The ${title.toLowerCase()} does what the problem asks`, strongSignal: "Handles the main case and at least one edge case" },
        { dimension: "code_quality", criterion: "The work is organised and readable", strongSignal: "Clear names and small units" },
        { dimension: "understanding", criterion: "The candidate can explain their choices", strongSignal: "Names a trade-off they made" },
      ],
      deliverables: ["Your code or written answer"],
      dependsOn: deps,
      estimatedHours: h,
    })
    // Skills that don't fit a smaller slice still appear in phase 1, so every required skill is covered.
    return {
      title: `${skills.slice(0, 2).join(" and ")} challenge`,
      summary: `A ${difficulty} challenge built around ${skills.join(", ")}: plan the solution, build the core, then test and explain it.`,
      scenario: "A small team needs a working, understandable solution to a well-defined problem.",
      learningGoals: ["Plan before building", "Handle awkward input", "Explain your decisions"],
      skills,
      difficulty,
      estimatedHours: hours,
      phases: [phase(1, "Plan the approach", [], hours * 0.25), phase(2, "Build the core", ["p1"], hours * 0.5), phase(3, "Test and explain", ["p2"], hours * 0.25)],
    }
  }

  // ------------------------------------------------------------ review

  private review(user: string) {
    const file = firstFile(user)
    const quote = this.behavior.reviewFabricates ? "this line does not exist anywhere in the submission" : file.line
    const ids = [...user.matchAll(/\[(p\d+\.(?:ac|rb)\d+)\]/g)].map((m) => m[1])
    return {
      summary: "The submission implements the core of the task in a readable way and leaves a few edge cases unhandled.",
      findings: [
        { severity: "info", title: "Core logic is present", detail: "The central behaviour the phase asks for is implemented in the submitted code.", path: file.path, quote },
        { severity: "minor", title: "Input validation is thin", detail: "Missing or malformed input is not clearly handled, so unusual cases may behave unexpectedly.", path: "", quote: "" },
      ],
      criteria: [...new Set(ids)].map((id) => ({ criterionId: id, status: "met", note: "The submitted code shows this.", quote })),
    }
  }

  // ------------------------------------------------------------ interview

  private interview(user: string) {
    const nums = /Questions asked so far: (\d+)\. Answered: (\d+)/.exec(user)
    const asked = Number(nums?.[1] ?? 0)
    const answered = Number(nums?.[2] ?? 0)
    const file = firstFile(user)
    const answers = [...user.matchAll(/<untrusted_data kind="candidate_answer">\n([\s\S]*?)\n<\/untrusted_data>/g)].map((m) => m[1])
    const lastAnswer = answers[answers.length - 1] ?? ""
    const followupsInRow = (() => {
      let n = 0
      const lines = user.split("\n").filter((l) => l.startsWith("Interviewer (question"))
      for (let i = lines.length - 1; i >= 0 && lines[i].includes("follow-up"); i--) n++
      return n
    })()
    const ident = /[A-Za-z_][A-Za-z0-9_]{4,}/.exec(file.line)?.[0] ?? "main"
    const criterion = /\[(p\d+\.ac\d+)\]/.exec(user)?.[1] ?? "p1.ac1"
    const quality = (a: string) => (a.trim().length < 25 ? "vague" : "clear")
    const base = { why: "Probes whether the candidate can explain their own work.", quote: "" }

    if (answered >= 3 && quality(lastAnswer) === "clear") {
      return { action: "finish", question: "", isFollowup: false, groundingKind: "answer", groundingRef: "", ...base, answerQuality: "clear" }
    }
    if (answered > 0 && quality(lastAnswer) === "vague" && followupsInRow < 2 && asked < 6) {
      const variants = [
        "That is a start. Can you point to the exact part of your work you are describing and say what it does?",
        "Could you give one concrete example that shows what you mean?",
      ]
      return { action: "ask", question: variants[followupsInRow % variants.length], isFollowup: true, groundingKind: "answer", groundingRef: "", ...base, answerQuality: "vague" }
    }
    const topics = [
      { question: `Walk me through what happens when \`${ident}\` runs, step by step, in your own words.`, groundingKind: "code", groundingRef: file.path, quote: file.line },
      { question: "Why did you structure the solution the way you did, and what other approach did you consider?", groundingKind: "finding", groundingRef: "f1", quote: "" },
      { question: "What happens with empty or malformed input, and how does your work deal with it?", groundingKind: "criterion", groundingRef: criterion, quote: "" },
      { question: "If a new requirement arrived next week, which part would you change first, and why?", groundingKind: "finding", groundingRef: "f2", quote: "" },
      { question: "How would you check that this keeps working as it grows?", groundingKind: "criterion", groundingRef: criterion, quote: "" },
      { question: "What is the weakest part of what you built, and what would you do about it?", groundingKind: "finding", groundingRef: "f1", quote: "" },
    ]
    const topic = topics[Math.min(asked, topics.length - 1)]
    return { action: "ask", ...topic, isFollowup: false, why: base.why, answerQuality: answered > 0 ? quality(lastAnswer) : "none" }
  }

  // ------------------------------------------------------------ assessment

  private assessment(user: string) {
    const file = firstFile(user)
    const answers = [...user.matchAll(/<untrusted_data kind="candidate_answer">\n([\s\S]*?)\n<\/untrusted_data>/g)].map((m) => m[1])
    const answerQuote = (i: number) => (answers[i] ?? "").trim().split(/\n/)[0].slice(0, 60)
    const skill = (/Skills this phase exercises: (.+)/.exec(user)?.[1] ?? "Python").split(",")[0].trim()
    const mode = this.behavior.assessment
    const fabricated = "an invented line that is not in the code at all"
    const code = (q: string) => ({ source: "code", ref: file.path, quote: q, note: "This line shows the behaviour." })
    const answer = (i: number) => ({ source: "answer", ref: `A${i + 1}`, quote: answerQuote(i), note: "The candidate explained this in their own words." })
    const check = (id: string) => ({ source: "check", ref: id, quote: "", note: "A deterministic check supports this." })

    const strong = mode === "strong"
    const unsupported = mode === "unsupported"
    return {
      correctness: {
        rating: strong ? 3 : unsupported ? 3 : 1,
        rationale: strong ? "The work meets the acceptance criteria, including the edge cases." : "Only part of the task is done.",
        evidence: unsupported ? [code(fabricated), code(fabricated)] : strong ? [code(file.line), check("substance")] : [code(file.line)],
      },
      codeQuality: {
        rating: strong ? 2 : unsupported ? 3 : 1,
        rationale: strong ? "Readable and sensibly structured." : "Hard to follow in places.",
        evidence: unsupported ? [code(fabricated), code(fabricated)] : [code(file.line)],
      },
      understanding: {
        rating: strong ? 3 : unsupported ? 3 : 1,
        rationale: strong ? "Explained their approach accurately and with trade-offs." : "Answers stayed at the surface.",
        evidence: unsupported ? [answer(0), { source: "answer", ref: "A1", quote: fabricated, note: "x".repeat(10) }] : strong ? [answer(0), answer(1)] : [answer(0)],
      },
      summary: strong ? "The candidate delivered working code and explained it clearly." : "The candidate delivered part of the task but could not explain it in depth.",
      strengths: strong ? ["Clear explanation of the approach"] : [],
      weaknesses: strong ? [] : ["Surface-level explanations"],
      gaps: strong
        ? []
        : [{ skill, title: "Handling unexpected input", detail: "The submission does not say what happens when input is missing or malformed.", severity: "moderate", evidenceSource: "none", evidenceQuote: "" }],
    }
  }
}

/** The first substantial line of the first candidate file in a prompt, and that file's path. */
function firstFile(user: string): { path: string; line: string } {
  const m = /<untrusted_data kind="candidate_file" path="([^"]+)">\n([\s\S]*?)\n<\/untrusted_data>/.exec(user)
  const path = m?.[1] ?? "solution.py"
  const line = (m?.[2] ?? "").split("\n").map((l) => l.trim()).find((l) => l.length >= 12 && !l.startsWith("#")) ?? "def solve(data):"
  return { path, line }
}
