# Weather Edge — Project Context

Weather market prediction platform. React 19 + Vite frontend, Python data pipeline.
- Title: "AA's Weather Edge 2026"
- Same family as March Madness, Bats, Hoops, Pucks

## Architecture

### Data Sources
- **OpenMeteo API** (free tier) — multi-model weather forecasts
  - HRRR (3km, hourly, best same-day) — primary pace anchor
  - GFS (global, 6-hourly runs)
  - ECMWF (European model, gold standard for 3-7 day)
  - ICON (German DWD model)
  - JMA (Japanese model)
  - GEM (Canadian model)
  - NBM (NWS blend — already an ensemble of ~20 models)
  - Each model = one "wiseman" in our ensemble
- **Kalshi API** — weather binary contracts (highs, lows, ranges)
  - Ticker format: `KXHIGH{CITY}-{DATE}-T{THRESHOLD}` (e.g. KXHIGHLAX-26APR07-T73)
  - Contract types: high temp above/below, low temp above/below, temp ranges
  - Cities: ~20 major US cities
- **NWS Observation API** (free) — actual recorded temperatures for resolution + pace tracking
- **OpenMeteo Historical API** — for backtesting model accuracy

### Core Concept: Ensemble Edge Detection
Same philosophy as March Madness Three Wisemen, but with weather models instead of AI:
1. Fetch forecasts from N weather models for each city/day
2. Build probability distribution from model spread (not just point estimate)
3. For each Kalshi contract threshold, calculate P(above) from our distribution
4. Compare our probability vs Kalshi market price
5. Edge = our_probability - market_implied_probability
6. Signal: BET YES/NO when edge exceeds threshold (e.g. 5%+)

### Key Features (Priority Order)
1. **Market Scanner** — table of all active Kalshi weather contracts with our edge estimate
2. **City Dashboard** — per-city forecast detail with model breakdown
3. **Ensemble Probability Engine** — multi-model distribution -> contract probability
4. **Pace Tracker** — intraday: current observed temp vs HRRR hourly curve (same-day edge refinement)
5. **Edge Alerts** — Telegram notifications when edge exceeds threshold
6. **Historical Accuracy** — did our ensemble beat the market? Track over time
7. **Model Leaderboard** — which weather models are sharpest for which cities/metrics

### Pipeline Design (Python)
```
refresh_weather.py
  1. Fetch Kalshi weather contracts (active markets)
  2. For each city/date with active contracts:
     a. Fetch OpenMeteo multi-model forecasts
     b. Fetch NWS current observations (for pace)
  3. Build ensemble distribution per city/date
  4. Calculate edge vs each contract threshold
  5. Write data files to src/ (same pattern as madness)
  6. Optional: Telegram alerts for high-edge opportunities
```

### Frontend (React + Vite)
Same dark theme (#0f172a + amber accents), mobile-friendly.

Tabs:
- **Scanner** — market table with edge %, signal, volume, expiry countdown
- **Cities** — per-city detail with model forecasts, hourly curves, pace tracking
- **Performance** — historical accuracy tracking
- **Guide** — methodology explanation

### Kalshi Weather Cities (expected)
Atlanta, Austin, Boston, Chicago, Dallas, Denver, Houston, Las Vegas,
Los Angeles, Miami, Minneapolis, Nashville, New York, Philadelphia,
Phoenix, San Antonio, San Francisco, Seattle, St. Louis, Washington DC

### Probability Calculation
For a threshold T (e.g. "high temp >= 73F"):
- Get forecast high from each model: [71.1, 72.5, 70.8, 73.2, 71.5, ...]
- Ensemble mean = mean(forecasts), ensemble std = std(forecasts)
- If std is too small (models agree), use historical forecast error as floor
- P(above T) = 1 - normCDF((T - ensemble_mean) / sigma)
- Edge = P(above T) - kalshi_yes_price

### Temperature Pace (Same-Day)
For markets expiring today:
- HRRR gives hourly temperature curve
- NWS gives current observed temperature
- Compare observed vs where HRRR expected us to be at this hour
- Pace adjustment: forecast_high + (observed - expected_at_hour)
- This is the intraday edge signal — catches when reality diverges from forecast

## UI Preferences
- Dark theme (#0f172a backgrounds, amber #f59e0b accents)
- Mobile-friendly
- Same family aesthetic as Bats/Hoops/Pucks/Madness

## Key Files
- `src/App.jsx` — Main React app
- `refresh_weather.py` — Python data pipeline
- `src/data.js` — Auto-generated forecast data
- `src/markets.js` — Auto-generated Kalshi market data

## Important Notes
- OpenMeteo is free but rate-limited — batch requests, cache aggressively
- Kalshi weather markets typically expire same-day or next-day
- HRRR updates every hour — most valuable for same-day markets
- GFS/ECMWF update every 6-12 hours — better for next-day+
- Temperature forecast error is roughly gaussian with sigma ~2-4F depending on model/horizon
