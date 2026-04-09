#!/usr/bin/env python3
"""
Weather Edge — Multi-model ensemble weather prediction pipeline.
Fetches forecasts from 3 weather models (HRRR, NBM, ECMWF) via OpenMeteo,
compares against Kalshi weather market pricing to find edges.
"""

import json, os, sys, time, math, requests, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# ============================================================
#  CONSTANTS
# ============================================================

OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"

WEATHER_MODELS = [
    "ncep_hrrr_conus",     # HRRR (3km, hourly, CONUS, ~48h) — best short-range
    "ncep_nbm_conus",      # NBM (2.5km, CONUS) — already blends 31 models w/ bias correction
    "ecmwf_ifs025",        # ECMWF IFS (14km, global) — best global model, adds value day 2+
    # Dropped: GFS (redundant, NBM already includes it bias-corrected),
    #          ICON (Europe-optimized), GEM (Canada-optimized), JMA (55km, noise)
]

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"

# 10 high-volume Kalshi weather cities
# Format: (display_name, lat, lon, kalshi_high_ticker, kalshi_low_ticker, timezone)
CITIES = {
    "NYC":   {"name": "New York",      "lat": 40.7128, "lon": -74.0060, "high": "KXHIGHNY",    "low": "KXLOWTNYC",   "tz": "America/New_York"},
    "LAX":   {"name": "Los Angeles",   "lat": 33.9425, "lon": -118.408, "high": "KXHIGHLAX",   "low": "KXLOWTLAX",   "tz": "America/Los_Angeles"},
    "CHI":   {"name": "Chicago",       "lat": 41.8781, "lon": -87.6298, "high": "KXHIGHCHI",   "low": "KXLOWTCHI",   "tz": "America/Chicago"},
    "MIA":   {"name": "Miami",         "lat": 25.7617, "lon": -80.1918, "high": "KXHIGHMIA",   "low": "KXLOWTMIA",   "tz": "America/New_York"},
    "DAL":   {"name": "Dallas",        "lat": 32.8998, "lon": -97.0403, "high": "KXHIGHTDAL",  "low": "KXLOWTDAL",   "tz": "America/Chicago"},
    "DEN":   {"name": "Denver",        "lat": 39.8561, "lon": -104.674, "high": "KXHIGHDEN",   "low": "KXLOWTDEN",   "tz": "America/Denver"},
    "PHI":   {"name": "Philadelphia",  "lat": 39.8744, "lon": -75.2424, "high": "KXHIGHPHIL",  "low": "KXLOWTPHIL",  "tz": "America/New_York"},
    "ATL":   {"name": "Atlanta",       "lat": 33.6407, "lon": -84.4277, "high": "KXHIGHTATL",  "low": "KXLOWTATL",   "tz": "America/New_York"},
    "HOU":   {"name": "Houston",       "lat": 29.9844, "lon": -95.3414, "high": "KXHIGHTHOU",  "low": "KXLOWTHOU",   "tz": "America/Chicago"},
    "PHX":   {"name": "Phoenix",       "lat": 33.4373, "lon": -112.008, "high": "KXHIGHTPHX",  "low": "KXLOWTPHX",   "tz": "America/Phoenix"},
}

# Sigma: city-specific from calibration data, with global fallback
# calibrate.py generates data/city_sigma.json with per-city/type/month sigma + bias
SIGMA_FLOOR = 3.0  # Global fallback when no calibration data (conservative default)
SIGMA_INFLATION = 1.3  # Inflate calibrated sigma to account for operational vs ideal conditions
SIGMA_MIN = 1.5  # Absolute minimum sigma (even PHX can surprise)

def _load_calibration():
    """Load city-specific sigma + bias from calibration data."""
    cal_file = Path(__file__).parent / "data" / "city_sigma.json"
    if cal_file.exists():
        return json.loads(cal_file.read_text(encoding="utf-8"))
    return None

CITY_SIGMA = _load_calibration()

# Edge threshold for signals
EDGE_THRESHOLD = 0.12  # 12% edge minimum — raised from 5% (too loose, was finding noise)
MAX_DISAGREEMENT = 0.20  # Kill switch: if |model - market| > 20%, it's a model failure, not alpha

# ============================================================
#  HELPERS
# ============================================================

def get_calibration(city_code, mtype, date_str):
    """Look up city/type/month-specific sigma and bias from calibration data.
    Returns (sigma, bias). Falls back to SIGMA_FLOOR if no data."""
    if CITY_SIGMA is None:
        return SIGMA_FLOOR, 0.0
    city_cal = CITY_SIGMA.get(city_code, {}).get(mtype, {})
    try:
        month = str(int(date_str.split("-")[1]))
    except (IndexError, ValueError):
        return SIGMA_FLOOR, 0.0
    month_cal = city_cal.get(month, {})
    if not month_cal:
        return SIGMA_FLOOR, 0.0
    raw_sigma = month_cal.get("sigma", SIGMA_FLOOR)
    bias = month_cal.get("bias", 0.0)
    sigma = max(raw_sigma * SIGMA_INFLATION, SIGMA_MIN)
    return sigma, bias


