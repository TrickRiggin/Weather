# Weather Edge — Project Context

Weather market prediction platform. React 19 + Vite frontend, Python data pipeline, GitHub Actions automation.
- Repo: https://github.com/TrickRiggin/Weather
- Title: "AA's Weather Edge"
- Domain: weather.trickriggin.ai (Cloudflare Pages)
- Same family as March Madness, Bats, Hoops, Pucks

## Key Files
- `src/App.jsx` — React frontend (Scanner, Cities, Guide tabs)
- `refresh_weather.py` — Python pipeline (OpenMeteo, Kalshi, NWS, pace tracking, historical tracking)
- `calibrate.py` — Historical verification: fetches 2yr actuals + 1yr model forecasts, computes city/type/month sigma + bias
- Auto-generated JS: `markets.js`, `forecasts.js`, `edges.js`, `observations.js`, `ai_analysis.js`, `meta.js`, `results.js`
- `data/signals.jsonl` — Historical edge signal snapshots (append-only)
- `data/resolutions.jsonl` — Resolved signals with actual temps, WIN/LOSS, P&L
- `.github/workflows/refresh.yml` — Refresh via cron-job.org repository_dispatch

## Architecture

### Data Sources
- **OpenMeteo API** (paid tier, `OPENMETEO_API_KEY`) — multi-model forecasts in ONE request
  - 3 models: `ncep_hrrr_conus` (3km, best day 0-1), `ncep_nbm_conus` (2.5km, 31-model blend), `ecmwf_ifs025` (14km, best global)
  - Dropped GFS (redundant, NBM already includes it), ICON (Europe-optimized), GEM (Canada-optimized), JMA (55km noise)
  - Multi-location + multi-model batched into a single API call
  - Response keys have model suffix: `temperature_2m_max_ncep_hrrr_conus`
  - HRRR nulls past ~48h, HRRR/NBM are CONUS-only
- **Kalshi API** — weather binary contracts (NO auth needed for reading)
  - Base: `https://api.elections.kalshi.com/trade-api/v2`
  - Series: `KXHIGH{CITY}` (highs), `KXLOWT{CITY}` (lows)
  - ~6 mutually exclusive contracts per event forming a probability distribution
  - Midpoint price = implied probability (contracts are $0-$1)
  - `with_nested_markets=true` is critical on the events endpoint
- **NWS Observation API** (free) — current temps for pace tracking
  - Airport stations: KNYC, KLAX, KMDW, KMIA, KDFW, KDEN, KPHL, KATL, KIAH, KPHX
