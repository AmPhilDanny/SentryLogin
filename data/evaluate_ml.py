"""
Rules-only vs rules+ML evaluation for SentryLogin (Sprint 2.3).

Replicates the backend feature engineering (src/features/features.service.ts),
rule engine (src/rules/rules.service.ts), IsolationForest training
(ml-service/app/ml/engine.py, n_estimators=100, random_state=42,
contamination="auto"), and the risk scoring engine
(src/risk/risk-scoring.service.ts, rule 0.6 / ml 0.4 weights) in pure Python,
then compares detection on the labeled synthetic dataset.

Detection is measured at the ATTACK-EVENT level (same grouping as
evaluate_rules.py): consecutive same-type attack rows within 15 min are one
event; an event is detected when any of its rows is flagged.

Usage:
    python data/evaluate_ml.py
"""

import os
import sys

import numpy as np
from sklearn.ensemble import IsolationForest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evaluate_rules import (  # noqa: E402
    ATTACK_EVENT_WINDOW_MINUTES,
    FLAG_THRESHOLD,
    MAX_SCORE,
    compute_features,
    evaluate_rules,
    group_attack_events,
    load_rows,
    score_row,
)

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(DATA_DIR, "sample_logins.csv")
OUTPUT_MD = os.path.join(os.path.dirname(DATA_DIR), "docs", "evaluation-ml.md")

# Mirrors backend/src/config/config.service.ts defaults
RULE_SCORE_WEIGHT = 0.6
ML_SCORE_WEIGHT = 0.4

# Feature column order — must match ml-service/app/routers/train.py
FEATURE_COLUMNS = [
    "login_hour",
    "day_of_week",
    "failed_attempts_in_window",
    "country_change",
    "device_change",
    "browser_change",
    "ip_change",
    "geo_distance_km",
    "account_login_frequency",
    "historical_success_rate",
]


def normalize_to_risk(raw_scores: list[float]) -> list[int]:
    """Map sklearn score_samples (lower = more anomalous) to 0-100 risk."""
    if not raw_scores:
        return []
    lo = min(raw_scores)
    hi = max(raw_scores)
    if hi == lo:
        return [0] * len(raw_scores)
    return [round((hi - s) / (hi - lo) * 100) for s in raw_scores]


def combined_score(rule_score: int, ml_score: int) -> int:
    return min(MAX_SCORE, round(rule_score * RULE_SCORE_WEIGHT + ml_score * ML_SCORE_WEIGHT))