def norm_cdf(x):
    """Standard normal CDF approximation."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


# KDE bandwidth for "between" contract probability — represents typical per-model forecast error
KDE_BANDWIDTH = 2.0  # degrees F


def model_kde_prob(model_temps, floor, cap, bandwidth=KDE_BANDWIDTH):
    """
    Probability of temp falling in [floor, cap) using Kernel Density Estimation.
    Places a gaussian kernel (bandwidth wide) around each model's prediction and
    integrates over the bucket. This respects model clustering — if 5/7 models
    predict 57-58F, the bucket gets ~70% probability instead of the ~11% that
    the ensemble gaussian gives.
    """
    if not model_temps:
        return 0.5
    total = 0
    for t in model_temps:
        total += norm_cdf((cap - t) / bandwidth) - norm_cdf((floor - t) / bandwidth)
    return total / len(model_temps)


def load_env():
    """Load API keys from ~/AI Stuff/keys.env if not in environment."""
    env_path = Path.home() / "AI Stuff" / "keys.env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                # Map keys.env names to expected env var names
                mapping = {
                    "Openrouter": "OPENROUTER_API_KEY",
                    "KenPom": "KENPOM_API_KEY",
                    "OpenMeteo": "OPENMETEO_API_KEY",
                }
                env_name = mapping.get(key, key)
                if env_name not in os.environ:
                    os.environ[env_name] = val


# ============================================================
#  OPENMETEO — MULTI-MODEL FORECASTS
# ============================================================

def fetch_forecasts(cities=CITIES, models=WEATHER_MODELS, forecast_days=3):
    """
    Fetch multi-model temperature forecasts for all cities.
    Returns: {city_code: {date: {model: {high, low, hourly: [(hour, temp)]}}}}
    """
    print("\n=== FETCHING OPENMETEO MULTI-MODEL FORECASTS ===\n")

    all_forecasts = {}
    city_codes = list(cities.keys())

    # Batch all cities in one request (OpenMeteo supports multi-location)
    lats = ",".join(str(cities[c]["lat"]) for c in city_codes)
    lons = ",".join(str(cities[c]["lon"]) for c in city_codes)
    model_str = ",".join(models)

    params = {
        "latitude": lats,
        "longitude": lons,
        "daily": "temperature_2m_max,temperature_2m_min",
        "hourly": "temperature_2m",
        "models": model_str,
        "temperature_unit": "fahrenheit",
        "timezone": "auto",
        "forecast_days": forecast_days,
    }

    # Add paid API key if available
    api_key = os.environ.get("OPENMETEO_API_KEY", "")
    if api_key:
        params["apikey"] = api_key

    try:
        resp = requests.get(OPENMETEO_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"  ERROR fetching OpenMeteo: {e}")
        return {}

    # Multi-location returns array
    if not isinstance(data, list):
        data = [data]

    for i, city_code in enumerate(city_codes):
        city_data = data[i] if i < len(data) else None
        if not city_data:
            print(f"  {city_code}: no data")
            continue

        city_forecasts = {}
        daily = city_data.get("daily", {})
        hourly = city_data.get("hourly", {})
        dates = daily.get("time", [])

        for di, date_str in enumerate(dates):
            day_models = {}

            for model in models:
                suffix = f"_{model}"
                high_key = f"temperature_2m_max{suffix}"
                low_key = f"temperature_2m_min{suffix}"

                high_val = daily.get(high_key, [None] * len(dates))[di]
                low_val = daily.get(low_key, [None] * len(dates))[di]

                # Hourly temps for this model on this date
                hourly_key = f"temperature_2m{suffix}"
                hourly_temps = hourly.get(hourly_key, [])
                hourly_times = hourly.get("time", [])

                day_hourly = []
                for hi, ht in enumerate(hourly_times):
                    if ht.startswith(date_str) and hi < len(hourly_temps):
                        temp = hourly_temps[hi]
                        if temp is not None:
                            day_hourly.append((ht, temp))

                if high_val is not None:
                    day_models[model] = {
                        "high": round(high_val, 1),
                        "low": round(low_val, 1) if low_val else None,
                        "hourly": day_hourly,
                    }

            if day_models:
                city_forecasts[date_str] = day_models

        all_forecasts[city_code] = city_forecasts
        model_count = max(len(v) for v in city_forecasts.values()) if city_forecasts else 0
        print(f"  {city_code} ({cities[city_code]['name']}): {len(city_forecasts)} days, {model_count} models")

    print(f"\n  Total: {len(all_forecasts)} cities fetched")
    return all_forecasts


# ============================================================
#  ENSEMBLE — PROBABILITY DISTRIBUTION
# ============================================================

def build_ensemble(forecasts):
    """
    Build ensemble statistics from multi-model forecasts.
    Returns: {city: {date: {high_mean, high_std, high_models: [...], low_mean, low_std, ...}}}
    """
    print("\n=== BUILDING ENSEMBLE DISTRIBUTIONS ===\n")

    ensembles = {}
    for city_code, city_data in forecasts.items():
        city_ensemble = {}
        for date_str, models in city_data.items():
            highs = [m["high"] for m in models.values() if m.get("high") is not None]
            lows = [m["low"] for m in models.values() if m.get("low") is not None]

            if len(highs) < 2:
                continue

            high_mean = sum(highs) / len(highs)
            high_std = max((sum((h - high_mean)**2 for h in highs) / (len(highs) - 1)) ** 0.5, SIGMA_FLOOR) if len(highs) > 1 else SIGMA_FLOOR

            low_mean = sum(lows) / len(lows) if lows else None
            low_std = max((sum((l - low_mean)**2 for l in lows) / (len(lows) - 1)) ** 0.5, SIGMA_FLOOR) if lows and len(lows) > 1 else SIGMA_FLOOR

            # Per-model breakdown for UI
            model_highs = {m: d["high"] for m, d in models.items() if d.get("high") is not None}
            model_lows = {m: d["low"] for m, d in models.items() if d.get("low") is not None}

            city_ensemble[date_str] = {
                "high_mean": round(high_mean, 1),
                "high_std": round(high_std, 2),
                "high_min": round(min(highs), 1),
                "high_max": round(max(highs), 1),
                "high_models": model_highs,
                "low_mean": round(low_mean, 1) if low_mean else None,
                "low_std": round(low_std, 2) if low_std else None,
                "low_models": model_lows,
                "model_count": len(highs),
            }

        ensembles[city_code] = city_ensemble
        if city_ensemble:
            sample = list(city_ensemble.values())[0]
            print(f"  {city_code}: {sample['model_count']} models, "
                  f"high {sample['high_mean']}F +/- {sample['high_std']}F, "
                  f"spread {sample['high_min']}-{sample['high_max']}F")

    return ensembles


# ============================================================
#  KALSHI — WEATHER MARKETS
# ============================================================

def fetch_kalshi_markets(cities=CITIES):
    """
    Fetch active Kalshi weather markets for all cities.
    Returns: {city_code: {date: {type: 'high'|'low', contracts: [...]}}}
    """
    print("\n=== FETCHING KALSHI WEATHER MARKETS ===\n")

    all_markets = {}
    series_tickers = []

    # Build list of series tickers to fetch
    for city_code, city in cities.items():
        series_tickers.append((city_code, "high", city["high"]))
        series_tickers.append((city_code, "low", city["low"]))

    for city_code, market_type, series_ticker in series_tickers:
        if city_code not in all_markets:
            all_markets[city_code] = {}

        try:
            events = _kalshi_paginate_events(series_ticker)
        except Exception as e:
            print(f"  {series_ticker}: ERROR {e}")
            continue

        for event in events:
            # Parse date from event ticker (e.g. KXHIGHLAX-26APR08)
            event_ticker = event.get("event_ticker", "")
            date_str = _parse_kalshi_date(event_ticker)
            if not date_str:
                continue

            contracts = []
            for market in event.get("markets", []):
                if market.get("status") != "active":
                    continue

                yes_bid = _parse_price(market.get("yes_bid_dollars") or market.get("yes_bid"))
                yes_ask = _parse_price(market.get("yes_ask_dollars") or market.get("yes_ask"))
                no_bid = _parse_price(market.get("no_bid_dollars") or market.get("no_bid"))
                no_ask = _parse_price(market.get("no_ask_dollars") or market.get("no_ask"))

                mid = (yes_bid + yes_ask) / 2 if yes_bid is not None and yes_ask is not None else None

                contracts.append({
                    "ticker": market.get("ticker", ""),
                    "title": market.get("title", ""),
                    "strike_type": market.get("strike_type", ""),
                    "floor_strike": market.get("floor_strike"),
                    "cap_strike": market.get("cap_strike"),
                    "yes_bid": yes_bid,
                    "yes_ask": yes_ask,
                    "no_bid": no_bid,
                    "no_ask": no_ask,
                    "mid": round(mid, 3) if mid else None,
                    "volume": _parse_price(market.get("volume_fp") or market.get("volume")),
                    "open_interest": _parse_price(market.get("open_interest_fp") or market.get("open_interest")),
                    "close_time": market.get("close_time"),
                })

            if contracts:
                key = f"{date_str}_{market_type}"
                all_markets[city_code][key] = {
                    "date": date_str,
                    "type": market_type,
                    "event_ticker": event_ticker,
                    "contracts": sorted(contracts, key=lambda c: c.get("floor_strike") or c.get("cap_strike") or 0),
                }

        time.sleep(0.5)  # Rate limit buffer

    # Summary
    total_contracts = sum(
        len(m["contracts"])
        for city in all_markets.values()
        for m in city.values()
    )
    total_events = sum(len(city) for city in all_markets.values())
    print(f"\n  Total: {total_events} events, {total_contracts} contracts across {len(all_markets)} cities")

    return all_markets


def _kalshi_paginate_events(series_ticker, limit=200):
    """Paginate through Kalshi events for a series ticker."""
    events = []
    cursor = None

    while True:
        params = {
            "series_ticker": series_ticker,
            "status": "open",
            "with_nested_markets": "true",
            "limit": limit,
        }
        if cursor:
            params["cursor"] = cursor

        resp = requests.get(f"{KALSHI_BASE}/events", params=params, timeout=15)
        if resp.status_code == 404:
            return events
        resp.raise_for_status()
        data = resp.json()

        events.extend(data.get("events", []))

        cursor = data.get("cursor")
        if not cursor or not data.get("events"):
            break
        time.sleep(0.3)

    return events


def _parse_kalshi_date(event_ticker):
    """Parse date from event ticker like KXHIGHLAX-26APR08 -> 2026-04-08."""
    parts = event_ticker.split("-")
    if len(parts) < 2:
        return None
    date_part = parts[1]  # e.g. 26APR08
    try:
        dt = datetime.strptime(date_part, "%y%b%d")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_price(val):
    """Parse Kalshi price field (string or number) to float."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


