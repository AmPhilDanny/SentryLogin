# prompt.md — SentryLogin Sprint Execution Guide

**Master guide for building the Suspicious Login Log Analysis Platform from start to finish.**
This document is the single source of truth for sprint execution. Read it before any work.

Companion docs: `PRD.md` (requirements), `architecture.md` (design), `plan.md` (phase roadmap).

---

## 1. Project Overview

SentryLogin is an AI/ML-assisted platform that ingests authentication logs (login attempts across
users, IPs, devices, locations) and identifies logins likely to be malicious — account takeover,
credential stuffing, password spraying, impossible-travel — versus normal user behavior.

**Three detection layers:** deterministic rules → unsupervised ML anomaly detection (Isolation
Forest) → LLM explanation. Surfaced through a security-analyst dashboard with risk scoring,
alerts, and per-user behavioral baselines.

**Portfolio project.** Must demo end-to-end (CSV upload → dashboard) in under 5 minutes. Metrics
that matter: recall ≥ 90% on injected attacks, precision ≥ 70%, dashboard < 2s for 10k rows,
every high-risk alert has a coherent explanation.

---

## 2. Current State (Phase 0 COMPLETE)

**IMPORTANT — Database strategy:** This dev machine has NO Docker, NO Postgres, and NO IPv6
(verified 2026-07-31). Development uses **SQLite** (`sqlite3` npm package, `DATABASE_TYPE=sqlite`
default, file at `db/sentry.sqlite`) so the pipeline is fully runnable locally. Production targets
**Supabase Postgres** (`DATABASE_TYPE=postgres` + `DATABASE_URL`; Supabase direct connections are
IPv6-only, use pooler on IPv4 networks; URL-encode password special chars like `@` → `%40`).
TypeORM config in `src/app.module.ts` must branch on `DATABASE_TYPE`. `synchronize: true` in dev
for both. Current Supabase project ref: `kaikuruvjtetdoafjtas` (credentials in
`.omo/run-continuation/Docs/Supabase etc configs.txt` — NOT committed).

| Component | State | Location |
|---|---|---|
| Monorepo root | ✅ package.json, tsconfig.base.json, .gitignore, .env.example | `./` |
| Backend (NestJS) | ✅ Scaffolded, builds clean. Modules: ingestion, logins, config | `./backend` |
| Frontend (React+Vite+Tailwind) | ✅ Scaffolded, prod build works. Pages: Dashboard, Upload, LoginDetail | `./frontend` |
| ML Service (FastAPI+sklearn) | ✅ Scaffolded, /train + /score + /health tested live | `./ml-service` |
| Data generator | ✅ `generate_logins.py` → 11,490 rows, 585 labeled attacks (5.1%) | `./data` |
| Docker | ✅ docker-compose.yml (postgres, backend, ml-service, frontend) | `./` |

**Already built (do not rebuild):**
- Backend: `src/main.ts` (ValidationPipe, `api` prefix, CORS), `src/app.module.ts` (TypeORM forRoot,
  synchronize in dev, autoLoadEntities), `src/ingestion/*` (POST /api/ingest/csv parses CSV,
  row-level validation, returns `{total, valid, errors, logins}`), `src/logins/*` (GET /api/logins
  with page/limit/risk/user/date/sort params returning empty scaffold; `login.entity.ts` exists),
  `src/config/*` (GET/PUT /api/config/rules, RuleConfig: failedLoginBurstThreshold=5,
  failedLoginBurstWindowMinutes=10, impossibleTravelSpeedKmh=800, oddHourStart=23, oddHourEnd=6,
  newDeviceScore=20, blacklistedIpScore=30).
- Frontend: pages with placeholder content, `src/lib/api.ts` (typed API client with uploadCsv/
  getLogins/getLogin/getConfig/updateConfig), `src/types/index.ts` (Login, RiskScore, RuleHit,
  UserProfile, AiExplanation, LoginDetail), Tailwind design system (risk colors, card/btn/badge
  component classes), Layout with nav.
- ML: `app/main.py`, `app/models.py` (Pydantic v2 FeatureVector/ScoreRequest/ScoreResponse/
  TrainRequest/TrainResponse), `app/routers/score.py` + `train.py` (in-memory registry),
  `app/ml/engine.py` (IsolationForest, n_estimators=100, random_state=42, contamination="auto").
