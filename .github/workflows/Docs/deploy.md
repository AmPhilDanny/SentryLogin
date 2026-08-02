# Deploying SentryLogin to Render + Supabase (Manual)

Production stack: **NestJS API** (Render Web Service) + **FastAPI ML service** (Render Web
Service) + **React frontend** (Render Static Site) + **Supabase Postgres** (managed DB).

```
Browser ──► frontend.onrender.com ──► api.onrender.com ──► ml.onrender.com
                 (static)        /api/*        │              (uvicorn)
                                               ▼
                                     Supabase Postgres (pooler)
```

> **Already done (this repo, verified live):**
> - Supabase schema **migrated** — all 7 tables created (`logins`, `users`, `user_features`,
>   `rule_hits`, `risk_scores`, `alerts`, `ai_explanations`)
> - **Seeded** with the full demo dataset — 13,898 logins, features, rule hits, risk scores
>   (88 critical / 139 high / 1,186 medium / 12,485 low)
> - **ML model trained** on that data and persisted (`ml-service/models/sentrylogin.joblib`,
>   committed — ml-service boots already trained)
>
> Steps 1–2 below can be skipped unless you want a fresh DB.

---

## 0. Secrets (do NOT commit)

The repo is public. Real credentials live only in
`.github/workflows/Docs/Supabase etc configs.txt` (gitignored) — never paste them into
committed files.

- Project ref: `<PROJECT_REF>` (e.g. `kaikuruvjtetdoafjtas`)
- DB password: `<SUPABASE_PASSWORD>` — special chars must be **URL-encoded** (`@` → `%40`)

**Pooler connection string (IPv4-friendly; the direct host is IPv6-only):**

```
postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Example shape (NOT real values):
`postgresql://postgres.kaikuruvjtetdoafjtas:S0me%40Pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

---

## 1. Supabase — fresh DB (only if re-creating)

1. Create a project at https://supabase.com (region **EU Central (Frankfurt)** — `eu-central-1`).
2. Copy the **pooler** connection string (Dashboard → Connect → Transaction pooler, port 5432).
   The pooler username is `postgres.<project-ref>`; keep port **5432** (transaction mode).
3. Create the schema by running the migration script locally once:

   ```powershell
   cd backend
   npm ci
   $env:DATABASE_TYPE='postgres'
   $env:DATABASE_URL='postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
   npx nest build
   node dist/db-sync.js
   ```

   → logs `[db-sync] schema synchronized on postgres`; all 7 tables now exist.

## 2. Seed demo data + train ML (only if starting fresh)

With the backend running against Supabase (local, as above) and ml-service running:

```powershell
# terminal 1 — ML service
cd ml-service
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# terminal 2 — backend (envs from step 1 + ML_SERVICE_URL=http://127.0.0.1:8000)
node dist/main

# terminal 3 — ingest the demo dataset, then train + backfill explanations
curl.exe -s -X POST -F "file=@..\data\sample_logins.csv" http://127.0.0.1:3000/api/ingest/csv
curl.exe -s -X POST http://127.0.0.1:3000/api/ml/train
curl.exe -s -X POST http://127.0.0.1:3000/api/explanations/backfill
```

In production you can also do this through the deployed app: **Upload page → sample_logins.csv**,
then `POST /api/ml/train`. Explanations are generated on first view of each login detail.

---

## 3. Render — manual deployment (3 services)

Create three services by hand. **Deploy order matters** (api needs the ml URL, frontend needs
the api URL): **ml → api → frontend**.

Common setup for every service: Dashboard → **New + → Web Service / Static Site** → connect the
GitHub repo `AmPhilDanny/SentryLogin` → branch `main` → service name, instance type **Free**.

### 3.1 `sentrylogin-ml` — Web Service (Python)

| Setting | Value |
|---|---|
| Name | `sentrylogin-ml` |
| Root Directory | `ml-service` |
| Runtime | Python 3 (auto-detected) |
| Region | **Frankfurt (EU Central)** — same region as Supabase |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

**Env vars:** none — `PORT` is injected automatically.