# ============================================================
#  EDGE CALCULATION
# ============================================================

def calculate_edges(ensembles, markets, pace_data=None):
    """
    Compare ensemble probabilities against Kalshi market prices.
    Uses pace-adjusted forecasts for same-day highs and horizon-based
    model weighting (HRRR dominant day 0, NBM/ECMWF for day 2+).
    Returns: [{city, date, type, contract_ticker, threshold, our_prob, market_prob, edge, signal}]
    """
    print("\n=== CALCULATING EDGES ===\n")

    pace_data = pace_data or {}

    # Determine today's local date per city
    now_utc = datetime.now(timezone.utc)
    city_today = {}
    for city_code, city in CITIES.items():
        local_now = now_utc.astimezone(ZoneInfo(city["tz"]))
        city_today[city_code] = local_now.strftime("%Y-%m-%d")

    # Model weights by days-ahead horizon
    # Day 0: HRRR is king (3km, hourly updates, pace-corrected)
    # Day 1: balanced, NBM slight lead (it already blends intelligently)
    # Day 2+: HRRR nulls out, NBM and ECMWF carry
    HORIZON_WEIGHTS = {
        0: {"ncep_hrrr_conus": 2.0, "ncep_nbm_conus": 1.0, "ecmwf_ifs025": 0.5},
        1: {"ncep_hrrr_conus": 1.0, "ncep_nbm_conus": 1.2, "ecmwf_ifs025": 0.8},
    }
    DEFAULT_WEIGHTS = {"ncep_nbm_conus": 1.2, "ecmwf_ifs025": 1.0}

    def horizon_weighted_mean(model_temps, horizon):
        """Compute horizon-weighted mean from {model_key: temp} dict."""
        weights = HORIZON_WEIGHTS.get(min(horizon, 1), DEFAULT_WEIGHTS)
        total_w, total_v = 0, 0
        for model, temp in model_temps.items():
            if temp is None:
                continue
            w = weights.get(model, 0.5)
            if w > 0:
                total_v += temp * w
                total_w += w
        return round(total_v / total_w, 1) if total_w > 0 else None

    edges = []
    for city_code, city_markets in markets.items():
        city_ensemble = ensembles.get(city_code, {})
        today = city_today.get(city_code, "")
        pace = pace_data.get(city_code, {})

        for key, market_data in city_markets.items():
            date_str = market_data["date"]
            mtype = market_data["type"]  # "high" or "low"

            ensemble = city_ensemble.get(date_str)
            if not ensemble:
                continue

            # Determine forecast horizon (days ahead)
            try:
                from datetime import date as _date
                horizon = (_date.fromisoformat(date_str) - _date.fromisoformat(today)).days
            except Exception:
                horizon = 1
            horizon = max(0, horizon)

            # Get per-model temps and raw ensemble stats
            model_temps = ensemble.get(f"{mtype}_models", {})
            raw_std = ensemble["high_std"] if mtype == "high" else ensemble.get("low_std")

            # Pick the best mean based on what data we have:
            # Day 0 high + pace data → pace-adjusted HRRR (observed reality)
            # Otherwise → horizon-weighted model mean
            if horizon == 0 and mtype == "high" and pace.get("adjusted_high") is not None:
                mean = pace["adjusted_high"]
            elif model_temps:
                mean = horizon_weighted_mean(model_temps, horizon)
            else:
                mean = ensemble["high_mean"] if mtype == "high" else ensemble.get("low_mean")

            if mean is None or raw_std is None:
                continue

            # Apply calibration: city-specific sigma + bias correction
            cal_sigma, cal_bias = get_calibration(city_code, mtype, date_str)
            mean = mean - cal_bias  # Correct systematic forecast bias
            std = cal_sigma  # Use calibrated sigma instead of raw model spread

            for contract in market_data["contracts"]:
                mid = contract.get("mid")
                if mid is None:
                    continue

                # Skip dead/settled contracts
                yes_bid = contract.get("yes_bid") or 0
                yes_ask = contract.get("yes_ask") or 0
                spread = yes_ask - yes_bid
                if spread >= 0.50:  # No real market
                    continue
                if mid <= 0.08 or mid >= 0.92:  # Near-settled — market has intraday info our model lacks
                    continue

                # Skip expired contracts
                close_time_str = contract.get("close_time", "")
                if close_time_str:
                    try:
                        ct = datetime.fromisoformat(close_time_str.replace("Z", "+00:00"))
                        if ct < datetime.now(timezone.utc):
                            continue
                    except ValueError:
                        pass

                strike_type = contract["strike_type"]
                floor = contract.get("floor_strike")
                cap = contract.get("cap_strike")

                # Calculate our probability for this contract
                if strike_type == "less" and cap is not None:
                    # P(temp < cap) — gaussian CDF works well for cumulative
                    our_prob = norm_cdf((cap - mean) / std)
                elif strike_type == "greater" and floor is not None:
                    # P(temp > floor) — gaussian CDF works well for cumulative
                    our_prob = 1 - norm_cdf((floor - mean) / std)
                elif strike_type == "between" and floor is not None and cap is not None:
                    # P(floor <= temp < cap) — use KDE from individual models
                    # Gaussian mean/std is too blunt for narrow 2-degree buckets:
                    # with sigma=3.5, ANY bucket maxes at ~23% probability.
                    # KDE respects model clustering (5/7 models at 57F → high bucket prob).
                    models_key = f"{mtype}_models"
                    model_temps = list(ensemble.get(models_key, {}).values())
                    if model_temps:
                        our_prob = model_kde_prob(model_temps, floor, cap)
                    else:
                        our_prob = norm_cdf((cap - mean) / std) - norm_cdf((floor - mean) / std)
                else:
                    continue

                our_prob = round(our_prob, 4)
                edge = round(our_prob - mid, 4)

                # Signal: only on "less"/"greater" contracts where cumulative gaussian works.
                # "Between" contracts are narrow 2-degree buckets — our model structurally
                # can't price them (max ~20% for any bucket, even when models cluster there).
                # Still calculate edge for display, but don't generate actionable signals.
                if strike_type != "between" and abs(edge) >= EDGE_THRESHOLD:
                    # Kill switch: huge disagreements with market are model failures
                    if abs(edge) > MAX_DISAGREEMENT:
                        signal = None
                    else:
                        signal = "YES" if edge > 0 else "NO"
                else:
                    signal = None

                # EV calculation (capped — if you're seeing 300%+ EV against a liquid market,
                # the model is probably wrong, not the market)
                if signal == "YES" and mid > 0.01:
                    ev = min(edge / mid, 3.0)
                elif signal == "NO" and mid < 0.99:
                    ev = min(-edge / (1 - mid), 3.0)
                else:
                    ev = 0

                edges.append({
                    "city": city_code,
                    "city_name": CITIES[city_code]["name"],
                    "date": date_str,
                    "type": mtype,
                    "ticker": contract["ticker"],
                    "strike_type": strike_type,
                    "floor": floor,
                    "cap": cap,
                    "threshold": cap if strike_type == "less" else floor if strike_type == "greater" else f"{floor}-{cap}",
                    "our_prob": our_prob,
                    "market_mid": mid,
                    "yes_bid": contract["yes_bid"],
                    "yes_ask": contract["yes_ask"],
                    "edge": edge,
                    "ev": round(ev, 4),
                    "signal": signal,
                    "volume": contract["volume"],
                    "close_time": contract["close_time"],
                })

    # Sort by absolute edge descending
    edges.sort(key=lambda e: abs(e["edge"]), reverse=True)

    # Summary
    signals = [e for e in edges if e["signal"]]
    print(f"  Total contracts analyzed: {len(edges)}")
    killed = len([e for e in edges if e["strike_type"] != "between" and abs(e["edge"]) >= EDGE_THRESHOLD and abs(e["edge"]) > MAX_DISAGREEMENT])
    print(f"  Signals ({EDGE_THRESHOLD*100:.0f}-{MAX_DISAGREEMENT*100:.0f}% edge): {len(signals)}  (killed {killed} over {MAX_DISAGREEMENT*100:.0f}% disagreement)")
    if signals:
        top = signals[0]
        print(f"  Best edge: {top['city_name']} {top['type']} {top['threshold']}F "
              f"-> {top['signal']} ({top['edge']:+.1%} edge, {top['ev']:+.1%} EV)")

    return edges


