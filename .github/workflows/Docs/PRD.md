# PRD — Suspicious Login Log Analysis Platform

**Codename:** SentryLogin
**Owner:** [Your Name]
**Status:** Draft v1.0
**Last updated:** 2026-07-30

---

## 1. Overview

SentryLogin is an AI/ML-assisted platform that ingests authentication logs (login attempts across users, IPs, devices, and locations) and identifies logins that are likely malicious — account takeover attempts, credential stuffing, password spraying, or impossible-travel anomalies — versus normal user behavior.

It combines three detection layers (deterministic rules, unsupervised ML anomaly detection, and an LLM explanation layer) and surfaces results through a security-analyst-style dashboard with risk scoring, alerts, and per-user behavioral baselines.

This is a portfolio project intended to demonstrate full-stack engineering, data science/ML, and security-domain thinking — but is scoped so a working, demoable version exists early, with advanced capabilities layered on top rather than required for v1.

---

## 2. Problem Statement

Security teams (and solo developers running their own products) need a way to tell the difference between:
- A user who forgot their password and logging in from a new laptop
- An attacker who has stolen credentials and is probing an account

Doing this by eyeballing raw logs doesn't scale past a handful of users. Rule-based systems alone (e.g. "5 failed logins in 10 minutes") catch known patterns but miss novel ones, and produce false positives on legitimate edge cases (travel, shared devices, VPNs). Pure ML systems are hard to interpret — an anomaly score of 0.92 doesn't tell an analyst *why* something is risky or what to do about it.

SentryLogin's core bet: **rules + ML + LLM explanation together outperform any one layer alone**, and are more explainable than ML alone.

---

## 3. Goals & Success Metrics

### Product goals
- Correctly flag synthetic/injected malicious login patterns with high recall
- Keep false-positive rate low enough that a dashboard of alerts stays usable
- Produce a human-readable explanation for every flagged login, not just a score
- Support both batch (CSV upload) and, later, streaming ingestion

### Success metrics (project-level, since there's no live production traffic)
| Metric | Target |
|---|---|
| Recall on injected attack scenarios (test set) | ≥ 90% |
| Precision on injected attack scenarios | ≥ 70% |
| Dashboard load time (10k logins) | < 2s |
| End-to-end demo (CSV upload → dashboard) | Fully working, no manual steps |
| Explanation quality (subjective, spot-check) | Every high-risk alert has a coherent, specific explanation |

### Portfolio goals
- Demonstrate: data engineering, feature engineering, unsupervised ML, full-stack development, API design, and applied security reasoning
- Be demoable in under 5 minutes to a technical interviewer

---

## 4. Target Users

- **Primary persona: Security analyst / IT admin at a small-to-mid org** — uploads or streams login data, reviews flagged logins, investigates and dismisses/escalates
- **Secondary persona: Individual developer** — wants to monitor logins to their own app without buying an enterprise SIEM

---

## 5. Scope

### In scope — v1 (MVP)
- CSV upload of login logs
- Feature engineering pipeline (failed attempts, geo-distance, new device/browser/IP, odd-hour login, login frequency)
- Rule-based detection engine (configurable thresholds)
- ML anomaly detection (Isolation Forest) trained per-dataset or per-user
- Combined risk score (rules + ML)
- Dashboard: table of logins with risk scores, filter/sort, drill-into detail view
- Per-login detail view showing which rules fired and the anomaly score

