"""
Synthetic Login Data Generator for SentryLogin.

Usage:
    python data/generate_logins.py

Generates a CSV of realistic login activity with injected attack patterns.
Attack rows are labeled for evaluation.
"""

import csv
import os
from datetime import datetime, timedelta
from random import Random

import numpy as np

# ── Configuration ──────────────────────────────────────────────────────
NUM_USERS = 50
DAYS_OF_HISTORY = 90
AVG_LOGINS_PER_DAY_PER_USER = 3
ATTACK_PROBABILITY = 0.05  # 5% of logins are attacks
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "sample_logins.csv")
SEED = 42

# ── User Profiles ──────────────────────────────────────────────────────

USER_PROFILES = [
    # (username, country, city, device, browser, hour_start, hour_end, ip_prefix)
    ("alice.johnson", "US", "New York", "Windows", "Chrome", 8, 18, "192.168.1"),
    ("bob.smith", "US", "San Francisco", "Mac", "Safari", 9, 17, "10.0.1"),
    ("carol.davis", "NG", "Lagos", "Android", "Chrome", 7, 20, "41.203.1"),
    ("david.wilson", "UK", "London", "Windows", "Edge", 8, 18, "86.134.1"),
    ("eva.martinez", "US", "Miami", "iPhone", "Safari", 9, 22, "172.16.1"),
    ("frank.thompson", "DE", "Berlin", "Linux", "Firefox", 6, 16, "89.15.1"),
    ("grace.lee", "BR", "Sao Paulo", "Android", "Chrome", 8, 23, "177.54.1"),
    ("henry.brown", "IN", "Mumbai", "Windows", "Chrome", 7, 19, "103.235.1"),
    ("iris.nguyen", "JP", "Tokyo", "Mac", "Safari", 9, 21, "126.73.1"),
    ("jack.taylor", "US", "Chicago", "Windows", "Firefox", 8, 17, "68.45.1"),
    ("karen.white", "NG", "Abuja", "Android", "Chrome", 7, 18, "41.204.1"),
    ("leo.garcia", "ES", "Madrid", "Mac", "Safari", 9, 19, "80.28.1"),
    ("maria.pereira", "PT", "Lisbon", "Windows", "Chrome", 8, 18, "85.247.1"),
    ("nathan.kim", "KR", "Seoul", "Android", "Chrome", 8, 23, "211.234.1"),
    ("olivia.mueller", "DE", "Munich", "Mac", "Safari", 8, 17, "84.135.1"),
]

DEVICES = ["Windows", "Mac", "Linux", "iPhone", "Android", "iPad"]
BROWSERS = ["Chrome", "Safari", "Firefox", "Edge"]

COUNTRY_CITIES = {
    "US": ["New York", "San Francisco", "Chicago", "Miami", "Seattle", "Austin"],
    "NG": ["Lagos", "Abuja", "Port Harcourt", "Ibadan"],
    "UK": ["London", "Manchester", "Birmingham", "Edinburgh"],
    "DE": ["Berlin", "Munich", "Hamburg", "Frankfurt"],
    "BR": ["Sao Paulo", "Rio de Janeiro", "Brasilia"],
    "IN": ["Mumbai", "Delhi", "Bangalore", "Hyderabad"],
    "JP": ["Tokyo", "Osaka", "Kyoto"],
    "ES": ["Madrid", "Barcelona", "Valencia"],
    "PT": ["Lisbon", "Porto"],
    "KR": ["Seoul", "Busan"],
}


def distance_km(country1: str, country2: str) -> float:
    """Approximate distance between country centroids in km."""
    coords = {
        "US": (37.0, -95.0), "NG": (9.0, 8.0), "UK": (55.0, -3.0),
        "DE": (51.0, 10.0), "BR": (-14.0, -51.0), "IN": (20.0, 77.0),
        "JP": (36.0, 138.0), "ES": (40.0, -3.0), "PT": (39.0, -8.0),
        "KR": (35.0, 128.0),
    }
    c1 = coords.get(country1, (0, 0))
    c2 = coords.get(country2, (0, 0))
    # Rough Euclidean approximation (1 degree ~ 111km)
    return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5 * 111