- Data: `data/sample_logins.csv` — columns: username,timestamp,ip,country,city,device,browser,
  success,is_attack,attack_type (brute_force|impossible_travel|credential_stuffing|
  odd_hour_new_device). Generator: `python data/generate_logins.py`.

---

## 3. Engineering Standards (MANDATORY)

1. **TypeScript strict everywhere.** No `any`, no `@ts-ignore`, no `@ts-expect-error`. TypeORM
   entities use definite assignment (`!`).
2. **Validation first.** class-validator DTOs on all API inputs (already global ValidationPipe).
3. **Configurable, not hardcoded.** Rule thresholds and scoring weights come from ConfigService /
   env vars. Never inline magic numbers.
4. **Per-login rule hits stored individually** (FR3.2) — UI shows *which* rule fired, not just a score.
5. **Row-level CSV errors** reported without failing the whole upload (FR1.2).
6. **Deterministic ML** — random_state=42 everywhere. Reproducible demos.
7. **Python**: type hints, no global mutable state, imports at top.
8. **No PII** in demo data (synthetic only, per NFR).
9. **Keep services pure where possible**: feature engineering + rule engine as pure TS functions
   (no DB access) so they're unit-testable and reusable; persistence lives in the orchestration
   layer.
10. **Verify before done**: `npx nest build` (backend), `npx tsc -b && vite build` (frontend),
    `python -c "from app.main import app"` (ML). Every change must compile.
11. **Bugfix rule**: fix minimally, never refactor while fixing.

---

## 4. Sprint Plan (from plan.md phases, reorganized for parallel execution)

### Sprint 1 — Detection Pipeline (plan.md Phase 1)
**Goal: CSV in → stored logins + per-login features + rule hits + rule score, with rules-only evaluation.**

| # | Task | Owner | Acceptance |
|---|---|---|---|
| 1.1 | TypeORM schema: `users`, `user_features`, `rule_hits`, `risk_scores` entities + wiring | schema | Backend builds; entities registered via autoLoadEntities |
| 1.2 | Feature engineering service (pure TS): login_hour, day_of_week, failed_attempts_in_window, country_change, device_change, browser_change, ip_change, geo_distance_km, account_login_frequency, historical_success_rate — per-user history | features | Pure service, unit-testable, typed |
| 1.3 | Rule engine service (pure TS): failed-login burst, impossible travel, blacklisted IP, new device, odd hours — thresholds from ConfigService, returns individual rule hits + score | rules | Pure service; each rule recorded individually |
| 1.4 | Ingestion E2E: upload → validate → persist → features → rules → store → summary `{imported, errors, flagged}` | pipeline (wave 2) | Uploading sample CSV yields stored logins with features + rule_hits + score |
| 1.5 | Rules evaluation: Python script computing recall/precision of rules alone vs labeled attacks + writeup | eval | `docs/evaluation-rules.md` with recall/precision per attack type |

**Definition of done (sprint):** Full pipeline works; rules-only recall ≥ 90% on brute-force +
impossible-travel; evaluation writeup exists.

### Sprint 2 — ML + Risk Scoring (plan.md Phase 2)
**Goal: rules + ML combined, measured improvement.**

| # | Task | Acceptance |
|---|---|---|
| 2.1 | Backend → ML integration: pull feature vectors from DB, POST /train and /score | ML scores flow end-to-end |
| 2.2 | Risk scoring engine: rule_score + ml_score with configurable weights → 0–100 + Low/Medium/High/Critical label; weights from ConfigService (FR5.2) | Configurable, not hardcoded |
| 2.3 | Evaluation: rules-only vs rules+ML recall/precision on labeled set | `docs/evaluation-ml.md` showing improvement |
| 2.4 | ML service: persist trained model to disk, reload on boot (model_path env) | Restart-safe |

**Definition of done:** /api/ml/train trains on current dataset; combined risk score produced
end-to-end; writeup documents the delta.

### Sprint 3 — Dashboard (plan.md Phase 3)
**Goal: usable UI end-to-end.**

| # | Task | Acceptance |
|---|---|---|
| 3.1 | Query endpoints: GET /api/logins (filters risk/user/date, pagination, sort), GET /api/logins/:id (full detail: rules, scores, features, profile) | Real data, typed responses |
| 3.2 | Dashboard page: summary cards (total, flagged %, critical, top risky user), sortable/filterable table, risk distribution chart (Recharts) | Works against live API |
| 3.3 | Login detail view: raw data, rules triggered, score breakdown, features | Drill-down works |
| 3.4 | Upload page wired to real /api/ingest/csv with inline validation errors | Upload → dashboard flow |

