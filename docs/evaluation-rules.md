# Rules-Only Evaluation (Sprint 1.5)

Dataset: `data/sample_logins.csv` — 13,898 rows, 2,502 labeled attack rows, 565 attack events.

Rules replicated from `backend/src/rules/rules.service.ts` with default thresholds from `config.service.ts`. A login is **flagged** when its rule score >= 40 (Medium+).
Detection is measured per **attack event** (consecutive same-type attack rows within 15 min count as one attack; detected when any row is flagged).

## Summary (event-level)

| Metric | Value |
|---|---|
| Attack events detected | 427/565 (75.6%) |
| Combined recall (brute_force + impossible_travel) | 97.8% |
| Row-level recall (attack rows flagged) | 64.3% |
| Row-level precision (flagged rows are attacks) | 88.4% |
| False-positive rows | 211 |

## Recall by Attack Type (event-level)

| Attack type | Events | Rows | Detected | Recall |
|---|---|---|---|---|
| brute_force | 139 | 2064 | 139 | 100.0% |
| credential_stuffing | 149 | 153 | 149 | 100.0% |
| impossible_travel | 139 | 141 | 133 | 95.7% |
| odd_hour_new_device | 138 | 144 | 6 | 4.3% |

## Notes

- Target (prompt.md §4 DoD): recall >= 90% on brute_force + impossible_travel events.
- `odd_hour_new_device` relies on weak single signals (odd hour 10 pts, new device 20 pts) that rarely reach the 40-pt flag threshold alone — ML layer (Sprint 2) is expected to close the gap.
- `credential_stuffing` is caught by `blacklisted_ip` (45 pts) on the synthetic proxy range.

## Rule Trigger Breakdown (attack rows)

| Rule | Triggered on attack rows |
|---|---|
| blacklisted_ip | 153 |
| failed_login_burst | 1312 |
| impossible_travel | 254 |
| new_device | 251 |
| odd_hour | 716 |
