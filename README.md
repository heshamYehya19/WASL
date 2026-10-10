# Qudra | قدرة

**Where Ability Meets Opportunity.**

*قدرة* means "ability". Qudra is a working prototype of a platform where students and graduates show what they can actually
do on real, phased challenges, and companies find people through that evidence rather than through CVs and claims alone.

**The problem it addresses.** Early-career candidates often can't prove their ability, and companies can't tell who can do the
work. Qudra puts a concrete task in between: a company describes a real problem, a candidate solves it in phases, an AI-assisted
**Proof Engine** reviews each submission and then *interviews the candidate about their own work*, and a fixed rule — not the
model — decides whether each phase passed.

> Status: a prototype for demonstration and evaluation. It has no real user accounts (sign-in is a demo account switcher), it
> runs on a single SQLite database, and it has no users, customers or outcome data. Nothing in this README describes results
> it has achieved — only what the software does.


---

## What is implemented

### For companies

- **Create a challenge from a five-field brief** — problem description, required skills, difficulty, expected deliverables and
  a realistic time. The brief is screened for personal data before it is stored (contact details, ID and card numbers block it;
  names and addresses produce a warning).
- **AI-drafted, validated challenge** — the model drafts a multi-phase challenge (objectives, instructions, acceptance criteria,
  rubric, dependencies, estimated hours); the server validates the structure and asks again once if it doesn't pass. With no
  AI provider configured, a **clearly labelled offline template** is created instead and is never presented as AI output.
- **Review, edit, publish** — the company edits any part (each edit is a new version; the original draft is kept), marks it
  reviewed, and must confirm how submissions may be used before publishing. A published version never changes for candidates
  already working on it. Lifecycle: Draft → Generated → Reviewed → Published → In progress → Completed / Archived.
- **Review candidates' submitted solutions** (see [Company access to submitted solutions](#company-access-to-submitted-solutions)).
- **Talent Discovery** — search candidates who chose to be discoverable by *demonstrated* skills. Results are ranked by a stated,
  transparent rule (a skill demonstrated in a passed assessment counts more than a declared one), each match shows its evidence,
  and declared skills are never presented as proven. Companies can shortlist candidates, download a CV only if the candidate
  shared one, and express interest (up to 25 a day); the candidate is told who and why.
