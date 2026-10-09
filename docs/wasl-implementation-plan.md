# WASL | وصل — implementation plan

*Where Ability Meets Opportunity.*

This repository is an independent fork of the WSL application. WSL turned university-verified student work into
proof for companies. WASL removes the university from the loop and connects students and graduates with companies
directly, through real-world challenges, an AI **Proof Engine** that inspects the work and interviews the candidate,
personalized improvement, and evidence-based talent discovery.

This document is the plan that guided the transformation. The result and the verification are recorded in
`docs/wasl-implementation-report.md`.

## 1. Existing architecture (what the fork started from)

| Layer | What WSL had | Verdict for WASL |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind 4, React Router, a hand-built design system (`src/components/ui`), `AppShell` role layout, light/dark theme | **Reused** (design system, shell, theme, public pages' structure) |
| Backend | One Node 22+ process, `node:http`, no framework; `server/index.ts` serves `dist/` and mounts `/api`; same handler is mounted into Vite dev | **Reused** |
| Database | `node:sqlite`, `PRAGMA user_version` migrations inline in `server/db.ts`, seed + reset | **Reused** (migration pattern, seed/reset); schema replaced by a forward migration |
| Auth | Demo auth: `X-WASL-Actor: role:id` header, id checked against the DB, every write handler re-checks ownership | **Reused** (renamed header; limitation documented) |
| AI | `server/ml/llm-grader.ts`: Groq → Gemini fallback, `llmDeps.fetch` test seam, health probe, key redaction. Grading-specific schema | **Generalized** into a structured-JSON caller used by every AI module |
| Tests | Vitest integration tests against a real HTTP server + throw-away SQLite (`server/test/helpers.ts`) | **Reused** (harness); WSL-domain tests removed with the domain |
| Domain | Companies → challenges → university assignment → student projects/teams → evidence → AI signals → **university verification** → company discovery | **Replaced** |

Roles in WSL: `student`, `university`, `company`. WASL: `student` (students and graduates; stored in the `candidates` table) and `company`.

## 2. Product loop

Challenge → Submit Evidence → Demonstrate Understanding → Improve → Build a Stronger Skills Profile → Connect With Employers.

Three modules: **Company Challenges**, **Student Practice Lab**, **Talent Discovery**, all running on the
**Proof Engine** (review → adaptive interview → assessment → improvement).

## 3. What is removed

* The `university` role: pages, routes, API, nav, dashboards, Industry Insights, program assignment.
* University verification: signals, review readiness, confirmation, stale-verification logic, Verified Proof pages.
* Student projects/teams/evidence-type model, contribution statements, Google-Docs reading, the WSL offline scorer
  (`server/ml`), model-graded seed cache, the guided tour, the QR demo helper, the architecture-diagram script.
* WSL tests that only exercised the removed domain (listed in the report). Tests for retained infrastructure
  were kept or ported.

University-dependent columns are not rewritten in the old migration chain. Migrations v2–v15 are preserved
verbatim in `server/legacy-schema.ts`. A **forward migration (v16)** converts a legacy database: it creates the
WASL tables, carries over companies and student profiles, and drops the university tables. A fresh database is
created directly at the WASL schema.

## 4. Data model (schema v16)

Identity: `companies`, `candidates` (profile, availability, sharing flags), `candidate_cv_files`.

Challenges: `challenges` (the company brief + lifecycle), `challenge_versions` (generated/edited structured
challenge; **kind** `company` or `practice`), `phases` (ordered, with objectives, acceptance criteria, rubric and
`depends_on`), `practice_challenges` (student Practice Lab configuration).

Work: `runs` (a candidate's engagement with a version; `share_scope`), `run_phases` (persistent per-phase state),
`submissions` (attempts, never overwritten), `submission_artifacts`.

Proof Engine: `reviews`, `interview_sessions`, `interview_messages`, `assessments` (three separate dimensions),
`skill_evidence`, `ai_calls` (traceability without content). There is no separate cache table: a review is stored per submission with a key built from candidate, run, phase, version, content and prompt version, and is only ever looked up by its own submission — so it can never be reused across candidates, phases, versions or attempts.

Improvement: `skill_gaps`, `recommendations`, `lessons`, `exercises`, `exercise_responses`.

Hiring: `company_actions` (saved / interested), `notifications`.

Constraints: foreign keys on, `CHECK` constraints on every enum, unique `(run, phase, attempt)`, one assessment per
submission, one interview per submission, indexes on every foreign key used in a lookup.

## 5. Phase state model and rules (one place: `server/domain/phases.ts`)

States: `not_started`, `in_progress`, `submitted`, `under_review`, `interview_in_progress`, `passed`, `failed`,
`revision_needed`, `assessment_unavailable`.

* **Availability.** A phase opens when every phase it `depends_on` has a *concluded* assessment — `passed` **or**
  `failed`. A failed phase therefore never blocks later eligible phases.
* **Completion.** The complete solution can be submitted only when **every** required phase is `passed`. Enforced in
  the domain layer and re-checked by the API; a client cannot bypass it.
* **History.** Each attempt is its own `submission` row. A resubmission never overwrites an earlier attempt, its
  review, interview or assessment.
* **No decision before the interview.** `assessments` rows are only written by the assessment step, which runs
  after the interview session is `completed`. An AI failure leaves the phase `assessment_unavailable` (recoverable),
  never `passed`.
* **Decision.** The model rates three dimensions 0–3 with cited evidence; the server validates every citation and
  applies a fixed rule (`server/domain/decision.ts`). The model does not decide pass/fail.

## 6. Proof Engine

1. **Validate** the submission (size, language, URL, repository readability) → otherwise `revision_needed`.
2. **Deterministic checks** (static, never executed): syntax parse where a safe parser exists, delimiter balance,
   empty/placeholder detection, secret detection (and redaction before anything reaches a model), rubric signal
   tokens. The UI says plainly that code is not executed.
3. **AI review** → schema-validated findings; every quoted evidence line is verified to exist in the submission.
4. **Adaptive interview**: open-ended, grounded questions tied to a finding or rubric criterion; follow-ups when an
   answer is vague; no multiple choice; repeats rejected; persisted per submission; resumable.
5. **Assessment**: correctness, code quality, demonstrated understanding — separate ratings with evidence.
6. **Improvement**: skill gaps tied to evidence, catalog-based resources (links verified at runtime, never
   invented), AI mini-lesson and exercise (marked as *not* an assessment).

Untrusted input (code, READMEs, briefs, interview answers) is always passed as delimited data; hidden rubrics and
system prompts are never sent back to the student.

## 7. Security decisions

* No code execution. (No sandbox exists in this architecture; adding one safely was not feasible, so correctness
  evidence is static analysis + AI review, labelled as such.)
* Server-side authorization on every route; ownership derived from the resolved actor, never from request bodies.
* Practice work is private by default; company-challenge work is visible to the owning company only; employers
  discover only what the candidate shares (`share_scope`, `discoverable`).
* GitHub URLs are parsed to `owner/repo` and fetched only through GitHub's API/raw hosts; link verification is
  restricted to https and a host allow-list.
* Secrets: `.env` never committed; keys never logged; `ai_calls` stores metadata only.
* Demo auth remains (any visitor can claim an account by header). It is documented as **not** production
  authentication; every authorization rule is still enforced against the resolved actor.

## 8. AI honesty

* Challenge generation without a provider uses a **labelled** deterministic scaffold (`origin = offline-template`)
  that the company must review; it is never presented as AI output.
* Review, interview and assessment **require** a provider. Without one the phase is `assessment_unavailable`
  with an honest message. There is no scripted pass/fail.
* Seed data contains clearly labelled demonstration fixtures (`is_demo_fixture`) so Talent Discovery is not empty
  on first launch; the UI marks them and tests do not depend on them.

## 9. Implementation order

1. Safe copy, baseline, this plan.
2. Schema + forward migration + canonical skills + seed skeleton.
3. AI provider layer (structured JSON, fallback, retries, traceability) + validators + grounding.
4. Challenge generation + company lifecycle API.
5. Practice Lab + runs + phase domain rules.
6. Submissions, static checks, review, interview, assessment pipeline.
7. Learning (gaps, resources, lessons, exercises).
8. Candidate profile + evidence profile + Talent Discovery + employer interest.
9. UI for the three journeys; branding; remove university UI.
10. Tests at every step; end-to-end tests with a mock provider; README, `.env.example`, report.