> The model is loaded from `models/sentrylogin.joblib` on boot (committed, already trained) —
> no training step on Render.

### 3.2 `sentrylogin-api` — Web Service (Node)

| Setting | Value |
|---|---|
| Name | `sentrylogin-api` |
| Root Directory | `backend` |
| Runtime | Node (20+ recommended) |
| Region | Frankfurt (EU Central) |
| Build Command | `npm ci && npm run build` |
| Start Command | `node dist/db-sync && node dist/main` |
| Health Check Path | `/api/logins/stats` |

**Env vars** (Environment tab):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_TYPE` | `postgres` |
| `DATABASE_URL` | `postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_PW>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` |
| `ML_SERVICE_URL` | `https://sentrylogin-ml.onrender.com` |
| `CORS_ORIGIN` | `https://sentrylogin-frontend.onrender.com` |
| `PORT` | (Render injects automatically) |

> `node dist/db-sync` runs before boot: it creates/updates the schema on every deploy
> (idempotent, safe), because production disables TypeORM auto-sync. Data is NOT wiped.

### 3.3 `sentrylogin-frontend` — Static Site (Node)

Deploy this **last**, after the api URL exists.

| Setting | Value |
|---|---|
| Name | `sentrylogin-frontend` |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

**Env var** (Environment tab — set **before** the build; Vite bakes it in at build time):

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://sentrylogin-api.onrender.com/api` |

> **Must include the `/api` suffix** — the API client uses this as the base for `/logins`,
> `/alerts`, etc. If you change it later, redeploy with **Clear build cache & deploy**
> (Manual Deploy button).

### Expected URLs

`https://sentrylogin-ml.onrender.com` · `https://sentrylogin-api.onrender.com` ·
`https://sentrylogin-frontend.onrender.com`

---

## 4. Verify the deployment

```powershell
# 1. ML service
curl.exe https://sentrylogin-ml.onrender.com/health
#   -> {"status":"ok","trained":true,...}

# 2. API — should show the seeded data
curl.exe https://sentrylogin-api.onrender.com/api/logins/stats
#   -> {"total":13898,"flagged":1413,...,"critical":88,"high":139,...}

# 3. UI
#    Open https://sentrylogin-frontend.onrender.com — Dashboard, filters, pagination,
#    login detail w/ AI explanation, Alerts page, Upload page.
```

---

## 5. Troubleshooting

- **First request is slow / 504** — free-tier web services sleep after ~15 min idle; the first
  request takes 30–60 s to spin up. Retry once.
- **`relation "logins" does not exist`** — schema missing; check the api start log (the start
  command runs `db-sync` automatically) or run `node dist/db-sync` against the DB.
- **`CASE types ... cannot be matched` / placeholder errors** — stale backend build; the
  Postgres-compatible SQL is in `ml.service.ts` (driver-aware `$n` vs `?` + explicit casts).
  Rebuild (`npm run build`) — don't reuse an old `dist`.
- **`Connection terminated unexpectedly`** — Supabase pooler recycled an idle pooled
  connection. Transient: retry the request; the app recovers automatically.
- **Uploads/ML training slow** — the pooler is transaction-mode (port 5432); batch sizes are
  already chunked (400 rows / 200 updates). For big datasets keep `limit` queries ≤ 200.
- **Frontend shows empty data but API works** — `VITE_API_URL` missing `/api` (see 3.3);
  change it, then Manual Deploy → Clear build cache & deploy.
- **API blocked by CORS in browser console** — `CORS_ORIGIN` on `sentrylogin-api` must exactly
  match the frontend origin (`https://sentrylogin-frontend.onrender.com`, no trailing slash).
- **Password with special chars** — always URL-encode in `DATABASE_URL` (`@` → `%40`,
  `#` → `%23`, `:` → `%3A`).

## 6. Redeploy / update

Pushing to `main` auto-deploys all three services (default for manually-created services).
Alternatively use **Manual Deploy → Deploy latest commit** (or **Clear build cache & deploy**
when env/build changed). The API's start command re-runs `db-sync` on every boot — always safe.
