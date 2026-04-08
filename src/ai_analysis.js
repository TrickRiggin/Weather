export const AI_ANALYSIS = {
  "claude": {
    "summary": "{\n  \"summary\": \"Markets appear significantly mispriced on several fronts, particularly on overnight lows where the market is pricing in warm outcomes that the ensemble strongly contradicts, and on a f",
    "picks": []
  },
  "gpt": {
    "summary": "The ensemble forecasts show strong signals for cooler lows in Denver and warmer highs and lows in Miami and Chicago, contradicting market prices that appear overly optimistic on warmth in several southern cities and lows in Dallas and Los Angeles. Market edges favoring NO on several warm thresholds seem overbet given model consensus and forecast horizon.",
    "picks": [
      {
        "city": "Dallas",
        "type": "low",
        "threshold": "51-52F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble models consistently forecast lows above 64F currently, with narrow spread and 7-day horizon. Market heavily favors low temps near 51-52F which is inconsistent with model consensus. Urban heat and seasonality support warmer lows."
      },
      {
        "city": "Los Angeles",
        "type": "low",
        "threshold": "57-58F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models agree on lows well above 62F currently, with coastal moderation and urban heat island effects. Market overprices low temps near 57-58F, unlikely given stable marine influence and forecast consistency."
      },
      {
        "city": "Denver",
        "type": "low",
        "threshold": "45F",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "Ensemble median near 57F with tight spread but current temps at 57.2F and forecast horizon allows for cooling overnight lows near 45F especially given elevation and possible radiational cooling. Market underprices this possibility."
      },
      {
        "city": "Los Angeles",
        "type": "low",
        "threshold": "58-59F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Similar to 57-58F low, models and local climatology do not support lows this cool. Market edge likely overestimates chance of cooler lows."
      },
      {
        "city": "Phoenix",
        "type": "high",
        "threshold": "96-97F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models forecast highs near mid-90s with some spread but 96-97F is on the high end. Market overprices extreme highs despite ensemble uncertainty and current temps in low 80s, so downside risk exists."
      },
      {
        "city": "Houston",
        "type": "high",
        "threshold": "79-80F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble forecasts highs near upper 70s to low 80s but market overprices probability of hitting 79-80F. Forecast horizon and local moisture patterns suggest less likelihood of this threshold."
      },
      {
        "city": "Miami",
        "type": "high",
        "threshold": "76F",
        "signal": "YES",
        "confidence": "STRONG",
        "reasoning": "Ensemble median near 77F with tight spread and current temps near 71.6F support a warm high above 76F. Market underprices this, likely due to underestimating warm stable conditions and urban heat."
      },
      {
        "city": "Miami",
        "type": "low",
        "threshold": "69-70F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models suggest lows closer to mid-70s, so market overprices chance of cooler lows near 69-70F. Coastal and urban heat effects reduce likelihood of such cool lows."
      },
      {
        "city": "Chicago",
        "type": "high",
        "threshold": "63F",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble median highs near 63-64F with moderate spread and current temps near 35.6F support warming trend. Market underprices chance of hitting 63F, though some uncertainty remains due to spring variability."
      },
      {
        "city": "Miami",
        "type": "high",
        "threshold": "80-81F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models show highs mostly below 78-79F, so market overprices extreme highs near 80-81F. Warmth is expected but not quite at this level given forecast horizon."
      },
      {
        "city": "Miami",
        "type": "low",
        "threshold": "70F",
        "signal": "YES",
        "confidence": "LEAN",
        "reasoning": "Ensemble lows near mid-70s suggest market underprices chance of lows above 70F. Urban heat and coastal moderation support warmer lows."
      },
      {
        "city": "Chicago",
        "type": "low",
        "threshold": "34-35F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models forecast lows near mid-30s but market overprices chance of hitting this low threshold. Slightly warmer lows are more likely given forecast trends."
      },
      {
        "city": "Atlanta",
        "type": "low",
        "threshold": "50-51F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Ensemble lows near mid-60s make lows near 50-51F unlikely. Market overprices cold lows, inconsistent with forecast and season."
      },
      {
        "city": "Miami",
        "type": "low",
        "threshold": "67-68F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Similar to other Miami low picks, lows below 70F are unlikely given model consensus and urban/coastal effects."
      },
      {
        "city": "Phoenix",
        "type": "low",
        "threshold": "66-67F",
        "signal": "NO",
        "confidence": "LEAN",
        "reasoning": "Models forecast highs in 90s and lows likely above 70F. Market overprices chance of such cool lows given desert climate and forecast horizon."
      }
    ]
  }
};
