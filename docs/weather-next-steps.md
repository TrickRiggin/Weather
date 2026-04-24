# Weather Edge Next Steps

## Strong Recommendation
Do not do a full rewrite yet. The app needed a better scoreboard first, and that is now in place. The next work should attack the specific broken slices instead of rebuilding everything blindly.

## Priority Queue
1. Rebuild or replace the high-temperature model before allowing any high signal again.
   - Start with contract-level diagnostics by city, strike type, threshold distance, horizon, and time-to-close.
   - Check whether the high forecast mean is biased or whether probability width/shape is the main failure.
   - Compare against Kalshi midpoint as the baseline, not against raw win rate alone.

2. Split the active low strategy by horizon.
   - Current replay says day-1 lows are carrying the edge.
   - Horizon 0 is negative and should probably be paused or separately gated unless more data proves otherwise.

3. Add closing-line-value tracking.
   - P&L is noisy with small samples.
   - If the model cannot beat closing market prices, the apparent edge is probably noise.

4. Stop treating NO and YES lows as equivalent.
   - Low YES has strong historical P&L but likely comes from lower buy prices and tail payouts.
   - Low NO wins often but has negative P&L in replay. That may need a stricter price/edge gate.

5. Improve the result presentation.
   - Keep historical recorded picks visible.
   - Make the current-gate replay the primary model-health metric.
   - Add a short note that historical picks include older rules.

6. Revisit range buckets only after the cumulative contracts are stable.
   - The model has positive Brier skill on between buckets, but Kalshi range contracts have settlement and pricing quirks.
   - Do not trade them until the app prices the full event distribution coherently.

## Not Worth Doing Yet
- Do not add more cities until the current 10-city calibration is defensible.
- Do not add Telegram alerts while high and horizon-0 behavior are still untrusted.
- Do not tune thresholds by hand from the same small replay sample and call it a model improvement.
- Do not bring LLM analysis back into the edge calculation; singular temperature contract pricing does not need narrative.

## Minimum Validation For Future Model Changes
- `python refresh_weather.py --audit`
- `python refresh_weather.py --backtest`
- `npm run lint`
- `npm run build`

For any pipeline change, compare model Brier score against market midpoint by:
- all contracts
- less/greater only
- high less/greater
- low less/greater
- horizon bucket
