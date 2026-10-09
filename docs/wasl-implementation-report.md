# WASL | وصل — implementation report

*Where Ability Meets Opportunity.* This report records what was built, how it was verified (exact commands and results), and what is **not** done or not verified.

## 1. Repository safety

- **Location of the new repository:** `C:\Users\hesha\WASL` — its own `git init`, branch `main`, **no commits and no remote**. Nothing was committed or pushed; nothing will be without your say-so.
- **The original WSL repository was not touched.** `C:\Users\hesha\WSL` is still at `199b492`, with only its pre-existing uncommitted change (`server/ml/seed-grades.json`). `node scripts/verify-repo-safety.mjs --original ../WSL --expect-head 199b492` confirms this (10 of 10 checks pass).
- **What was not copied:** `node_modules`, `dist/`, caches, any `.env`, databases (`data/`, `*.db`), keys/certificates, build output, local assistant settings. `.gitignore` covers them; `.env.example` has no values; the safety script scans every non-ignored file for key patterns.
- The copy carried over the original's uncommitted work as it was; the WSL-only parts were then removed (§3).

## 2. What WASL is now

Two roles — **student/graduate** and **company** — and no university role, verification, assignment or insight anywhere (UI, API, schema, docs). The three modules and the Proof Engine are described in [README.md](../README.md); the design is in [wasl-implementation-plan.md](wasl-implementation-plan.md).

| Requirement | Where |
|---|---|
| Company brief of exactly five fields; validated; personal data in a brief is refused | `server/services/challenges.ts` (`parseBrief`), `src/pages/company/NewChallenge.tsx` |
| AI generation of a validated multi-phase challenge (objectives, acceptance criteria, rubrics, dependencies, workload scaled to the stated time) | `server/ai/challenge-generator.ts`, `server/domain/spec.ts` |
| Lifecycle Draft → Generated → Reviewed → Published → In progress → Completed/Archived; company review/edit (each edit a new version); explicit evaluation-use acknowledgement, no implied ownership | `server/domain/lifecycle.ts`, `services/challenges.ts`, `ManageChallenge.tsx`, `SpecEditor.tsx` |
| Practice Lab (skills, difficulty, optional description/language; private; code and/or GitHub) | `services/practice.ts`, `PracticeLab.tsx` |
| Proof Engine: validate → deterministic checks → AI review → adaptive interview → three-way assessment → decision | `services/pipeline.ts`, `server/ai/{reviewer,interviewer,assessor}.ts`, `server/analysis/*`, `server/domain/decision.ts` |
| Phase states, availability, completion rule, attempts preserved | `server/domain/phases.ts`, `services/runs.ts` |
| Personalised improvement (gaps, verified catalog links, AI lessons/exercises, labelled non-assessment) | `services/learning.ts`, `server/learning/catalog.ts`, `server/ai/learning.ts`, `Improve.tsx`, `GapPage.tsx` |
| Candidate profile (information + evidence profile: declared vs demonstrated), CV, sharing controls | `services/profile.ts`, `Profile.tsx` |
| Talent Discovery (explainable, evidence-based, authorised evidence only) and express-interest | `services/discovery.ts`, `TalentSearch.tsx`, `TalentProfile.tsx` |
| Forward migration, legacy chain preserved | `server/db.ts` (v16), `server/legacy-schema.ts` |

## 3. What was removed

The `university` role and everything hanging off it; university verification, review readiness and stale-verification logic; programs/assignments; WSL's student projects/teams/evidence-type model; the offline scorer and ML model files (`server/ml`, `scripts/ml`, `scripts/grade-seed.ts`); Google-Docs reading; the guided tour; the QR helper; the architecture-diagram script and its assets; the WSL frontend pages; and the ~30 WSL-domain test files (they exercised only the removed domain). Infrastructure tests were rewritten for WASL rather than weakened (provider fallback, migrations, access boundaries, reset, input validation).

**Migration.** The applied WSL migrations v2–v15 are preserved *verbatim* in `server/legacy-schema.ts` and never edited. A new database is created directly at the WASL schema. An existing WSL database is brought to v15 by the preserved chain, backed up to `<db>.pre-wasl.bak`, then converted by forward migration **v16**, which keeps companies and student profiles (mapped to `candidates`; nobody is discoverable until they opt in) and drops everything university-shaped. No "verified" mark is carried forward — nothing in WASL could re-derive it.

## 4. Honest-AI behaviour (the parts that matter most)

