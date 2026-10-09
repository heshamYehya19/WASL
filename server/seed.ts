import type { DatabaseSync } from "node:sqlite"
import { finalizeSpec } from "./domain/spec.ts"
import type { ChallengeSpec, RawSpec } from "./domain/spec.ts"
import { exec, newId } from "./sql.ts"
import { insertVersion, loadVersion } from "./services/versions.ts"

// The demonstration data a fresh database starts with, so the product can be explored on first launch:
//  * two companies, each with one published sample challenge (hand-written, labelled "demonstration content");
//  * three candidates. Two are discoverable and carry a few clearly labelled demonstration assessments, so Talent Discovery is
//    not empty; the third is a blank account to try the whole flow.
// Demonstration assessments are NOT produced by the Proof Engine. They are marked `origin = demo_fixture`, the candidates and
// runs are flagged `is_demo_fixture`, and the interface says so wherever they appear. Real challenges, submissions, interviews
// and assessments created by using the app are never mixed with them. Set WASL_SEED_DEMO_DATA=false to start empty.

const NOW = () => new Date().toISOString()
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

const routerSpec: RawSpec = {
  title: "Support ticket router",
  summary:
    "A small support team receives tickets by email and sorts them by hand. Build a routing function that reads a ticket and sends it to the right queue — billing, technical or general — with a clear reason, then show it works.",
  scenario:
    "The team gets about 200 tickets a day. A ticket has a subject, a body and a customer tier (free, pro, enterprise). Billing tickets mention invoices, refunds or payments; technical tickets mention errors, crashes or setup; everything else is general. Enterprise tickets always go to the priority queue.",
  learningGoals: ["Turn a loose business rule into code", "Design for missing and malformed input", "Test behaviour rather than implementation"],
  skills: ["Python", "REST API Design", "Software Testing"],
  difficulty: "beginner",
  estimatedHours: 8,
  phases: [
    {
      key: "p1",
      title: "Plan the routing rules",
      objective: "Show that you understand the routing rules and have a sensible plan before writing code.",
      instructions:
        "Read the scenario. In your own words, write a short plan (under one page) for how a ticket becomes a queue. State the order in which you would apply the rules (for example, does the enterprise rule beat the keyword rules?), what you would do with a ticket that matches both billing and technical words, and how you would handle an empty subject or an unknown tier. List two questions you would ask the support team.",
      skills: ["Python", "REST API Design"],
      acceptanceCriteria: ["States the order in which rules are applied and why", "Says what happens when a ticket matches more than one queue", "Handles an empty subject and an unknown customer tier", "Lists at least two questions for the support team"],
      rubric: [
        { dimension: "correctness", criterion: "The plan applies the enterprise rule and the keyword rules consistently with the scenario", strongSignal: "Puts the enterprise rule first (or explains a justified alternative) and resolves conflicts between billing and technical keywords explicitly" },
        { dimension: "code_quality", criterion: "The plan is organised so someone else could implement it", strongSignal: "A short numbered list of rules, with the decision order obvious at a glance" },
        { dimension: "understanding", criterion: "The candidate can justify the rule order and the handling of ambiguous tickets", strongSignal: "Explains a concrete ticket that would be routed wrongly under a different order" },
      ],
      deliverables: ["A written plan (plain text or Markdown)"],
      dependsOn: [],
      estimatedHours: 1.5,
    },
    {
      key: "p2",
      title: "Implement the router",
      objective: "Build a function that routes a ticket to a queue and explains why.",
      instructions:
        "Write a Python function route_ticket(ticket) where ticket is a dict with 'subject', 'body' and 'tier'. It returns a dict {'queue': ..., 'reason': ...}. Queues are 'priority', 'billing', 'technical' and 'general'. Follow your plan. The function must not crash on a missing field or an unexpected tier; it should fall back to 'general' with a reason that says what was missing. Paste your code, or link a public GitHub repository.",
      skills: ["Python", "REST API Design"],
      acceptanceCriteria: ["Enterprise tickets go to 'priority'", "Billing and technical keywords route to the matching queue", "A missing field or unknown tier does not raise an exception", "Every result includes a human-readable reason"],
      rubric: [
        { dimension: "correctness", criterion: "The function returns the right queue for the cases in the scenario", strongSignal: "Handles enterprise precedence, keyword matches, and a ticket with no matching keywords" },
        { dimension: "code_quality", criterion: "The code is readable, with clear names and small functions", strongSignal: "The keyword lists are data, not repeated if-statements; names explain intent" },
        { dimension: "understanding", criterion: "The candidate can explain how the function decides and what its limits are", strongSignal: "Names a real weakness of keyword matching and how they would improve it" },
      ],
      deliverables: ["Python source code for route_ticket"],
      dependsOn: ["p1"],
      estimatedHours: 3.5,
    },
    {
      key: "p3",
      title: "Test and document",
      objective: "Show that the router behaves as intended, including on awkward input.",
      instructions:
        "Add tests (pytest or unittest) for the main behaviour and at least three awkward cases: an empty subject, mixed-case keywords, and a ticket that matches both billing and technical words. Add a short note on how to run them and on one limitation of your approach.",
      skills: ["Python", "Software Testing"],
      acceptanceCriteria: ["Tests cover each of the four queues", "Tests include an empty subject and mixed-case keywords", "Tests include a ticket that matches two queues", "A short note explains how to run the tests and one limitation"],
      rubric: [
        { dimension: "correctness", criterion: "The tests assert specific expected queues, not just that the code runs", strongSignal: "Each test names the input and the expected queue and would fail if the rule were wrong" },
        { dimension: "code_quality", criterion: "Test names describe the behaviour being checked", strongSignal: "Names such as test_enterprise_beats_billing_keywords" },
        { dimension: "understanding", criterion: "The candidate can say what their tests would and would not catch", strongSignal: "Identifies a bug their tests would miss and how to cover it" },
      ],
      deliverables: ["Test code", "A short note on running the tests and one limitation"],
      dependsOn: ["p2"],
      estimatedHours: 3,
    },
  ],
}