# ============================================================
#  NWS OBSERVATIONS — CURRENT TEMPS (for pace tracking)
# ============================================================

def fetch_observations(cities=CITIES):
    """
    Fetch current temperature observations from NWS for pace tracking.
    Returns: {city_code: {temp_f, observed_at, station}}
    """
    print("\n=== FETCHING NWS OBSERVATIONS ===\n")

    # NWS station IDs for our cities (airport weather stations)
    NWS_STATIONS = {
        "NYC": "KNYC",  "LAX": "KLAX",  "CHI": "KMDW",
        "MIA": "KMIA",  "DAL": "KDFW",  "DEN": "KDEN",
        "PHI": "KPHL",  "ATL": "KATL",  "HOU": "KIAH",
        "PHX": "KPHX",
    }

    observations = {}
    for city_code, station_id in NWS_STATIONS.items():
        try:
            url = f"https://api.weather.gov/stations/{station_id}/observations/latest"
            resp = requests.get(url, headers={"User-Agent": "WeatherEdge/1.0"}, timeout=10)
            if resp.status_code != 200:
                print(f"  {city_code} ({station_id}): HTTP {resp.status_code}")
                continue

            data = resp.json()
            props = data.get("properties", {})
            temp_c = props.get("temperature", {}).get("value")

            if temp_c is not None:
                temp_f = round(temp_c * 9/5 + 32, 1)
                observed_at = props.get("timestamp", "")
                # Track observation age so frontend can flag stale readings
                obs_age_min = None
                if observed_at:
                    try:
                        obs_time = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
                        obs_age_min = round((datetime.now(timezone.utc) - obs_time).total_seconds() / 60)
                    except ValueError:
                        pass
                observations[city_code] = {
                    "temp_f": temp_f,
                    "observed_at": observed_at,
                    "station": station_id,
                    "obs_age_min": obs_age_min,
                }
                age_str = f", {obs_age_min}min ago" if obs_age_min else ""
                print(f"  {city_code}: {temp_f}F ({station_id}{age_str})")
            else:
                print(f"  {city_code}: null temperature")

        except Exception as e:
            print(f"  {city_code}: ERROR {e}")

        time.sleep(0.2)

    print(f"\n  Got observations for {len(observations)}/{len(NWS_STATIONS)} cities")
    return observations


# ============================================================
#  PACE TRACKING — INTRADAY TEMPERATURE ADJUSTMENT
# ============================================================

def calculate_pace(forecasts, observations):
    """
    Compare current observed temps against HRRR hourly curve to detect
    whether reality is running ahead/behind forecast.
    Returns: {city_code: {pace_delta, expected_now, observed, adjusted_high}}
    """
    print("\n=== CALCULATING TEMPERATURE PACE ===\n")

    now_utc = datetime.now(timezone.utc)
    pace_data = {}

    for city_code, obs in observations.items():
        city_tz = CITIES.get(city_code, {}).get("tz", "America/New_York")
        local_now = now_utc.astimezone(ZoneInfo(city_tz))
        today_str = local_now.strftime("%Y-%m-%d")

        city_forecasts = forecasts.get(city_code, {}).get(today_str, {})
        hrrr = city_forecasts.get("ncep_hrrr_conus")

        if not hrrr or not hrrr.get("hourly"):
            continue

        # Match against HRRR hourly using LOCAL time (OpenMeteo returns local times)
        local_hour = local_now.strftime("%Y-%m-%dT%H")

        expected_now = None
        for ht, temp in hrrr["hourly"]:
            if ht.startswith(local_hour):
                expected_now = temp
                break

        if expected_now is None:
            continue

        pace_delta = round(obs["temp_f"] - expected_now, 1)
        adjusted_high = round(hrrr["high"] + pace_delta, 1)

        pace_data[city_code] = {
            "pace_delta": pace_delta,
            "expected_now": round(expected_now, 1),
            "observed": obs["temp_f"],
            "hrrr_high": hrrr["high"],
            "adjusted_high": adjusted_high,
        }

        direction = "AHEAD" if pace_delta > 0 else "BEHIND" if pace_delta < 0 else "ON PACE"
        print(f"  {city_code}: {obs['temp_f']}F observed vs {expected_now:.1f}F expected "
              f"-> {pace_delta:+.1f}F {direction} (adj high: {adjusted_high}F)")

    return pace_data