def generate() -> None:
    rng = np.random.default_rng(SEED)
    py_rng = Random(SEED)

    base_date = datetime(2026, 7, 31) - timedelta(days=DAYS_OF_HISTORY)
    rows: list[dict] = []

    for user_idx in range(NUM_USERS):
        profile = USER_PROFILES[user_idx % len(USER_PROFILES)]
        username, country, city, device, browser, h_start, h_end, ip_prefix = profile

        # Track user state for attack injection
        last_login_time: datetime | None = None
        last_country = country
        recent_failures = 0
        recent_failure_times: list[datetime] = []

        for day in range(DAYS_OF_HISTORY):
            day_start = base_date + timedelta(days=day)
            daily_logins = max(1, int(rng.normal(AVG_LOGINS_PER_DAY_PER_USER, 1)))

            for _ in range(daily_logins):
                is_attack = rng.random() < ATTACK_PROBABILITY

                if is_attack:
                    attack_type = rng.choice(["brute_force", "impossible_travel", "credential_stuffing", "odd_hour_new_device"])
                    if attack_type == "brute_force":
                        attack_rows = _generate_brute_force_burst(py_rng, rng, username, profile, day_start)
                        for row in attack_rows:
                            row["is_attack"] = True
                            row["attack_type"] = attack_type
                            rows.append(row)
                    else:
                        attack_row = _generate_attack(rng, py_rng, username, profile, day_start, last_login_time, last_country, attack_type)
                        attack_row["is_attack"] = True
                        attack_row["attack_type"] = attack_type
                        rows.append(attack_row)
                        attack_rows = [attack_row]

                    last_row = attack_rows[-1]
                    last_login_time = datetime.fromisoformat(last_row["timestamp"])
                    last_country = last_row["country"]
                else:
                    hour = py_rng.randint(h_start, h_end)
                    minute = py_rng.randint(0, 59)
                    timestamp = day_start.replace(hour=hour, minute=minute, second=py_rng.randint(0, 59))

                    success = rng.random() > 0.08  # 92% success rate

                    row = {
                        "username": username,
                        "timestamp": timestamp.isoformat(),
                        "ip": f"{ip_prefix}.{py_rng.randint(2, 254)}",
                        "country": country,
                        "city": city,
                        "device": device,
                        "browser": browser,
                        "success": str(success),
                        "is_attack": False,
                        "attack_type": "",
                    }

                    last_login_time = timestamp
                    last_country = country

                    if not success:
                        recent_failures += 1
                        recent_failure_times.append(timestamp)
                        # Prune old failures (>30 min)
                        recent_failure_times = [t for t in recent_failure_times if timestamp - t < timedelta(minutes=30)]
                    else:
                        recent_failures = 0

                rows.append(row)

    # Write CSV
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "username", "timestamp", "ip", "country", "city",
            "device", "browser", "success", "is_attack", "attack_type",
        ])
        writer.writeheader()
        writer.writerows(rows)

    # Summary
    total = len(rows)
    attacks = [r for r in rows if r["is_attack"]]
    attack_types: dict[str, int] = {}
    for a in attacks:
        t = a["attack_type"]
        attack_types[t] = attack_types.get(t, 0) + 1

    print(f"Generated {total} login rows -> {OUTPUT_FILE}")
    print(f"  Normal:  {total - len(attacks)} ({100 - len(attacks) / total * 100:.1f}%)")
    print(f"  Attacks: {len(attacks)} ({len(attacks) / total * 100:.1f}%)")
    for at, count in sorted(attack_types.items()):
        print(f"    {at}: {count}")


