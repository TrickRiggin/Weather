export const AI_ANALYSIS = {
  "claude": {
    "summary": "{\n  \"summary\": \"Ensemble models show strong cold signals for NYC, Chicago, and Philadelphia versus overly optimistic market pricing, while Denver pace anomaly and Atlanta/Chicago NO signals offer solid fade opportunities. The most trustworthy edges cluster around well-defined synoptic patterns (cold",
    "picks": []
  },
  "gpt": {
    "summary": "The ensemble forecasts show strong consensus on several temperature thresholds, particularly for New York, Chicago, Philadelphia, and Los Angeles highs, where the market appears undervaluing the probabilities. Some edges on lows and Denver highs are less certain due to model spread and local factors.",
    "picks": [
      {
        "city": "New York",
        "type": "high",
        "threshold": "53",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Moderate model agreement (3 models) with a forecast horizon of 2 days; ensemble temps near 47F with a steady warming trend, so 53F is plausible but slightly above ensemble mean. Urban heat island effect in NYC could push temps higher. Market undervalues this, but confidence is tempered by forecast horizon and model spread."
      },
      {
        "city": "Chicago",
        "type": "high",
        "threshold": "65",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "Good model agreement (3 models) with temps forecasted around 63-65F for April 8-9, close to threshold. Ensemble range supports a high probability of exceeding 65F. Market significantly undervalues this. No major weather patterns expected to suppress temps. Confidence strong."
      },
      {
        "city": "Philadelphia",
        "type": "high",
        "threshold": "59",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "3 models show temps rising from low 50s to mid 50s on April 9, with a jump to mid 60s on April 10. Threshold 59F is near the upper bound for April 9, so some uncertainty exists. Coastal proximity could moderate temps slightly. Market undervalues this, but confidence is moderate due to forecast horizon and variability."
      },
      {
        "city": "Chicago",
        "type": "high",
        "threshold": "70",
        "signal": "NO",
        "confidence": "STRONG",
        "reasoning": "Ensemble forecasts show a sharp drop to high 40s on April 10, well below 70F. Market overvalues probability of exceeding 70F. Model agreement is good, and no known patterns suggest a warm spike. Strong confidence in NO."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "38",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Model agreement moderate but forecast horizon longer; temps forecasted in low 70s highs with lows likely above 38F. Mountain terrain can cause variability, but current ensemble suggests low chance of dropping below 38F. Market overvalues this; lean NO."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "45",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble suggests lows near or above mid 40s, with some model spread. Mountain effects and diurnal variation could cause lows near 45F. Market undervalues this probability. Confidence moderate due to terrain complexity."
      },
      {
        "city": "Los Angeles",
        "type": "high",
        "threshold": "75",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "3 models agree on highs around 74F with a range up to 81.6F, making 75F a reasonable threshold to exceed. Coastal and urban heat island effects support warmer temps. Market significantly undervalues this; strong confidence."
      },
      {
        "city": "Dallas",
        "type": "high",
        "threshold": "79",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble temps near 79-80F with moderate model agreement. Market undervalues probability, but forecast horizon and slight model spread suggest some caution. Urban heat island may support warmer temps."
      },
      {
        "city": "Atlanta",
        "type": "low",
        "threshold": "51",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble temps for lows near 68F, well above 51F. Market overvalues probability of lows below 51F. Confidence moderate given stable forecast and no significant cold fronts expected."
      },
      {
        "city": "Houston",
        "type": "high",
        "threshold": "79",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble temps near 79-80F with moderate model agreement. Market undervalues probability. Coastal humidity and urban heat island may support warmer temps, but some variability possible."
      },
      {
        "city": "Miami",
        "type": "low",
        "threshold": "71",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble temps near 76-77F, well above 71F threshold. Market undervalues probability. Coastal and tropical climate stable, so confidence moderate."
      },
      {
        "city": "Chicago",
        "type": "low",
        "threshold": "46",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble lows near mid 40s with moderate model agreement. Market undervalues probability. No major cold fronts expected, confidence moderate."
      },
      {
        "city": "Phoenix",
        "type": "low",
        "threshold": "68",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble lows near low 90s highs but lows likely above 68F. Market undervalues probability. Desert climate stable, but diurnal variation could affect lows. Moderate confidence."
      },
      {
        "city": "Dallas",
        "type": "low",
        "threshold": "60",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble lows near 60F with moderate model agreement. Market undervalues probability. Urban heat island effect may support warmer lows. Moderate confidence."
      },
      {
        "city": "Denver",
        "type": "high",
        "threshold": "76",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble highs near 72-74F with some spread; threshold 76F slightly above mean but possible. Market undervalues probability. Mountain terrain adds uncertainty; confidence moderate."
      }
    ]
  }
};