# ============================================================
#  AI ANALYSIS (Claude + GPT via OpenRouter)
# ============================================================

def ai_analysis(edges, ensembles, pace_data, observations):
    """
    Get Claude and GPT to independently analyze the top edges.
    Returns: {model_name: {summary, picks: [...]}}
    """
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        print("\n  [--] OPENROUTER_API_KEY not set — skipping AI analysis")
        return {}

    print("\n=== AI WEATHER ANALYSIS ===\n")

    # Build context for AI
    top_edges = [e for e in edges if e["signal"]][:15]
    if not top_edges:
        print("  No signals to analyze")
        return {}

    # Format the data concisely
    edge_lines = []
    for e in top_edges:
        pace = pace_data.get(e["city"], {})
        pace_str = f" (pace: {pace['pace_delta']:+.1f}F)" if pace else ""
        edge_lines.append(
            f"  {e['city_name']} {e['type']} {e['threshold']}F: "
            f"our={e['our_prob']:.0%} vs market={e['market_mid']:.0%} "
            f"-> {e['signal']} ({e['edge']:+.1%} edge, {e['ev']:+.1%} EV){pace_str}"
        )

    ensemble_lines = []
    for city_code, city_data in ensembles.items():
        for date, ens in city_data.items():
            obs = observations.get(city_code, {})
            obs_str = f", current: {obs['temp_f']}F" if obs else ""
            ensemble_lines.append(
                f"  {CITIES[city_code]['name']} {date}: "
                f"high {ens['high_mean']}F +/-{ens['high_std']}F "
                f"(range: {ens['high_min']}-{ens['high_max']}F, {ens['model_count']} models{obs_str})"
            )

    prompt = f"""You are a weather market analyst. You have ensemble weather forecasts from 7 models
and Kalshi market prices. Analyze the top edges and give your independent assessment.

ENSEMBLE FORECASTS:
{chr(10).join(ensemble_lines)}

TOP EDGES DETECTED:
{chr(10).join(edge_lines)}

For each edge, assess:
1. Is the ensemble signal trustworthy here? (model agreement, forecast horizon, city-specific factors)
2. Any weather patterns that could shift the outcome? (fronts, urban heat islands, coastal effects)
3. Your confidence: STRONG / LEAN / SKIP

Respond in JSON format:
{{
  "summary": "1-2 sentence overall market take",
  "picks": [
    {{
      "city": "NYC",
      "type": "high",
      "threshold": "72",
      "signal": "YES",
      "confidence": "STRONG",
      "reasoning": "brief reason"
    }}
  ]
}}"""

    models = [
        ("claude", "anthropic/claude-sonnet-4-6"),
        ("gpt", "openai/gpt-4.1-mini"),
    ]

    results = {}
    for model_name, model_id in models:
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 1500,
                    "response_format": {"type": "json_object"},
                },
                timeout=60,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]

            # Multi-stage JSON parsing
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            parsed = None
            # Stage 1: direct parse
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                pass
            # Stage 2: find first { to last }
            if not parsed:
                try:
                    start = content.index("{")
                    end = content.rindex("}") + 1
                    parsed = json.loads(content[start:end])
                except (ValueError, json.JSONDecodeError):
                    pass

            if parsed:
                results[model_name] = parsed
                pick_count = len(parsed.get("picks", []))
                print(f"  {model_name}: {pick_count} picks — {parsed.get('summary', '')[:80]}")
            else:
                print(f"  {model_name}: got response but failed to parse JSON")
                results[model_name] = {"summary": content[:300], "picks": []}
        except Exception as e:
            print(f"  {model_name}: ERROR {e}")

    return results


# ============================================================
#  HISTORICAL DATA — SIGNAL RECORDING & RESOLUTION
# ============================================================

DATA_DIR = Path(__file__).parent / "data"


def record_signals(edges, ensembles, pace_data):
    """
    Append edge signals to data/signals.jsonl for backtesting.
    Deduplicates: skips tickers already recorded within the last hour.
    """
    print("\n=== RECORDING SIGNALS ===\n")

    DATA_DIR.mkdir(exist_ok=True)
    signals_file = DATA_DIR / "signals.jsonl"

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    signals = [e for e in edges if e["signal"]]

    if not signals:
        print("  No signals to record")
        return

    # Load tickers recorded in the last hour for dedup
    recent_tickers = set()
    if signals_file.exists():
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
        for line in signals_file.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
                rec_ts = datetime.fromisoformat(rec["snapshot_ts"].replace("Z", "+00:00"))
                if rec_ts > cutoff:
                    recent_tickers.add(rec["ticker"])
            except (json.JSONDecodeError, KeyError, ValueError):
                continue

    new_count = 0
    with open(signals_file, "a", encoding="utf-8") as f:
        for e in signals:
            if e["ticker"] in recent_tickers:
                continue

            # Ensemble data for this signal
            ens = ensembles.get(e["city"], {}).get(e["date"], {})
            pace = pace_data.get(e["city"], {})

            record = {
                "id": str(uuid.uuid4()),
                "snapshot_ts": timestamp,
                "city": e["city"],
                "date": e["date"],
                "type": e["type"],
                "ticker": e["ticker"],
                "strike_type": e["strike_type"],
                "floor": e["floor"],
                "cap": e["cap"],
                "threshold": e["threshold"],
                "our_prob": e["our_prob"],
                "market_mid": e["market_mid"],
                "edge": e["edge"],
                "signal": e["signal"],
                "ev": e["ev"],
                "yes_bid": e["yes_bid"],
                "yes_ask": e["yes_ask"],
                "volume": e["volume"],
                "close_time": e["close_time"],
                "ensemble_mean": ens.get(f"{e['type']}_mean"),
                "ensemble_std": ens.get(f"{e['type']}_std"),
                "model_count": ens.get("model_count"),
                "pace_delta": pace.get("pace_delta"),
            }

            f.write(json.dumps(record, default=str) + "\n")
            new_count += 1
            recent_tickers.add(e["ticker"])

    total = len(signals)
    print(f"  Recorded {new_count} new signals ({total - new_count} deduped within 1h)")


