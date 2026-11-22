# Iṣẹ́

**AI-assisted CV screening with a built-in bias audit, for Nigerian graduate hiring.**

Iṣẹ́ screens applications against job-specific, weighted criteria, explains every score in plain language, keeps candidate identity hidden by default, and audits the whole funnel for adverse impact — selection rates, the four-fifths rule, proxy features, counterfactual testing and override patterns.

AI is advisory only. Every stage change, rejection and identity reveal is a human action, requires a written reason where it departs from the recommendation, and is written to an immutable audit trail.

- **Stack:** React 18 + Vite + TypeScript + Tailwind (SPA), Convex for the database, functions, file storage and scheduled jobs.
- **Hosting model:** the SPA is a static build (Vercel); all application logic runs in Convex.

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start with Docker](#quick-start-with-docker)
3. [Local development without Docker](#local-development-without-docker)
4. [Scripts](#scripts)
5. [Seed accounts](#seed-accounts)
6. [Configuration](#configuration)
7. [Scoring and AI](#scoring-and-ai)
8. [Bias audit methodology](#bias-audit-methodology)
9. [Privacy, NDPA and security](#privacy-ndpa-and-security)
10. [Accessibility](#accessibility)
11. [Testing](#testing)
12. [Project layout](#project-layout)
13. [Known limits](#known-limits)

---

## What it does

### Candidates
- Browse open roles, read the AI-notice and privacy notice before applying.
- Upload a CV (PDF/DOCX, ≤5 MB), review and correct the parsed data, add a cover letter, answer knockout questions.
- Track stage, score summary and interview details; manage notification preferences; download or delete their data (NDPA rights).

### Recruiters
- Job builder: weighted criteria totalling 100%, knockout questions, blind-screening and hide-university toggles, deadline and openings.
- Kanban pipeline with bulk decisions. Rejections and overrides require a written reason.
- Candidate comparison on anonymised references; identity reveal is logged.
- Interview scheduling from availability windows with double-booking prevention, ICS invitations and reminders.
- Job-level and organisation-level bias dashboards, counterfactual testing, PDF audit reports.

### Admins
- Platform overview, organisations, users and roles, audit log export (CSV), NDPA data requests, audit thresholds and retention settings.

---

## Running on Convex

There is no database to install and no API server to run: tables, functions, authentication and CV storage all live in [Convex](https://convex.dev).

```bash
npm install

# 1. Start the backend. The first run offers "Start without an account (run Convex locally)",
#    which provisions a local deployment on http://127.0.0.1:3210 and writes
#    CONVEX_DEPLOYMENT and VITE_CONVEX_URL to .env.local.
npx convex dev

# 2. Give the deployment the secrets it needs (in a second terminal).
node -e "console.log(require(crypto).randomBytes(32).toString(hex))"   # SEED_TOKEN
node -e "console.log(require(crypto).randomBytes(32).toString(hex))"   # APP_SECRET
npx convex env set SEED_TOKEN <value>
npx convex env set APP_SECRET <value>
npx convex env set FIELD_ENCRYPTION_KEY <optional, 64 hex chars; falls back to APP_SECRET>
npx convex env set APP_URL http://localhost:5174

# 3. Load the demo world (150 candidates, 6 jobs, 300 scored applications, bias reports).
CONVEX_URL=http://127.0.0.1:3210 SEED_TOKEN=<same value> npm run seed:convex

# 4. Run the SPA.
npm run dev:web
```

The SPA talks to Convex directly through `ConvexHttpClient`; it only needs `VITE_CONVEX_URL` (already in `.env.local` locally).

### Deploying

```bash
npx convex deploy            # pushes schema + functions to the production deployment
```

Then set `VITE_CONVEX_URL` (the production `https://<deployment>.convex.cloud` URL) in the Vercel project, and set the same `SEED_TOKEN`, `APP_SECRET`, `FIELD_ENCRYPTION_KEY` and `APP_URL` variables on the production deployment with `npx convex env set --prod`. `vercel.json` builds only the SPA (`client/dist`).

### A note on the repository path

The Convex CLI sends its working directory in a request header and fails with `Cannot convert argument to a ByteString` when the path contains non-ASCII characters — this repository is named `Iṣẹ́`. Run `npx convex dev` / `npx convex deploy` from a copy or junction of the project at an ASCII path (for example `C:devise`), then continue working in the real folder; generated types land in `convex/_generated` because the copy links back to it.

### What runs where

| Concern | Implementation |
| --- | --- |
| Data, sessions, audit log | `convex/schema.ts` (27 tables) |
| Auth | bearer session tokens hashed with SHA-256 in `convex/auth.ts`; bcrypt hashes in Node actions |
| CV parsing | `convex/extract.ts` (`pdf-parse` / `mammoth` in a Node action), scored by `shared/evaluate.ts` |
| Encrypted demographics | AES-256-GCM in `convex/secure.ts`, readable only from `"use node"` functions |
| CV files | Convex file storage (`convex/files.ts`) |
| Scheduled reminders | `convex/crons.ts` → `convex/reminders.ts` |
| Bias report PDF | generated in the browser with `pdf-lib` and DejaVu fonts (`client/src/lib/reportPdf.ts`) |

`server/` (Express + Prisma) is the previous backend. It is no longer built or deployed and is kept only for reference.

---

## Scripts

Run from the repository root.

| Script | Description |
| --- | --- |
| `npm run convex:dev` | Push functions and watch the Convex deployment |
| `npm run convex:deploy` | Deploy schema and functions to production |
| `npm run seed:convex` | Load the demo world (needs `CONVEX_URL` and `SEED_TOKEN`) |
| `npm run dev:web` | Vite dev server for the SPA |
| `npm run build:web` | Production build of the SPA (`client/dist`) |
| `npm run typecheck` | TypeScript check for the SPA and the Convex functions |
| `npm run typecheck:convex` | TypeScript check for `convex/` and `shared/` |

---

## Seed accounts

All demo passwords are shown here because they are local fixtures; change them before any shared deployment.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@ise.test` | `Password123` |
| Recruiter (Federal Tech) | `recruiter@federaltech.test` | `Password123` |
| Recruiter (Lagos Fintech) | `hr@lagosfintech.test` | `Password123` |

The seed also creates ~150 candidate accounts, six jobs (one deliberately biased demo job guarded by `ALLOW_BIAS_DEMO`) and 300 scored applications so the audit dashboards have meaningful samples. `npm run seed:convex` clears the demo tables first, so it can be re-run safely.

---

## Configuration

Deployment variables live in the Convex deployment, not in `.env` (that file only holds `VITE_CONVEX_URL` for the SPA and is written by `convex dev`). Set them with `npx convex env set NAME value` (add `--prod` for production).

| Variable | Required | Notes |
| --- | --- | --- |
| `SEED_TOKEN` | for demo data | Guard on every `convex/seed.ts` mutation; also required by `secure.seedDeclaration` |
| `APP_SECRET` | yes | HMAC key for anonymous candidate references |
| `FIELD_ENCRYPTION_KEY` | recommended | 64 hex chars for AES-256-GCM demographics; falls back to a hash of `APP_SECRET`. Rotating it makes old declarations unreadable |
| `APP_URL` | no | Defaults to `http://localhost:5174`; used in notification and interview links |
| `ALLOW_BIAS_DEMO` | no | `true` by default; set `false` to disable the seeded biased job |
| `VITE_CONVEX_URL` | client | Deployment URL; written to `.env.local` by `convex dev`, set manually in Vercel |

Audit thresholds (minimum group size, four-fifths threshold, counterfactual threshold, retention days) and the bias-demo switch are stored in the `settings` table and edited from the admin settings page; the environment variable above only sets the demo default.

### Graceful degradation

Nothing except `DATABASE_URL` and the JWT secrets is required. Missing providers fall back to safe local implementations:

| Missing | Behaviour |
| --- | --- |
| `LLM_API_KEY` | Deterministic rubric scorer; scores are tagged `rubric-v1` |
| `REDIS_URL` | In-process job queue |
| Email/SMS credentials | Messages are written to the server log, never sent |
| S3 credentials | Files stored under `server/uploads` |
| `FIELD_ENCRYPTION_KEY` | Development-derived key; set a real one in production |
| Google Calendar | ICS download only |

---

## Scoring and AI

1. **Extraction** — `pdf-parse`/`mammoth` pull text from the upload; the parser builds structured fields (skills, education, experience, projects, certifications, languages).
2. **Identity stripping** — `stripIdentityForScoring()` removes name, email, phone and location before any scoring code runs. Name, gender, age, state of origin and photographs are never inputs.
3. **Criteria** — each job has criteria whose weights must total 100. Types: `SKILL`, `DEGREE_LEVEL`, `DEGREE_CLASS`, `FIELD_OF_STUDY`, `EXPERIENCE`, `CERTIFICATION`, `LANGUAGE`. Each produces a 0–1 sub-score with a rationale and explicit `matched` / `missing` lists.
4. **Total** — `Σ(weight × sub-score) / Σ(weight) × 100`, rounded and clamped to 0–100.
5. **Explanation** — strongest criteria, gaps, any non-merit adjustments, and a reminder that AI only recommends.
6. **Recommendation** — ≥60 suggests `SHORTLISTED`, otherwise `SCREENED`. It is never a rejection and never applied automatically.
7. **Override** — a recruiter choosing a different stage must supply `overrideReason`, which is stored and appears in override analysis.

With an LLM key configured, the model may refine the explanation while the rubric sub-scores remain deterministic and auditable. Every score row records `model`, `promptVersion` and `rubricVersion`.

**Knockout questions** (NYSC, degree class, location, availability, work authorisation) *flag* an application. They never delete, auto-reject or hide it: the flag, the answer and the reason appear on the candidate card for a recruiter to judge.

**Blind screening** is on by default. Recruiters see an anonymous reference (`ISE-xxxx`) and a redacted CV: structured identity fields removed, free text scrubbed of names, emails, phones and links, identity lines (DOB, state of origin, marital status, religion, gender) dropped, and institution names hidden when the job requires it. Revealing identity is an explicit action, recorded with actor and timestamp.

---

## Bias audit methodology

Demographic data is voluntary and stored AES-256-GCM encrypted in its own table. It is decrypted only inside the audit service to build aggregate statistics — never joined into recruiter or scoring queries.

**Selection rate** per declared group per stage = selected ÷ applications in group.

**Four-fifths (80%) rule.** The group with the highest selection rate is the reference. Any other group below 80% of that rate is flagged, with severity:

| Ratio to reference | Severity |
| --- | --- |
| ≥ 0.80 | none |
| 0.67 – 0.80 | moderate |
| 0.50 – 0.67 | high |
| < 0.50 | severe |

**Statistical support.** A two-proportion z-test p-value accompanies each comparison so reviewers can separate a small-sample wobble from a real pattern.

**Suppression.** Groups smaller than `AUDIT_MIN_GROUP_SIZE` are reported as suppressed rather than published or silently dropped — the dashboard always shows that the group exists.

**Proxy detection.** For numeric features (CV length, years of experience, institution type, etc.) the engine computes the correlation with the AI score and the point-biserial correlation with each group. A feature correlating ≥0.3 with *both* is flagged as a possible proxy for identity.

**Counterfactual testing.** The same CV is re-scored with identity signals altered. If the total moves by ≥ `AUDIT_COUNTERFACTUAL_THRESHOLD` points, the scoring is sensitive to identity and is flagged.

**Override analysis.** Stage changes away from the AI recommendation are grouped by outcome and protected group, exposing overrides that consistently favour or penalise one group.

**Outputs.** Live dashboards per job and per organisation, a stored `BiasReport` (summary, findings, sample size, methodology), PDF export, CSV audit-log export, and in-app alerts when a flag appears. Reports state their sample size and methodology so readers can judge reliability.

The dashboard and reports are decision support. They do not replace human review, legal advice, or the judgement of the hiring panel.

---

## Privacy, NDPA and security

Aligned with the Nigeria Data Protection Act 2023:

- **Lawful basis and notice** — a consent record is written per purpose with a version; the AI notice and privacy notice are shown before applying.
- **Data minimisation** — demographics are optional, encrypted, and kept apart from operational tables; identity is hidden from screeners by default.
- **Retention** — a daily sweep purges CV files and parsed personal data for applications closed longer than `DATA_RETENTION_DAYS`; expired tokens are deleted. Audit logs survive because they carry no CV contents.
- **Data-subject rights** — candidates can export their data, request deletion, and review/correct their profile; admins process requests from the admin area.
- **Accountability** — append-only audit log of authentication, decisions, reveals, overrides, settings changes and data requests, exportable to CSV.

Security controls: bcrypt password hashing, short-lived JWT access tokens with rotating refresh tokens (hashed at rest, revocable), role-based access control on every route, Helmet (with a strict CSP in production), strict CORS allow-list, rate limiting on API/upload/audit routes, Zod validation of all input, size/type-limited uploads, consistent error envelopes that never leak stacks or CV text, and path-escape checks on local storage keys.

> **Legal review required.** This implementation provides technical controls and documentation to support NDPA compliance; it is not a legal opinion. Have counsel review the privacy notice, consent wording, retention period and audit report disclaimers before production use.

---

## Accessibility

- Mobile-first layouts; every table has a card fallback on small screens.
- Keyboard-operable navigation, visible focus rings, skip link, labelled form controls and error messages tied to inputs via `aria-describedby`.
- AA contrast for text and interactive states on the deep-green/gold palette; status is never conveyed by colour alone (icons and text labels accompany every badge).
- Semantic landmarks and a page title per route.

---

## Testing

```bash
npm test            # server: unit + end-to-end
npm run typecheck   # both workspaces
npm run build       # server compile + client production build
```

- `server/src/__tests__/unit.test.ts` — scoring and weight normalisation, bias-demo adjustment, blind redaction, selection rates and suppression, four-fifths severity, two-proportion p-values, proxy detection, slot generation, ICS output, knockout flagging.
- `server/src/__tests__/e2e.test.ts` — HTTP-level journeys against the real database and seeded data: health and public discovery, login for each role, RBAC denials, 401s, candidate profile/applications/notifications/demographics, recruiter dashboard/jobs/pipeline/compare, audit snapshots, admin dashboard/organisations/users/settings/logs/data requests.

The end-to-end suite needs a migrated, seeded database. Tests never send real email or SMS (the `console` providers log instead).

---

## Project layout

```
.
├── client/                     Vite + React SPA
│   └── src/
│       ├── pages/              landing, auth, privacy, candidate/*, recruiter/*, admin
│       ├── components/         layout, guards, UI primitives
│       └── lib/                API client, auth context, query client, helpers
├── server/
│   ├── prisma/                 schema, migrations, seed
│   ├── scripts/embedded-db.ts  Docker-free PostgreSQL launcher
│   └── src/
│       ├── domain/             pure logic: scoring, redaction, audit maths, ICS, types
│       ├── routes/             auth, public, candidate, applications, recruiter,
│       │                       interviews, audit, admin, notifications
│       ├── services/           CV parsing, LLM, audit, counterfactual, report,
│       │                       scheduler, queue, mailer, SMS, storage, knockouts
│       ├── middleware/         auth/RBAC, audit logging, rate limits
│       └── lib/                crypto, errors, logger, validation, async
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Known limits

- Single-tenant per organisation deployment; cross-organisation data is isolated by `organisationId` checks, not by separate databases.
- The in-process scheduler and queue are appropriate for a single API instance. For multiple replicas, set `REDIS_URL` so queued CV work is shared, and run only one reminder sweep.
- Google Calendar sync requires OAuth credentials and is optional; ICS files work without it.
- PDFs (bias audit reports and seeded demo CVs) render through the DejaVu Sans pair bundled at `server/assets/fonts`, so `ṣ`/`ẹ` and other diacritics are embedded rather than dropped. Override the font with `PDF_FONT_PATH`/`PDF_FONT_BOLD_PATH` if you need a different typeface.
- S3 storage, SMTP/Resend email, Termii SMS and an external LLM are implemented but untested against live provider accounts in this repository.
