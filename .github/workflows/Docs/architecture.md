# Architecture — Suspicious Login Log Analysis Platform
https://github.com/AmPhilDanny/SentryLogin.git

**Status:** Draft v1.0
**Companion docs:** PRD.md, plan.md

---

## 1. System Architecture (High-Level)

```
┌──────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                  │
│                                                                        │
│   ┌──────────────┐   ┌──────────────┐   ┌───────────────────────┐    │
│   │  Upload CSV  │   │  Dashboard    │   │  Login Detail View    │    │
│   │  Screen      │   │  (Table/Grid) │   │  (Explanation, Score) │    │
│   └──────┬───────┘   └───────┬───────┘   └───────────┬───────────┘    │
│          │                   │                       │                │
└──────────┼───────────────────┼───────────────────────┼────────────────┘
           │                   │                       │
           ▼                   ▼                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         BACKEND API (NestJS)                         │
│                                                                        │
│   ┌────────────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│   │ Ingestion       │  │ Query/Reporting│  │ Config/Admin           │  │
│   │ Controller      │  │ Controller     │  │ Controller             │  │
│   └───────┬─────────┘  └───────┬────────┘  └───────────┬────────────┘  │
│           │                    │                        │             │
└───────────┼────────────────────┼────────────────────────┼─────────────┘
            │                    │                        │
            ▼                    │                        ▼
┌────────────────────────┐       │            ┌───────────────────────┐
│   VALIDATION LAYER     │       │            │   POSTGRES DATABASE   │
│  (schema check, CSV    │       │            │  users, logins,        │
│   row-level errors)    │       │            │  rule_hits, scores,     │
└───────────┬────────────┘       │            │  ai_explanations        │
            │                    │            └───────────┬───────────┘
            ▼                    │                        ▲
┌────────────────────────┐       │                        │
│  FEATURE ENGINEERING    │       │                        │
│  (per-user, per-login   │───────┴────────────────────────┘
│   derived features)     │
└───────────┬────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                     DETECTION LAYER                        │
│                                                              │
│  ┌────────────────┐   ┌────────────────┐   ┌─────────────┐ │
│  │  Rule Engine     │   │  ML Service     │   │  Threat     │ │
│  │  (in NestJS or   │   │  (FastAPI +     │   │  Intel      │ │
│  │   shared lib)    │   │  scikit-learn)  │   │  (v3)       │ │
│  └────────┬────────┘   └────────┬────────┘   └──────┬──────┘ │
│           └──────────────┬──────┴────────────────────┘        │
│                           ▼                                    │
│                 ┌───────────────────┐                          │
│                 │  Risk Scoring      │                         │
│                 │  Engine            │                         │
│                 └─────────┬─────────┘                          │
└───────────────────────────┼─────────────────────────────────────┘
                             ▼
                 ┌───────────────────────┐
                 │  AI Explanation Layer  │
                 │  (LLM API — only for   │
                 │   above-threshold rows)│
                 └───────────┬───────────┘
                             ▼
                 ┌───────────────────────┐
                 │   Stored + returned    │
                 │   to Dashboard/API      │
                 └───────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Frontend (React + TypeScript + Tailwind)
- **Upload screen** — drag/drop CSV, shows validation errors inline
- **Dashboard** — sortable/filterable table, summary cards, risk distribution chart (Recharts)
- **Detail view** — single login: raw fields, rule hits, anomaly score breakdown, AI explanation, user behavioral profile comparison
- **Alerts view (v2)** — only High/Critical risk items, with dismiss/escalate actions

### 2.2 Backend API (NestJS)
- **Ingestion controller** — receives CSV, hands off to validation + feature engineering
- **Query/reporting controller** — serves dashboard data, filters, pagination
- **Config/admin controller** — rule thresholds, scoring weights (FR5.2)
- Talks to the ML service over HTTP (internal call), not exposed to the frontend directly

### 2.3 ML Service (FastAPI + scikit-learn)
- Stateless-ish service: receives feature vectors, returns anomaly scores
- Owns model training/retraining endpoint
- Isolation Forest as default estimator; pluggable to swap in LOF/One-Class SVM/Random Forest later without changing the API contract

### 2.4 AI Explanation Layer
- Given: risk score breakdown + which rules fired + anomaly score + user profile deltas
- Returns: natural-language explanation + recommended action
- **Called only for logins above a risk threshold** — this keeps cost/latency bounded (NFR from PRD)

### 2.5 Database (Postgres / Supabase)
Core tables:
- `users` — id, username, created_at
- `logins` — id, user_id, timestamp, ip, country, city, device, browser, success
- `user_features` — per-login computed features (FK to logins)
- `rule_hits` — login_id, rule_name, triggered (bool)
- `risk_scores` — login_id, rule_score, ml_score, threat_intel_score, final_score, label
- `ai_explanations` — login_id, explanation_text, recommended_action, generated_at
- `user_profiles` — user_id, typical_hours, typical_country, typical_device, avg_logins_per_day (recomputed periodically)

---

## 3. Data Flow (Single Login, End to End)

```
CSV Row
   │
   ▼
[Validate schema] ──fail──▶ Row-level error reported, skipped
   │ pass
   ▼
[Store raw login in DB]
   │
   ▼
[Compute features] ── uses user's historical logins ──▶ feature vector
   │
   ▼
[Run rule engine] ──▶ list of triggered rules + rule_score
   │
   ▼
[Call ML service] ──▶ anomaly_score
   │
   ▼
