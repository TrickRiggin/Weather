#!/usr/bin/env python3
"""
calibrate.py — Historical verification & city-specific sigma calibration

Pulls actual temps (OpenMeteo Archive API, 2 years) and historical model forecasts
(OpenMeteo Previous Runs API, Jan 2024+), computes forecast error distributions
per city/type/month, outputs data/city_sigma.json for use by refresh_weather.py.

Usage:
    python calibrate.py              # Full calibration (fetch + compute)
    python calibrate.py --report     # Just print stats from cached data
    python calibrate.py --fetch-only # Just fetch and cache raw data
"""

import json
import math
import os
import statistics
import sys
import time
import requests
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"

# Import city definitions from main pipeline
from refresh_weather import CITIES, WEATHER_MODELS, SIGMA_FLOOR

DATA_DIR = Path(__file__).parent / "data" / "calibration"
OUTPUT_FILE = Path(__file__).parent / "data" / "city_sigma.json"

# How far back to pull data
ACTUAL_LOOKBACK_DAYS = 730   # 2 years of actuals
FORECAST_LOOKBACK_DAYS = 365  # ~1 year of model forecasts (API has data from Jan 2024)

# Chunk size for Previous Runs API (avoid timeouts on large ranges)
FORECAST_CHUNK_DAYS = 90


# ── Helpers ─────────────────────────────────────────────────────

def api_key():
    return os.environ.get("OPENMETEO_API_KEY", "")