- No decision before the interview completes: assessments are written only by the assessment step, after the session is `completed` (tested, including mid-interview checks that no assessment row exists).
- The model never says pass/fail. It rates three dimensions 0–3 and cites evidence; the server verifies every citation (code quotes, answer quotes/numbers, check ids, finding ids), drops what it can't verify, clamps unsupported ratings (a 2 needs one verified item, a 3 needs two), applies caps from deterministic facts (unparseable code → correctness ≤ 1; one-word interview answers → understanding ≤ 1 or 0), and `decide()` applies a fixed rule. Insufficient verified evidence ⇒ no decision.
- AI failure at any step (outage, rate limit, timeout, malformed JSON, schema mismatch, unverifiable evidence) ⇒ **assessment unavailable**: work and answers kept, nothing passed or failed, retry resumes from what exists. Never a pass; never a fail.
- With no provider: generation uses a **labelled template** (never shown as AI output); review/interview/assessment say they're unavailable. If a provider is configured but failing, the template is **not** swapped in silently — the user chooses it.
- Prompt-injection: user text is fenced as data, flagged when it tries to instruct the grader (shown to the company, never obeyed), hidden rubric notes never returned to candidates. Secrets are redacted before storage and before any prompt.
- Submitted code is **never executed** (JS is parse-only via `vm.Script` compile; nothing is run). The UI says so.
- Learning links come from a hand-written catalog and are verified at request time (https, catalog hosts only); dead links are dropped, unverifiable ones are shown as unchecked, and a gap with no match gets a *labelled search link*, never an invented course.
- No fake metrics: every number is a count of real records. Seed fixtures are labelled **Demonstration data** and flagged `demo_fixture` in the database.

## 5. Verification (commands run in `C:\Users\hesha\WASL`, results as observed)

| Command | Result |
|---|---|
| `npx tsc -b` (app + server projects) | no errors |
| `npx vitest run` | **13 test files, 223 tests, all passing** |
| `npx oxlint` | 0 errors, **4 warnings** (2 × `only-export-components` on the provider+hook files `theme.tsx`/`session.tsx`; 2 × `set-state-in-effect` on the data-fetching effects in `session.tsx`/`useApi.ts` — the same count as the WSL baseline's 4, different locations) |
| `npm run build` | succeeds |
| `npm run build && node scripts/e2e.ts` | **41 of 41 end-to-end steps passed** (Chromium via Playwright, built server, mock AI provider) |
| `node scripts/verify-repo-safety.mjs` | all checks pass |

**What the tests cover:** phase availability/completion/state-machine rules and the decision rule (pure unit tests); the full HTTP pipeline against a scripted provider (happy path, weak work, resubmission, ordering, completion enforcement, attempts preserved); every failure mode (no provider, outage at review / interview / assessment, unverifiable evidence, garbage JSON, transient errors with retry, stalled work, double submit, provider fallback, key never logged); grounding (fabricated quotes dropped, criteria downgraded); submission validation (size, binary, language, GitHub URL SSRF cases, unreadable/private repos, rate limits); no code execution; secret redaction; prompt-injection handling; company challenge lifecycle and validation; Practice Lab inputs/privacy/deletion; access control and isolation (cross-candidate, cross-company, role boundaries, ids in bodies, sharing scopes, review "cache" never shared across candidates); learning (catalog, link verification, SSRF-style URLs, non-assessment guarantee); profile, CV, discovery, ranking explanation, authorised-evidence-only, interest workflow and caps; migrations (fresh, seeded, constraints, WSL upgrade with backup, idempotence); the repo-safety script.
**End-to-end** additionally covers: public pages and 404, company brief → generate → edit → review → publish, student start (acknowledgement) → submit → interview → three rated dimensions → pass → complete, AI-outage recovery, "not passed yet" wording, the improvement page, sharing and discovery, expressing interest, cross-account access, no horizontal scrolling at 390 px on nine pages, the phone menu, structural accessibility checks (one `h1`, `main`, labelled controls, link/button names), dark mode, and zero console errors.

## 6. What was **not** verified, and known limitations

- **No real AI provider was called.** No key was available; every AI path was exercised through a scripted provider that answers in real response shapes and runs the real validation. Prompt quality and real-model behaviour (including Groq/Gemini free-tier token limits on long submissions) are untested. Prompt versions are recorded per call so this can be iterated.
- **No live network:** GitHub reading and learning-link verification were tested against mocked hosts, not the real sites.
- Migration from a real production WSL database was not possible; it was tested with a synthetic legacy database built using the preserved chain. Upgrades from WSL versions older than v15 depend on the preserved chain (idempotence is tested; older fixtures are not).
- **Demo sign-in is not authentication** (documented in README, API and UI). There is no rate limiting beyond the daily express-interest cap, so an exposed demo could be used to spend AI quota; production needs real accounts and limits.
- Processing runs inside the request (a submission or answer can take up to a minute with a slow provider); recovery is by retry, not a background queue.
- A published challenge is immutable; there is no "duplicate as new draft" yet.
- GitHub reading is bounded (≈8 source files, 20 k–36 k characters) and public-only; very large repositories are sampled, and the UI marks truncation.
- Accessibility was checked structurally and by automated DOM checks, not with screen-reader user testing or a contrast audit.
- The code editor is a plain text area.
- No component-level unit tests for the React code; the interface is covered by the end-to-end run.

## 7. Suggested next steps

Add a provider key and run `npm run e2e` against it with `WASL_GROQ_BASE_URL` unset to review real prompts; add real authentication and quotas; a background job queue for the pipeline; "duplicate challenge"; an accessibility audit; then decide on committing (nothing has been committed).
