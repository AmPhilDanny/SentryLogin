# Plan — Suspicious Login Log Analysis Platform

**Status:** Draft v1.0
**Companion docs:** PRD.md, architecture.md

Approach: build in phases so a working, demoable artifact exists as early as possible. Each phase has a clear "definition of done" — don't move to the next phase until the current one's done criteria are met.

---

## Phase 0 — Setup & Data (few days)

**Goal:** Have a realistic dataset and a repo skeleton to build against.

- [ ] Set up monorepo structure: `/frontend`, `/backend`, `/ml-service`, `/docs`
- [ ] Generate or source a synthetic login dataset:
  - Base it on realistic normal behavior per user (consistent hours, country, device)
  - Inject known attack patterns: brute force bursts, impossible travel, credential stuffing across accounts, new-device+odd-hour combos
  - Label the injected attacks (ground truth) — this is what you'll evaluate against later, even though a real system wouldn't have labels
- [ ] Docker-compose skeleton with Postgres running

**Definition of done:** A CSV (or generator script) exists producing thousands of rows of realistic login data with known, labeled injected attacks.

---

## Phase 1 — Rules Engine + EDA (1 week)

**Goal:** Deterministic detection working end-to-end, plus exploratory analysis to inform ML feature choices.

- [ ] Implement CSV ingestion + validation (FR1)
- [ ] Implement feature engineering pipeline (FR2): failed_attempts, geo_distance, device/browser/ip change flags, login_hour, day_of_week
- [ ] Implement rule engine (FR3): failed-login burst, impossible travel, blacklisted IP, new device, odd hours
- [ ] Exploratory data analysis notebook: distributions of features, how well rules alone catch the labeled attacks
- [ ] Store rule hits + rule score per login in DB

**Definition of done:** Uploading the synthetic CSV produces per-login rule hits and a rule score, and you have a notebook showing recall/precision of rules alone against your labeled attacks.

---

## Phase 2 — ML Anomaly Detection (1–1.5 weeks)

**Goal:** Add the unsupervised ML layer and prove it adds value over rules alone.

- [ ] Stand up FastAPI ML service with `/train` and `/score` endpoints
- [ ] Train Isolation Forest on feature vectors
- [ ] Evaluate: does combining rules + ML improve recall/precision over rules alone on your labeled test set? (This comparison is the actual data-science deliverable — write it up.)
- [ ] Implement risk scoring engine combining rule_score + ml_score (FR5)
- [ ] Make scoring weights configurable, not hardcoded

**Definition of done:** A documented evaluation (in a notebook or short writeup) comparing rules-only vs rules+ML performance, with a combined risk score being produced end-to-end via API.

---

## Phase 3 — Dashboard (1–1.5 weeks)

**Goal:** Make the results usable by a human, not just an API response.

- [ ] Build NestJS query/reporting endpoints (`/logins`, `/logins/:id`)
- [ ] Build React dashboard: table view, filters, summary cards (per architecture.md §4.1)
- [ ] Build login detail view: rule hits + score breakdown (per architecture.md §4.2, minus AI explanation for now)
- [ ] Build upload screen with validation feedback (per architecture.md §4.3)

**Definition of done:** You can upload a CSV through the UI and browse/filter flagged logins with full score breakdowns — a fully working v1 MVP per the PRD.

---

## Phase 4 — AI Explanation Layer (3–5 days)

**Goal:** Add the layer that turns scores into human-readable analyst guidance.

- [ ] Design the prompt: inputs are rule hits, ML score, and (if available) user profile deltas; output is explanation + recommended action
- [ ] Call the LLM only for logins above the risk threshold (cost control, per NFR)
- [ ] Cache explanations in `ai_explanations` table so repeat views don't re-call the API
- [ ] Surface in the detail view

**Definition of done:** Every High/Critical login in the detail view shows a coherent, specific explanation and a recommended action — spot-check a dozen for quality.

---

## Phase 5 — Behavioral Profiles + Alerts View (1 week)

**Goal:** v2 features that make the tool feel like a real security product.

- [ ] Compute per-user behavioral profile (typical hours, country, device, avg logins/day)
- [ ] Show baseline-vs-this-login comparison in detail view
- [ ] Build dedicated Alerts view: High/Critical only, with dismiss/escalate actions
- [ ] Add basic auth (Supabase Auth) so the dashboard isn't wide open

**Definition of done:** Profiles are visibly used in the detail view (not just computed and ignored), and the Alerts view is a genuinely faster workflow than the full table.

---

## Phase 6 — Stretch / Future Enhancements (open-ended, pick what excites you)

Only start these once Phases 0–5 are solid — they're the "advanced portfolio flex" items, not requirements:

- [ ] Real-time ingestion via WebSocket/queue instead of CSV upload
- [ ] Network graph view (shared IPs/devices across accounts)
- [ ] Threat intelligence feed integration
- [ ] Predictive risk model ("likelihood of compromise in next 7 days")
- [ ] Supervised classifier option, if you decide to hand-label more data

---

## Suggested Timeline

| Phase | Duration | Cumulative |
|---|---|---|
| 0 — Setup & Data | 2–3 days | Week 1 |
| 1 — Rules + EDA | ~1 week | Week 2 |
| 2 — ML Anomaly Detection | ~1–1.5 weeks | Week 3–4 |
| 3 — Dashboard | ~1–1.5 weeks | Week 5–6 |
| 4 — AI Explanation | 3–5 days | Week 6–7 |
| 5 — Profiles + Alerts | ~1 week | Week 8 |
| 6 — Stretch goals | open | Ongoing |

A working, demoable MVP exists by the end of Phase 3 (~week 6). Everything after that is what pushes it from "solid project" to "clearly advanced portfolio piece."

---

## Key Risks to Watch

- **Don't let Phase 0's synthetic data be too clean** — if attacks are too obviously different from normal behavior, your evaluation numbers will look artificially perfect and won't demonstrate real rigor. Add noise and edge cases (legit travel, shared family devices).
- **Don't skip the Phase 2 evaluation writeup** — "I combined rules and ML" is a weak interview answer; "here's the precision/recall improvement I measured" is a strong one.
- **Don't let Phase 6 eat time from Phases 0–5** — a finished MVP with a clean writeup beats a half-built system with a network graph.