const anomalySpec: RawSpec = {
  title: "Weekly sales anomaly report",
  summary:
    "A retailer wants to know which days last month looked unusual. Define what 'unusual' means, write a small script that finds those days from a table of daily sales, and report what you found and how far to trust it.",
  scenario:
    "You are given 30 days of daily totals for one store (the data is invented): most days are between 900 and 1,300, a weekend runs higher, and two days look odd — day 9 at 2,950 and day 21 at 140. A manager will read your report on Monday and decide whether to investigate.",
  learningGoals: ["Choose and justify a simple anomaly rule", "Separate the method from the data", "Communicate limits honestly"],
  skills: ["Python", "Data Analysis", "SQL"],
  difficulty: "intermediate",
  estimatedHours: 10,
  phases: [
    {
      key: "p1",
      title: "Define 'unusual'",
      objective: "Choose a defensible rule for calling a day an anomaly, and say why.",
      instructions:
        "Looking at the scenario, write down how you would decide that a day is unusual. Consider at least two options (for example, a fixed band, a z-score, or comparing with the same weekday). Pick one, explain why it suits weekend-heavy sales, and write the SQL you would use to compute a daily average and standard deviation from a table sales(day DATE, total NUMERIC).",
      skills: ["Data Analysis", "SQL"],
      acceptanceCriteria: ["Compares at least two ways to define an anomaly", "Explains why the chosen rule suits weekend-heavy data", "Includes a working SQL query for the daily average and standard deviation", "States an assumption about the data that could be wrong"],
      rubric: [
        { dimension: "correctness", criterion: "The SQL computes the average and standard deviation correctly", strongSignal: "Uses AVG and a correct standard deviation expression over the right column" },
        { dimension: "code_quality", criterion: "The query and the write-up are clear and well formatted", strongSignal: "Readable SQL with aliases; the reasoning is short and ordered" },
        { dimension: "understanding", criterion: "The candidate can explain why a simple rule can mislead on weekly patterns", strongSignal: "Explains that a weekend peak could be flagged unless the weekday is accounted for" },
      ],
      deliverables: ["A short write-up", "The SQL query"],
      dependsOn: [],
      estimatedHours: 2.5,
    },
    {
      key: "p2",
      title: "Detect the anomalies",
      objective: "Implement the rule in Python and apply it to the data.",
      instructions:
        "Write a Python function find_anomalies(totals) that takes a list of 30 daily totals and returns the 1-based day numbers it considers unusual, using the rule you chose. Include the data from the scenario as a list in your file (invent plausible values around the numbers given) and print the result. Paste your code or link a public GitHub repository.",
      skills: ["Python", "Data Analysis"],
      acceptanceCriteria: ["Returns day numbers, not values", "Flags the two odd days from the scenario", "Does not flag the weekend peak as an anomaly", "Handles an empty list without crashing"],
      rubric: [
        { dimension: "correctness", criterion: "The function flags the genuinely odd days and not the normal weekend peak", strongSignal: "Works on the data with the weekend pattern and returns exactly the odd days" },
        { dimension: "code_quality", criterion: "The code separates the rule from the data and is easy to read", strongSignal: "Threshold is a named parameter; no magic numbers in the middle of a loop" },
        { dimension: "understanding", criterion: "The candidate can explain how the threshold was chosen and what changing it would do", strongSignal: "Describes the trade-off between false alarms and missed anomalies" },
      ],
      deliverables: ["Python source code"],
      dependsOn: ["p1"],
      estimatedHours: 4,
    },
    {
      key: "p3",
      title: "Report to the manager",
      objective: "Explain the findings, and their limits, to a non-technical reader.",
      instructions:
        "Write a half-page note to the store manager: which days were flagged, what the numbers were, what you would check first, and how confident you are. Include one thing the analysis cannot tell them and what extra data would help.",
      skills: ["Data Analysis", "Python"],
      acceptanceCriteria: ["Names the flagged days and their values", "Suggests a first thing to check", "States the confidence honestly", "Names one thing the analysis cannot show and what data would help"],
      rubric: [
        { dimension: "correctness", criterion: "The report matches what the code actually found", strongSignal: "The days and values in the note are exactly those produced by the detector" },
        { dimension: "code_quality", criterion: "The note is clear and free of jargon", strongSignal: "A manager could act on it after one read" },
        { dimension: "understanding", criterion: "The candidate can explain the limits of a small sample and a simple rule", strongSignal: "Explains that 30 days cannot reveal seasonal patterns" },
      ],
      deliverables: ["A half-page report"],
      dependsOn: ["p2"],
      estimatedHours: 3.5,
    },
  ],
}

