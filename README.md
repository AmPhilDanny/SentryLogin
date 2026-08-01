# SentryLogin — SOC Login Analytics & Anomaly Detection

A full-stack login-fraud detection platform: ingest login audit logs (CSV), extract risk features,
score them with a trained ML model plus deterministic rule checks, and surface suspicious activity
in an operations dashboard with AI-assisted explanations.

**Stack:** NestJS (TypeORM + SQLite/Postgres) · FastAPI + scikit-learn · React + Vite · Docker Compose

---

## Architecture

```
┌──────────────┐   POST /api/upload    ┌──────────────┐   /score /train   ┌──────────────┐
│   Frontend   │ ────────────────────► │   Backend    │ ─────────────────► │  ml-service  │
│  React/Vite  │ ◄──────────────────── │   NestJS     │ ◄───────────────── │   FastAPI    │
│  :5173/4173  │       /api/*          │    :3000     │     risk scores   │    :8000     │
└──────────────┘                      └──────┬───────┘                   └──────────────┘
                                             │
                                     ┌───────┴───────┐
                                     │    SQLite     │  (or opt-in Postgres)
                                     │  sentry.sqlite │
                                     └───────────────┘
```

**Backend modules** (`backend/src/`):

| Module | Responsibility |
|---|---|
| `ingestion` | CSV upload, validation (malformed rows tolerated via `relax_column_count`), transactional bulk insert |
| `features` | Per-login feature extraction: login hour/day, failed-attempt window, country/device/browser/IP change, geo distance, login frequency, historical success rate |
| `rules` | Deterministic rules: failed-login burst, impossible travel, blacklisted IP, new device, odd hour; score cap 100 |
| `ml` | Batches features to ml-service, merges ML score + rule score into final risk |
| `explanations` | Template-based (or LLM) explanations for high-risk logins; backfill + cache |
| `alerts` | Alert lifecycle: open → dismissed / escalated → reopened; paginated API |
| `users` | User profiles (device/country/geo history) for comparison views |
| `config` | Runtime-tunable thresholds (e.g. `explainThreshold`, rule weights) |

---

## Quick Start (local, no Docker)

Requires **Node 18+** and **Python 3.10+**.

```powershell
# 1. Backend
cd backend
npm ci
Copy-Item ..\.env.example ..\.env   # optional; all defaults work
npm run start:dev                   # NestJS on :3000  (or npm run build && node dist/main)

# 2. ML service (separate terminal)
cd ml-service
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# 3. Frontend (separate terminal)
cd frontend
npm ci
npm run dev                         # Vite dev server on :5173, proxies /api → :3000
```

Open http://localhost:5173.

### Docker (recommended for demos)

```powershell
docker compose up --build
# backend :3000 · ml-service :8000 · frontend :5173
```

SQLite is the default (persistent volume, zero config). Postgres is supported as an opt-in —
see the commented block in `docker-compose.yml` and the `DATABASE_TYPE=postgres` section in
`.env.example`.

---

## 5-Minute Demo

```powershell
# 1. Generate a realistic dataset (10k logins, seeded attack patterns)
cd data
python generate_logins.py            # writes sample_logins.csv

# 2. Open the dashboard → Upload → sample_logins.csv
#    Backend ingests, extracts features, scores every login, raises alerts.

# 3. Review findings
#    Dashboard:    risk-score distribution, top anomalies
#    Alerts page:  /alerts  — open/dismissed/escalated lifecycle
#    Login detail: /logins/:id — AI explanation card + profile comparison

# 4. Tune detection
#    PUT /api/config/rules  — e.g. lower failed_login_burst threshold → more alerts
```

API cheatsheet:

```powershell
# Upload + analyze (multipart, field name "file")
curl.exe -X POST -F "file=@.\sample_logins.csv" http://localhost:3000/api/ingest/csv

# Alerts
Invoke-RestMethod http://localhost:3000/api/alerts?status=open
Invoke-RestMethod -Method Patch http://localhost:3000/api/alerts/1 `
  -ContentType 'application/json' -Body '{\"status\":\"dismissed\"}'

# Config
Invoke-RestMethod http://localhost:3000/api/config/rules
```

---

## Tests

```powershell
cd backend
npm test           # unit: features (9) + rules (10) — 19 passing
npm run test:e2e   # e2e: full CSV ingestion through API — 3 passing
```

`test/setup-env.ts` points e2e runs at a throwaway SQLite file — the dev database is never touched.

---

## Data & Artifacts

- `data/` — `generate_logins.py` (realistic login-log generator) + `sample_logins.csv`
- `backend/db/` — SQLite database (auto-created; schema synchronizes on boot)
- `ml-service/models/` — persisted trained model (JSON + weights)
- `docs/` — evaluation write-ups: `evaluation-ml.md`, `evaluation-rules.md`

## Environment

Copy `.env.example` → `.env` for overrides. Key vars: `DATABASE_TYPE` (`sqlite`|`postgres`),
`DATABASE_PATH` / `DATABASE_URL`, `ML_SERVICE_URL`, `CORS_ORIGIN`, `LLM_API_KEY` (optional,
rule-based explanations otherwise).