def norm_cdf(x):
    """Standard normal CDF (same as in refresh_weather.py)."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def percentile(data, p):
    """Simple percentile calculation."""
    if not data:
        return None
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * p / 100
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_data[int(k)]
    return sorted_data[f] * (c - k) + sorted_data[c] * (k - f)


# ── Phase 1: Fetch Actual Temps ─────────────────────────────────

def fetch_actuals():
    """Pull 2 years of actual daily high/low from OpenMeteo Archive API."""
    print("\n=== PHASE 1: FETCHING ACTUAL TEMPS (Archive API) ===\n")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    cache_file = DATA_DIR / "actuals.json"
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < 24:
            print(f"  Using cached actuals ({age_hours:.1f}h old)")
            return json.loads(cache_file.read_text(encoding="utf-8"))

    end_date = date.today() - timedelta(days=1)  # Yesterday (today may be incomplete)
    start_date = end_date - timedelta(days=ACTUAL_LOOKBACK_DAYS)

    city_codes = list(CITIES.keys())
    lats = ",".join(str(CITIES[c]["lat"]) for c in city_codes)
    lons = ",".join(str(CITIES[c]["lon"]) for c in city_codes)

    # NOTE: Don't send API key — archive/previous-runs endpoints return 403 with
    # forecast-tier keys. Free tier works fine with rate limits.
    params = {
        "latitude": lats,
        "longitude": lons,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "daily": "temperature_2m_max,temperature_2m_min",
        "temperature_unit": "fahrenheit",
        "timezone": "auto",
    }

    print(f"  Fetching {start_date} to {end_date} ({ACTUAL_LOOKBACK_DAYS} days) for {len(city_codes)} cities...")

    try:
        resp = requests.get(ARCHIVE_URL, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"  ERROR: {e}")
        return {}

    if not isinstance(data, list):
        data = [data]

    actuals = {}
    for i, city_code in enumerate(city_codes):
        city_data = data[i] if i < len(data) else None
        if not city_data:
            print(f"  {city_code}: no data")
            continue

        daily = city_data.get("daily", {})
        dates = daily.get("time", [])
        highs = daily.get("temperature_2m_max", [])
        lows = daily.get("temperature_2m_min", [])

        city_actuals = {}
        valid = 0
        for di, d in enumerate(dates):
            h = highs[di] if di < len(highs) else None
            l = lows[di] if di < len(lows) else None
            if h is not None and l is not None:
                city_actuals[d] = {"high": round(h, 1), "low": round(l, 1)}
                valid += 1

        actuals[city_code] = city_actuals
        print(f"  {city_code} ({CITIES[city_code]['name']}): {valid} days of data")

    # Cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(actuals, indent=2), encoding="utf-8")
    print(f"\n  Cached to {cache_file}")

    return actuals


# ── Phase 2: Fetch Historical Forecasts ─────────────────────────

def fetch_historical_forecasts():
    """
    Pull historical model forecasts from OpenMeteo Previous Runs API.
    Returns: {city: {date: {model: {high, low}}}}
    """
    print("\n=== PHASE 2: FETCHING HISTORICAL FORECASTS (Previous Runs API) ===\n")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    cache_file = DATA_DIR / "forecasts.json"
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < 24:
            print(f"  Using cached forecasts ({age_hours:.1f}h old)")
            return json.loads(cache_file.read_text(encoding="utf-8"))

    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=FORECAST_LOOKBACK_DAYS)

    # Previous Runs API: per city in chunks (rate-limited, no multi-location)
    all_forecasts = {}

    for city_code, city_info in CITIES.items():
        city_forecasts = {}
        chunk_start = start_date

        while chunk_start < end_date:
            chunk_end = min(chunk_start + timedelta(days=FORECAST_CHUNK_DAYS), end_date)

            params = {
                "latitude": city_info["lat"],
                "longitude": city_info["lon"],
                "start_date": chunk_start.isoformat(),
                "end_date": chunk_end.isoformat(),
                "daily": "temperature_2m_max,temperature_2m_min",
                "models": ",".join(WEATHER_MODELS),
                "temperature_unit": "fahrenheit",
                "timezone": "auto",
            }

            try:
                resp = requests.get(PREVIOUS_RUNS_URL, params=params, timeout=60)
                resp.raise_for_status()
                data = resp.json()

                daily = data.get("daily", {})
                dates = daily.get("time", [])

                for di, d in enumerate(dates):
                    day_models = {}
                    for model in WEATHER_MODELS:
                        suffix = f"_{model}"
                        high_key = f"temperature_2m_max{suffix}"
                        low_key = f"temperature_2m_min{suffix}"

                        h = daily.get(high_key, [None] * len(dates))[di]
                        l = daily.get(low_key, [None] * len(dates))[di]

                        if h is not None:
                            day_models[model] = {
                                "high": round(h, 1),
                                "low": round(l, 1) if l is not None else None,
                            }

                    if day_models:
                        city_forecasts[d] = day_models

            except Exception as e:
                print(f"  {city_code} {chunk_start}..{chunk_end}: ERROR {e}")

            chunk_start = chunk_end + timedelta(days=1)
            time.sleep(0.3)  # Rate limiting

        all_forecasts[city_code] = city_forecasts
        days_with_data = len(city_forecasts)
        print(f"  {city_code} ({city_info['name']}): {days_with_data} days of forecast data")

    # Cache
    cache_file.write_text(json.dumps(all_forecasts, indent=2), encoding="utf-8")
    print(f"\n  Cached to {cache_file}")

    return all_forecasts


# ── Phase 3: Compute Forecast Errors & City-Specific Sigmas ────

def compute_sigmas(actuals, forecasts):
    """
    Compare forecast vs actual, compute city/type/month-specific sigma.
    Returns: {city: {type: {month: sigma}}}
    """
    print("\n=== PHASE 3: COMPUTING FORECAST ERRORS ===\n")

    # Collect forecast errors: {(city, type, month): [errors]}
    errors = defaultdict(list)
    # Also collect per-model errors for diagnostics
    model_errors = defaultdict(list)

    matched = 0
    unmatched = 0

    for city_code in CITIES:
        city_actuals = actuals.get(city_code, {})
        city_forecasts = forecasts.get(city_code, {})

        for date_str, models in city_forecasts.items():
            actual = city_actuals.get(date_str)
            if not actual:
                unmatched += 1
                continue

            # Parse month from date
            try:
                month = int(date_str.split("-")[1])
            except (IndexError, ValueError):
                continue

            for mtype in ["high", "low"]:
                actual_temp = actual.get(mtype)
                if actual_temp is None:
                    continue

                # Compute weighted ensemble mean (same as main pipeline day-0 weights)
                weights = {"ncep_hrrr_conus": 2.0, "ncep_nbm_conus": 1.0, "ecmwf_ifs025": 0.5}
                total_w, total_v = 0, 0
                for model, mdata in models.items():
                    temp = mdata.get(mtype)
                    if temp is not None:
                        w = weights.get(model, 0.5)
                        total_v += temp * w
                        total_w += w

                        # Per-model error
                        model_errors[(city_code, mtype, model)].append(temp - actual_temp)

                if total_w > 0:
                    ensemble_mean = total_v / total_w
                    error = ensemble_mean - actual_temp
                    errors[(city_code, mtype, month)].append(error)
                    matched += 1

    print(f"  Matched forecast-vs-actual pairs: {matched}")
    print(f"  Unmatched (no actual for forecast date): {unmatched}")

    if matched == 0:
        print("  No forecast verification data available!")
        print("  Falling back to climatological variability from actuals...")
        return compute_sigmas_from_actuals(actuals)

    # ── Compute sigma per city/type/month ──

    city_sigma = {}
    all_errors_flat = []

    for city_code in CITIES:
        city_sigma[city_code] = {"high": {}, "low": {}}

        for mtype in ["high", "low"]:
            for month in range(1, 13):
                key = (city_code, mtype, month)
                errs = errors.get(key, [])

                if len(errs) >= 10:
                    # Enough data: use actual forecast error std + fat-tail adjustment
                    sigma_raw = statistics.stdev(errs)
                    bias = statistics.mean(errs)
                    mae = statistics.mean(abs(e) for e in errs)
                    # P95 of absolute errors: if fatter tails than normal, P95/1.96 > sigma
                    abs_sorted = sorted(abs(e) for e in errs)
                    p95 = abs_sorted[min(int(len(abs_sorted) * 0.95), len(abs_sorted) - 1)]
                    # Take the max of raw sigma and fat-tail-adjusted sigma
                    sigma = max(sigma_raw, p95 / 1.96)
                    all_errors_flat.extend(errs)
                elif len(errs) >= 3:
                    # Sparse: use MAE-based estimate (more robust for small N)
                    mae = statistics.mean(abs(e) for e in errs)
                    sigma = mae / 0.798  # MAE-to-sigma conversion for normal dist
                    bias = statistics.mean(errs)
                    p95 = None
                    all_errors_flat.extend(errs)
                else:
                    # Not enough data for this specific month — pool nearby months
                    pooled = []
                    for m_offset in range(-2, 3):
                        m = ((month - 1 + m_offset) % 12) + 1
                        pooled.extend(errors.get((city_code, mtype, m), []))

                    if len(pooled) >= 5:
                        sigma = statistics.stdev(pooled) if len(pooled) > 1 else SIGMA_FLOOR
                        bias = statistics.mean(pooled)
                        mae = statistics.mean(abs(e) for e in pooled)
                    else:
                        sigma = SIGMA_FLOOR
                        bias = 0
                        mae = SIGMA_FLOOR * 0.798
                    p95 = None

                # Floor: even PHX can surprise by ~1.5F
                sigma = max(sigma, 1.5)

                city_sigma[city_code][mtype][str(month)] = {
                    "sigma": round(sigma, 2),
                    "bias": round(bias, 2),
                    "mae": round(mae, 2),
                    "n": len(errs),
                }

    # ── Global stats ──

    if all_errors_flat:
        global_std = statistics.stdev(all_errors_flat)
        global_mae = statistics.mean(abs(e) for e in all_errors_flat)
        global_bias = statistics.mean(all_errors_flat)
        print(f"\n  Global forecast error stats ({len(all_errors_flat)} samples):")
        print(f"    Bias:  {global_bias:+.2f}F")
        print(f"    MAE:   {global_mae:.2f}F")
        print(f"    Sigma: {global_std:.2f}F")
        print(f"    Current SIGMA_FLOOR: {SIGMA_FLOOR}F")

    # ── Per-model stats ──

    print(f"\n  Per-model forecast errors:")
    for model in WEATHER_MODELS:
        model_errs = []
        for key, errs in model_errors.items():
            if key[2] == model:
                model_errs.extend(errs)
        if model_errs:
            m_bias = statistics.mean(model_errs)
            m_mae = statistics.mean(abs(e) for e in model_errs)
            m_std = statistics.stdev(model_errs) if len(model_errs) > 1 else 0
            print(f"    {model:>20}: bias={m_bias:+.2f}F  MAE={m_mae:.2f}F  "
                  f"sigma={m_std:.2f}F  (n={len(model_errs)})")

    return city_sigma


def compute_sigmas_from_actuals(actuals):
    """
    Fallback: estimate sigma from temperature variability in actuals.
    Uses day-to-day temperature change std as a proxy for forecast uncertainty.
    """
    print("\n  Computing sigma from climatological variability (fallback)...")

    city_sigma = {}

    for city_code in CITIES:
        city_sigma[city_code] = {"high": {}, "low": {}}
        city_actuals = actuals.get(city_code, {})

        # Group by month
        monthly = defaultdict(lambda: {"high": [], "low": []})
        sorted_dates = sorted(city_actuals.keys())

        for d in sorted_dates:
            try:
                month = int(d.split("-")[1])
            except (IndexError, ValueError):
                continue
            for mtype in ["high", "low"]:
                val = city_actuals[d].get(mtype)
                if val is not None:
                    monthly[month][mtype].append(val)

        for month in range(1, 13):
            for mtype in ["high", "low"]:
                temps = monthly[month][mtype]
                if len(temps) >= 10:
                    # Day-to-day change variability
                    changes = [temps[i+1] - temps[i] for i in range(len(temps)-1)]
                    # Forecast error ~ day-to-day variability / sqrt(2)
                    # (since consecutive days are partially correlated)
                    change_std = statistics.stdev(changes)
                    sigma = max(change_std / math.sqrt(2), 2.0)
                    bias = 0  # Can't estimate bias without forecasts
                    mae = sigma * 0.798
                else:
                    sigma = SIGMA_FLOOR
                    bias = 0
                    mae = SIGMA_FLOOR * 0.798

                city_sigma[city_code][mtype][str(month)] = {
                    "sigma": round(sigma, 2),
                    "bias": round(bias, 2),
                    "mae": round(mae, 2),
                    "n": len(temps),
                    "source": "climatological",
                }

    return city_sigma


# ── Output & Report ─────────────────────────────────────────────

def save_sigmas(city_sigma):
    """Save city_sigma.json for the main pipeline."""
    OUTPUT_FILE.write_text(json.dumps(city_sigma, indent=2), encoding="utf-8")
    print(f"\n  Saved to {OUTPUT_FILE}")


def print_report(city_sigma):
    """Print a human-readable calibration report."""
    print(f"""
{'=' * 75}
  CALIBRATION REPORT — City-Specific Sigma Values
{'=' * 75}
""")

    # Current month for highlighting
    current_month = date.today().month
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    for city_code in sorted(CITIES.keys()):
        city_data = city_sigma.get(city_code, {})
        print(f"  {city_code} ({CITIES[city_code]['name']})")
        print(f"  {'─' * 65}")

        for mtype in ["high", "low"]:
            type_data = city_data.get(mtype, {})
            # Current month sigma
            cur = type_data.get(str(current_month), {})
            cur_sigma = cur.get("sigma", SIGMA_FLOOR)
            cur_bias = cur.get("bias", 0)
            cur_n = cur.get("n", 0)

            # Annual range
            sigmas = [v["sigma"] for v in type_data.values() if isinstance(v, dict)]
            if sigmas:
                min_s, max_s = min(sigmas), max(sigmas)
                avg_s = statistics.mean(sigmas)
            else:
                min_s = max_s = avg_s = SIGMA_FLOOR

            marker = " <-- current" if cur_n >= 5 else " <-- current (low data)"
            print(f"    {mtype:>4}: now={cur_sigma:.1f}F (bias={cur_bias:+.1f}F, n={cur_n}){marker}")
            print(f"          range={min_s:.1f}-{max_s:.1f}F  avg={avg_s:.1f}F")

        # Season detail for current +/- 1 month
        print(f"\n    Monthly detail ({month_names[current_month]} window):")
        for mtype in ["high", "low"]:
            type_data = city_data.get(mtype, {})
            row = f"      {mtype:>4}: "
            for m_offset in range(-1, 2):
                m = ((current_month - 1 + m_offset) % 12) + 1
                md = type_data.get(str(m), {})
                s = md.get("sigma", SIGMA_FLOOR)
                n = md.get("n", 0)
                row += f"{month_names[m]}={s:.1f}F(n={n})  "
            print(row)

        print()

    # ── Comparison table: old vs new ──
    print(f"\n  {'─' * 75}")
    print(f"  SIGMA COMPARISON: Global Floor ({SIGMA_FLOOR}F) vs Calibrated")
    print(f"  {'─' * 75}")
    print(f"  {'City':>4} {'Type':>4} {'Old':>6} {'New':>6} {'Delta':>7} {'Verdict':>12}")
    print(f"  {'─' * 75}")

    for city_code in sorted(CITIES.keys()):
        for mtype in ["high", "low"]:
            cur = city_sigma.get(city_code, {}).get(mtype, {}).get(str(current_month), {})
            new_sigma = cur.get("sigma", SIGMA_FLOOR)
            delta = new_sigma - SIGMA_FLOOR
            if delta < -0.5:
                verdict = "TIGHTER"
            elif delta > 0.5:
                verdict = "WIDER"
            else:
                verdict = "~same"
            print(f"  {city_code:>4} {mtype:>4} {SIGMA_FLOOR:>5.1f}F {new_sigma:>5.1f}F {delta:>+6.1f}F {verdict:>12}")

    print(f"\n{'=' * 75}")


# ── Main ────────────────────────────────────────────────────────

def main():
    report_only = "--report" in sys.argv
    fetch_only = "--fetch-only" in sys.argv

    if report_only:
        if OUTPUT_FILE.exists():
            city_sigma = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            print_report(city_sigma)
        else:
            print("No calibration data yet. Run without --report first.")
        return

    # Fetch data
    actuals = fetch_actuals()
    forecasts = fetch_historical_forecasts()

    if fetch_only:
        print("\n  Data fetched and cached. Run without --fetch-only to compute sigmas.")
        return

    # Compute
    city_sigma = compute_sigmas(actuals, forecasts)

    # Save & report
    save_sigmas(city_sigma)
    print_report(city_sigma)


if __name__ == "__main__":
    main()