function specFrom(raw: RawSpec): ChallengeSpec {
  return finalizeSpec(raw, { requiredSkills: raw.skills, budgetHours: raw.estimatedHours, difficulty: raw.difficulty })
}

interface FixturePhase {
  key: string
  outcome: "passed" | "failed"
  ratings: [number, number, number]
  summary: string
  code: string
}

/** One demonstration run with assessed phases. Everything here is labelled as demonstration data. */
function fixtureRun(db: DatabaseSync, candidateId: string, challengeId: string, versionId: string, shareScope: "employers" | "challenge_owner", phases: FixturePhase[], completed: boolean, daysAgo: number): void {
  const version = loadVersion(db, versionId)!
  const runId = newId("run")
  exec(
    db,
    "INSERT INTO runs (id, candidate_id, kind, challenge_id, version_id, status, share_scope, is_demo_fixture, started_at, completed_at) VALUES (?, ?, 'company', ?, ?, ?, ?, 1, ?, ?)",
    runId, candidateId, challengeId, versionId, completed ? "completed" : "in_progress", shareScope, ago(daysAgo + 3), completed ? ago(daysAgo) : null,
  )
  for (const spec of version.spec.phases) {
    const done = phases.find((p) => p.key === spec.key)
    const rpId = newId("rph")
    exec(db, "INSERT INTO run_phases (id, run_id, phase_id, state, attempts, updated_at) VALUES (?, ?, ?, ?, ?, ?)", rpId, runId, version.phaseIds[spec.key], done ? done.outcome : "not_started", done ? 1 : 0, ago(daysAgo))
    if (!done) continue
    const subId = newId("sub")
    exec(
      db,
      "INSERT INTO submissions (id, run_phase_id, attempt, language, code_text, content_hash, stage, problems, created_at) VALUES (?, ?, 1, 'Python', ?, ?, 'assessed', '[]', ?)",
      subId, rpId, done.code, `demo-${subId}`, ago(daysAgo + 1),
    )
    exec(db, "INSERT INTO submission_artifacts (id, submission_id, path, source, content, size, truncated, redactions) VALUES (?, ?, 'solution.py', 'pasted', ?, ?, 0, 0)", newId("art"), subId, done.code, done.code.length)
    const asmId = newId("asm")
    const evidence = JSON.stringify({ rationale: "Demonstration data — not produced by the Proof Engine.", adjustment: "", dropped: 0, items: [] })
    exec(
      db,
      `INSERT INTO assessments (id, submission_id, correctness, correctness_evidence, code_quality, code_quality_evidence, understanding, understanding_evidence,
         outcome, outcome_reason, summary, strengths, weaknesses, origin, provider, model, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'demo_fixture', '', '', 'demo', ?)`,
      asmId, subId, done.ratings[0], evidence, done.ratings[1], evidence, done.ratings[2], evidence, done.outcome,
      done.outcome === "passed" ? "Demonstration data: shown as passed." : "Demonstration data: shown as not passed yet.", done.summary, ago(daysAgo),
    )
    for (const skill of spec.skills) {
      exec(
        db,
        "INSERT INTO skill_evidence (id, candidate_id, skill, run_id, phase_id, assessment_id, state, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        newId("evd"), candidateId, skill, runId, version.phaseIds[spec.key], asmId, done.outcome === "passed" ? "demonstrated" : "attempted", "Demonstration data.", ago(daysAgo),
      )
    }
  }
}

