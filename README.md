# WASL | وصل

**Where Ability Meets Opportunity.**

WASL connects students and graduates directly with companies — no university in between. Companies publish real challenges; candidates take them (or practise on their own); an AI **Proof Engine** reviews each submission and *interviews the candidate about their own work* before deciding anything; employers search by evidence, not claims.

> This repository is an independent fork of the WSL project. It has its own git history and no remote. See [docs/wasl-implementation-report.md](docs/wasl-implementation-report.md) for exactly what changed and what was verified, and [docs/wasl-implementation-plan.md](docs/wasl-implementation-plan.md) for the design.

## The three modules

| Module | For | What it does |
|---|---|---|
| **Company Challenges** | Companies | Five-field brief → AI-generated, validated, multi-phase challenge (objectives, acceptance criteria, rubrics, dependencies, workload) → company reviews/edits → publishes. Lifecycle: Draft → Generated → Reviewed → Published → In progress → Completed / Archived. |
| **Student Practice Lab** | Students & graduates | Skills + difficulty (+ optional description and language) → a private, phased practice challenge assessed by the same engine. |
| **Talent Discovery** | Companies | Search by *demonstrated* skills. Every match explains itself; declared skills are never presented as proven. Express interest; the candidate sees who and why. |

### The Proof Engine

1. **Validate** the submission (real content, not a copy of the task, a linked repository is readable) — otherwise *revision needed*.
2. **Deterministic checks** — parse-only syntax checks (JS/JSON), bracket balance, tests/placeholders/credentials; secrets are redacted before anything is stored or sent to a model. **Submitted code is never executed.**
3. **AI review** — schema-validated; every quoted line is verified against the submission.
4. **Adaptive interview** — 3–6 open-ended questions, each grounded in a finding, criterion or line of the candidate's code; follow-ups for vague answers; no multiple choice, no repeats.
5. **Assessment** — correctness, code quality and demonstrated understanding rated 0–3 *separately*, each with server-verified evidence. A fixed rule (`server/domain/decision.ts`), not the model, turns ratings into *passed* / *not passed yet*. **No decision exists before the interview is complete.**
6. **Improvement** — skill gaps tied to evidence, curated resources whose links are verified at runtime, AI mini-lessons and exercises (clearly *not* assessments).

If the AI is unavailable or its output can't be validated, the phase becomes **assessment unavailable** — recoverable, never a pass or a fail.

### Phases

Phases unlock by **submission**, in order. Phase 1 is open from the start; phase N opens once phase N−1 has a **valid recorded submission** — passing is **not** required. A pending, failed or unavailable assessment of phase N−1 does not lock (or relock) phase N.

A *valid recorded submission* is a saved row in `submissions` whose stage is `checked`, `reviewed`, `interviewing` or `assessed` (`VALID_SUBMISSION_STAGES` in `server/domain/phases.ts`): it was stored and passed the deterministic checks. An attempt refused before saving (bad input, a locked or busy phase) leaves no row, and a saved attempt the checks reject (empty, comment-only, a copy of the task, an unreadable repository — shown as "Revision needed") is kept as history but does not unlock anything. Submissions are never removed, so an opened phase stays open.

The server enforces this on every candidate action — start, submit, interview answer and assessment retry (`server/services/pipeline.ts`) — so no endpoint or payload can skip a phase. Every earlier phase must have a valid submission, so a run recorded under an older rule (a later phase with work while an earlier one has none) is frozen, not reset: its work and results are kept and it continues once the earlier phase is submitted. A phase's "builds on" (`dependsOn`) describes the work; it does not decide when the phase opens.

Unlocking is not completion: the whole solution can be submitted as complete only when **every** phase has **passed**. Every attempt is kept.

> History: originally a phase opened when its `dependsOn` phases had a decision (passed or failed); briefly (commit `74b4cd1`) every earlier phase had to pass. Both are superseded by submission-based unlocking.

## Quick start

Requires **Node.js 22.18+** (24 recommended; uses the built-in `node:sqlite`).

```bash
npm ci
cp .env.example .env      # optional: add GROQ_API_KEY and/or GEMINI_API_KEY
npm run dev               # http://localhost:5173 (API served by the same process)
```