def resolve_signals():
    """
    Check past signals whose markets have closed. Fetch actual temps
    from NWS observations, score as WIN/LOSS, compute P&L.
    """
    print("\n=== RESOLVING PAST SIGNALS ===\n")

    signals_file = DATA_DIR / "signals.jsonl"
    resolutions_file = DATA_DIR / "resolutions.jsonl"

    if not signals_file.exists():
        print("  No signals file yet")
        return

    now = datetime.now(timezone.utc)

    # Load already-resolved tickers
    resolved_tickers = set()
    if resolutions_file.exists():
        for line in resolutions_file.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
                resolved_tickers.add(rec["ticker"])
            except (json.JSONDecodeError, KeyError):
                continue

    # Find unresolved signals whose close_time has passed (+ 2h buffer for NWS data)
    to_resolve = {}  # {(city, date, type): first_signal_for_that_ticker}
    for line in signals_file.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
            ticker = rec["ticker"]
            if ticker in resolved_tickers:
                continue
            close_time = datetime.fromisoformat(rec["close_time"].replace("Z", "+00:00"))
            if now > close_time + timedelta(hours=2):
                # Keep first occurrence per ticker (entry signal)
                if ticker not in {s["ticker"] for sigs in to_resolve.values() for s in sigs}:
                    key = (rec["city"], rec["date"], rec["type"])
                    if key not in to_resolve:
                        to_resolve[key] = []
                    to_resolve[key].append(rec)
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

    if not to_resolve:
        print("  No signals ready for resolution")
        return

    pending = sum(len(v) for v in to_resolve.values())
    print(f"  {pending} signals across {len(to_resolve)} markets to resolve")

    # Fetch actual temps
    actual_temps = fetch_actual_temps(to_resolve)

    new_resolutions = 0
    with open(resolutions_file, "a", encoding="utf-8") as f:
        for key, sigs in to_resolve.items():
            city, date_str, mtype = key
            actual = actual_temps.get(key)
            if actual is None:
                continue

            for sig in sigs:
                strike_type = sig["strike_type"]
                floor = sig.get("floor")
                cap = sig.get("cap")

                # Did the contract resolve YES (true)?
                if strike_type == "less" and cap is not None:
                    contract_yes = actual < cap
                elif strike_type == "greater" and floor is not None:
                    contract_yes = actual > floor
                elif strike_type == "between" and floor is not None and cap is not None:
                    contract_yes = floor <= actual < cap
                else:
                    continue

                # Score the signal
                if sig["signal"] == "YES":
                    win = contract_yes
                    buy_price = sig.get("yes_ask") or sig["market_mid"]
                    pnl = round((1.0 - buy_price) if win else -buy_price, 4)
                else:  # NO
                    win = not contract_yes
                    yes_bid = sig.get("yes_bid") or sig["market_mid"]
                    buy_price = round(1.0 - yes_bid, 4)
                    pnl = round((1.0 - buy_price) if win else -buy_price, 4)

                resolution = {
                    "signal_id": sig.get("id"),
                    "ticker": sig["ticker"],
                    "city": city,
                    "date": date_str,
                    "type": mtype,
                    "threshold": sig["threshold"],
                    "signal": sig["signal"],
                    "edge": sig["edge"],
                    "our_prob": sig["our_prob"],
                    "market_mid": sig["market_mid"],
                    "ensemble_mean": sig.get("ensemble_mean"),
                    "ensemble_std": sig.get("ensemble_std"),
                    "model_count": sig.get("model_count"),
                    "actual_temp": actual,
                    "contract_resolved_yes": contract_yes,
                    "result": "WIN" if win else "LOSS",
                    "buy_price": buy_price,
                    "pnl": pnl,
                    "ai": sig.get("ai"),
                    "resolved_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }

                f.write(json.dumps(resolution, default=str) + "\n")
                new_resolutions += 1
                resolved_tickers.add(sig["ticker"])

    print(f"  Resolved {new_resolutions} signals")


def fetch_actual_temps(to_resolve):
    """
    Fetch actual observed high/low temps from NWS station observations.
    Uses the same airport stations as our pace tracker — same source Kalshi settles against.
    Returns: {(city, date, type): actual_temp_f}
    """
    NWS_STATIONS = {
        "NYC": "KNYC", "LAX": "KLAX", "CHI": "KMDW",
        "MIA": "KMIA", "DAL": "KDFW", "DEN": "KDEN",
        "PHI": "KPHL", "ATL": "KATL", "HOU": "KIAH",
        "PHX": "KPHX",
    }

    actuals = {}

    # Group by (city, date) to minimize API calls
    city_dates = {}
    for (city, date_str, mtype) in to_resolve.keys():
        key = (city, date_str)
        if key not in city_dates:
            city_dates[key] = set()
        city_dates[key].add(mtype)

    for (city_code, date_str), types in city_dates.items():
        station = NWS_STATIONS.get(city_code)
        if not station:
            continue

        city_info = CITIES.get(city_code)
        if not city_info:
            continue

        try:
            # Convert local date boundaries to UTC for the NWS query
            city_tz = ZoneInfo(city_info["tz"])
            local_start = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=city_tz)
            local_end = local_start + timedelta(days=1)
            start_utc = local_start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            end_utc = local_end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            url = f"https://api.weather.gov/stations/{station}/observations"
            resp = requests.get(
                url,
                params={"start": start_utc, "end": end_utc},
                headers={"User-Agent": "WeatherEdge/1.0"},
                timeout=15,
            )

            if resp.status_code != 200:
                print(f"  {city_code} {date_str}: HTTP {resp.status_code}")
                continue

            data = resp.json()
            temps = []
            for feature in data.get("features", []):
                temp_c = feature.get("properties", {}).get("temperature", {}).get("value")
                if temp_c is not None:
                    temps.append(temp_c * 9 / 5 + 32)

            if temps:
                if "high" in types:
                    actuals[(city_code, date_str, "high")] = round(max(temps), 1)
                if "low" in types:
                    actuals[(city_code, date_str, "low")] = round(min(temps), 1)
                print(f"  {city_code} {date_str}: high={max(temps):.1f}F low={min(temps):.1f}F ({len(temps)} obs)")
            else:
                print(f"  {city_code} {date_str}: no temperature observations")

        except Exception as e:
            print(f"  {city_code} {date_str}: ERROR {e}")

        time.sleep(0.3)

    return actuals