def main() -> None:
    rows = load_rows()
    by_user: dict[str, list[dict]] = {}
    for r in rows:
        by_user.setdefault(r["username"], []).append(r)
    for user_rows in by_user.values():
        user_rows.sort(key=lambda r: r["timestamp"])

    # Per-row features + rule score (same pass as evaluate_rules.py)
    scored: list[dict] = []
    for user_rows in by_user.values():
        history: list[dict] = []
        for row in user_rows:
            features = compute_features(row, history)
            rule = score_row(row, features)
            scored.append(
                {
                    "username": row["username"],
                    "timestamp": row["timestamp"],
                    "is_attack": row["is_attack"] == "True",
                    "attack_type": row["attack_type"],
                    "rule_score": rule,
                    "features": features,
                }
            )
            history.append(row)

    total = len(scored)
    attacks = [r for r in scored if r["is_attack"]]

    # Train IsolationForest on ALL rows (unsupervised — labels unused), same
    # hyperparameters as ml-service/app/ml/engine.py
    X = np.array(
        [[s["features"][c] for c in FEATURE_COLUMNS] for s in scored],
        dtype=float,
    )
    model = IsolationForest(n_estimators=100, random_state=42, contamination="auto", n_jobs=-1)
    model.fit(X)
    raw = model.score_samples(X).tolist()
    ml_scores = normalize_to_risk(raw)
    for i, s in enumerate(scored):
        s["ml_score"] = ml_scores[i]
        s["total_score"] = combined_score(s["rule_score"], s["ml_score"])

    by_key = {(s["username"], s["timestamp"]): s for s in scored}

    def event_stats(field: str) -> tuple[int, dict[str, dict], int, int, int]:
        events = group_attack_events(rows)
        per_type: dict[str, dict] = {}
        for ev in events:
            ev_scored = [by_key[(r["username"], r["timestamp"])] for r in ev]
            detected = any(s[field] >= FLAG_THRESHOLD for s in ev_scored)
            t = ev[0]["attack_type"] or "unknown"
            entry = per_type.setdefault(t, {"events": 0, "detected": 0, "rows": 0})
            entry["events"] += 1
            entry["rows"] += len(ev)
            if detected:
                entry["detected"] += 1
        events_total = sum(v["events"] for v in per_type.values())
        events_detected = sum(v["detected"] for v in per_type.values())
        fp = sum(1 for s in scored if not s["is_attack"] and s[field] >= FLAG_THRESHOLD)
        tp = sum(1 for s in attacks if s[field] >= FLAG_THRESHOLD)
        return events_total, per_type, events_detected, tp, fp

    def combined_events(rule_field: str, ml_field: str) -> tuple[int, dict[str, dict], int, int, int]:
        events = group_attack_events(rows)
        per_type: dict[str, dict] = {}
        for ev in events:
            ev_scored = [by_key[(r["username"], r["timestamp"])] for r in ev]
            detected = any(
                s[rule_field] >= FLAG_THRESHOLD or s[ml_field] >= FLAG_THRESHOLD
                for s in ev_scored
            )
            t = ev[0]["attack_type"] or "unknown"
            entry = per_type.setdefault(t, {"events": 0, "detected": 0, "rows": 0})
            entry["events"] += 1
            entry["rows"] += len(ev)
            if detected:
                entry["detected"] += 1
        events_total = sum(v["events"] for v in per_type.values())
        events_detected = sum(v["detected"] for v in per_type.values())
        fp = sum(
            1
            for s in scored
            if not s["is_attack"] and (s[rule_field] >= FLAG_THRESHOLD or s[ml_field] >= FLAG_THRESHOLD)
        )
        tp = sum(
            1
            for s in attacks
            if s[rule_field] >= FLAG_THRESHOLD or s[ml_field] >= FLAG_THRESHOLD
        )
        return events_total, per_type, events_detected, tp, fp

    # Rules-only (baseline, same as evaluation-rules.md)
    et_r, per_r, det_r, tp_r, fp_r = event_stats("rule_score")
    # Rules+ML weighted total
    et_m, per_m, det_m, tp_m, fp_m = event_stats("total_score")
    # Rules OR ML flagged (union of signals)
    et_u, per_u, det_u, tp_u, fp_u = combined_events("rule_score", "ml_score")

    def recall_of(per: dict[str, dict], types: tuple[str, ...]) -> float:
        evs = [e for t, e in per.items() if t in types]
        return sum(e["detected"] for e in evs) / sum(e["events"] for e in evs) if evs else 0.0

    bf_it = ("brute_force", "impossible_travel")
    recall_r = recall_of(per_r, bf_it)
    recall_m = recall_of(per_m, bf_it)
    recall_u = recall_of(per_u, bf_it)

    precision_r = tp_r / (tp_r + fp_r) if tp_r + fp_r else 0.0
    precision_m = tp_m / (tp_m + fp_m) if tp_m + fp_m else 0.0
    precision_u = tp_u / (tp_u + fp_u) if tp_u + fp_u else 0.0

    lines = [
        "# Rules vs Rules+ML Evaluation (Sprint 2.3)",
        "",
        f"Dataset: `data/sample_logins.csv` — {total:,} rows, {len(attacks):,} labeled attack rows, "
        f"{et_r} attack events.",
        "",
        "**Rules-only** replicates `backend/src/rules/rules.service.ts` with default thresholds; "
        "flag when rule score >= 40. **Rules+ML** adds an IsolationForest "
        "(`n_estimators=100, random_state=42, contamination='auto'`, matching "
        "`ml-service/app/ml/engine.py`) trained unsupervised on the same feature vectors, "
        "scores normalized min-max to 0-100, combined as "
        "`total = 0.6*rule + 0.4*ml` (mirrors `src/risk/risk-scoring.service.ts`), flag when total >= 40.",
        "",
        "Detection is measured per **attack event** (consecutive same-type attack rows within "
        f"{ATTACK_EVENT_WINDOW_MINUTES} min count as one attack; detected when any row is flagged).",
        "",
        "## Summary (event-level)",
        "",
        "| Metric | Rules-only | Rules+ML (weighted) | Rules OR ML |",
        "|---|---|---|---|",
        f"| Attack events detected | {det_r}/{et_r} ({det_r / et_r * 100:.1f}%) | "
        f"{det_m}/{et_m} ({det_m / et_m * 100:.1f}%) | {det_u}/{et_u} ({det_u / et_u * 100:.1f}%) |",
        f"| Combined recall (brute_force + impossible_travel) | {recall_r * 100:.1f}% | "
        f"{recall_m * 100:.1f}% | {recall_u * 100:.1f}% |",
        f"| Row-level recall | {tp_r / len(attacks) * 100:.1f}% | {tp_m / len(attacks) * 100:.1f}% | "
        f"{tp_u / len(attacks) * 100:.1f}% |",
        f"| Row-level precision | {precision_r * 100:.1f}% | {precision_m * 100:.1f}% | "
        f"{precision_u * 100:.1f}% |",
        f"| False-positive rows | {fp_r:,} | {fp_m:,} | {fp_u:,} |",
        "",
        "## Recall by Attack Type (event-level)",
        "",
        "| Attack type | Events | Rules-only | Rules+ML (weighted) | Rules OR ML |",
        "|---|---|---|---|---|",
    ]
    for t in sorted(per_r):
        er = per_r[t]
        em = per_m.get(t, {"detected": 0, "events": 0})
        eu = per_u.get(t, {"detected": 0, "events": 0})
        lines.append(
            f"| {t} | {er['events']} | {er['detected']}/{er['events']} "
            f"({er['detected'] / er['events'] * 100:.1f}%) | "
            f"{em['detected']}/{em['events']} ({em['detected'] / em['events'] * 100:.1f}%) | "
            f"{eu['detected']}/{eu['events']} ({eu['detected'] / eu['events'] * 100:.1f}%) |"
        )
    lines.extend(
        [
            "",
            "## ML Score Distribution",
            "",
            f"- Rows with ml_score >= 80 (strong anomalies): "
            f"{sum(1 for s in scored if s['ml_score'] >= 80):,}",
            f"- Rows with ml_score >= 40: {sum(1 for s in scored if s['ml_score'] >= 40):,}",
            f"- Mean ml_score: {np.mean([s['ml_score'] for s in scored]):.1f}",
            "",
            "## Notes",
            "",
            "- The IsolationForest is trained **unsupervised** on all rows (labels are never "
            "seen by the model), matching the production flow (`POST /api/ml/train`).",
            "- Weights (0.6/0.4) come from `config.service.ts` defaults and are tunable via "
            "`PUT /api/config/rules`.",
            "- 'Rules OR ML' shows the ceiling when the UI surfaces both signals independently.",
            "",
        ]
    )

    os.makedirs(os.path.dirname(OUTPUT_MD), exist_ok=True)
    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Evaluated {total:,} rows ({len(attacks):,} attack rows, {et_r} events)")
    print(f"  Rules-only:       events {det_r}/{et_r}  recall(bf+it) {recall_r*100:.1f}%  "
          f"precision {precision_r*100:.1f}%  FP {fp_r:,}")
    print(f"  Rules+ML (total): events {det_m}/{et_m}  recall(bf+it) {recall_m*100:.1f}%  "
          f"precision {precision_m*100:.1f}%  FP {fp_m:,}")
    print(f"  Rules OR ML:      events {det_u}/{et_u}  recall(bf+it) {recall_u*100:.1f}%  "
          f"precision {precision_u*100:.1f}%  FP {fp_u:,}")
    for t in sorted(per_r):
        er = per_r[t]
        em = per_m.get(t, {"detected": 0, "events": 0})
        print(f"  {t}: rules {er['detected']}/{er['events']}  ->  ml {em['detected']}/{em['events']}")
    print(f"Writeup -> {OUTPUT_MD}")


if __name__ == "__main__":
    main()
