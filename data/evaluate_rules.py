"""
Rules-only evaluation for SentryLogin (Sprint 1.5).

Replicates the backend feature engineering (src/features/features.service.ts) and
rule engine (src/rules/rules.service.ts) in pure Python, runs them against the
labeled synthetic dataset, and writes docs/evaluation-rules.md.

Detection is measured at the ATTACK-EVENT level: consecutive attack rows of the
same type within ATTACK_EVENT_WINDOW_MINUTES belong to one event; an event is
detected when any of its rows is flagged. Per-row recall is reported as well.

Usage:
    python data/evaluate_rules.py
"""

import csv
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta

# Mirrors DEFAULT_RULES in backend/src/config/config.service.ts
FAILED_LOGIN_BURST_THRESHOLD = 5
FAILED_LOGIN_BURST_WINDOW_MINUTES = 10
IMPOSSIBLE_TRAVEL_SPEED_KMH = 800
ODD_HOUR_START = 23
ODD_HOUR_END = 6
RULE_SCORES = {
    "failed_login_burst": 40,
    "impossible_travel": 40,
    "blacklisted_ip": 45,
    "new_device": 20,
    "odd_hour": 10,
}
FLAG_THRESHOLD = 40  # Medium+ per risk label contract
MAX_SCORE = 100
ATTACK_EVENT_WINDOW_MINUTES = 15

# Mirrors COUNTRY_COORDS in backend/src/features/geo.ts
COUNTRY_COORDS = {
    "US": (37.0, -95.0), "NG": (9.0, 8.0), "UK": (55.0, -3.0),
    "DE": (51.0, 10.0), "BR": (-14.0, -51.0), "IN": (20.0, 77.0),
    "JP": (36.0, 138.0), "ES": (40.0, -3.0), "PT": (39.0, -8.0),
    "KR": (35.0, 128.0), "RU": (55.75, 37.62),
}
EARTH_RADIUS_KM = 6371.0

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(DATA_DIR, "sample_logins.csv")
OUTPUT_MD = os.path.join(os.path.dirname(DATA_DIR), "docs", "evaluation-rules.md")