def backtest_report():
    """Print backtest performance stats from resolved signals."""
    resolutions_file = DATA_DIR / "resolutions.jsonl"
    signals_file = DATA_DIR / "signals.jsonl"

    if not resolutions_file.exists():
        print("\n  No resolutions yet — need at least one market to close and resolve.")
        return

    # Load resolutions
    resolutions = []
    for line in resolutions_file.read_text(encoding="utf-8").splitlines():
        try:
            resolutions.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    # Count total signals
    total_signals = 0
    if signals_file.exists():
        total_signals = sum(1 for _ in signals_file.read_text(encoding="utf-8").splitlines() if _.strip())

    if not resolutions:
        print(f"\n  {total_signals} signals recorded, 0 resolved. Markets still open.")
        return

    # ---- Era split ----
    current_mc = len(WEATHER_MODELS)
    current_era = [r for r in resolutions if r.get("model_count") == current_mc]
    legacy_era = [r for r in resolutions if r.get("model_count", current_mc) != current_mc]

    # ---- Overall stats ----
    wins = [r for r in resolutions if r["result"] == "WIN"]
    losses = [r for r in resolutions if r["result"] == "LOSS"]
    total_pnl = sum(r["pnl"] for r in resolutions)
    avg_pnl = total_pnl / len(resolutions)

    # Era sub-stats
    cur_wins = sum(1 for r in current_era if r["result"] == "WIN")
    cur_pnl = sum(r["pnl"] for r in current_era)
    leg_wins = sum(1 for r in legacy_era if r["result"] == "WIN")
    leg_pnl = sum(r["pnl"] for r in legacy_era)

    print(f"""
{'=' * 65}
  BACKTEST RESULTS
{'=' * 65}

  Signals recorded:  {total_signals}
  Resolved:          {len(resolutions)}
  Pending:           {total_signals - len(resolutions)}

  Win Rate:          {len(wins)}/{len(resolutions)} = {len(wins)/len(resolutions):.1%}
  Avg P&L/signal:    ${avg_pnl:+.4f}  (on $1 bets)
  Total P&L:         ${total_pnl:+.2f}

  --- ERA BREAKDOWN ---
  Current ({current_mc}-model): {len(current_era):3d} resolved, {cur_wins}/{len(current_era)} win ({cur_wins/len(current_era):.0%} WR), ${cur_pnl:+.2f} P&L""" + (f"""
  Legacy  (old):     {len(legacy_era):3d} resolved, {leg_wins}/{len(legacy_era)} win ({leg_wins/len(legacy_era):.0%} WR), ${leg_pnl:+.2f} P&L""" if legacy_era else "") + """
""")

    # ---- By edge bucket ----
    buckets = [
        ("5-10%",  0.05, 0.10),
        ("10-20%", 0.10, 0.20),
        ("20-50%", 0.20, 0.50),
        ("50%+",   0.50, 2.00),
    ]
    print("  BY EDGE SIZE:")
    for label, lo, hi in buckets:
        bucket = [r for r in resolutions if lo <= abs(r["edge"]) < hi]
        if not bucket:
            continue
        bwins = sum(1 for r in bucket if r["result"] == "WIN")
        bpnl = sum(r["pnl"] for r in bucket)
        print(f"    {label:>8}: {len(bucket):3d} signals, "
              f"{bwins/len(bucket):5.1%} win, "
              f"${bpnl/len(bucket):+.4f} avg P&L, "
              f"${bpnl:+.2f} total")

    # ---- By type ----
    print("\n  BY TYPE:")
    for mtype in ["high", "low"]:
        subset = [r for r in resolutions if r["type"] == mtype]
        if not subset:
            continue
        swins = sum(1 for r in subset if r["result"] == "WIN")
        spnl = sum(r["pnl"] for r in subset)
        print(f"    {mtype:>8}: {len(subset):3d} signals, "
              f"{swins/len(subset):5.1%} win, "
              f"${spnl/len(subset):+.4f} avg P&L")

    # ---- By city ----
    print("\n  BY CITY:")
    city_groups = {}
    for r in resolutions:
        city_groups.setdefault(r["city"], []).append(r)
    for city in sorted(city_groups, key=lambda c: -len(city_groups[c])):
        subset = city_groups[city]
        swins = sum(1 for r in subset if r["result"] == "WIN")
        spnl = sum(r["pnl"] for r in subset)
        print(f"    {city:>8}: {len(subset):3d} signals, "
              f"{swins/len(subset):5.1%} win, "
              f"${spnl:+.2f} total P&L")

    # ---- By signal direction ----
    print("\n  BY DIRECTION:")
    for direction in ["YES", "NO"]:
        subset = [r for r in resolutions if r["signal"] == direction]
        if not subset:
            continue
        swins = sum(1 for r in subset if r["result"] == "WIN")
        spnl = sum(r["pnl"] for r in subset)
        print(f"    {direction:>8}: {len(subset):3d} signals, "
              f"{swins/len(subset):5.1%} win, "
              f"${spnl/len(subset):+.4f} avg P&L")

    # ---- AI accuracy ----
    ai_resolutions = [r for r in resolutions if r.get("ai")]
    if ai_resolutions:
        print("\n  AI PICK ACCURACY:")
        ai_stats = {}  # {(model, confidence): [wins, total]}
        for r in ai_resolutions:
            for model, conf in r["ai"].items():
                key = (model, conf)
                if key not in ai_stats:
                    ai_stats[key] = [0, 0]
                ai_stats[key][1] += 1
                if r["result"] == "WIN":
                    ai_stats[key][0] += 1
        for (model, conf), (w, t) in sorted(ai_stats.items()):
            print(f"    {model:>8} {conf:>8}: {t:3d} picks, {w/t:.1%} win")

    # ---- Calibration (our_prob vs actual hit rate) ----
    print("\n  CALIBRATION (our predicted prob vs actual outcome):")
    cal_buckets = [(0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]
    for lo, hi in cal_buckets:
        # For YES signals, our_prob is how likely the contract resolves yes
        # For NO signals, 1 - our_prob is how likely contract resolves no
        subset = [r for r in resolutions if lo <= r["our_prob"] < hi]
        if not subset:
            continue
        actual_yes = sum(1 for r in subset if r["contract_resolved_yes"])
        print(f"    P={lo:.0%}-{hi:.0%}: {len(subset):3d} contracts, "
              f"actual YES rate {actual_yes/len(subset):.1%} "
              f"(predicted avg {sum(r['our_prob'] for r in subset)/len(subset):.1%})")

    print(f"\n{'=' * 65}")


# ============================================================
#  FILE WRITERS
# ============================================================

def write_data_files(forecasts, ensembles, markets, edges, observations, pace_data):
    """Write all data to src/ JS files for the frontend."""
    src_dir = Path(__file__).parent / "src"
    src_dir.mkdir(exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ---- markets.js ----
    # Flatten markets for frontend consumption
    flat_markets = []
    for city_code, city_markets in markets.items():
        for key, market_data in city_markets.items():
            for contract in market_data["contracts"]:
                flat_markets.append({
                    "city": city_code,
                    "city_name": CITIES[city_code]["name"],
                    "date": market_data["date"],
                    "type": market_data["type"],
                    **contract,
                })

    _write_js(src_dir / "markets.js", "MARKETS", flat_markets)
    print(f"  Wrote {len(flat_markets)} contracts to src/markets.js")

    # ---- forecasts.js ----
    _write_js(src_dir / "forecasts.js", "FORECASTS", ensembles)
    print(f"  Wrote {len(ensembles)} city forecasts to src/forecasts.js")

    # ---- edges.js ----
    _write_js(src_dir / "edges.js", "EDGES", edges)
    print(f"  Wrote {len(edges)} edges to src/edges.js")

    # ---- observations.js ----
    obs_with_pace = {}
    for city_code in CITIES:
        obs_with_pace[city_code] = {
            **(observations.get(city_code, {})),
            **(pace_data.get(city_code, {})),
        }
    _write_js(src_dir / "observations.js", "OBSERVATIONS", obs_with_pace)
    print(f"  Wrote {len(observations)} observations to src/observations.js")

    # ---- ai_analysis.js (empty — AI removed, models don't add value for singular temp values) ----
    _write_js(src_dir / "ai_analysis.js", "AI_ANALYSIS", {})

    # ---- meta.js ----
    meta = {
        "last_updated": timestamp,
        "cities": len(CITIES),
        "models": len(WEATHER_MODELS),
        "model_names": WEATHER_MODELS,
        "total_contracts": len(flat_markets),
        "total_edges": len([e for e in edges if e["signal"]]),
        "edge_threshold": EDGE_THRESHOLD,
        "max_disagreement": MAX_DISAGREEMENT,
    }
    _write_js(src_dir / "meta.js", "META", meta)
    print(f"  Wrote meta to src/meta.js")

    # ---- results.js ----
    resolutions_file = DATA_DIR / "resolutions.jsonl"
    resolutions = []
    if resolutions_file.exists():
        for line in resolutions_file.read_text(encoding="utf-8").splitlines():
            try:
                resolutions.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    # Only show current-era results (3-model ensemble) in frontend
    current_model_count = len(WEATHER_MODELS)
    resolutions = [r for r in resolutions if r.get("model_count") == current_model_count]

    # Sort newest first
    resolutions.sort(key=lambda r: r.get("resolved_at", ""), reverse=True)

    # Summary stats
    r_wins = sum(1 for r in resolutions if r["result"] == "WIN")
    r_total = len(resolutions)
    r_pnl = sum(r["pnl"] for r in resolutions)
    r_risked = sum(abs(r["buy_price"]) for r in resolutions)

    # Current streak
    streak = 0
    if resolutions:
        streak_result = resolutions[0]["result"]
        for r in resolutions:
            if r["result"] == streak_result:
                streak += 1
            else:
                break
        if streak_result == "LOSS":
            streak = -streak

    # Edge tier breakdown
    tier_defs = [
        ("STRONG", "20%+ edge", 0.20, 2.0),
        ("SOLID", "10-20%", 0.10, 0.20),
        ("LEAN", "5-10%", 0.05, 0.10),
    ]
    tiers = []
    for label, desc, lo, hi in tier_defs:
        t_picks = [r for r in resolutions if lo <= abs(r["edge"]) < hi]
        t_wins = sum(1 for r in t_picks if r["result"] == "WIN")
        t_pnl = sum(r["pnl"] for r in t_picks)
        tiers.append({"label": label, "desc": desc, "total": len(t_picks),
                       "wins": t_wins, "pnl": round(t_pnl, 2)})

    # By direction
    directions = []
    for d in ["YES", "NO"]:
        d_picks = [r for r in resolutions if r["signal"] == d]
        d_wins = sum(1 for r in d_picks if r["result"] == "WIN")
        d_pnl = sum(r["pnl"] for r in d_picks)
        directions.append({"label": d, "total": len(d_picks),
                           "wins": d_wins, "pnl": round(d_pnl, 2)})

    # Picks as compact arrays: [resolved_at, city, date, type, threshold, signal, edge, our_prob, market_mid, actual_temp, result, buy_price, pnl]
    picks = []
    for r in resolutions:
        picks.append([
            r.get("resolved_at"), r.get("city"), r.get("date"),
            r.get("type"), r.get("threshold"), r.get("signal"),
            r.get("edge"), r.get("our_prob"), r.get("market_mid"),
            r.get("actual_temp"), r.get("result"),
            r.get("buy_price"), r.get("pnl"),
        ])

    results_data = {
        "summary": {
            "total": r_total,
            "wins": r_wins,
            "losses": r_total - r_wins,
            "win_rate": round(r_wins / r_total, 4) if r_total else 0,
            "total_pnl": round(r_pnl, 2),
            "total_risked": round(r_risked, 2),
            "roi": round(r_pnl / r_risked * 100, 1) if r_risked > 0 else 0,
            "current_streak": streak,
        },
        "tiers": tiers,
        "directions": directions,
        "picks": picks,
    }
    _write_js(src_dir / "results.js", "RESULTS", results_data)
    print(f"  Wrote {r_total} results to src/results.js")


def _write_js(path, var_name, data):
    """Write a JS export file."""
    json_str = json.dumps(data, indent=2, default=str)
    path.write_text(f"export const {var_name} = {json_str};\n", encoding="utf-8")


# ============================================================
#  MAIN
# ============================================================

def main():
    load_env()

    write_mode = "--write-data" in sys.argv
    skip_ai = "--skip-ai" in sys.argv
    backtest_only = "--backtest" in sys.argv

    # Backtest mode — just print stats and exit
    if backtest_only:
        print("=" * 65)
        print("  WEATHER EDGE — Backtest Report")
        print("=" * 65)
        backtest_report()
        return

    print("=" * 65)
    print("  WEATHER EDGE — Multi-Model Ensemble Pipeline")
    print("=" * 65)
    print(f"\n  Cities: {len(CITIES)} | Models: {len(WEATHER_MODELS)} | Forecast days: 3")
    print(f"  Mode: {'WRITE' if write_mode else 'LOCAL'}")

    # 1. Fetch weather forecasts
    forecasts = fetch_forecasts()
    if not forecasts:
        print("\nERROR: No forecast data. Exiting.")
        return

    # 2. Build ensemble distributions
    ensembles = build_ensemble(forecasts)

    # 3. Fetch current observations + pace (before edges so pace can feed in)
    observations = fetch_observations()
    pace_data = calculate_pace(forecasts, observations)

    # 4. Fetch Kalshi markets
    markets = fetch_kalshi_markets()

    # 5. Calculate edges (pace-aware — uses HRRR pace adjustment for day 0 highs)
    edges = calculate_edges(ensembles, markets, pace_data=pace_data)

    # 6. Record signals + resolve past ones (always, not just write mode)
    record_signals(edges, ensembles, pace_data)
    resolve_signals()

    # 7. Write data files
    if write_mode:
        print("\n=== WRITING DATA FILES ===\n")
        write_data_files(forecasts, ensembles, markets, edges, observations, pace_data)
    else:
        print("\n  [LOCAL MODE] — pass --write-data to write src/ files")

        # Print top edges to console
        signals = [e for e in edges if e["signal"]]
        if signals:
            print(f"\n  TOP EDGES ({len(signals)} signals):\n")
            for e in signals[:20]:
                print(f"    {e['signal']:3} {e['city_name']:15} {e['type']:4} "
                      f"{str(e['threshold']):>6}F  "
                      f"our={e['our_prob']:5.1%} mkt={e['market_mid']:5.1%}  "
                      f"edge={e['edge']:+6.1%}  EV={e['ev']:+6.1%}")

    print("\n" + "=" * 65)
    print("  DONE!")
    print("=" * 65)


if __name__ == "__main__":
    main()