Production-style:

```bash
npm run build
npm start                 # http://localhost:3000
```

Open `/login` and pick an account. The database (`data/wasl.db`) is created and seeded on first run; `npm run db:reset` re-seeds it.

### Without an AI key

Everything is explorable. Challenge generation falls back to a **clearly labelled template** (never presented as AI output); review, interview and assessment report *assessment unavailable* instead of guessing.

### Trying the full flow without a real provider

```bash
node scripts/mock-ai-server.ts                      # http://127.0.0.1:4010
GROQ_API_KEY=mock WASL_GROQ_BASE_URL=http://127.0.0.1:4010/v1 npm start
```

The mock answers in the real response shapes from the actual submission text so the real pipeline runs end to end, but what it "decides" is scripted. It is a development/test tool, never to be used for real assessment.

## Configuration

See [.env.example](.env.example). AI: `GROQ_API_KEY` (first), `GEMINI_API_KEY` (backup), optional model/provider overrides and timeout. `GITHUB_TOKEN` raises the GitHub rate limit. `WASL_DEMO_MODE=false` disables the account switcher, demo sign-up and reset. `WASL_SEED_DEMO_DATA=false` starts empty.

## Demonstration data

A fresh database contains two fictional companies with one hand-written sample challenge each, and three candidates; two carry a few **assessments marked `demo_fixture`** so Talent Discovery isn't empty on first launch. They are labelled **“Demonstration data”** wherever they appear, were *not* produced by the Proof Engine, and are never mixed with real results. No statistic in the product is invented: counts are counts of real records.

## Security model (read this)

- **Sign-in is a demo account switcher** (`X-WASL-Actor: role:id`), *not authentication*: anyone can claim any account. Every route still derives ownership from the resolved account, never from request bodies, and returns *not found* for other people's resources. A real deployment needs real sessions/tokens and CSRF protection.
- Untrusted text (code, READMEs, briefs, interview answers) is fenced as data in prompts, scanned for instruction-like content (flagged, never obeyed), and hidden rubric notes are never returned to candidates.
- GitHub URLs are strictly parsed; only `api.github.com` and `raw.githubusercontent.com` are contacted. Learning links are verified only over https on the catalog's own hosts.
- Candidates control sharing per run (`private` / `challenge_owner` / `employers`) and discoverability. Employers see only demonstrated skills and ratings from work shared with them — not code or transcripts (except the owner of a challenge, for that challenge).

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | develop / build / serve |
| `npm test` | unit + HTTP integration tests (throw-away SQLite, mocked providers) |
| `npm run typecheck` | `tsc -b` for the app and server |
| `npm run lint` | oxlint |
| `npm run build && npm run e2e` | Playwright end-to-end tests with a mock AI provider (needs `npx playwright install chromium` once) |
| `npm run verify:repo` | repository-safety checks (own repo, no remote, no secrets/databases/build output tracked) |
| `npm run db:reset` | wipe and re-seed the database |

## Layout

```
server/            node:http API, node:sqlite (schema v16, forward migration from WSL), domain rules, AI layer, services, tests
  domain/          phases, decision rule, challenge lifecycle, spec validation, skills — pure and unit-tested
  ai/              provider (Groq → Gemini), schema combinators, prompts + validators for each AI step
  analysis/        static checks, secret redaction, grounding helpers
  services/        challenges, runs, pipeline, submissions, learning, profile, discovery
  routes/          HTTP routes by audience
  legacy-schema.ts the preserved WSL migration chain (v2–v15), applied before the v16 conversion
src/               React 19 + Vite + Tailwind 4 interface
scripts/           mock AI server, end-to-end tests, repository-safety check
docs/              plan and implementation report
```

## Limitations

Stated plainly: code is analysed statically, not run; an interview raises confidence in understanding but cannot prove authorship; AI output can be wrong (so ratings are bounded by verified evidence and caps from deterministic facts); the demo sign-in is not secure; SQLite on one instance; GitHub reading covers public repositories only and a bounded number of files; accessibility was checked structurally and by keyboard-reachable markup, not with assistive-technology user testing.