[Combine scores] ──▶ final_score (0–100) + label
   │
   ▼
final_score ≥ threshold? ──yes──▶ [Call LLM] ──▶ explanation + action ──▶ store
   │ no
   ▼
Store risk_score only, no explanation call (cost control)
```

---

## 4. Wireframes

### 4.1 Dashboard (main view)

```
┌────────────────────────────────────────────────────────────────────┐
│  SentryLogin                                    [Upload CSV] [⚙]   │
├────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐   │
│  │ Total       │ │ Flagged     │ │ Critical    │ │ Top Risky User │   │
│  │ Logins      │ │ %           │ │ Alerts      │ │ jane.doe (7)   │   │
│  │ 12,480      │ │ 4.2%        │ │ 6           │ │                │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘   │
├────────────────────────────────────────────────────────────────────┤
│  Filter: [ Risk: All ▾ ] [ User: ______ ] [ Date range: ____ ]      │
├────────────────────────────────────────────────────────────────────┤
│  User        │ Time            │ IP           │ Risk    │ Score    │
│──────────────┼─────────────────┼──────────────┼─────────┼──────────│
│  jane.doe    │ 2026-07-30 02:14│ 41.22.x.x    │ CRITICAL│  93   ▶  │
│  john.smith  │ 2026-07-30 09:01│ 105.11.x.x   │ Low     │  12   ▶  │
│  mary.k      │ 2026-07-29 23:47│ 88.4.x.x     │ Medium  │  58   ▶  │
│  ...         │ ...             │ ...          │ ...     │  ...     │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Login Detail View

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard              jane.doe — 2026-07-30 02:14      │
├────────────────────────────────────────────────────────────────────┤
│  RISK SCORE: 93 / 100  (CRITICAL)                                   │
│  ┌──────────────┬──────────────┬──────────────────┐                │
│  │ Rule Score    │ ML Score      │ Threat Intel      │                │
│  │    45          │    92          │    10             │                │
│  └──────────────┴──────────────┴──────────────────┘                │
├────────────────────────────────────────────────────────────────────┤
│  RULES TRIGGERED                                                     │
│   ✔ New device                                                       │
│   ✔ Impossible travel (Lagos → Berlin in 40 min)                     │
│   ✔ 3 failed attempts before success                                 │
│   ✘ Blacklisted IP (not triggered)                                   │
├────────────────────────────────────────────────────────────────────┤
│  AI EXPLANATION                                                      │
│  "This login is high risk: it occurred from a device and location    │
│   never seen for this user, immediately following several failed     │
│   attempts, and is geographically inconsistent with the user's       │
│   prior login 40 minutes earlier."                                   │
│                                                                        │
│  Recommended action: Force password reset + notify user               │
├────────────────────────────────────────────────────────────────────┤
│  USER BASELINE VS THIS LOGIN                                          │
│   Typical hours: 08:00–18:00        │  This login: 02:14              │
│   Typical country: Nigeria           │  This login: Germany            │
│   Typical device: Windows/Chrome     │  This login: Linux/Firefox      │
└────────────────────────────────────────────────────────────────────┘
```

### 4.3 Upload Screen

```
┌────────────────────────────────────────────────────────────────────┐
│  SentryLogin — Upload Login Data                                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                        │
│        ┌──────────────────────────────────────────────┐              │
│        │                                                │              │
│        │        Drag & drop CSV file here                │              │
│        │              or click to browse                 │              │
│        │                                                │              │
│        └──────────────────────────────────────────────┘              │
│                                                                        │
│  Expected columns: username, timestamp, ip, country, city, device,   │
│  browser, success                                                     │
│                                                                        │
│  [ Validation results appear here after upload ]                     │
│                                                                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + TypeScript + Tailwind CSS | Recharts for charts, Leaflet for geo-map (v3) |
| Backend API | NestJS (TypeScript) | Owns ingestion, query, config endpoints |
| ML Service | FastAPI + scikit-learn + pandas + NumPy | Isolation Forest default; swappable |
| AI Layer | LLM API call from backend or ML service | Cache explanations, only call above threshold |
| Database | PostgreSQL (Supabase) | Supabase Auth available for v2 auth needs |
| Queue (v3) | Redis + BullMQ | For streaming ingestion, not required for v1 |
| Containerization | Docker + docker-compose | One command to run the whole stack locally |
| Deployment | Render (API/ML) + Vercel (frontend) | Free-tier friendly for a portfolio demo |

---

## 6. API Contract (Core Endpoints, v1)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/ingest/csv` | Upload and process a login CSV |
| GET | `/logins` | Paginated, filterable login list with risk scores |
| GET | `/logins/:id` | Full detail for one login (rules, scores, explanation) |
| POST | `/ml/train` | Trigger model retraining on current dataset |
| GET | `/config/rules` | Current rule thresholds |
| PUT | `/config/rules` | Update rule thresholds |
| GET | `/users/:id/profile` | Behavioral baseline for a user (v2) |

---

## 7. Deployment Architecture

```
┌───────────────┐        ┌───────────────────┐        ┌───────────────┐
│   Vercel       │  API   │   Render            │  SQL   │   Supabase     │
│  (Frontend)    │───────▶│  (NestJS + FastAPI  │───────▶│  (Postgres)    │
│                │◀───────│   containers)        │◀───────│                │
└───────────────┘        └───────────────────┘        └───────────────┘
```

Local dev uses `docker-compose up` to run frontend, backend, ML service, and Postgres together — no cloud dependency required to develop or demo locally.
