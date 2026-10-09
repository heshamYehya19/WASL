// Deterministic checks on a submission. NOTHING here executes submitted code: JavaScript is only PARSED (vm.Script compiles
// without running), JSON is parsed, and every other language gets a delimiter/string/comment scan. The results are shown to
// the candidate and the company as what they are — static analysis — and given to the reviewer as facts to weigh.

import { Script } from "node:vm"
import { copiedShare } from "./grounding.ts"
import type { Artifact } from "./grounding.ts"

export type CheckStatus = "pass" | "warn" | "fail" | "info"
export interface StaticCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  path?: string
}

export interface CheckInput {
  artifacts: (Artifact & { source: "pasted" | "repository"; truncated?: boolean })[]
  language: string
  /** The phase instructions and criteria, to detect a submission that is mostly a copy of the task. */
  taskText: string
  redactions: { count: number; kinds: string[] }
}

const PLACEHOLDER = /\b(?:todo:?\s*implement|your code (?:goes )?here|lorem ipsum|replace this|fill (?:this )?in|not implemented|placeholder)\b/i

const ext = (path: string) => path.split(".").pop()?.toLowerCase() ?? ""
const LINE_COMMENT: Record<string, string> = {
  py: "#", rb: "#", sh: "#", r: "#", sql: "--", js: "//", mjs: "//", jsx: "//", ts: "//", tsx: "//", java: "//", kt: "//",
  go: "//", rs: "//", cs: "//", cpp: "//", cc: "//", c: "//", h: "//", php: "//", swift: "//", dart: "//", scala: "//",
}

/** Code with comments and blank lines removed — what is left is "real" content. */
function substantiveLines(content: string, extension: string): string[] {
  const marker = LINE_COMMENT[extension]
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !(marker && l.startsWith(marker)) && !/^(\/\*|\*|\*\/)/.test(l))
}

/** Scans for unbalanced (), [], {} outside strings and comments. Returns the first problem, or null. */
export function delimiterProblem(content: string, extension: string): string | null {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" }
  const stack: { ch: string; line: number }[] = []
  const hash = extension === "py" || extension === "rb" || extension === "sh" || extension === "r"
  const slashes = !hash && extension !== "sql"
  let line = 1
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]
    if (ch === "\n") {
      line++
      continue
    }
    if (hash && ch === "#") {
      while (i < content.length && content[i] !== "\n") i++
      i--
      continue
    }
    if (slashes && ch === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++
      i--
      continue
    }
    if (slashes && ch === "/" && next === "*") {
      const end = content.indexOf("*/", i + 2)
      const stop = end < 0 ? content.length : end + 2
      line += (content.slice(i, stop).match(/\n/g) ?? []).length
      i = stop - 1
      continue
    }
    if (ch === '"' || ch === "'" || (ch === "`" && extension !== "py")) {
      const triple = extension === "py" && content.startsWith(ch.repeat(3), i)
      const quote = triple ? ch.repeat(3) : ch
      let j = i + quote.length
      for (; j < content.length; j++) {
        if (content[j] === "\\") {
          j++
          continue
        }
        if (content.startsWith(quote, j)) break
        if (content[j] === "\n") {
          line++
          // An ordinary string ends at the line (so an apostrophe in prose or a regex stays harmless).
          if (!triple && ch !== "`") break
        }
      }
      i = j + quote.length - 1
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") stack.push({ ch, line })
    else if (ch in pairs) {
      const top = stack.pop()
      if (!top || top.ch !== pairs[ch]) return `unexpected “${ch}” on line ${line}`
    }
  }
  const open = stack[stack.length - 1]
  return open ? `“${open.ch}” opened on line ${open.line} is never closed` : null
}

function syntaxCheck(a: Artifact): StaticCheck | null {
  const e = ext(a.path)
  if (e === "json") {
    try {
      JSON.parse(a.content)
      return { id: `syntax:${a.path}`, label: "JSON parses", status: "pass", detail: "Valid JSON.", path: a.path }
    } catch (err) {
      return { id: `syntax:${a.path}`, label: "JSON parses", status: "fail", detail: `Not valid JSON (${err instanceof Error ? err.message : "parse error"}).`, path: a.path }
    }
  }
  if (e === "js" || e === "cjs") {
    try {
      new Script(a.content, { filename: a.path }) // compiles; never runs
      return { id: `syntax:${a.path}`, label: "JavaScript parses", status: "pass", detail: "Parsed without syntax errors (not run).", path: a.path }
    } catch (err) {
      const message = err instanceof Error ? err.message : "syntax error"
      // ES module syntax is valid JavaScript that vm.Script cannot compile as a script; fall back to the delimiter scan.
      if (/import|export|top-level await/i.test(message)) return null
      return { id: `syntax:${a.path}`, label: "JavaScript parses", status: "fail", detail: `Syntax error: ${message}.`, path: a.path }
    }
  }
  return null
}

