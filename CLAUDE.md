# Weather Edge — Project Context

Weather market prediction platform. React 19 + Vite frontend, Python data pipeline, GitHub Actions automation.
- Repo: https://github.com/TrickRiggin/Weather
- Title: "AA's Weather Edge"
- Domain: weather.trickriggin.ai (Cloudflare Pages)
- Same family as March Madness, Bats, Hoops, Pucks

## Key Files
- `src/App.jsx` — React frontend (Scanner, Cities, Guide tabs)
- `refresh_weather.py` — Python pipeline (OpenMeteo, Kalshi, NWS, AI analysis, historical tracking)
- Auto-generated JS: `markets.js`, `forecasts.js`, `edges.js`, `observations.js`, `ai_analysis.js`, `meta.js`, `results.js`
- `data/signals.jsonl` — Historical edge signal snapshots (append-only)
- `data/resolutions.jsonl` — Resolved signals with actual temps, WIN/LOSS, P&L
- `.github/workflows/refresh.yml` — Refresh via cron-job.org repository_dispatch

## Architecture

### Data Sources
- **OpenMeteo API** (paid tier, `OPENMETEO_API_KEY`) — multi-model forecasts in ONE request
  - 7 models: `gfs_seamless`, `ecmwf_ifs025`, `icon_seamless`, `gem_seamless`, `jma_seamless`, `ncep_hrrr_conus`, `ncep_nbm_conus`
  - Multi-location + multi-model batched into a single API call
  - Response keys have model suffix: `temperature_2m_max_gfs_seamless`
  - HRRR nulls past ~48h, HRRR/NBM are CONUS-only
- **Kalshi API** — weather binary contracts (NO auth needed for reading)
  - Base: `https://api.elections.kalshi.com/trade-api/v2`
  - Series: `KXHIGH{CITY}` (highs), `KXLOWT{CITY}` (lows)
  - ~6 mutually exclusive contracts per event forming a probability distribution
  - Midpoint price = implied probability (contracts are $0-$1)
  - `with_nested_markets=true` is critical on the events endpoint
- **NWS Observation API** (free) — current temps for pace tracking
  - Airport stations: KNYC, KLAX, KMDW, KMIA, KDFW, KDEN, KPHL, KATL, KIAH, KPHX
- **OpenRouter** (`OPENROUTER_API_KEY`) — Claude Sonnet + GPT-4.1-mini for AI analysis

### 10 Cities (High-Volume Kalshi Markets)
NYC, LAX, CHI, MIA, DAL, DEN, PHI, ATL, HOU, PHX

### Spread Formula
```
ensemble_mean = avg(model_highs)  # or lows
ensemble_std = max(std(model_highs), SIGMA_FLOOR)  # SIGMA_FLOOR = 3.5F
P(above T) = 1 - normCDF((T - ensemble_mean) / ensemble_std)
edge = our_probability - kalshi_midpoint
signal = YES/NO when |edge| >= 5%
```

### Pace Tracking (Intraday)
- HRRR gives hourly temperature curve in city's LOCAL timezone
- NWS gives current observed temperature
- pace_delta = observed - HRRR_expected_at_this_hour
- adjusted_high = HRRR_forecast_high + pace_delta
- Timezone offsets hardcoded (no pytz): ET=-4, CT=-5, MT=-6, PT=-7, AZ=-7

### AI Analysis
- Claude Sonnet + GPT-4.1-mini via OpenRouter
- Fed top 15 edge signals + ensemble data
- Return structured JSON with picks + confidence (STRONG/LEAN/SKIP)
- Runs on every refresh (fast enough, cheap enough)

## Refresh Schedule
- **Every 20-30 min** — cron-job.org -> `repository_dispatch` (type: `light-refresh`)
- Single workflow handles everything (no heavy/light split — pipeline runs in ~45s)
- Full pipeline: OpenMeteo forecasts -> ensemble -> Kalshi markets -> edges -> NWS obs -> pace -> AI analysis -> record signals -> resolve past signals -> write src/

## UI
- Dark theme (#0f172a backgrounds, blue/cyan #3b82f6/#06b6d4 gradient accents)
- Mobile-friendly, same family aesthetic as other AA apps
- **Scanner tab**: Top signal cards + sortable/filterable market table
- **Cities tab**: City selector with current temps, 3-day forecast, model breakdown, pace indicator, per-city edges
- **Results tab**: Track record — hero stats (win rate, record, streak, P&L, ROI), edge tier breakdown with progress bars, YES/NO direction cards, per-pick table with actual temps
- **Guide tab**: Methodology explanation

## Important Gotchas
- `yes_bid=0.0` is falsy in Python — use `is not None` checks, not truthiness
- Settled/dead contracts (bid=0, ask=0.01) must be filtered or they create phantom edges
- HRRR hourly times are in city LOCAL timezone (OpenMeteo `timezone=auto`), NWS observations are UTC — must convert
- Kalshi "between" contracts are narrow 2-degree buckets — with sigma=3.5F, any single bucket gets ~10-15% max probability
- SIGMA_FLOOR=3.5F is a global floor; tropical cities (MIA) have lower forecast error for lows than continental cities (DEN)
- JMA model is coarsest for US locations (55km) — frequently the outlier
- OpenMeteo model name gotcha: `ncep_hrrr_conus` not `hrrr_conus`, `ncep_nbm_conus` not `nbm_conus`
- Kalshi rate limits: 0.5s delay between series fetches to avoid 429s

## Secrets (GitHub + .env)
- `OPENMETEO_API_KEY` — paid tier, avoids rate limits
- `OPENROUTER_API_KEY` — Claude/GPT AI analysis
- `KALSHI_API_KEY` — not currently used (read-only is unauthenticated) but available
- `KALSHI_RSA_KEY` — same, for future trading integration

## Historical Data & Backtesting
- **Signal recording**: Every refresh appends edge signals to `data/signals.jsonl` (deduped within 1 hour per ticker)
- **Resolution**: Each refresh checks if past signals' markets have closed (close_time + 2h), fetches actual temps from NWS observations, scores WIN/LOSS with P&L
- **Actual temps source**: NWS airport station observations (same stations as pace tracker) — max/min temp for the date in the city's local timezone
- **P&L model**: $1 bet at market ask (YES signals) or 1-bid (NO signals), collect $1 on win
- **Backtest report**: `python refresh_weather.py --backtest` — win rate, P&L by edge bucket/city/type/direction, AI pick accuracy, calibration
- **Signal schema**: `{id, snapshot_ts, city, date, type, ticker, strike_type, floor, cap, threshold, our_prob, market_mid, edge, signal, ev, yes_bid, yes_ask, volume, close_time, ensemble_mean, ensemble_std, model_count, pace_delta, ai}`
- **Resolution schema**: `{signal_id, ticker, city, date, type, threshold, signal, edge, our_prob, market_mid, ensemble_mean, ensemble_std, actual_temp, contract_resolved_yes, result, buy_price, pnl, ai, resolved_at}`

## Future Ideas
- City-specific sigma floors (calibrate from historical forecast error — now possible with backtest data)
- Weight models differently by forecast horizon (HRRR for day 0, ECMWF for day 2+)
- Model leaderboard (which models are sharpest per city/metric? — track per-model forecasts in signals)
- Pace-adjusted ensemble feeding back into edge calculation
- Telegram alerts for high-edge opportunities
- Expand to 20 cities (all Kalshi markets)
- Rain/snow/wind contract support
