# Weather Edge Current State

Last updated: 2026-04-24
Latest model checkpoint: `9d114da` (`Pause high signals and add strategy audit`)

## Production Stance
- High-temperature signals are paused with `SUPPRESS_HIGH_SIGNALS = True`.
- Low-temperature signals remain active with the current gate: `12% <= |edge| <= 20%`.
- Range buckets are priced for context only and never become actionable signals.
- Very large disagreements remain killed as likely model failures, not alpha.
- Pace is display-only; it is not used in probability math.

## Why Highs Are Paused
- Recorded high picks remain weak: 81 resolved highs, 25.9% win rate, -$0.0557 average P&L.
- Audit on 15,219 resolved contract snapshots shows high less/greater Brier score is materially worse than Kalshi midpoint:
  - model: 0.1641
  - market: 0.1058
  - skill: -55.0%
- This is not a threshold problem. The high model is structurally worse than the market on the contracts we can trade.

## Latest Audit Read
Command: `python refresh_weather.py --audit`

- Resolved contract snapshots: 15,219
- All snapshots Brier: model 0.1254 vs market 0.1427, +12.1% skill
- Less/greater Brier: model 0.1842 vs market 0.1646, -11.9% skill
- Between-bucket Brier: model 0.1110 vs market 0.1373, +19.2% skill
- Low less/greater Brier: model 0.1955 vs market 0.1978, +1.2% skill

Current gate replay:
- 120 replayed picks
- 78-42 record, 65.0% win rate
- +$6.25 P&L, +8.7% ROI
- Highs: 0 picks
- Lows: 120 picks, +$6.25
- Horizon 0: -$1.45
- Horizon 1: +$7.70

## Evaluation Gotcha
`python refresh_weather.py --backtest` reports the picks actually recorded under older strategy versions. Use it for historical accounting, not for judging the current gate.

Use `python refresh_weather.py --audit` to judge current production rules against the full resolved contract snapshot dataset.

## Operational Notes
- GitHub Actions now has a native 30-minute schedule fallback in addition to the external cron dispatch.
- Generated frontend data was refreshed after the high-signal pause and shows 0 live signals when no low edge qualifies.
- The Results UI now includes a "Current gate replay" panel separate from historical recorded picks.