export function seedDatabase(db: DatabaseSync): void {
  if (process.env.WASL_SEED_DEMO_DATA === "false") return
  const now = NOW()

  exec(db, "INSERT INTO companies (id, name, industry, location, logo_initials, about, website, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "co-nahla", "Nahla Systems", "Software & support tooling", "Amman, Jordan", "NS",
    "A small team building help-desk software for regional retailers. (Fictional company for demonstration.)", "", now)
  exec(db, "INSERT INTO companies (id, name, industry, location, logo_initials, about, website, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "co-orbit", "Orbit Analytics", "Retail analytics", "Remote", "OA",
    "Helps shops understand their sales data. (Fictional company for demonstration.)", "", now)

  const challenges: [string, string, RawSpec, string, string][] = [
    ["chl-demo-router", "co-nahla", routerSpec, "Build a small routing function that sends support tickets to the right queue, test it, and explain the choices you made.", "Python, tests and a short note"],
    ["chl-demo-anomaly", "co-orbit", anomalySpec, "Find the unusual days in a month of daily sales, using a rule you can defend, and report what you found and how far to trust it.", "Python code and a half-page report"],
  ]
  const versions = new Map<string, string>()
  for (const [id, companyId, raw, problem, deliverables] of challenges) {
    const spec = specFrom(raw)
    exec(
      db,
      `INSERT INTO challenges (id, company_id, problem_description, required_skills, difficulty, expected_deliverables, time_hours, status, evaluation_use_acknowledged, is_demo_fixture, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 1, 1, ?, ?, ?)`,
      id, companyId, problem, JSON.stringify(spec.skills), spec.difficulty, deliverables, Math.round(spec.estimatedHours), ago(10), ago(10), ago(10),
    )
    const versionId = insertVersion(db, { kind: "company", challengeId: id, spec, origin: "demo_fixture", promptVersion: "demo" })
    exec(db, "UPDATE challenges SET current_version_id = ?, published_version_id = ? WHERE id = ?", versionId, versionId, id)
    for (const status of ["draft", "generated", "reviewed", "published"]) exec(db, "INSERT INTO challenge_history (challenge_id, status, at, note) VALUES (?, ?, ?, 'Demonstration challenge.')", id, status, ago(10))
    versions.set(id, versionId)
  }

  const candidate = (id: string, name: string, headline: string, bio: string, location: string, status: string, education: string, skills: string[], discoverable: boolean, availability: string, fixture: boolean) =>
    exec(
      db,
      `INSERT INTO candidates (id, name, headline, bio, location, status, education, availability, declared_skills, links, discoverable, is_demo_fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      id, name, headline, bio, location, status, education, availability, JSON.stringify(skills), discoverable ? 1 : 0, fixture ? 1 : 0, now, now,
    )
  candidate("cand-layla", "Layla Haddad", "Backend developer · Python", "Recent graduate who likes small, well-tested services. (Demonstration profile.)", "Amman, Jordan", "graduate", "B.Sc. Computer Science (self-reported)", ["Python", "SQL", "Git", "REST API Design"], true, "open_to_work", true)
  candidate("cand-omar", "Omar Saleh", "Aspiring data analyst", "Second-year student practising data analysis. (Demonstration profile.)", "Irbid, Jordan", "student", "Studying Data Science (self-reported)", ["Python", "Data Analysis", "Machine Learning"], true, "open_to_internships", true)
  candidate("cand-sara", "Sara Nasser", "", "A blank account for trying the full flow: start a challenge, submit, take the interview. (Demonstration account.)", "", "student", "", [], false, "not_available", true)

  fixtureRun(db, "cand-layla", "chl-demo-router", versions.get("chl-demo-router")!, "employers", [
    { key: "p1", outcome: "passed", ratings: [3, 2, 3], summary: "Demonstration data: a clear plan that orders the rules and handles conflicts.", code: "# Demonstration plan\n1. If tier == 'enterprise' -> priority\n2. Billing words -> billing\n3. Technical words -> technical\n4. Otherwise general\nConflicts: billing wins, reason mentions both." },
    { key: "p2", outcome: "passed", ratings: [3, 3, 2], summary: "Demonstration data: a readable router with data-driven keyword lists.", code: "BILLING = {'invoice', 'refund', 'payment'}\nTECH = {'error', 'crash', 'setup'}\n\ndef route_ticket(ticket):\n    tier = ticket.get('tier')\n    text = f\"{ticket.get('subject', '')} {ticket.get('body', '')}\".lower()\n    if tier == 'enterprise':\n        return {'queue': 'priority', 'reason': 'enterprise tier'}\n    if any(w in text for w in BILLING):\n        return {'queue': 'billing', 'reason': 'billing keyword'}\n    if any(w in text for w in TECH):\n        return {'queue': 'technical', 'reason': 'technical keyword'}\n    return {'queue': 'general', 'reason': 'no keyword matched'}" },
    { key: "p3", outcome: "passed", ratings: [2, 2, 3], summary: "Demonstration data: tests that assert specific queues, with a candid limitation.", code: "def test_enterprise_beats_billing_keywords():\n    assert route_ticket({'subject': 'refund', 'tier': 'enterprise'})['queue'] == 'priority'\n\ndef test_empty_subject_is_general():\n    assert route_ticket({'subject': '', 'tier': 'free'})['queue'] == 'general'" },
  ], true, 6)

  fixtureRun(db, "cand-omar", "chl-demo-anomaly", versions.get("chl-demo-anomaly")!, "employers", [
    { key: "p1", outcome: "passed", ratings: [2, 2, 2], summary: "Demonstration data: compares a fixed band with a z-score and argues for per-weekday comparison.", code: "-- average and standard deviation of daily sales\nSELECT AVG(total) AS mean, SQRT(AVG(total * total) - AVG(total) * AVG(total)) AS sd FROM sales;" },
    { key: "p2", outcome: "failed", ratings: [1, 2, 1], summary: "Demonstration data: flags the weekend peak and could not explain the threshold.", code: "def find_anomalies(totals):\n    mean = sum(totals) / len(totals)\n    return [i + 1 for i, t in enumerate(totals) if abs(t - mean) > 300]" },
  ], false, 3)
}
