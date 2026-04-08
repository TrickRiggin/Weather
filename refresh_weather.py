#!/usr/bin/env python3
"""
Weather Edge — Multi-model ensemble weather prediction pipeline.
Fetches forecasts from 7 weather models via OpenMeteo, compares against
Kalshi weather market pricing to find edges.
"""

import json, os, sys, time, math, requests
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ============================================================
#  CONSTANTS
# ============================================================

OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"

WEATHER_MODELS = [
    "gfs_seamless",        # NOAA GFS (global, 6h runs)
    "ecmwf_ifs025",        # ECMWF IFS (European, gold standard)
    "icon_seamless",       # DWD ICON (German)
    "gem_seamless",        # Canadian GEM
    "jma_seamless",        # Japan Met Agency
    "ncep_hrrr_conus",     # HRRR (3km, hourly, US only, ~48h range)
    "ncep_nbm_conus",      # NWS National Blend (~20 model ensemble)
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

# Minimum sigma floor — even when all models agree, forecast error is never zero
# Based on typical NWS forecast error for 1-2 day temperature forecasts
SIGMA_FLOOR = 2.0  # degrees F

# Edge threshold for signals
EDGE_THRESHOLD = 0.05  # 5% edge minimum

# ============================================================
#  HELPERS
# ============================================================

def norm_cdf(x):
    """Standard normal CDF approximation."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


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
            high_std = max((sum((h - high_mean)**2 for h in highs) / len(highs)) ** 0.5, SIGMA_FLOOR)

            low_mean = sum(lows) / len(lows) if lows else None
            low_std = max((sum((l - low_mean)**2 for l in lows) / len(lows)) ** 0.5, SIGMA_FLOOR) if lows and len(lows) >= 2 else SIGMA_FLOOR

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

                mid = (yes_bid + yes_ask) / 2 if yes_bid and yes_ask else None

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

def calculate_edges(ensembles, markets):
    """
    Compare ensemble probabilities against Kalshi market prices.
    Returns: [{city, date, type, contract_ticker, threshold, our_prob, market_prob, edge, signal}]
    """
    print("\n=== CALCULATING EDGES ===\n")

    edges = []
    for city_code, city_markets in markets.items():
        city_ensemble = ensembles.get(city_code, {})

        for key, market_data in city_markets.items():
            date_str = market_data["date"]
            mtype = market_data["type"]  # "high" or "low"

            ensemble = city_ensemble.get(date_str)
            if not ensemble:
                continue

            mean = ensemble["high_mean"] if mtype == "high" else ensemble.get("low_mean")
            std = ensemble["high_std"] if mtype == "high" else ensemble.get("low_std")
            if mean is None or std is None:
                continue

            for contract in market_data["contracts"]:
                mid = contract.get("mid")
                if mid is None or mid <= 0 or mid >= 1:
                    continue

                strike_type = contract["strike_type"]
                floor = contract.get("floor_strike")
                cap = contract.get("cap_strike")

                # Calculate our probability for this contract
                if strike_type == "less" and cap is not None:
                    # P(temp < cap)
                    our_prob = norm_cdf((cap - mean) / std)
                elif strike_type == "greater" and floor is not None:
                    # P(temp > floor)
                    our_prob = 1 - norm_cdf((floor - mean) / std)
                elif strike_type == "between" and floor is not None and cap is not None:
                    # P(floor <= temp < cap)
                    our_prob = norm_cdf((cap - mean) / std) - norm_cdf((floor - mean) / std)
                else:
                    continue

                our_prob = round(our_prob, 4)
                edge = round(our_prob - mid, 4)

                # Signal: YES if our prob > market (underpriced), NO if our prob < market (overpriced)
                if abs(edge) >= EDGE_THRESHOLD:
                    signal = "YES" if edge > 0 else "NO"
                else:
                    signal = None

                # EV calculation: edge / (1 - our_prob) for YES, edge / our_prob for NO
                if signal == "YES" and mid < 1:
                    ev = edge / mid  # EV of buying YES at market price
                elif signal == "NO" and mid > 0:
                    ev = -edge / (1 - mid)  # EV of buying NO
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
    print(f"  Signals (>= {EDGE_THRESHOLD*100}% edge): {len(signals)}")
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
                observations[city_code] = {
                    "temp_f": temp_f,
                    "observed_at": observed_at,
                    "station": station_id,
                }
                print(f"  {city_code}: {temp_f}F ({station_id})")
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

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    pace_data = {}

    for city_code, obs in observations.items():
        city_forecasts = forecasts.get(city_code, {}).get(today_str, {})
        hrrr = city_forecasts.get("ncep_hrrr_conus")

        if not hrrr or not hrrr.get("hourly"):
            continue

        # Find the HRRR expected temp for the current hour
        obs_time = obs.get("observed_at", "")
        current_hour = now.strftime("%Y-%m-%dT%H:00")

        expected_now = None
        for ht, temp in hrrr["hourly"]:
            if ht.startswith(current_hour[:13]):  # Match to hour
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
                },
                timeout=60,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]

            # Parse JSON from response (handle markdown code blocks)
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0]

            parsed = json.loads(content)
            results[model_name] = parsed
            pick_count = len(parsed.get("picks", []))
            print(f"  {model_name}: {pick_count} picks — {parsed.get('summary', '')[:80]}")

        except json.JSONDecodeError:
            print(f"  {model_name}: got response but failed to parse JSON")
            results[model_name] = {"summary": content[:200], "picks": []}
        except Exception as e:
            print(f"  {model_name}: ERROR {e}")

    return results


# ============================================================
#  FILE WRITERS
# ============================================================

def write_data_files(forecasts, ensembles, markets, edges, observations, pace_data, ai_results):
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

    # ---- ai_analysis.js ----
    _write_js(src_dir / "ai_analysis.js", "AI_ANALYSIS", ai_results)
    print(f"  Wrote AI analysis to src/ai_analysis.js")

    # ---- meta.js ----
    meta = {
        "last_updated": timestamp,
        "cities": len(CITIES),
        "models": len(WEATHER_MODELS),
        "model_names": WEATHER_MODELS,
        "total_contracts": len(flat_markets),
        "total_edges": len([e for e in edges if e["signal"]]),
        "edge_threshold": EDGE_THRESHOLD,
    }
    _write_js(src_dir / "meta.js", "META", meta)
    print(f"  Wrote meta to src/meta.js")


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

    print("=" * 65)
    print("  WEATHER EDGE — Multi-Model Ensemble Pipeline")
    print("=" * 65)
    print(f"\n  Cities: {len(CITIES)} | Models: {len(WEATHER_MODELS)} | Forecast days: 3")
    print(f"  Mode: {'WRITE' if write_mode else 'LOCAL'} | AI: {'OFF' if skip_ai else 'ON'}")

    # 1. Fetch weather forecasts
    forecasts = fetch_forecasts()
    if not forecasts:
        print("\nERROR: No forecast data. Exiting.")
        return

    # 2. Build ensemble distributions
    ensembles = build_ensemble(forecasts)

    # 3. Fetch Kalshi markets
    markets = fetch_kalshi_markets()

    # 4. Calculate edges
    edges = calculate_edges(ensembles, markets)

    # 5. Fetch current observations
    observations = fetch_observations()

    # 6. Calculate pace
    pace_data = calculate_pace(forecasts, observations)

    # 7. AI analysis (optional)
    ai_results = {}
    if not skip_ai:
        ai_results = ai_analysis(edges, ensembles, pace_data, observations)

    # 8. Write data files
    if write_mode:
        print("\n=== WRITING DATA FILES ===\n")
        write_data_files(forecasts, ensembles, markets, edges, observations, pace_data, ai_results)
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
