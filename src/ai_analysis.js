export const AI_ANALYSIS = {
  "claude": {
    "summary": "{\n  \"summary\": \"The ensemble models are showing strong divergence from current market prices across multiple cities, with the most compelling edges in Chicago (cooling front dramatically oversold by market), New York (persistent cool pattern underpriced), and Denver (warm anomaly not yet priced in).",
    "picks": []
  },
  "gpt": {
    "summary": "The ensemble forecasts show strong signals for several temperature thresholds with good model agreement and reasonable forecast horizons, particularly for New York, Chicago, Philadelphia, Denver, Los Angeles, Dallas, and Houston. Market prices appear misaligned in many cases, offering attractive edges especially where urban heat island or coastal effects are minimal or well accounted for.",
    "picks": [
      {
        "city": "New York",
        "type": "high",
        "threshold": "53",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "High ensemble agreement (3 models) with a solid forecast horizon and a consistent warming trend from 47F to near 60F by April 10. Market underprices this significantly, and no major coastal or urban heat island effects are expected to disrupt this pattern."
      },
      {
        "city": "Chicago",
        "type": "high",
        "threshold": "65",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Moderate ensemble agreement (3 models) with a forecast horizon of 2-3 days. The forecast shows a cooling trend after April 9 but still supports highs near 64F. Urban heat island effects could slightly boost temps, supporting the YES signal, but some model spread exists."
      },
      {
        "city": "Philadelphia",
        "type": "high",
        "threshold": "59",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Good model agreement with 3 models and a forecast horizon of 2-3 days. The ensemble shows a warming trend from low 50s to mid 60s by April 10. Coastal proximity may moderate extremes but unlikely to negate the warming trend."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "45",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Strong ensemble agreement (3 models) with a forecast horizon of 2-3 days. Mountainous terrain can cause variability, but the consistent signal and market underpricing support a YES. Cooler nights expected with no strong fronts forecasted."
      },
      {
        "city": "Los Angeles",
        "type": "high",
        "threshold": "75",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Moderate ensemble agreement (3 models) and a forecast horizon of 2-3 days. Coastal effects may moderate highs, but the ensemble range (68.8-81.6F) supports the possibility of highs above 75F. Market underpricing suggests value."
      },
      {
        "city": "Dallas",
        "type": "high",
        "threshold": "79",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Good ensemble agreement (3 models) with a forecast horizon of 2-3 days. Forecasts show highs near 79-80F, slightly above current market pricing. No major fronts expected to disrupt warming trend."
      },
      {
        "city": "Houston",
        "type": "high",
        "threshold": "79",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Strong ensemble agreement (3 models) with a forecast horizon of 2-3 days. Forecast highs near 79-80F align with urban heat island effects and no significant weather disruptions forecasted."
      }
    ]
  }
};