- Notifications (for example, when a candidate passes a phase of the company's challenge).

### For students and graduates

- **Company challenges** — browse published challenges, see what the company will be able to see, and start one.
- **Practice Lab** — choose skills and a difficulty (optionally a description and a language) and get a private, phased practice
  challenge assessed by the same engine. Practice work is private by default; the candidate may share its passed results with
  employers who find them (skills and ratings, never the code).
- **Submit each phase** by pasting code or linking a **public GitHub repository** (a bounded number of files is read), with an
  optional note. Every attempt is kept.
- **Take the understanding interview** for each submitted phase, and see the review, the interview and the assessment.
- **Improve** — skill gaps found in assessed work become a plan: curated resources (links checked at runtime), a short AI lesson
  and an exercise with feedback. These are learning aids and are *not* assessments.
- **Profile** — declared skills, education, links, an optional CV upload, discoverability, and per-challenge sharing
  (`private`, `challenge_owner`, or `employers`).

### Phases and progression

- Phases unlock **by submission, in order**. Phase 1 is open from the start; phase N opens once phase N−1 has a **valid recorded
  submission** — passing is **not** required, and a pending, failed or unavailable assessment does not lock (or relock) the next
  phase.
- A *valid recorded submission* is a saved row in `submissions` whose stage is `checked`, `reviewed`, `interviewing` or
  `assessed` (`VALID_SUBMISSION_STAGES` in `server/domain/phases.ts`). A saved attempt that the checks reject (empty,
  comment-only, a copy of the task, an unreadable repository — shown as *Revision needed*) is kept as history but unlocks nothing.
- The server enforces this on every candidate action — start, submit, interview answer and assessment retry
  (`server/services/pipeline.ts`) — so no endpoint or payload can skip a phase.
- Unlocking is not completion: a whole challenge can be submitted as complete only when **every** phase has **passed**.

### How the AI-assisted assessment works

1. **Validate** the submission (real content, not a copy of the task, a linked repository is readable) — otherwise *revision needed*.
2. **Deterministic checks** — static only: parse-only syntax checks for JavaScript and JSON, bracket balance, presence of tests, placeholders,
   credentials, truncation. Secrets are redacted before anything is stored or sent to a model. **Submitted code is never run.**
3. **AI review** — the model's answer must match a schema; every line it quotes is checked against the submission, and claims it
   can't anchor are dropped.
4. **Interview** — 3–6 open-ended questions, each tied to a finding, a criterion or a line of the candidate's code, with
   follow-ups for vague answers.
5. **Assessment** — correctness, code quality and demonstrated understanding are rated 0–3 *separately*, each with evidence the
   server verifies (a quote must exist in the code or the transcript). Ratings without verified evidence are lowered; caps come from
   deterministic facts. A fixed rule (`server/domain/decision.ts`), not the model, turns the ratings into *passed* or
   *not passed yet*. **No decision exists before the interview is complete.**
6. If the AI is unavailable, rate-limited, or its output can't be validated or verified, the phase becomes
   **assessment unavailable** — the work and answers are kept, the candidate can retry, and nothing is passed or failed.

**Limitations of the assessment.** It is AI-assisted, not autonomous or infallible: the model can misjudge work, and the
checks above bound its influence rather than guarantee correctness. Code is read, not executed, so behaviour is inferred. The
interview raises confidence that a candidate understands their work; it does **not** prove who wrote it. No accuracy, bias or
validity study has been done. Results should inform a human decision, not replace it.

### Company access to submitted solutions

A company can review the solutions candidates submitted to **its own** challenges:

1. **Challenges → (a challenge) → Candidates** lists the candidates who shared their work on it, each phase's state, attempts
   and ratings. Candidates who keep their work private are only counted, never named.
2. Opening a candidate shows every phase; **Open the evidence** shows each submitted attempt (one per button when there are
   several), read-only: the submitted code or repository files as stored (secrets redacted), the language, note and GitHub URL,
   the attempt number, date, stage and phase state, the deterministic checks, the AI review, the interview transcript and the
   assessment.
3. A link leads to the candidate's full evidence profile.

What is enforced on the server for every request (`server/services/participants.ts`, routes in `server/routes/company.ts`):

- the request must come from a company account (signed out → 401, student → 403);
- the company must own the challenge (`company_id` match), otherwise *not found*;
- the run must belong to **that** challenge and not be `private` — so a run from another challenge, a practice run or a
  withdrawn share is *not found*;
- the submission must belong to **that** run — a submission id from another candidate, phase run or challenge is *not found*;
- responses list named fields only; no prompts, keys, request hashes or internal metadata are returned;
- viewing is read-only and changes nothing (no status, outcome, evidence, progression or completion change; no AI call).

Only work the candidate actually submitted exists to be shown — there are no drafts; a submission row is created when the
candidate submits. Submissions are code (pasted or read from a public repository) plus a note; there are no other attachment
types. Covered by `server/test/company-solution-access.test.ts`, `server/test/access-control.test.ts` and an end-to-end step.

## Technology and architecture

| Part | What |
|---|---|
| Interface | React 19, React Router 7, Vite 6, Tailwind CSS 4 (light and dark themes) |
| Server | Node.js `node:http` API (`server/api.ts`), same origin as the interface |
| Database | SQLite through the built-in `node:sqlite` (schema v16, with a forward migration from the original WSL schema) |
| AI | Groq (first) and Gemini (backup) through one module, `server/ai/provider.ts`; every answer is schema-validated |
| Tests | Vitest (unit + HTTP integration against a throwaway database), Playwright end-to-end |

```
server/            API, database, domain rules, AI layer, services, tests
  domain/          phases, decision rule, challenge lifecycle, spec validation, skills — pure and unit-tested
  ai/              provider (Groq → Gemini, demo mock), schema combinators, prompts + validators for each AI step
  analysis/        static checks, secret redaction, grounding helpers
  services/        challenges, runs, pipeline, submissions, participants, learning, profile, discovery
  routes/          HTTP routes by audience (public, student, company, talent)
  testing/         the scripted fake AI used by tests, the mock server and demo mock mode
  legacy-schema.ts the preserved WSL migration chain (v2–v15), applied before the v16 conversion
src/               the interface
scripts/           mock AI server, end-to-end tests, repository-safety check
docs/              the original implementation plan and report (written under the earlier name, WASL)
```

## Getting started

Requires **Node.js 22.18 or newer** (it uses the built-in `node:sqlite`).

```bash
git clone https://github.com/heshamYehya19/WASL.git
cd WASL
npm ci
cp .env.example .env      # optional: add GROQ_API_KEY and/or GEMINI_API_KEY
npm run dev               # http://localhost:5173 — Vite serves the interface and the API
```

Production-style:

```bash
npm run build
npm start                 # http://localhost:3000 (PORT to change it)
```

Open `/login` and pick an account. The database (`data/wasl.db`, or `WASL_DB_PATH`) is created and seeded on first run;
`npm run db:reset` wipes and re-seeds it.

### Configuration

All settings are environment variables; see [.env.example](.env.example). None is required to start.

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY` | AI providers (Groq tried first, Gemini as backup) |
| `GROQ_MODEL`, `GEMINI_MODEL` | optional model overrides (defaults `openai/gpt-oss-120b`, `gemini-flash-latest`) |
| `WASL_AI_PROVIDER` | optional, `groq` or `gemini` — which is tried first |
| `WASL_AI_TIMEOUT_MS` | optional per-request timeout (default 45000) |
| `GITHUB_TOKEN` | optional; raises the GitHub API rate limit when reading public repositories |
| `PORT`, `WASL_DB_PATH` | server port (3000) and database location (`data/wasl.db`) |
| `WASL_DEMO_MODE` | `false` disables the account switcher, demo sign-up and the reset endpoint |
| `WASL_SEED_DEMO_DATA` | `false` starts with an empty database |
| `WASL_GROQ_BASE_URL`, `WASL_GEMINI_BASE_URL` | development/tests only: point a provider at a local mock |
| `WASL_AI_MOCK` | `true` = demo mock AI for local rehearsal (see below); off when unset |

### Without an AI key

Everything can be explored. Challenge generation falls back to the labelled template; review, interview and assessment report
*assessment unavailable* instead of guessing.

### Running the full flow without a real provider

```bash
node scripts/mock-ai-server.ts                      # http://127.0.0.1:4010
GROQ_API_KEY=mock WASL_GROQ_BASE_URL=http://127.0.0.1:4010/v1 npm start
```

The mock answers in the real response shapes, built from the actual submission text, so the real pipeline runs end to end — but
what it "decides" is scripted. It is a development and test tool, never for real assessment.

### Rehearsing a demo without spending AI quota

```powershell
$env:WASL_AI_MOCK = "true"; npm start     # PowerShell — bash: WASL_AI_MOCK=true npm start
```

Demo mock AI answers every AI step in-process with the same scripted answers — **no request reaches Groq, Gemini or any other
provider**, even if keys are set — and the answers still go through the real schema checks, grounding and pass rule. A banner
says the mode is on, and its reviews, assessments and challenges are labelled as demonstration data. It is off unless set to
exactly `true`, and the server refuses to start with it under `NODE_ENV=production` or `WASL_DEMO_MODE=false`. Its results are
always a pass, so a rehearsal shows the flow, not judgement; run `npm run db:reset` afterwards.

## Demo accounts and data

With `WASL_SEED_DEMO_DATA` on (the default), a fresh database contains two **fictional** companies — *Nahla Systems* and
*Orbit Analytics* — each with one hand-written sample challenge, and three fictional candidates: *Layla Haddad* and *Omar Saleh*,
who carry a few sample assessments so Talent Discovery isn't empty, and *Sara Nasser*, a blank account for trying the full flow.
The sample assessments are stored as `demo_fixture`, were **not** produced by the Proof Engine, and are labelled
"Demonstration data" wherever they appear. Pick any account at `/login`. No statistic in the product is invented: counts are
counts of records in the database.

## Security model

- **Sign-in is a demo account switcher** (the `X-WASL-Actor: role:id` header), **not authentication**: anyone can choose any
  account. Every route still derives ownership from the resolved account — never from ids in a request body — and answers
  *not found* for other people's resources. A real deployment needs real sessions or tokens and CSRF protection.
- Untrusted text (code, repository files, briefs, interview answers) is fenced as data in prompts and scanned for instructions
  aimed at the grader (flagged, never obeyed). Rubric "strong signals" are not shown to candidates.
- GitHub URLs are strictly parsed; only `api.github.com` and `raw.githubusercontent.com` are contacted. Learning links are checked
  only over https on the catalog's own hosts.
- Candidates control sharing per run and their discoverability. Employers in Talent Discovery see demonstrated skills and
  ratings from work shared with them — not code or transcripts. The **owner of a challenge** sees the submitted solutions,
  interviews and assessments for that challenge only, and only for candidates who shared with it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | development server (interface + API) |
| `npm run build` / `npm start` | production build / serve it |
| `npm test` | unit and HTTP integration tests (throwaway SQLite, mocked providers, no network) |
| `npm run typecheck` | `tsc -b` for the interface and the server |
| `npm run lint` | oxlint |
| `npm run build && npm run e2e` | Playwright end-to-end tests against a mock AI provider (`npx playwright install chromium` once) |
| `npm run verify:repo` | repository-safety checks: no secrets, databases or build output tracked; it also reports a configured git remote as a failure |
| `npm run mock-ai` | start the mock AI provider |
| `npm run db:reset` | wipe and re-seed the database |

## Limitations and what is not built

- **Not built:** real authentication and account recovery; email or messaging between companies and candidates beyond the
  "express interest" notice; company comments or feedback on a submission (review is read-only); file attachments in submissions
  (only code and public repositories); running or sandboxing submitted code; multi-instance deployment (one SQLite database).
- The assessment is AI-assisted and can be wrong; see [its limitations](#how-the-ai-assisted-assessment-works).
- GitHub reading covers public repositories only, and a bounded number of files.
- AI prompts and some internal identifiers still use the original name, WASL.
- Accessibility was checked structurally and for keyboard-reachable markup, not with assistive-technology user testing.