- **OpenRouter** — REMOVED (AI analysis dropped — singular model temps don't benefit from LLM interpretation)

### 10 Cities (High-Volume Kalshi Markets)
NYC, LAX, CHI, MIA, DAL, DEN, PHI, ATL, HOU, PHX

### Edge Calculation (Horizon-Weighted Ensemble, Calibrated)
```
# Day 0: mean = weighted_avg(HRRR*2, NBM*1, ECMWF*0.5)
# Day 1: mean = weighted_avg(HRRR*1, NBM*1.2, ECMWF*0.8)
# Day 2+: mean = weighted_avg(NBM*1.2, ECMWF*1.0)  # HRRR nulls out

sigma, bias = get_calibration(city, type, date)  # city/type/month-specific from calibrate.py
mean = ensemble_mean - bias  # correct systematic forecast bias
std = max(sigma * 1.3, 1.5)  # inflate for operational conditions, floor at 1.5F
P(above T) = 1 - normCDF((T - mean) / std)
edge = our_probability - kalshi_midpoint

# Signal gating (type-specific after 2026-04-18 backtest):
#   lows:  signal when 12% <= |edge| <= 20%
#   highs: signal when 18% <= |edge| <= 20%   (lower floor removed, backtest lost -$3.21 in 0.12-0.18 band)
# Kill switch (both): |edge| > 20% = model failure, not alpha
# HIGH YES signals are ALWAYS suppressed — 2/39 = 5% WR historical (residual cold-bias symptom)
# Blocklist: (CHI, high), (DEN, high), (DEN, low) — calibration bias wrong-direction or under-correcting

EV capped at 300% (if higher, model is probably wrong, not market)
Near-settled filter: skip contracts with mid <= 8% or mid >= 92%
```

### Pace Tracking (Intraday — Display Only)
- HRRR gives hourly temperature curve in city's LOCAL timezone
- NWS gives current observed temperature
- pace_delta = observed - HRRR_expected_at_this_hour
- adjusted_high = HRRR_forecast_high + pace_delta
- **Pace is surfaced in the UI as a live indicator but NOT used in edge math.**
  Backtest (2026-04-18) showed pace-adjusted mean had 3.3x worse MAE than raw ensemble
  on day 0 highs (2.17F vs 0.66F) and went 0/7 on signals — an early-morning temperature
  anomaly frequently doesn't carry through to the daily high, so pace systematically
  flipped the mean across thresholds and generated confident wrong bets.
- Uses `zoneinfo.ZoneInfo` for timezone conversion (Python 3.9+)

## Refresh Schedule
- **Every 20-30 min** — cron-job.org -> `repository_dispatch` (type: `light-refresh`)
- Single workflow handles everything (no heavy/light split — pipeline runs in ~45s)
- Full pipeline: OpenMeteo forecasts -> ensemble -> NWS obs -> pace (display only) -> Kalshi markets -> edges (ensemble+calibration) -> record signals -> resolve past signals -> write src/

## UI
- Dark theme (#0f172a backgrounds, blue/cyan #3b82f6/#06b6d4 gradient accents)
- Mobile-friendly, same family aesthetic as other AA apps
- **Scanner tab**: Paywall-style market cards (recommendation banner + forecast/threshold/gap + weather data) + simplified market table
- **Cities tab**: City selector with current temps, 3-day forecast, model breakdown, pace indicator, per-city edges
- **Results tab**: Track record — hero stats (win rate, record, streak, P&L, ROI), edge tier breakdown with progress bars, YES/NO direction cards, per-pick table with actual temps
- **Guide tab**: Methodology explanation

## Important Gotchas
- `yes_bid=0.0` is falsy in Python — use `is not None` checks, not truthiness
- Settled/dead contracts (bid=0, ask=0.01) must be filtered or they create phantom edges
- HRRR hourly times are in city LOCAL timezone (OpenMeteo `timezone=auto`), NWS observations are UTC — must convert
- Kalshi "between" contracts are narrow 2-degree buckets — with sigma=3.5F, any single bucket gets ~10-15% max probability
- Sigma is now city/type/month-specific from `calibrate.py` (data/city_sigma.json), NOT a global floor
- Calibration uses 1yr of OpenMeteo Previous Runs API forecasts vs Archive API actuals (7320 samples)
- Sigma ranges: PHX/MIA/LAX high ~2.0F (inflated), CHI/NYC/DAL high ~3.0-3.5F (inflated)
- Bias correction applied: CHI April highs have -1.6F bias (model runs cold), NYC April lows +1.6F (model runs warm)
- SIGMA_FLOOR=3.0F is now just a fallback when no calibration data exists
- NBM is already a 31-model blend — including raw GFS/ICON/GEM/JMA alongside it dilutes signal (we dropped them)
- OpenMeteo model name gotcha: `ncep_hrrr_conus` not `hrrr_conus`, `ncep_nbm_conus` not `nbm_conus`
- With 3 models, HRRR nulls past 48h → day 2+ has only NBM + ECMWF (2 models, SIGMA_FLOOR dominates std)
- Resolutions track `model_count` — results.js frontend only shows current-era (3-model) results; backtest_report shows era breakdown
- Kalshi rate limits: 0.5s delay between series fetches to avoid 429s

## Secrets (GitHub + .env)
- `OPENMETEO_API_KEY` — paid tier, avoids rate limits
- `OPENROUTER_API_KEY` — no longer used (AI analysis removed), still in secrets
- `KALSHI_API_KEY` — not currently used (read-only is unauthenticated) but available
- `KALSHI_RSA_KEY` — same, for future trading integration

## Historical Data & Backtesting
- **Signal recording**: Every refresh appends edge signals to `data/signals.jsonl` (deduped within 1 hour per ticker)
- **Resolution**: Each refresh checks if past signals' markets have closed (close_time + 2h), fetches actual temps from NWS observations, scores WIN/LOSS with P&L
- **Actual temps source**: NWS airport station observations (same stations as pace tracker) — max/min temp for the date in the city's local timezone
- **P&L model**: $1 bet at market ask (YES signals) or 1-bid (NO signals), collect $1 on win
- **Backtest report**: `python refresh_weather.py --backtest` — win rate, P&L by edge bucket/city/type/direction, calibration
- **Signal schema**: `{id, snapshot_ts, city, date, type, ticker, strike_type, floor, cap, threshold, our_prob, market_mid, edge, signal, ev, yes_bid, yes_ask, volume, close_time, ensemble_mean, ensemble_std, model_count, pace_delta}`
- **Resolution schema**: `{signal_id, ticker, city, date, type, threshold, signal, edge, our_prob, market_mid, ensemble_mean, ensemble_std, actual_temp, contract_resolved_yes, result, buy_price, pnl, resolved_at}`

## Future Ideas
- City-specific sigma floors (calibrate from historical forecast error — now possible with backtest data)
- Pace adjustment for lows (currently only highs get pace-corrected)
- Telegram alerts for high-edge opportunities
- Expand to 20 cities (all Kalshi markets)
- Rain/snow/wind contract support