**Definition of done:** Upload CSV through UI → browse/filter flagged logins with full breakdowns.
Dashboard loads < 2s for 10k rows.

### Sprint 4 — AI Explanations + Profiles + Alerts (plan.md Phases 4–5)
**Goal: v2 — feels like a real security product.**

| # | Task | Acceptance |
|---|---|---|
| 4.1 | User behavioral profiles: typical hours, country, device, avg logins/day; GET /api/users/:id/profile | Profiles computed + served |
| 4.2 | LLM explanation service: called only above risk threshold, cached in `ai_explanations`, prompt uses rule hits + ML score + profile deltas | Every High/Critical login has coherent explanation + recommended action |
| 4.3 | Alerts view: High/Critical only, dismiss/escalate workflow | Faster workflow than full table |
| 4.4 | Profile-vs-login comparison in detail view | Visible in UI |

**Definition of done:** Spot-check a dozen High/Critical explanations; alerts workflow works.

### Sprint 5 — Hardening & Production Readiness
**Goal: ship it.**

| # | Task | Acceptance |
|---|---|---|
| 5.1 | Unit tests: feature engineering + rule engine; e2e: ingestion flow | Tests pass |
| 5.2 | Docker full-stack verification: `docker compose up` → all 4 services healthy | One command runs everything |
| 5.3 | README (setup, demo script, architecture summary), finalize .env.example, optional GitHub Actions CI | Fresh clone → up → demo works |
| 5.4 | Final QA: fresh state → generate data → upload → analyze → dashboard → screenshots | 5-minute demo documented |

**Definition of done:** A stranger can clone, run, and demo in under 10 minutes.

---

## 5. Data Contracts (shared across sprints)

### Feature vector (per login, FR2.1)
```ts
interface LoginFeatures {
  login_hour: number;            // 0-23
  day_of_week: number;           // 0-6 (Mon=0)
  failed_attempts_in_window: number; // failed logins for this user in last N minutes (10 default)
  country_change: number;        // 0 | 1
  device_change: number;         // 0 | 1
  browser_change: number;        // 0 | 1
  ip_change: number;             // 0 | 1
  geo_distance_km: number;       // approx distance from user's previous login location
  account_login_frequency: number; // avg logins/day for this user (history)
  historical_success_rate: number; // 0-1
}
```

### Rule hit (FR3.2)
```ts
interface RuleHit {
  ruleName: string;   // e.g. 'failed_login_burst' | 'impossible_travel' | 'blacklisted_ip' | 'new_device' | 'odd_hour'
  triggered: boolean;
  details?: string;   // human-readable reason
  score: number;      // this rule's contribution
}
```

### Risk score (FR5)
```ts
// 0-100 final = weighted combination of rule_score + ml_score (+ threat_intel, default 0)
// label: Low (<40) | Medium (40-64) | High (65-84) | Critical (>=85)
```

### CSV schema (FR1.1, exact)
`username, timestamp, ip, country, city, device, browser, success` (plus optional
`is_attack, attack_type` for evaluation data).

---

## 6. API Contract (v1, from architecture.md §6)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/ingest/csv | Upload + process login CSV |
| GET | /api/logins | Paginated, filterable list with risk scores |
| GET | /api/logins/:id | Full detail (rules, scores, explanation) |
| POST | /api/ml/train | Trigger model retraining |
| GET | /api/config/rules | Current rule thresholds |
| PUT | /api/config/rules | Update rule thresholds |
| GET | /api/users/:id/profile | Behavioral baseline (v2) |

---

## 7. Team Protocol

- Read this file first. Work only on your assigned task. Do NOT touch files owned by other tasks.
- Report progress via team messages; mark tasks completed only when acceptance criteria are met
  AND code compiles.
- If blocked (missing file/contract), message the lead immediately — do not guess.
- Never modify: PRD.md, architecture.md, plan.md, prompt.md, .env.example (unless task says so).
- After finishing: verify with the build/typecheck command for your layer, then report.

## 8. Verification Commands

```bash
# Backend
cd backend && npx nest build
# Frontend
cd frontend && npx tsc -b && npm run build
# ML
cd ml-service && python -c "from app.main import app; print('ok')"
# Data
python data/generate_logins.py
# Full stack
docker compose up
```
