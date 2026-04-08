export const AI_ANALYSIS = {
  "claude": {
    "summary": "Denver stands out as the clearest opportunity with strong ensemble agreement on warm temps well above thresholds, while the Dallas/Phoenix/Atlanta 'low' markets appear mispriced with markets overestimating cold overnight lows given the warm daytime forecasts. LA high 76F is a speculative lean given high model spread.",
    "picks": [
      {
        "city": "Denver",
        "type": "high",
        "threshold": "71",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "Ensemble mean of 71.1F with range 65.9-73.5F across 7 models puts us right at the threshold with ~49% probability, yet market is only pricing 17%. Denver is notorious for rapid warm-ups in April with strong downslope Chinook winds, and the current temp of 55.4F with a +15.7F expected rise is consistent with a classic spring warm pattern. Model agreement is solid. Market is dramatically underpricing this. Best edge on the board."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "45",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble strongly supports warm conditions (mean 71.1F high), making a low above 45F plausible, and our 85% vs market 62% suggests real edge. However, Denver lows can be deceptive \u2014 clear skies after warm days can cause rapid radiative cooling, and the city sits at elevation. The pace indicator (+4.7F) is supportive. Reasonable edge but Denver overnight temps are volatile, so not STRONG."
      },
      {
        "city": "Dallas",
        "type": "low",
        "threshold": "57",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Dallas ensemble high of 76.9F is warm and consistent across 7 models, but a LOW threshold of 57F is a different question entirely. Overnight lows in Dallas in early April can easily drop 20-25F from daytime highs, especially with any frontal passage. The market at 76% YES (low stays above 57F) seems high, and our 40% implies significant downside risk. However, Dallas urban heat island effect supports warmer lows, and the current temp of 60.8F suggests a warm airmass in place. Edge is real but overnight low forecasting is noisier \u2014 lean NO rather than strong."
      },
      {
        "city": "Phoenix",
        "type": "low",
        "threshold": "67",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Phoenix ensemble high of 95.1F is very hot and well-agreed across 7 models, but the LOW threshold of 67F is the question. Phoenix in April can have lows in the mid-50s to low 60s even on hot days \u2014 a 95F high with a 67F low is not guaranteed. Desert radiative cooling is extreme. Market at 78% seems to be anchoring too heavily on the hot daytime signal. Our 42% feels more defensible. However, with such extreme heat, the overnight recovery may be slower, keeping lows elevated. Lean NO but not STRONG given desert cooling dynamics cut both ways."
      },
      {
        "city": "Atlanta",
        "type": "low",
        "threshold": "51",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Atlanta ensemble high of 68.1F with extremely tight model agreement (range only 67.4-68.9F) is impressive, but a low threshold of 51F means we need overnight temps to stay above 51F. Atlanta in April with a 68F high could easily see lows in the upper 40s to low 50s depending on cloud cover and wind. Market at 78% YES seems aggressive. Our 52% is more neutral. The tight model range on the high is actually a signal of a stable, settled airmass which could support warmer lows, but 25% edge is meaningful. Lean NO."
      },
      {
        "city": "Los Angeles",
        "type": "high",
        "threshold": "76",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "LA ensemble mean of 72.2F with a wide range of 68.5-82.3F and high spread (+/-4.73F) reflects genuine model disagreement. The upper end of the range (82.3F) shows some models see a hot day, likely driven by offshore flow or Santa Ana-adjacent conditions. Market at only 6% for hitting 76F seems too low given the range. However, LA coastal marine influence typically caps temperatures, and the mean is well below 76F. This is a speculative play on the hot-tail scenario. The pace indicator (+5.6F above current) is supportive of warming. Lean YES but small position sizing warranted given high uncertainty."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "38",
        "signal": "NO",
        "confidence": "SKIP",
        "reasoning": "Our probability of 0% vs market 10% gives a mathematical edge, but a 10% market price on an extreme cold scenario with only ~11% EV is not worth the noise. With Denver forecasted warm, the chance of a sub-38F low is genuinely near zero, but the market is already pricing it cheaply. Thin EV, small absolute edge, and the asymmetric risk of being wrong on a tail event makes this a skip. Not enough juice."
      }
    ]
  },
  "gpt": {
    "summary": "The ensemble forecasts show strong signals for Denver and Los Angeles edges with good model agreement and reasonable forecast horizon, suggesting value in those markets. Conversely, the Dallas, Phoenix, and Atlanta edges appear overvalued by the market given ensemble probabilities and city-specific factors, indicating caution or avoidance.",
    "picks": [
      {
        "city": "Denver",
        "type": "high",
        "threshold": "71F",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "High model agreement (7 models), consistent forecast horizon (April 8), and a clear signal with ensemble mean near threshold and low uncertainty. Denver's inland location reduces coastal influence, making the ensemble forecast reliable."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "45F",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Strong ensemble signal with 85% probability vs market 62%, good model agreement, but low temperature forecasts can be sensitive to local terrain and diurnal effects. Confidence is good but slightly tempered by potential local variability."
      },
      {
        "city": "Los Angeles",
        "type": "high",
        "threshold": "76F",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble shows 21% probability vs market 6%, with moderate model agreement and a forecast horizon of April 8. Coastal influence and urban heat island effects can cause some variability, but the signal is strong enough to lean YES."
      },
      {
        "city": "Dallas",
        "type": "low",
        "threshold": "57F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble probability (40%) is well below market (76%), indicating market overpricing. Models show good agreement but Dallas can have rapid temperature swings due to frontal passages, so some caution is warranted."
      },
      {
        "city": "Phoenix",
        "type": "low",
        "threshold": "67F",
        "signal": "NO",
        "confidence": "STRONG",
        "reasoning": "Ensemble probability (42%) is significantly lower than market (78%) with strong model agreement and stable desert climate patterns. Large temperature jumps unlikely, so market edge is likely overstated."
      },
      {
        "city": "Atlanta",
        "type": "low",
        "threshold": "51F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble shows 52% vs market 78%, moderate model agreement but Atlanta's variable spring weather and urban heat island could cause some fluctuations. Lean NO due to market overpricing but with some caution."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "38F",
        "signal": "NO",
        "confidence": "SKIP",
        "reasoning": "Low ensemble probability (0%) vs market (10%) but low absolute probabilities and small edge suggest limited value. Forecast horizon and local terrain effects add uncertainty."
      }
    ]
  }
};
