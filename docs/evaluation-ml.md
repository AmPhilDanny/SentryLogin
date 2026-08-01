# Rules vs Rules+ML Evaluation (Sprint 2.3)

Dataset: `data/sample_logins.csv` — 13,898 rows, 2,502 labeled attack rows, 565 attack events.

**Rules-only** replicates `backend/src/rules/rules.service.ts` with default thresholds; flag when rule score >= 40. **Rules+ML** adds an IsolationForest (`n_estimators=100, random_state=42, contamination='auto'`, matching `ml-service/app/ml/engine.py`) trained unsupervised on the same feature vectors, scores normalized min-max to 0-100, combined as `total = 0.6*rule + 0.4*ml` (mirrors `src/risk/risk-scoring.service.ts`), flag when total >= 40.

Detection is measured per **attack event** (consecutive same-type attack rows within 15 min count as one attack; detected when any row is flagged).

## Summary (event-level)

| Metric | Rules-only | Rules+ML (weighted) | Rules OR ML |
|---|---|---|---|
| Attack events detected | 427/565 (75.6%) | 551/565 (97.5%) | 565/565 (100.0%) |
| Combined recall (brute_force + impossible_travel) | 97.8% | 97.5% | 100.0% |
| Row-level recall | 64.3% | 41.5% | 71.3% |
| Row-level precision | 88.4% | 74.6% | 66.0% |
| False-positive rows | 211 | 353 | 921 |

## Recall by Attack Type (event-level)

| Attack type | Events | Rules-only | Rules+ML (weighted) | Rules OR ML |
|---|---|---|---|---|
| brute_force | 139 | 139/139 (100.0%) | 138/139 (99.3%) | 139/139 (100.0%) |
| credential_stuffing | 149 | 149/149 (100.0%) | 145/149 (97.3%) | 149/149 (100.0%) |
| impossible_travel | 139 | 133/139 (95.7%) | 133/139 (95.7%) | 139/139 (100.0%) |
| odd_hour_new_device | 138 | 6/138 (4.3%) | 135/138 (97.8%) | 138/138 (100.0%) |

## ML Score Distribution

- Rows with ml_score >= 80 (strong anomalies): 301
- Rows with ml_score >= 40: 1,851
- Mean ml_score: 16.2

## Notes

- The IsolationForest is trained **unsupervised** on all rows (labels are never seen by the model), matching the production flow (`POST /api/ml/train`).
- Weights (0.6/0.4) come from `config.service.ts` defaults and are tunable via `PUT /api/config/rules`.
- 'Rules OR ML' shows the ceiling when the UI surfaces both signals independently.

