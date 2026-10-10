/// <reference lib="dom" />
// End-to-end tests in a real browser. Starts a mock AI provider and the built WASL server (against a throw-away database), then
// drives the interface with Playwright: public pages, the company journey (brief → generate → review → publish), the student
// journey (start → submit → interview → pass → complete), the failure and recovery path, sharing, Talent Discovery, expressing
// interest, responsive layout and basic accessibility checks.
//
//   npm run build && npm run e2e
//
// Needs the browser Playwright uses: `npx playwright install chromium` once. Screenshots go to test-results/e2e/.

import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import type { Browser, BrowserContext, Page } from "playwright"
import { startMockAi } from "./mock-ai-server.ts"

const SHOTS = join(process.cwd(), "test-results", "e2e")
mkdirSync(SHOTS, { recursive: true })

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
    s.on("error", reject)
  })

const results: { name: string; ok: boolean; ms: number; error?: string }[] = []
let currentPage: Page | null = null

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  ok   ${name}`)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n").slice(0, 6).join("\n") : String(err)
    results.push({ name, ok: false, ms: Date.now() - started, error: message })
    console.log(`  FAIL ${name}\n       ${message.replace(/\n/g, "\n       ")}`)
    await currentPage?.screenshot({ path: join(SHOTS, `FAIL-${name.replace(/\W+/g, "-").slice(0, 60)}.png`), fullPage: true }).catch(() => undefined)
    return false
  }
}

function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

const ANSWER =
  "When the function runs it lowercases the subject and body, checks the enterprise tier first because those customers always go to the priority queue, and then looks for billing words. Anything else falls through to the general queue."
const CODE = [
  "BILLING = {'invoice', 'refund', 'payment'}",
  "",
  "def route_ticket(ticket):",
  "    text = f\"{ticket.get('subject', '')} {ticket.get('body', '')}\".lower()",
  "    if ticket.get('tier') == 'enterprise':",
  "        return {'queue': 'priority', 'reason': 'enterprise tier'}",
  "    if any(word in text for word in BILLING):",
  "        return {'queue': 'billing', 'reason': 'billing keyword'}",
  "    return {'queue': 'general', 'reason': 'no keyword matched'}",
].join("\n")

async function waitForServer(base: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`The WASL server exited early (code ${child.exitCode})`)
    try {
      const res = await fetch(`${base}/api/session`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error("The WASL server didn't start in time")
}

async function signInAs(page: Page, base: string, name: string) {
  await page.goto(`${base}/login`)
  await page.getByRole("button", { name: new RegExp(name) }).first().click()
  await page.waitForURL(/\/(student|company)$/)
}

/** Answers interview questions until the phase is assessed (or the engine reports it is unavailable). */
async function completeInterview(page: Page): Promise<"assessed" | "unavailable"> {
  for (let i = 0; i < 10; i++) {
    const outcome = await Promise.race([
      // Ready to answer = the form is there, enabled and empty (the previous answer has been sent and the page has moved on).
      page
        .waitForFunction(() => {
          const box = document.querySelector<HTMLTextAreaElement>("#interview-answer")
          return !!box && !box.disabled && box.value === ""
        }, undefined, { timeout: 30_000 })
        .then(() => "answer" as const),
      page.getByRole("heading", { name: "Assessment", exact: true }).waitFor({ state: "visible", timeout: 30_000 }).then(() => "assessed" as const),
      page.getByText("Assessment unavailable").first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "unavailable" as const),
    ])
    if (outcome !== "answer") return outcome
    await page.locator("#interview-answer").fill(ANSWER)
    const answered = page.waitForResponse((r) => /\/answer$/.test(r.url()))
    await page.getByRole("button", { name: "Send answer" }).click()
    await answered
    await page.waitForLoadState("networkidle")
  }
  throw new Error("The interview never finished")
}

async function checkAccessibility(page: Page, label: string) {
  const problems = await page.evaluate(() => {
    const out: string[] = []
    const h1 = document.querySelectorAll("h1").length
    if (h1 !== 1) out.push(`${h1} h1 elements`)
    if (!document.querySelector("main")) out.push("no <main> landmark")
    if (document.documentElement.lang !== "en") out.push("html lang is not set")
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const input = el as HTMLInputElement
      if (input.type === "hidden" || input.type === "file") continue
      const named = (input.labels && input.labels.length > 0) || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby")
      if (!named) out.push(`unlabelled ${el.tagName.toLowerCase()}#${el.id || "?"}`)
    }
    for (const b of document.querySelectorAll("button")) {
      if (!(b.textContent ?? "").trim() && !b.getAttribute("aria-label")) out.push("button with no name")
    }
    for (const a of document.querySelectorAll("a")) {
      if (!(a.textContent ?? "").trim() && !a.getAttribute("aria-label")) out.push("link with no name")
    }
    for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push("img without alt")
    return out
  })
  must(problems.length === 0, `${label}: ${problems.join("; ")}`)
}