### In scope — v2 (post-MVP, still part of this project's ambition)
- LLM explanation layer: natural-language explanation + recommended action per flagged login
- Per-user behavioral baseline profile (typical hours, typical country, typical device)
- Alerts view (only high-risk items), with dismiss/escalate workflow
- Auth (so the dashboard itself isn't wide open) and multi-user/org support

### In scope — v3 (stretch / future enhancements)
- Real-time ingestion via WebSocket/queue instead of CSV upload
- Network graph view (shared IPs/devices across accounts — infrastructure reuse detection)
- Threat intelligence feed integration (known malicious IP lists)
- Predictive risk ("likelihood this account is compromised in the next 7 days")
- Supervised classifier option if labeled data becomes available

### Out of scope (explicitly)
- Actually blocking/intervening on logins (this is a detection/analysis tool, not an auth gateway)
- Integrating with a specific real IdP (Okta, Auth0, etc.) — synthetic/sample data only
- Mobile app
- Compliance certifications (SOC2 etc.) — not relevant to a portfolio project

---

## 6. Functional Requirements

### FR1 — Data ingestion
- FR1.1: User can upload a CSV with columns: `username, timestamp, ip, country, city, device, browser, success`
- FR1.2: System validates schema and reports row-level errors without failing the whole upload
- FR1.3 (v3): System can accept a stream of login events instead of a static file

### FR2 — Feature engineering
- FR2.1: For every login, compute: login_hour, day_of_week, failed_attempts_in_window, country_change, device_change, browser_change, ip_change, geo_distance_from_last_login, account_login_frequency, historical_success_rate
- FR2.2: Features are recomputed per-user, using that user's own history as baseline

### FR3 — Rule engine
- FR3.1: Configurable thresholds for: failed-login burst, impossible travel (distance/time), blacklisted IP, new-device login, odd-hour login
- FR3.2: Each rule that fires is recorded individually (not just a total) so the UI can show *which* rule triggered

### FR4 — ML anomaly detection
- FR4.1: Isolation Forest trained on the feature set, producing an anomaly score per login
- FR4.2: Model retrains on new data on demand (button/endpoint), not required to be automatic in v1

### FR5 — Risk scoring
- FR5.1: Combine rule score + ML anomaly score (+ threat-intel score in v3) into a single 0–100 risk score with a label (Low/Medium/High/Critical)
- FR5.2: Scoring weights are configurable, not hardcoded

### FR6 — Dashboard
- FR6.1: Table view of all logins, sortable/filterable by risk level, user, date range
- FR6.2: Detail view per login: raw data, which rules fired, anomaly score, (v2) AI explanation
- FR6.3: Summary stats (total logins, % flagged, top risky users)

### FR7 — AI explanation layer (v2)
- FR7.1: For any login above a risk threshold, generate a natural-language explanation of why it's risky
- FR7.2: Include a recommended action (e.g., "force password reset", "verify with user")

### FR8 — User behavioral profiles (v2)
- FR8.1: Auto-generated profile per user: typical login hours, typical country, typical device/browser, average logins/day
- FR8.2: New logins are compared against the profile in the detail view

---

## 7. Non-Functional Requirements

- **Explainability:** every flagged login must show *why*, never just a bare score
- **Performance:** dashboard should handle at least 50k login rows without noticeable lag
- **Reproducibility:** ML training should be deterministic given a fixed seed, for demoability
- **Portability:** should run locally via Docker without depending on paid third-party services (LLM API key aside)
- **Data privacy:** since this may use synthetic data resembling real patterns, no real user PII should ever be used in the demo dataset

---

## 8. Key User Stories

- As an analyst, I want to upload a CSV of logins and immediately see which ones are risky, so I don't have to manually scan raw logs.
- As an analyst, I want to know *why* a login was flagged, so I can decide whether to act on it.
- As an analyst, I want to see a user's normal behavior baseline, so I can judge whether a new login is really unusual for *them* specifically, not just unusual in general.
- As a developer evaluating this project, I want to see the ML methodology and evaluation metrics, so I can judge whether the anomaly detection is rigorous or just a black box.

---

## 9. Risks & Assumptions

| Risk/Assumption | Mitigation |
|---|---|
| No real labeled attack data exists | Use synthetic data generation with injected known attack patterns for evaluation |
| Isolation Forest may flag rare-but-legitimate behavior (e.g. real travel) | Combine with rules and behavioral profile context, not ML score alone |
| LLM explanation cost/latency | Cache explanations per login; only call LLM for above-threshold logins, not every row |
| Scope creep toward a full SIEM | Hold the line at the v1/v2/v3 boundaries defined above |

---

## 10. Glossary

- **UEBA:** User and Entity Behavior Analytics — the general category this project falls into
- **Impossible travel:** Two logins from geographically distant locations in a time window too short for real travel
- **Isolation Forest:** An unsupervised ML algorithm that isolates anomalies by randomly partitioning data; anomalies require fewer splits to isolate
- **Risk score:** Combined 0–100 score derived from rules + ML (+ threat intel) used to prioritize analyst attention
