# Iṣẹ́

**AI-assisted CV screening with a built-in bias audit, for Nigerian graduate hiring.**

Iṣẹ́ screens applications against job-specific, weighted criteria, explains every score in plain language, keeps candidate identity hidden by default, and audits the whole funnel for adverse impact — selection rates, the four-fifths rule, proxy features, counterfactual testing and override patterns.

AI is advisory only. Every stage change, rejection and identity reveal is a human action, requires a written reason where it departs from the recommendation, and is written to an immutable audit trail.

- **Stack:** React 18 + Vite + TypeScript + Tailwind (client), Express + TypeScript + Prisma (server), PostgreSQL, Redis/BullMQ (optional).
- **Hosting model:** one Node process serves `/api/*` and the built SPA.

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

## Quick start with Docker

Requires Docker with Compose v2.

```bash
cp .env.example .env
# Fill in JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and FIELD_ENCRYPTION_KEY.
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up --build -d
docker compose exec api npx prisma migrate deploy --schema prisma/schema.prisma
docker compose exec api npm run db:seed --workspace @ise/server
```

Open <http://localhost:4000>. The API applies migrations on boot; seeding is a one-off command because the seed creates demo organisations, jobs and applications.

The compose file runs three services:

| Service | Image | Purpose |
| --- | --- | --- |
| `db` | `postgres:16-alpine` | Primary datastore |
| `redis` | `redis:7-alpine` | BullMQ CV-processing queue (fallback: in-process) |
| `api` | built from `Dockerfile` | Express API + built SPA on port 4000 |

Volumes: `ise-db` (database), `ise-redis` (queue persistence), `ise-uploads` (CV files when `STORAGE_DRIVER=local`).

To promote a user to admin: `docker compose exec api npx prisma studio --schema prisma/schema.prisma`, or update the `role` column in SQL.

---

## Local development without Docker

Requires Node.js 20+ (22 recommended). A local PostgreSQL is needed; Redis is optional.

```bash
npm install
cp .env.example .env          # set DATABASE_URL, JWT secrets, FIELD_ENCRYPTION_KEY
```

### Option A — an existing PostgreSQL

```bash
# .env
DATABASE_URL=postgresql://ise:ise_password@localhost:5432/ise?schema=public
```

### Option B — bundled PostgreSQL (no Docker)

`npm run db:embedded` starts a real PostgreSQL 17 from the `embedded-postgres` binaries, on port **5433**, with user `ise`, password `ise_password` and database `ise`. Nothing else needs to be installed.

```bash
npm run db:embedded           # leave this terminal open
# in a second terminal
npm run db:migrate
npm run db:seed
npm run dev
```

Set `DATABASE_URL=postgresql://ise:ise_password@localhost:5433/ise?schema=public` to match.

**Why the temp directory?** Windows PostgreSQL binaries refuse to start when a path contains non-ASCII characters, and this repository is named `Iṣẹ́`. The launcher therefore mirrors the binaries and the data directory into `%TEMP%\ise-embedded-pg` and runs from there. Override the location with `EMBEDDED_PG_DIR`; change the port/database/credentials with `EMBEDDED_PG_PORT`, `EMBEDDED_PG_DB`, `EMBEDDED_PG_USER`, `EMBEDDED_PG_PASSWORD`.

### Running the two apps separately

```bash
npm run dev -w server                         # API on :4000
npm run dev -w client                         # Vite on :5173 (proxies /api → :4000)
```

If port 5173 is taken, run `npx vite --port 5174 --strictPort` from `client/` **and** add that origin to `CORS_ORIGINS`, otherwise the API rejects browser requests with `Origin not allowed`.

---

## Scripts

Run from the repository root.

| Script | Description |
| --- | --- |
| `npm run dev` | API + client together (concurrently) |
| `npm run build` | Compile the server and build the client |
| `npm start` | Run the compiled API (`server/dist/src/index.js`) |
| `npm run typecheck` | TypeScript check for both workspaces |
| `npm test` | Server test suite (unit + end-to-end) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Apply committed migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Load demo organisations, jobs, applications and users |
| `npm run db:embedded` | Start the bundled PostgreSQL on port 5433 |

`server/` also exposes `db:migrate:dev` and `db:push` for schema work.

---

## Seed accounts

All demo passwords are shown here because they are local fixtures; change them before any shared deployment.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@ise.test` | `Password123` |
| Recruiter (Federal Tech) | `recruiter@federaltech.test` | `Password123` |
| Recruiter (Lagos Fintech) | `hr@lagosfintech.test` | `Password123` |
| Candidate | `candidate@ise.test` | `CandidatePass123` |

The seed also creates ~150 candidate accounts, six jobs (one deliberately biased demo job guarded by `ALLOW_BIAS_DEMO`) and 200+ scored applications so the audit dashboards have meaningful samples. The seed is **not** idempotent for email uniqueness — run it against a fresh database.

---

## Configuration

Everything is read from the repository-root `.env` (`server/src/env.ts` validates it with Zod on boot). Start from `.env.example`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | yes | dev fallback | ≥16 chars; use 64 hex |
| `JWT_REFRESH_SECRET` | yes | dev fallback | different from the access secret |
| `FIELD_ENCRYPTION_KEY` | recommended | empty | 32-byte hex for AES-256-GCM demographics; rotating it makes old records unreadable |
| `PORT` | no | `4000` | Blank/`0` falls back to 4000 |
| `APP_URL` / `API_URL` | no | localhost | Used in emails and links |
| `CORS_ORIGINS` | no | localhost 5173/4000 | Comma-separated exact origins |
| `ACCESS_TOKEN_TTL` | no | `15m` | |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | |
| `BCRYPT_ROUNDS` | no | `12` | |
| `STORAGE_DRIVER` | no | `local` | `local` or `s3` |
| `LOCAL_STORAGE_DIR` | no | `./uploads` | Relative to `server/` |
| `S3_*` | S3 only | — | Bucket, region, endpoint, keys, path-style |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | no | OpenAI-compatible | Empty key → deterministic rubric scorer |
| `PROMPT_VERSION` | no | `2026-02-v1` | Stored on every score |
| `EMAIL_PROVIDER` | no | `console` | `console`, `smtp`, `resend` |
| `SMS_PROVIDER` | no | `console` | `console`, `termii` |
| `REDIS_URL` | no | empty | Empty → in-process queue |
| `GOOGLE_CALENDAR_*` | no | disabled | Optional calendar sync |
| `AUDIT_MIN_GROUP_SIZE` | no | `5` | Groups below this are suppressed |
| `AUDIT_ADVERSE_IMPACT_THRESHOLD` | no | `0.8` | Four-fifths rule |
| `AUDIT_COUNTERFACTUAL_THRESHOLD` | no | `5` | Points of score change that flag |
| `DATA_RETENTION_DAYS` | no | `365` | CV/file purge after closure |
| `ALLOW_BIAS_DEMO` | no | `true` | Enables the seeded biased job |

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
- The PDF audit report uses PDFKit's built-in Helvetica, which does not render Yoruba/Igbo diacritics such as `ṣ` in the report body. Use the web dashboard for full-fidelity text; embedding a Unicode TTF removes this limitation.
- S3 storage, SMTP/Resend email, Termii SMS and an external LLM are implemented but untested against live provider accounts in this repository.