async function main() {
  const mock = await startMockAi(0)
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const dir = mkdtempSync(join(tmpdir(), "wasl-e2e-"))
  const server = spawn(process.execPath, ["server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      WASL_DB_PATH: join(dir, "wasl.db"),
      WASL_DEMO_MODE: "true",
      WASL_SEED_DEMO_DATA: "true",
      GROQ_API_KEY: "mock-key-for-e2e-0123456789",
      GEMINI_API_KEY: "",
      WASL_GROQ_BASE_URL: `${mock.url}/v1`,
      WASL_AI_TIMEOUT_MS: "20000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  server.stdout?.on("data", () => undefined)
  let serverLog = ""
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()))

  let browser: Browser | null = null
  try {
    await waitForServer(base, server)
    console.log(`WASL at ${base}, mock AI at ${mock.url}`)
    browser = await chromium.launch()
    const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    currentPage = page
    page.setDefaultTimeout(15_000)
    const consoleErrors: string[] = []
    // (A 4xx from the API is an expected, handled answer — a rejected form, a page the account may not open — not a bug.)
    page.on("console", (m) => m.type() === "error" && !/favicon|fonts\.g|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && consoleErrors.push(m.text()))
    page.on("pageerror", (e) => consoleErrors.push(e.stack ?? String(e)))

    console.log("\nPublic site")
    await step("landing page shows the WASL brand and no university", async () => {
      await page.goto(base)
      await page.getByRole("heading", { level: 1 }).waitFor()
      const text = (await page.locator("body").innerText()).toLowerCase()
      must(text.includes("where ability meets opportunity"), "tagline missing")
      must(!text.includes("universit"), "the landing page should not mention universities")
      must(text.includes("وصل"), "Arabic mark missing")
      await page.screenshot({ path: join(SHOTS, "landing.png") })
    })
    for (const path of ["/", "/how-it-works", "/for-students", "/for-companies", "/about", "/login"]) {
      await step(`accessible structure: ${path}`, async () => {
        await page.goto(`${base}${path}`)
        await page.getByRole("heading", { level: 1 }).first().waitFor()
        await checkAccessibility(page, path)
      })
    }
    await step("an unknown page shows a helpful 404", async () => {
      await page.goto(`${base}/nope`)
      await page.getByText("That page isn't here").waitFor()
    })

    console.log("\nCompany: brief → generate → review → publish")
    await step("sign in as Nahla Systems", async () => {
      await signInAs(page, base, "Nahla Systems")
      await page.getByRole("heading", { name: "Nahla Systems" }).waitFor()
      await page.screenshot({ path: join(SHOTS, "company-dashboard.png") })
    })
    let challengeUrl = ""
    await step("create a challenge from the five-field brief and generate it", async () => {
      await page.goto(`${base}/company/challenges/new`)
      await page.getByLabel("Problem description").fill("Our support team sorts incoming tickets by hand. We want a small tool that reads a ticket and suggests which queue it belongs in, with the reason.")
      await page.locator("#skills").fill("Python")
      await page.locator("#skills").press("Enter")
      await page.locator("#skills").fill("software testing")
      await page.locator("#skills").press("Enter")
      await page.getByLabel("Difficulty").selectOption("beginner")
      await page.getByLabel("Realistic time for one candidate (hours)").fill("6")
      await page.getByLabel("Expected deliverables").fill("A Python function with tests and a short note about its limits.")
      await page.getByRole("button", { name: "Create and generate" }).click()
      await page.waitForURL(/\/company\/challenges\/chl-/)
      await page.getByText("Generated by AI — please review it").waitFor()
      challengeUrl = page.url()
      await page.screenshot({ path: join(SHOTS, "company-generated.png") })
    })
    await step("the brief rejects personal data and names the field", async () => {
      await page.goto(`${base}/company/challenges/new`)
      await page.getByLabel("Problem description").fill("Call Ahmad on +962 79 123 4567 or ahmad.khalil@example.com about the support data we have.")
      await page.locator("#skills").fill("Python")
      await page.locator("#skills").press("Enter")
      await page.getByLabel("Expected deliverables").fill("A Python script that sorts tickets.")
      await page.getByRole("button", { name: "Save as draft" }).click()
      await page.getByText(/personal or sensitive data/).waitFor()
    })
    await step("review the generated challenge: edit the title and save a new version", async () => {
      await page.goto(challengeUrl)
      await page.getByRole("tab", { name: "Challenge" }).click()
      await page.getByLabel("Title").first().fill("Ticket routing challenge")
      await page.getByRole("button", { name: "Save as a new version" }).click()
      await page.getByRole("heading", { name: "Ticket routing challenge" }).waitFor()
      await page.getByRole("tab", { name: "History" }).click()
      await page.getByText(/Version 2 — Edited by your team/).waitFor()
      must(await page.getByText(/Version 1 — Generated by AI/).isVisible(), "the AI's original version should be kept")
    })
    await step("mark reviewed, then publishing needs the evaluation-use confirmation", async () => {
      await page.getByRole("tab", { name: "Overview" }).click()
      await page.getByRole("button", { name: "Mark as reviewed" }).click()
      await page.getByRole("button", { name: "Publish…" }).click()
      const publish = page.getByRole("button", { name: "Publish this challenge" })
      must(await publish.isDisabled(), "publish should be disabled until the terms are confirmed")
      await page.getByText(/only to evaluate candidates/).first().waitFor()
      await page.getByRole("checkbox", { name: /I confirm that submissions/ }).check()
      await publish.click()
      await page.getByText(/Open to candidates/).waitFor()
    })

    console.log("\nStudent: start → submit → interview → pass → complete")
    await step("sign in as Sara Nasser and see the published challenge", async () => {
      await signInAs(page, base, "Sara Nasser")
      await page.goto(`${base}/student/challenges`)
      await page.getByRole("link", { name: /Ticket routing challenge/ }).waitFor()
      await page.screenshot({ path: join(SHOTS, "student-challenges.png") })
    })
    let workUrl = ""
    await step("starting requires understanding who sees the work", async () => {
      await page.getByRole("link", { name: /Ticket routing challenge/ }).click()
      await page.getByText(/will be able to see your submissions/).first().waitFor()
      const start = page.getByRole("button", { name: "Start this challenge" })
      must(await start.isDisabled(), "start should be disabled before acknowledging")
      await page.getByRole("checkbox", { name: /I understand that Nahla Systems will see/ }).check()
      await start.click()
      await page.waitForURL(/\/student\/work\/run-/)
      workUrl = page.url()
      await page.getByRole("heading", { name: "Ticket routing challenge" }).waitFor()
    })
    await step("later phases are locked until the one before has been submitted", async () => {
      await page.getByText(/Opens once you submit/).first().waitFor()
      must((await page.getByRole("link", { name: "Start" }).count()) === 1, "only the first phase can be started")
    })
    await step("submit phase 1 and be interviewed before any decision", async () => {
      await page.getByRole("link", { name: "Start" }).click()
      await page.locator("#code").fill(CODE)
      await page.getByLabel("Language").first().fill("Python")
      await page.getByRole("button", { name: "Submit for review" }).click()
      await page.locator("#interview-answer").waitFor()
      must((await page.getByRole("heading", { name: "Assessment", exact: true }).count()) === 0, "no assessment may exist before the interview is finished")
      await page.getByText("Understanding interview").waitFor()
      await page.getByText("Deterministic checks").waitFor()
      await page.getByText(/read, not run|Your code is read, not run/).first().waitFor()
      await page.screenshot({ path: join(SHOTS, "student-interview.png"), fullPage: true })
    })
    await step("answer the interview, then see three separate rated dimensions", async () => {
      const outcome = await completeInterview(page)
      must(outcome === "assessed", `expected an assessment, got ${outcome}`)
      for (const d of ["Correctness", "Code quality", "Demonstrated understanding"]) await page.getByRole("region", { name: d }).waitFor()
      await page.getByText("Passed", { exact: true }).first().waitFor()
      await page.screenshot({ path: join(SHOTS, "student-assessment.png"), fullPage: true })
    })
    await step("pass the remaining phases and submit the complete solution", async () => {
      for (const key of ["p2", "p3"]) {
        await page.goto(`${workUrl}/${key}`)
        await page.locator("#code").fill(CODE)
        await page.getByRole("button", { name: "Submit for review" }).click()
        const outcome = await completeInterview(page)
        must(outcome === "assessed", `phase ${key}: expected an assessment, got ${outcome}`)
      }
      await page.goto(workUrl)
      await page.getByRole("button", { name: "Submit complete solution" }).click()
      await page.getByText(/Submitted as complete/).waitFor()
    })

    console.log("\nFailure and recovery")
    await step("an AI outage during assessment leaves the phase unavailable — never passed or failed — and retry recovers", async () => {
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ fail: ["assessment"] }) })
      await page.goto(`${base}/student/practice`)
      await page.locator("#skills").fill("Python")
      await page.locator("#skills").press("Enter")
      await page.getByRole("button", { name: "Create my challenge" }).click()
      await page.waitForURL(/\/student\/work\/run-/)
      await page.getByRole("link", { name: "Start" }).click()
      await page.locator("#code").fill(CODE)
      await page.getByRole("button", { name: "Submit for review" }).click()
      const outcome = await completeInterview(page)
      must(outcome === "unavailable", `expected "unavailable", got ${outcome}`)
      await page.getByText(/nothing has been decided/i).waitFor()
      must((await page.getByRole("heading", { name: "Assessment", exact: true }).count()) === 0, "no assessment may be shown")
      must((await page.getByText("Passed", { exact: true }).count()) === 0, "must not say passed")
      await page.screenshot({ path: join(SHOTS, "student-unavailable.png"), fullPage: true })
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ fail: [] }) })
      await page.getByRole("button", { name: "Try again" }).click()
      await page.getByRole("heading", { name: "Assessment", exact: true }).waitFor()
    })
    await step("'Try again' with not enough verified evidence sends ONE retry for the same attempt, shows progress and says it is still undecided", async () => {
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ assessment: "unsupported", fail: [] }) })
      await page.goto(`${base}/student/practice`)
      await page.locator("#skills").fill("Python")
      await page.locator("#skills").press("Enter")
      await page.getByRole("button", { name: "Create my challenge" }).click()
      await page.waitForURL(/\/student\/work\/run-/)
      await page.getByRole("link", { name: "Start" }).click()
      await page.locator("#code").fill(CODE)
      const submitted = page.waitForResponse((r) => /\/phases\/[^/]+\/submissions$/.test(r.url()) && r.request().method() === "POST")
      await page.getByRole("button", { name: "Submit for review" }).click()
      const submissionId = String(((await (await submitted).json()) as { submissionId: string }).submissionId)
      const outcome = await completeInterview(page)
      must(outcome === "unavailable", `expected "unavailable", got ${outcome}`)
      await page.getByText(/not enough verified evidence/i).first().waitFor()

      const retries: string[] = []
      const creates: string[] = []
      const watch = (r: { method(): string; url(): string }) => {
        if (r.method() !== "POST") return
        if (/\/api\/submissions\/[^/]+\/retry$/.test(r.url())) retries.push(r.url())
        if (/\/phases\/[^/]+\/submissions$/.test(r.url())) creates.push(r.url())
      }
      page.on("request", watch)
      const done = page.waitForResponse((r) => /\/retry$/.test(r.url()))
      const button = page.getByRole("button", { name: "Try again" })
      await button.dblclick() // an impatient double click must still send a single request
      const res = await done
      must(res.status() === 200, `retry answered ${res.status()}`)
      // The click visibly did something: it says it tried again and why it still couldn't decide. No result is invented.
      const feedback = page.getByTestId("retry-feedback")
      await feedback.getByText(/Tried again at .+ still couldn't be completed/).waitFor()
      must(/nothing has been decided/.test((await feedback.textContent()) ?? ""), "the feedback must say nothing was decided")
      must(retries.length === 1, `expected exactly 1 retry request, saw ${retries.length}`)
      must(retries[0].endsWith(`/api/submissions/${submissionId}/retry`), `retried the wrong submission: ${retries[0]}`)
      must(creates.length === 0, "a retry must not create a new submission")
      must((await page.getByRole("heading", { name: "Assessment", exact: true }).count()) === 0, "no assessment may be shown")
      must((await page.getByText("Passed", { exact: true }).count()) === 0, "must not say passed")
      must((await page.getByRole("button", { name: /^Attempt 2/ }).count()) === 0, "no second attempt may appear")
      await page.screenshot({ path: join(SHOTS, "student-retry-still-unavailable.png"), fullPage: true })
      page.off("request", watch)

      // Once the evidence can be verified, the same button finishes the same attempt by the normal rule.
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ assessment: "strong" }) })
      await button.click()
      await page.getByRole("heading", { name: "Assessment", exact: true }).waitFor()
    })
    await step("a weak result is 'not passed yet', never a failure stamp, and opens an improvement plan", async () => {
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ assessment: "weak" }) })
      await page.goto(`${base}/student/practice`)
      await page.locator("#skills").fill("SQL")
      await page.locator("#skills").press("Enter")
      await page.getByRole("button", { name: "Create my challenge" }).click()
      await page.waitForURL(/\/student\/work\/run-/)
      await page.getByRole("link", { name: "Start" }).click()
      await page.locator("#code").fill(CODE)
      await page.getByRole("button", { name: "Submit for review" }).click()
      await completeInterview(page)
      await page.getByText("Not passed yet").first().waitFor()
      must((await page.getByText(/\bfailed\b/i).count()) === 0, "the word 'failed' should not be used about the person")
      // A phase that has not passed keeps the next one locked (strict sequential progression).
      await page.goto(page.url().replace(/\/p\d+(\?.*)?$/, "")) // this run's overview
      // Submission-based unlocking: phase 1 was submitted (and not passed), so phase 2 is open; phase 3 waits for phase 2.
      await page.getByText(/You can carry on with the next phase meanwhile/).waitFor()
      must((await page.getByRole("link", { name: "Start" }).count()) === 1, "exactly the next phase should be startable after phase 1 was submitted")
      await page.getByText(/Opens once you submit/).first().waitFor()
      await fetch(`${mock.url}/__behavior`, { method: "POST", body: JSON.stringify({ assessment: "strong" }) })
    })
    await step("the Improve page turns the gap into a plan with checked resources, a lesson and an exercise", async () => {
      await page.goto(`${base}/student/learning`)
      await page.getByRole("link", { name: /Handling unexpected input/ }).first().click()
      await page.getByText("Where to learn this").waitFor()
      await page.getByText(/practice material|Practice material|never change a phase result/).first().waitFor()
      await page.getByRole("button", { name: "Write me a short lesson" }).click()
      await page.getByText(/Generated by/).first().waitFor()
      await page.getByRole("button", { name: "Give me an exercise" }).click()
      await page.locator("#exercise-answer").fill("def average(xs):\n    return sum(xs) / len(xs) if xs else None")
      await page.getByRole("button", { name: "Get feedback" }).click()
      await page.getByText("Practice feedback — not an assessment").waitFor()
      await page.screenshot({ path: join(SHOTS, "student-improve.png"), fullPage: true })
    })

    console.log("\nSharing, Talent Discovery and interest")
    await step("the student becomes discoverable and shares the finished challenge with employers", async () => {
      await page.goto(`${base}/student/profile`)
      await page.getByRole("switch", { name: /Appear in Talent Discovery/ }).click()
      await page.getByText(/no work is shared with employers/).waitFor()
      await page.goto(workUrl)
      const shared = page.waitForResponse((r) => /\/share$/.test(r.url()))
      await page.getByRole("radio", { name: /Employers who find me/ }).click()
      await shared
      await page.goto(`${base}/student/profile`)
      await page.getByRole("heading", { name: "Skills and evidence" }).waitFor()
      await page.getByRole("region", { name: "Demonstrated" }).getByText("Python").first().waitFor()
      await page.screenshot({ path: join(SHOTS, "student-profile.png"), fullPage: true })
    })
    await step("a company finds the candidate by demonstrated skill, with the evidence shown", async () => {
      await signInAs(page, base, "Orbit Analytics")
      await page.goto(`${base}/company/talent`)
      await page.locator("#t-skills").fill("Python")
      await page.locator("#t-skills").press("Enter")
      await page.getByLabel(/Demonstrated skills only/).check()
      await page.getByRole("button", { name: "Search" }).click()
      await page.getByRole("link", { name: "Sara Nasser" }).waitFor()
      await page.getByText(/Demonstrated in \d+ assessed phase/).first().waitFor()
      await page.screenshot({ path: join(SHOTS, "company-talent.png"), fullPage: true })
    })
    await step("the company sees only demonstrated skills — no code, and no private practice", async () => {
      await page.getByRole("link", { name: "Sara Nasser" }).click()
      await page.getByRole("heading", { name: "Skills and evidence" }).waitFor()
      const text = await page.locator("main").innerText()
      must(!text.includes("route_ticket"), "code leaked to a company that was only given the evidence")
      must(!/Building/.test(text), "attempts that haven't passed must not be shown to employers")
    })
    await step("express interest; the candidate is told who and why", async () => {
      await page.getByLabel("A message").fill("We'd like to talk about a junior role.")
      await page.getByRole("button", { name: "Express interest" }).click()
      await page.getByText(/You've told Sara you're interested/).waitFor()
      await signInAs(page, base, "Sara Nasser")
      await page.goto(`${base}/student/profile`)
      await page.getByText("Orbit Analytics").first().waitFor()
      await page.getByText(/junior role/).waitFor()
    })
    await step("the company challenge owner sees the candidate's shared work and interview", async () => {
      await signInAs(page, base, "Nahla Systems")
      await page.goto(`${challengeUrl}`)
      await page.getByRole("tab", { name: /Candidates/ }).click()
      await page.getByRole("link", { name: "Sara Nasser" }).click()
      await page.getByText("Open the evidence").first().click()
      await page.getByText("Understanding interview").first().waitFor()
      await page.getByText(/read, never run/).first().waitFor()
      await page.screenshot({ path: join(SHOTS, "company-participant.png"), fullPage: true })
    })
    await step("one student cannot open another's work by its address", async () => {
      await signInAs(page, base, "Omar Saleh")
      await page.goto(workUrl)
      await page.getByText("We couldn't load this.").waitFor()
    })

    console.log("\nLayout")
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
    const mobile = await phone.newPage()
    currentPage = mobile
    mobile.setDefaultTimeout(15_000)
    await signInAs(mobile, base, "Sara Nasser")
    for (const path of ["/", "/login", "/how-it-works", "/student", "/student/challenges", "/student/practice", "/student/work", "/student/learning", "/student/profile"]) {
      await step(`no horizontal scrolling on a phone: ${path}`, async () => {
        await mobile.goto(`${base}${path}`)
        await mobile.getByRole("heading", { level: 1 }).first().waitFor()
        await mobile.waitForLoadState("networkidle")
        const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        must(overflow <= 1, `page is ${overflow}px wider than the screen`)
        if (path === "/student") await mobile.screenshot({ path: join(SHOTS, "mobile-dashboard.png") })
      })
    }
    await step("the phone menu opens and navigates", async () => {
      await mobile.goto(`${base}/student`)
      await mobile.getByRole("button", { name: "Menu" }).click()
      await mobile.locator("#mobile-nav").getByRole("link", { name: "Practice Lab" }).click()
      await mobile.waitForURL(/\/student\/practice$/)
    })
    currentPage = page
    await phone.close()

    await step("accessible structure inside the app", async () => {
      await signInAs(page, base, "Sara Nasser")
      for (const path of ["/student", "/student/challenges", "/student/practice", "/student/work", "/student/learning", "/student/profile"]) {
        await page.goto(`${base}${path}`)
        await page.getByRole("heading", { level: 1 }).first().waitFor()
        await page.waitForLoadState("networkidle")
        await checkAccessibility(page, path)
      }
    })
    await step("dark mode works", async () => {
      await page.getByRole("button", { name: /Switch to dark mode/ }).click()
      must(await page.evaluate(() => document.documentElement.classList.contains("dark")), "dark class not applied")
      await page.screenshot({ path: join(SHOTS, "dark-mode.png") })
      await page.getByRole("button", { name: /Switch to light mode/ }).click()
    })
    await step("no console errors or uncaught exceptions during the whole run", async () => {
      must(consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "))
    })
  } finally {
    await browser?.close().catch(() => undefined)
    server.kill()
    await mock.close()
    // Windows keeps the database file locked for a moment after the server exits; a leftover temp file is harmless.
    await new Promise((r) => setTimeout(r, 300))
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} end-to-end steps passed.`)
  if (failed.length) {
    console.log("Failed:\n" + failed.map((f) => `  - ${f.name}`).join("\n"))
    if (serverLog.trim()) console.log("\nServer stderr:\n" + serverLog.slice(-2000))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