BLACKLISTED_CIDRS = ["185.220.101.0/24", "185.220.102.0/24"]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    to_rad = lambda d: d * math.pi / 180
    dlat = to_rad(lat2 - lat1)
    dlng = to_rad(lng2 - lng1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def country_distance_km(country_a: str, country_b: str) -> float:
    a = COUNTRY_COORDS.get(country_a)
    b = COUNTRY_COORDS.get(country_b)
    if a is None or b is None:
        return 0.0
    return haversine_km(a, b)


def is_blacklisted_ip(ip: str) -> bool:
    for cidr in BLACKLISTED_CIDRS:
        network, prefix = cidr.split("/")
        prefix = int(prefix)
        take = math.ceil(prefix / 8)
        if ".".join(ip.split(".")[:take]) == ".".join(network.split(".")[:take]):
            return True
    return False


def compute_features(row: dict, history: list[dict]) -> dict:
    ts = datetime.fromisoformat(row["timestamp"])
    window_ms = FAILED_LOGIN_BURST_WINDOW_MINUTES * 60_000
    prev = history[-1] if history else None
    prev_ts = datetime.fromisoformat(prev["timestamp"]) if prev else None
    history_count = len(history)
    history_start = datetime.fromisoformat(history[0]["timestamp"]) if history else None
    span_days = (
        max(1.0, (ts - history_start).total_seconds() / 86_400)
        if history_start is not None
        else 0.0
    )
    successes = sum(1 for h in history if h["success"] == "True")

    failed_in_window = sum(
        1
        for h in history
        if h["success"] != "True"
        and (ts - datetime.fromisoformat(h["timestamp"])).total_seconds() * 1000
        <= window_ms
    )

    return {
        "login_hour": ts.hour,
        "day_of_week": (ts.weekday() + 1) % 7,  # Mon=0
        "failed_attempts_in_window": failed_in_window,
        "country_change": 1 if prev and prev["country"] != row["country"] else 0,
        "device_change": 1 if prev and prev["device"] != row["device"] else 0,
        "browser_change": 1 if prev and prev["browser"] != row["browser"] else 0,
        "ip_change": 1 if prev and prev["ip"] != row["ip"] else 0,
        "geo_distance_km": (
            country_distance_km(prev["country"], row["country"]) if prev else 0.0
        ),
        "account_login_frequency": history_count / span_days if span_days > 0 else 0.0,
        "historical_success_rate": (
            successes / history_count if history_count > 0 else 0.0
        ),
        "prev_ts": prev_ts,
    }


def evaluate_rules(row: dict, features: dict) -> list[dict]:
    ts = datetime.fromisoformat(row["timestamp"])
    hits = []

    burst_hit = features["failed_attempts_in_window"] >= FAILED_LOGIN_BURST_THRESHOLD
    hits.append({"rule": "failed_login_burst", "triggered": burst_hit})

    travel_hit = False
    if features["prev_ts"] is not None and features["geo_distance_km"] > 0:
        hours = (ts - features["prev_ts"]).total_seconds() / 3600
        max_dist = hours * IMPOSSIBLE_TRAVEL_SPEED_KMH
        travel_hit = features["geo_distance_km"] > max_dist
    hits.append({"rule": "impossible_travel", "triggered": travel_hit})

    hits.append({"rule": "blacklisted_ip", "triggered": is_blacklisted_ip(row["ip"])})
    hits.append({"rule": "new_device", "triggered": features["device_change"] == 1})
    hits.append(
        {
            "rule": "odd_hour",
            "triggered": features["login_hour"] >= ODD_HOUR_START
            or features["login_hour"] < ODD_HOUR_END,
        }
    )
    return hits


def score_row(row: dict, features: dict) -> int:
    hits = evaluate_rules(row, features)
    return min(
        MAX_SCORE,
        sum(RULE_SCORES[h["rule"]] for h in hits if h["triggered"]),
    )


def group_attack_events(rows: list[dict]) -> list[list[dict]]:
    events: list[list[dict]] = []
    window = timedelta(minutes=ATTACK_EVENT_WINDOW_MINUTES)
    for row in rows:
        if row["is_attack"] != "True":
            continue
        ts = datetime.fromisoformat(row["timestamp"])
        if (
            events
            and events[-1][0]["attack_type"] == row["attack_type"]
            and ts - datetime.fromisoformat(events[-1][-1]["timestamp"]) <= window
        ):
            events[-1].append(row)
        else:
            events.append([row])
    return events


def load_rows() -> list[dict]:
    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    rows = load_rows()
    by_user: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_user[r["username"]].append(r)
    for user_rows in by_user.values():
        user_rows.sort(key=lambda r: r["timestamp"])

    scored_rows = []
    for user_rows in by_user.values():
        history: list[dict] = []
        for row in user_rows:
            features = compute_features(row, history)
            score = score_row(row, features)
            scored_rows.append(
                {
                    "username": row["username"],
                    "timestamp": row["timestamp"],
                    "is_attack": row["is_attack"] == "True",
                    "attack_type": row["attack_type"],
                    "score": score,
                    "flagged": score >= FLAG_THRESHOLD,
                }
            )
            history.append(row)

    total = len(scored_rows)
    attacks = [r for r in scored_rows if r["is_attack"]]

    # Event-level detection
    events = group_attack_events(rows)
    by_key = {(r["username"], r["timestamp"]): r for r in scored_rows}
    event_scores: list[dict] = []
    for ev in events:
        ev_scored = [by_key[(r["username"], r["timestamp"])] for r in ev]
        event_scores.append(
            {
                "attack_type": ev[0]["attack_type"],
                "detected": any(r["flagged"] for r in ev_scored),
                "rows": len(ev),
            }
        )

    per_type: dict[str, dict] = {}
    for e in event_scores:
        t = e["attack_type"] or "unknown"
        entry = per_type.setdefault(t, {"events": 0, "detected": 0, "rows": 0})
        entry["events"] += 1
        entry["rows"] += e["rows"]
        if e["detected"]:
            entry["detected"] += 1

    events_total = sum(v["events"] for v in per_type.values())
    events_detected = sum(v["detected"] for v in per_type.values())

    # Per-row stats for the report
    fp_rows = sum(1 for r in scored_rows if not r["is_attack"] and r["flagged"])
    row_tp = sum(1 for r in attacks if r["flagged"])
    row_recall = row_tp / len(attacks) if attacks else 0.0
    row_precision = row_tp / (row_tp + fp_rows) if (row_tp + fp_rows) > 0 else 0.0

    bf_travel = [
        e for e in event_scores if e["attack_type"] in ("brute_force", "impossible_travel")
    ]
    bf_travel_recall = (
        sum(1 for e in bf_travel if e["detected"]) / len(bf_travel) if bf_travel else 0.0
    )

    lines = [
        "# Rules-Only Evaluation (Sprint 1.5)",
        "",
        f"Dataset: `data/sample_logins.csv` — {total:,} rows, {len(attacks):,} labeled attack rows, "
        f"{events_total} attack events.",
        "",
        "Rules replicated from `backend/src/rules/rules.service.ts` with default thresholds "
        "from `config.service.ts`. A login is **flagged** when its rule score >= 40 (Medium+).",
        "Detection is measured per **attack event** (consecutive same-type attack rows within "
        f"{ATTACK_EVENT_WINDOW_MINUTES} min count as one attack; detected when any row is flagged).",
        "",
        "## Summary (event-level)",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Attack events detected | {events_detected}/{events_total} ({events_detected / events_total * 100:.1f}%) |",
        f"| Combined recall (brute_force + impossible_travel) | {bf_travel_recall * 100:.1f}% |",
        f"| Row-level recall (attack rows flagged) | {row_recall * 100:.1f}% |",
        f"| Row-level precision (flagged rows are attacks) | {row_precision * 100:.1f}% |",
        f"| False-positive rows | {fp_rows} |",
        "",
        "## Recall by Attack Type (event-level)",
        "",
        "| Attack type | Events | Rows | Detected | Recall |",
        "|---|---|---|---|---|",
    ]
    for t in sorted(per_type):
        e = per_type[t]
        lines.append(
            f"| {t} | {e['events']} | {e['rows']} | {e['detected']} | "
            f"{e['detected'] / e['events'] * 100:.1f}% |"
        )
    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Target (prompt.md §4 DoD): recall >= 90% on brute_force + impossible_travel events.",
            "- `odd_hour_new_device` relies on weak single signals (odd hour 10 pts, new device "
            "20 pts) that rarely reach the 40-pt flag threshold alone — ML layer (Sprint 2) is "
            "expected to close the gap.",
            "- `credential_stuffing` is caught by `blacklisted_ip` (45 pts) on the synthetic "
            "proxy range.",
            "",
            "## Rule Trigger Breakdown (attack rows)",
            "",
        ]
    )
    rule_counts: dict[str, int] = defaultdict(int)
    for user_rows in by_user.values():
        history = []
        for row in user_rows:
            if row["is_attack"] != "True":
                history.append(row)
                continue
            features = compute_features(row, history)
            for h in evaluate_rules(row, features):
                if h["triggered"]:
                    rule_counts[h["rule"]] += 1
            history.append(row)
    lines.append("| Rule | Triggered on attack rows |")
    lines.append("|---|---|")
    for rule in sorted(rule_counts):
        lines.append(f"| {rule} | {rule_counts[rule]} |")

    os.makedirs(os.path.dirname(OUTPUT_MD), exist_ok=True)
    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Evaluated {total:,} rows ({len(attacks):,} attack rows, {events_total} events)")
    print(f"  Events detected:  {events_detected}/{events_total} ({events_detected / events_total * 100:.1f}%)")
    print(f"  Combined recall (brute_force+impossible_travel): {bf_travel_recall * 100:.1f}%")
    print(f"  Row recall: {row_recall * 100:.1f}%  Row precision: {row_precision * 100:.1f}%  FP rows: {fp_rows}")
    for t in sorted(per_type):
        e = per_type[t]
        print(f"  {t}: {e['detected']}/{e['events']} events ({e['detected'] / e['events'] * 100:.1f}%)")
    print(f"Writeup -> {OUTPUT_MD}")


if __name__ == "__main__":
    main()