const TEST_HINT = /\b(?:describe|it|test)\s*\(|\bdef\s+test_|\bassert\w*\b|unittest|pytest|@Test\b|\bexpect\s*\(|#\[test\]|func\s+Test\w+\(/

export function runStaticChecks(input: CheckInput): StaticCheck[] {
  const checks: StaticCheck[] = []
  const all = input.artifacts
  const code = all.filter((a) => !/\.(md|rst|txt)$/i.test(a.path) || a.source === "pasted")

  // --- substance
  const lines = code.flatMap((a) => substantiveLines(a.content, ext(a.path)))
  const chars = lines.join("").length
  if (chars < 40) checks.push({ id: "substance", label: "Has real content", status: "fail", detail: "The submission has almost no content beyond comments and blank lines." })
  else checks.push({ id: "substance", label: "Has real content", status: "pass", detail: `${lines.length} non-comment lines across ${code.length} file${code.length === 1 ? "" : "s"}.` })

  if (code.some((a) => PLACEHOLDER.test(a.content))) {
    checks.push({ id: "placeholder", label: "No placeholder text", status: "warn", detail: "Contains placeholder text such as “TODO: implement” or “your code here”." })
  }

  // --- a copy of the task
  const submitted = code.map((a) => a.content).join("\n")
  if (copiedShare(submitted, input.taskText) >= 0.5) {
    checks.push({ id: "copied-task", label: "Not a copy of the task", status: "fail", detail: "Most of the submission repeats the phase instructions rather than answering them." })
  }

  // --- syntax and structure
  for (const a of all) {
    const syntax = syntaxCheck(a)
    if (syntax) checks.push(syntax)
    else if (a.truncated !== true && LINE_COMMENT[ext(a.path)]) {
      const problem = delimiterProblem(a.content, ext(a.path))
      checks.push(
        problem
          ? { id: `delimiters:${a.path}`, label: "Brackets balanced", status: "warn", detail: `${a.path}: ${problem}.`, path: a.path }
          : { id: `delimiters:${a.path}`, label: "Brackets balanced", status: "pass", detail: `${a.path}: every bracket is matched.`, path: a.path },
      )
    }
  }

  // --- tests and documentation
  const hasTests = all.some((a) => TEST_HINT.test(a.content) || /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.|test_[^/]*\.py$/i.test(a.path))
  checks.push({ id: "tests", label: "Tests present", status: hasTests ? "pass" : "info", detail: hasTests ? "Test code or assertions were found." : "No tests or assertions were found." })
  if (all.some((a) => /readme/i.test(a.path))) checks.push({ id: "readme", label: "README present", status: "pass", detail: "The repository has a README." })

  if (all.some((a) => a.truncated)) checks.push({ id: "truncated", label: "Fully read", status: "info", detail: "Some files were long and only their first part was read." })

  // --- secrets
  if (input.redactions.count > 0) {
    checks.push({
      id: "secrets",
      label: "No credentials committed",
      status: "warn",
      detail: `${input.redactions.count} value${input.redactions.count === 1 ? "" : "s"} that look like credentials (${input.redactions.kinds.join(", ")}) were found and removed before review. Rotate any real key you have shared.`,
    })
  }
  return checks
}

/** Reasons to turn a submission away before any review: the candidate should revise and resubmit. */
export function blockingProblems(checks: StaticCheck[]): string[] {
  const out: string[] = []
  if (checks.some((c) => c.id === "substance" && c.status === "fail")) out.push("The submission has almost no content. Add your actual work and submit again.")
  if (checks.some((c) => c.id === "copied-task" && c.status === "fail")) out.push("The submission mostly repeats the phase instructions. Submit your own work.")
  return out
}

/** Highest correctness the evidence allows, from deterministic facts alone. */
export function correctnessCap(checks: StaticCheck[]): { cap: 0 | 1 | 2 | 3; reason: string } {
  const broken = checks.find((c) => c.id.startsWith("syntax:") && c.status === "fail")
  if (broken) return { cap: 1, reason: `${broken.path ?? "A file"} does not parse, so the work cannot be rated as correct.` }
  return { cap: 3, reason: "" }
}