def _generate_brute_force_burst(py_rng, rng, username, profile, day_start) -> list[dict]:
    _, country, city, device, browser, _, _, ip_prefix = profile
    burst_size = py_rng.randint(8, 20)
    start = day_start.replace(hour=py_rng.randint(0, 23), minute=py_rng.randint(0, 59))
    rows = []
    for i in range(burst_size):
        timestamp = start + timedelta(seconds=i * py_rng.randint(15, 45))
        is_success = rng.random() < 0.08  # Most attempts fail
        rows.append({
            "username": username,
            "timestamp": timestamp.isoformat(),
            "ip": f"{ip_prefix}.{py_rng.randint(2, 254)}",
            "country": country,
            "city": city,
            "device": device,
            "browser": browser,
            "success": str(is_success),
        })
    return rows


def _generate_attack(
    rng, py_rng, username, profile, day_start, last_login_time, last_country, attack_type
) -> dict:
    _, country, city, device, browser, _, _, ip_prefix = profile

    if attack_type == "impossible_travel":
        # Login from very distant country within a short time (1-4h of last login)
        far_countries = [c for c in COUNTRY_CITIES if c != country]
        far_country = py_rng.choice(far_countries)
        far_city = py_rng.choice(COUNTRY_CITIES[far_country])
        far_ip_prefix = {
            "US": "192.168.", "NG": "41.203.", "UK": "86.134.",
            "DE": "89.15.", "BR": "177.54.", "IN": "103.235.",
            "JP": "126.73.", "ES": "80.28.", "PT": "85.247.", "KR": "211.234.",
        }.get(far_country, "10.0.0")

        if last_login_time is not None:
            timestamp = last_login_time + timedelta(hours=py_rng.randint(1, 4), minutes=py_rng.randint(0, 59))
        else:
            timestamp = day_start.replace(hour=py_rng.randint(0, 23), minute=py_rng.randint(0, 59))
        return {
            "username": username,
            "timestamp": timestamp.isoformat(),
            "ip": f"{far_ip_prefix}.{py_rng.randint(2, 254)}",
            "country": far_country,
            "city": far_city,
            "device": device,
            "browser": browser,
            "success": "True",
            "is_attack": True,
            "attack_type": "impossible_travel",
        }

    elif attack_type == "credential_stuffing":
        # Same IP, different usernames (we just mark individual row)
        timestamp = day_start.replace(hour=py_rng.randint(0, 23), minute=py_rng.randint(0, 59))
        return {
            "username": username,
            "timestamp": timestamp.isoformat(),
            "ip": f"185.220.101.{py_rng.randint(2, 254)}",  # Known proxy range
            "country": "RU",
            "city": "Moscow",
            "device": "Windows",
            "browser": "Chrome",
            "success": str(rng.random() < 0.1),
            "is_attack": True,
            "attack_type": "credential_stuffing",
        }

    elif attack_type == "odd_hour_new_device":
        # 3am from unknown device
        timestamp = day_start.replace(hour=py_rng.randint(1, 4), minute=py_rng.randint(0, 59))
        new_device = py_rng.choice([d for d in DEVICES if d != device])
        new_browser = py_rng.choice([b for b in BROWSERS if b != browser])
        return {
            "username": username,
            "timestamp": timestamp.isoformat(),
            "ip": f"{ip_prefix}.{py_rng.randint(200, 254)}",
            "country": country,
            "city": city,
            "device": new_device,
            "browser": new_browser,
            "success": "True",
            "is_attack": True,
            "attack_type": "odd_hour_new_device",
        }

    # Fallback: normal login
    hour = py_rng.randint(8, 18)
    timestamp = day_start.replace(hour=hour, minute=py_rng.randint(0, 59))
    return {
        "username": username,
        "timestamp": timestamp.isoformat(),
        "ip": f"{ip_prefix}.{py_rng.randint(2, 254)}",
        "country": country,
        "city": city,
        "device": device,
        "browser": browser,
        "success": "True",
        "is_attack": False,
        "attack_type": "",
    }


if __name__ == "__main__":
    generate()
