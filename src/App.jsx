import { useState, useMemo } from "react";
import { EDGES } from "./edges.js";
import { FORECASTS } from "./forecasts.js";
import { MARKETS } from "./markets.js";
import { OBSERVATIONS } from "./observations.js";
// AI analysis removed — singular model temps don't benefit from LLM interpretation
import { META } from "./meta.js";
import { RESULTS } from "./results.js";

// ========== CITY CONFIG ==========
const CITY_NAMES = {
  NYC: "New York", LAX: "Los Angeles", CHI: "Chicago", MIA: "Miami",
  DAL: "Dallas", DEN: "Denver", PHI: "Philadelphia", ATL: "Atlanta",
  HOU: "Houston", PHX: "Phoenix",
};

const MODEL_LABELS = {
  ncep_hrrr_conus: "HRRR", ncep_nbm_conus: "NBM", ecmwf_ifs025: "ECMWF",
};

const MODEL_COLORS = {
  ncep_hrrr_conus: "#06b6d4", ncep_nbm_conus: "#f97316", ecmwf_ifs025: "#22c55e",
};

// ========== HELPERS ==========
const pct = (v, digits = 0) => v != null ? `${(v * 100).toFixed(digits)}%` : "—";
const signPct = (v) => v != null ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";
const tempF = (v) => v != null ? `${v.toFixed(1)}F` : "—";

const getSignalColor = (signal) => signal === "YES" ? "#22c55e" : signal === "NO" ? "#ef4444" : "#64748b";
const getEdgeColor = (edge) => {
  const abs = Math.abs(edge || 0);
  if (abs >= 0.15) return "#22c55e";
  if (abs >= 0.08) return "#f59e0b";
  return "#64748b";
};

const getConfidenceBadge = (edge) => {
  const abs = Math.abs(edge || 0);
  if (abs >= 0.20) return { label: "STRONG", bg: "#22c55e" };
  if (abs >= 0.10) return { label: "SOLID", bg: "#f59e0b" };
  if (abs >= 0.05) return { label: "LEAN", bg: "#3b82f6" };
  return null;
};

const timeUntil = (closeTime) => {
  if (!closeTime) return "";
  const diff = new Date(closeTime) - new Date();
  if (diff <= 0) return "CLOSED";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

// Card helpers
const getBuyPrice = (e) => {
  if (e.signal === "YES") return e.yes_ask;
  if (e.signal === "NO") return 1 - (e.yes_bid || 0);
  return null;
};

const getWinProb = (e) => {
  if (e.signal === "YES") return e.our_prob;
  if (e.signal === "NO") return 1 - e.our_prob;
  return null;
};

const getForecastData = (e) => {
  const cityFcst = FORECASTS?.[e.city]?.[e.date];
  if (!cityFcst) return { mean: null, std: null, models: null, modelCount: null };
  return e.type === "high"
    ? { mean: cityFcst.high_mean, std: cityFcst.high_std, models: cityFcst.high_models, modelCount: cityFcst.model_count }
    : { mean: cityFcst.low_mean, std: cityFcst.low_std, models: cityFcst.low_models, modelCount: cityFcst.model_count };
};


function App() {
  const [tab, setTab] = useState("scanner");
  const [selectedCity, setSelectedCity] = useState(null);
  const [filterCity, setFilterCity] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState("edge");
  const [filterDate, setFilterDate] = useState("today");
  const [resultsView, setResultsView] = useState("last100");

  // ========== HELPERS ==========
  // Available dates from edges, sorted
  const availableDates = useMemo(() =>
    [...new Set((EDGES || []).map(e => e.date).filter(Boolean))].sort(),
    []
  );
  const todayDate = availableDates[0] || "";

  // Kalshi URL builder — links to the event page (one URL per city+date+type)
  const kalshiUrl = (edge) => {
    if (!edge?.ticker) return "#";
    const eventTicker = edge.ticker.replace(/-[^-]+$/, "");
    const seriesTicker = eventTicker.replace(/-.*$/, "");
    const cityName = (CITY_NAMES[edge.city] || "").toLowerCase().replace(/\s+/g, "-");
    const typeSlug = edge.type === "high" ? "highest" : "lowest";
    return `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${typeSlug}-temperature-in-${cityName}/${eventTicker.toLowerCase()}`;
  };

  // ========== DERIVED DATA ==========
  const activeDate = filterDate === "today" ? todayDate : filterDate === "all" ? null : filterDate;

  const signals = useMemo(() =>
    (EDGES || []).filter(e => e.signal && (!activeDate || e.date === activeDate))
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)),
    [activeDate]
  );

  const allEdges = useMemo(() => {
    let filtered = [...(EDGES || [])];
    if (activeDate) filtered = filtered.filter(e => e.date === activeDate);
    if (filterCity !== "all") filtered = filtered.filter(e => e.city === filterCity);
    if (filterType !== "all") filtered = filtered.filter(e => e.type === filterType);

    if (sortBy === "edge") filtered.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    else if (sortBy === "ev") filtered.sort((a, b) => Math.abs(b.ev) - Math.abs(a.ev));
    else if (sortBy === "volume") filtered.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    return filtered;
  }, [filterCity, filterType, sortBy]);

  const cityList = Object.keys(CITY_NAMES);

  // ========== TAB STYLE ==========
  const ts = (t) => ({
    padding: "8px 16px", cursor: "pointer", borderRadius: 20, fontSize: 12,
    fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
    background: tab === t ? "rgba(245,158,11,0.15)" : "transparent",
    color: tab === t ? "#f59e0b" : "#64748b",
    border: tab === t ? "1px solid rgba(245,158,11,0.3)" : "1px solid transparent",
    transition: "all 0.2s", display: "inline-flex", alignItems: "center", gap: 6,
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", fontFamily: "'Inter', system-ui, sans-serif", color: "#e2e8f0" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>

        {/* HEADER */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontFamily: "Outfit", fontSize: "clamp(24px, 6vw, 40px)", fontWeight: 900, background: "linear-gradient(135deg, #3b82f6, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0, letterSpacing: -1 }}>
            AA's WEATHER EDGE
          </h1>
          <p style={{ color: "#64748b", fontSize: 11, margin: "4px 0 0", letterSpacing: 2, textTransform: "uppercase" }}>
            HRRR + NBM + ECMWF vs Kalshi Markets
          </p>

          {/* Stats bar */}
          <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
            {[
              { label: "Models", value: META?.models || 7 },
              { label: "Cities", value: META?.cities || 10 },
              { label: "Contracts", value: META?.total_contracts || 0 },
              { label: "Signals", value: signals.length, color: signals.length > 0 ? "#22c55e" : "#64748b" },
            ].map(s => (
              <div key={s.label} style={{ fontSize: 11, color: "#64748b" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: s.color || "#e2e8f0", marginRight: 4 }}>{s.value}</span>
                {s.label}
              </div>
            ))}
          </div>

          {/* Updated timestamp */}
          {META?.last_updated && (
            <p style={{ fontSize: 10, color: "#334155", marginTop: 8 }}>
              Last updated: {new Date(META.last_updated).toLocaleString()}
            </p>
          )}
        </div>

        {/* TAB BAR */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={ts("scanner")} onClick={() => setTab("scanner")}>
            Scanner
            {signals.length > 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 10, background: tab === "scanner" ? "#f59e0b" : "#22c55e", color: "#000" }}>{signals.length}</span>}
          </div>
          <div style={ts("cities")} onClick={() => setTab("cities")}>Cities</div>
          <div style={ts("results")} onClick={() => setTab("results")}>
            Results
            {(RESULTS?.summary?.total || 0) > 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 10, background: tab === "results" ? "#f59e0b" : ((RESULTS?.summary?.win_rate || 0) >= 0.55 ? "#22c55e" : "#64748b"), color: tab === "results" ? "#000" : "#fff", marginLeft: 4 }}>{RESULTS.summary.total}</span>}
          </div>
          <div style={ts("guide")} onClick={() => setTab("guide")}>Guide</div>
        </div>

        {/* ==================== SCANNER TAB ==================== */}
        {tab === "scanner" && (
          <div>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
                style={{ padding: "6px 12px", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}>
                <option value="today">Today ({todayDate?.slice(5)})</option>
                {availableDates.slice(1).map(d => <option key={d} value={d}>{d.slice(5)}</option>)}
                <option value="all">All Dates</option>
              </select>
              <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                style={{ padding: "6px 12px", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}>
                <option value="all">All Cities</option>
                {cityList.map(c => <option key={c} value={c}>{CITY_NAMES[c]}</option>)}
              </select>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                style={{ padding: "6px 12px", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}>
                <option value="all">All Types</option>
                <option value="high">Highs</option>
                <option value="low">Lows</option>
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ padding: "6px 12px", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}>
                <option value="edge">Sort: Edge</option>
                <option value="ev">Sort: EV</option>
                <option value="volume">Sort: Volume</option>
              </select>
              <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>
                {allEdges.length} contracts
              </span>
            </div>

            {/* ===== SIGNAL CARDS — Paywall-Style Market Cards ===== */}
            {signals.length > 0 && filterCity === "all" && filterType === "all" && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                  Top Signals
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
                  {signals.slice(0, 8).map((e, i) => {
                    const obs = OBSERVATIONS?.[e.city] || {};
                    const fcst = getForecastData(e);
                    const isToday = e.date === todayDate;
                    const hasPace = isToday && e.type === "high" && obs.adjusted_high != null;
                    const forecastVal = hasPace ? obs.adjusted_high : fcst.mean;
                    const forecastLabel = hasPace ? "PACE ADJ" : "FORECAST";

                    const buyPrice = getBuyPrice(e);
                    const winProb = getWinProb(e);
                    const realEV = (buyPrice && buyPrice > 0 && winProb != null) ? ((winProb / buyPrice - 1) * 100) : 0;

                    // Parse threshold for gap calc
                    const isBetween = typeof e.threshold === "string" && String(e.threshold).includes("-");
                    const thresh = isBetween
                      ? (() => { const parts = String(e.threshold).split("-").map(Number); return (parts[0] + parts[1]) / 2; })()
                      : parseFloat(e.threshold);
                    const gap = (forecastVal != null && !isNaN(thresh)) ? Math.abs(forecastVal - thresh) : null;
                    const gapFavorable = !isNaN(thresh) && forecastVal != null && (
                      (e.signal === "YES" && e.strike_type === "less" && forecastVal < thresh) ||
                      (e.signal === "YES" && e.strike_type === "greater" && forecastVal > thresh) ||
                      (e.signal === "NO" && e.strike_type === "less" && forecastVal >= thresh) ||
                      (e.signal === "NO" && e.strike_type === "greater" && forecastVal <= thresh)
                    );

                    const sigColor = e.signal === "YES" ? "#22c55e" : "#ef4444";
                    const sigBg = e.signal === "YES" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
                    const sigBorder = e.signal === "YES" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)";

                    return (
                      <div key={i} style={{ background: "#0f172a", borderRadius: 12, overflow: "hidden", border: `1px solid ${sigBorder}` }}>

                        {/* Header */}
                        <div style={{ padding: "12px 16px 8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>
                              {e.city_name} <span style={{ color: "#475569" }}>&mdash;</span> <span style={{ color: e.type === "high" ? "#ef4444" : "#3b82f6" }}>{e.type.toUpperCase()}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#475569", marginTop: 2, fontFamily: "'Courier New', monospace" }}>
                              {e.ticker}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{e.date?.slice(5)}</div>
                            <a href={kalshiUrl(e)} target="_blank" rel="noopener noreferrer"
                              onClick={ev => ev.stopPropagation()}
                              style={{ fontSize: 10, color: "#f59e0b", textDecoration: "none", fontWeight: 700 }}>
                              Kalshi &rarr;
                            </a>
                          </div>
                        </div>

                        {/* Recommendation Banner */}
                        <div style={{ margin: "0 12px", padding: "10px 14px", borderRadius: 8, background: sigBg, border: `1px solid ${sigBorder}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 15, fontWeight: 900, color: sigColor }}>
                              BET {e.signal} @ {buyPrice != null ? `${Math.round(buyPrice * 100)}¢` : "—"}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#f59e0b" }}>
                              +{realEV.toFixed(0)}% EV
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            {winProb != null ? `${(winProb * 100).toFixed(0)}% probability of winning` : ""}
                          </div>
                        </div>

                        {/* Hero Stats: Forecast / Threshold / Gap */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", margin: "12px 12px 0", background: "#0a0f1a", borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ padding: "10px 8px", textAlign: "center", borderRight: "1px solid #1e293b" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 4 }}>{forecastLabel}</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: "#e2e8f0" }}>
                              {forecastVal != null ? `${forecastVal.toFixed(1)}°` : "—"}
                            </div>
                          </div>
                          <div style={{ padding: "10px 8px", textAlign: "center", borderRight: "1px solid #1e293b" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 4 }}>THRESHOLD</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: "#94a3b8" }}>
                              {e.strike_type === "less" ? "<" : e.strike_type === "greater" ? ">" : ""}{e.threshold}°
                            </div>
                          </div>
                          <div style={{ padding: "10px 8px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", letterSpacing: 1, marginBottom: 4 }}>GAP</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: gap != null ? (gapFavorable ? "#22c55e" : "#f59e0b") : "#64748b" }}>
                              {gap != null ? `${gap.toFixed(1)}°` : "—"}
                            </div>
                          </div>
                        </div>

                        {/* Weather Data */}
                        <div style={{ padding: "10px 16px 6px", fontSize: 11 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                            <span style={{ color: "#64748b" }}>Ensemble Mean</span>
                            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                              {fcst.mean != null ? `${fcst.mean.toFixed(1)}°F` : "—"}
                              {fcst.modelCount && <span style={{ color: "#475569", marginLeft: 4 }}>({fcst.modelCount} models)</span>}
                            </span>
                          </div>
                          {isToday && obs.temp_f != null && (
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                              <span style={{ color: "#64748b" }}>Current Observed</span>
                              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                                {obs.temp_f}°F
                                {obs.station && <span style={{ color: "#475569", marginLeft: 4 }}>({obs.station})</span>}
                              </span>
                            </div>
                          )}
                          {isToday && obs.pace_delta != null && (
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                              <span style={{ color: "#64748b" }}>Pace</span>
                              <span style={{ fontWeight: 700, color: obs.pace_delta > 1 ? "#ef4444" : obs.pace_delta < -1 ? "#3b82f6" : "#64748b" }}>
                                {obs.pace_delta > 0 ? "+" : ""}{obs.pace_delta.toFixed(1)}°F {obs.pace_delta > 1 ? "RUNNING HOT" : obs.pace_delta < -1 ? "RUNNING COLD" : "ON PACE"}
                              </span>
                            </div>
                          )}
                          {hasPace && obs.hrrr_high != null && (
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                              <span style={{ color: "#64748b" }}>HRRR Forecast</span>
                              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{obs.hrrr_high}°F</span>
                            </div>
                          )}
                        </div>

                        {/* Footer: Volume + Expires */}
                        <div style={{ padding: "8px 16px", borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                          <span>Vol: {(e.volume || 0).toLocaleString()}</span>
                          <span>{timeUntil(e.close_time)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===== MARKET TABLE ===== */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["Market", "Edge", "EV", "Rec", "Price", "Vol", "Expires"].map(h => (
                      <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: "#64748b", fontWeight: 700, letterSpacing: 0.5, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allEdges.slice(0, 100).map((e, i) => {
                    const bp = getBuyPrice(e);
                    const ev = e.ev || 0;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer", transition: "background 0.15s" }}
                        onMouseEnter={ev => ev.currentTarget.style.background = "#1e293b"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
                        onClick={() => { setSelectedCity(e.city); setTab("cities"); }}>
                        <td style={{ padding: "8px 6px" }}>
                          <span style={{ fontWeight: 600, color: "#f1f5f9" }}>{e.city}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 5, padding: "1px 5px", borderRadius: 3,
                            background: e.type === "high" ? "#ef444422" : "#3b82f622",
                            color: e.type === "high" ? "#ef4444" : "#3b82f6" }}>
                            {e.type === "high" ? "H" : "L"}
                          </span>
                          <span style={{ color: "#94a3b8", marginLeft: 5 }}>
                            {e.strike_type === "less" ? "<" : e.strike_type === "greater" ? ">" : ""}{e.threshold}°
                          </span>
                          <span style={{ color: "#475569", marginLeft: 5, fontSize: 10 }}>{e.date?.slice(5)}</span>
                        </td>
                        <td style={{ padding: "8px 6px", fontWeight: 800, color: getEdgeColor(e.edge) }}>{signPct(e.edge)}</td>
                        <td style={{ padding: "8px 6px", fontWeight: 600, color: ev > 0.5 ? "#f59e0b" : "#94a3b8" }}>
                          {ev > 0 ? `+${(ev * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {e.signal ? (
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: getSignalColor(e.signal), color: "#fff" }}>{e.signal}</span>
                          ) : <span style={{ color: "#334155" }}>—</span>}
                        </td>
                        <td style={{ padding: "8px 6px", color: bp != null ? "#e2e8f0" : "#334155", fontWeight: 600 }}>
                          {bp != null ? `${Math.round(bp * 100)}¢` : "—"}
                        </td>
                        <td style={{ padding: "8px 6px", color: "#64748b" }}>{(e.volume || 0).toLocaleString()}</td>
                        <td style={{ padding: "8px 6px", color: "#64748b", fontSize: 11 }}>{timeUntil(e.close_time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== CITIES TAB ==================== */}
        {tab === "cities" && (
          <div>
            {/* City selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", justifyContent: "center" }}>
              {cityList.map(c => {
                const isSelected = selectedCity === c;
                const obs = OBSERVATIONS?.[c] || {};
                const citySignals = (EDGES || []).filter(e => e.city === c && e.signal).length;
                return (
                  <div key={c} onClick={() => setSelectedCity(isSelected ? null : c)}
                    style={{ padding: "8px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
                      background: isSelected ? "rgba(59,130,246,0.15)" : "#0f172a",
                      border: isSelected ? "1px solid rgba(59,130,246,0.4)" : "1px solid #1e293b",
                      color: isSelected ? "#3b82f6" : "#94a3b8" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{c}
                      {citySignals > 0 && <span style={{ fontSize: 8, fontWeight: 800, marginLeft: 4, padding: "1px 4px", borderRadius: 6, background: "#22c55e", color: "#000" }}>{citySignals}</span>}
                    </div>
                    {obs.temp_f != null && <div style={{ fontSize: 10, color: "#64748b" }}>{obs.temp_f}F</div>}
                  </div>
                );
              })}
            </div>

            {/* City Detail */}
            {selectedCity && (() => {
              const forecast = FORECASTS?.[selectedCity] || {};
              const obs = OBSERVATIONS?.[selectedCity] || {};
              const allCityEdges = (EDGES || []).filter(e => e.city === selectedCity);
              const obsStale = obs.obs_age_min != null && obs.obs_age_min > 90;

              // Kalshi event URL for a section header
              const kalshiEventUrl = (edges) => edges[0] ? kalshiUrl(edges[0]) : "#";

              // Helper: model range bar — shows each model's temp as a colored number on a horizontal scale
              const ModelRange = ({ models, mean, std, typeColor, typeLabel }) => {
                if (!models) return null;
                const temps = Object.values(models);
                const pad = 2;
                const lo = Math.floor(Math.min(...temps) - pad);
                const hi = Math.ceil(Math.max(...temps) + pad);
                const range = hi - lo;
                const pos = (t) => Math.max(1, Math.min(99, ((t - lo) / range) * 100));
                // Sort models by temp for the legend
                const sorted = Object.entries(models).sort((a, b) => a[1] - b[1]);
                return (
                  <div style={{ marginBottom: 16 }}>
                    {/* Header: "PREDICTED HIGH 76F" style */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 800, color: typeColor, letterSpacing: 1 }}>PREDICTED {typeLabel} </span>
                        <span style={{ fontSize: 22, fontWeight: 900, color: typeColor }}>{mean}F</span>
                      </div>
                      <span style={{ fontSize: 10, color: "#64748b" }}>range {Math.min(...temps).toFixed(0)}-{Math.max(...temps).toFixed(0)}F</span>
                    </div>
                    {/* Range bar with model temp numbers */}
                    <div style={{ position: "relative", height: 36, background: "#1e293b", borderRadius: 6, overflow: "visible", marginBottom: 2 }}>
                      {/* Ensemble ±1 std band */}
                      <div style={{ position: "absolute", left: `${pos(mean - std)}%`, width: `${Math.max(pos(mean + std) - pos(mean - std), 1)}%`, height: "100%", background: `${typeColor}18`, borderRadius: 4 }} />
                      {/* Ensemble mean line */}
                      <div style={{ position: "absolute", left: `${pos(mean)}%`, top: 0, width: 2, height: "100%", background: typeColor, zIndex: 2, borderRadius: 1 }} />
                      {/* Mean label on top */}
                      <div style={{ position: "absolute", left: `${pos(mean)}%`, top: -14, transform: "translateX(-50%)", fontSize: 9, fontWeight: 800, color: typeColor, whiteSpace: "nowrap" }}>{mean}F</div>
                      {/* Model temp numbers positioned on the bar */}
                      {sorted.map(([m, t], i) => (
                        <div key={m} style={{ position: "absolute", left: `${pos(t)}%`, top: "50%", transform: "translate(-50%, -50%)", zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: MODEL_COLORS[m] || "#94a3b8", textShadow: "0 0 4px #0f172a, 0 0 4px #0f172a", whiteSpace: "nowrap", lineHeight: 1 }}>
                            {t.toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Scale endpoints */}
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 9, color: "#475569" }}>{lo}F</span>
                      <span style={{ fontSize: 9, color: "#475569" }}>{hi}F</span>
                    </div>
                    {/* Model legend — compact row */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {sorted.map(([m, t]) => (
                        <span key={m} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: MODEL_COLORS[m] || "#94a3b8" }}>{MODEL_LABELS[m]}</span>
                          <span style={{ color: "#64748b" }}>{t}F</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              };

              return (
                <div>
                  {/* City header */}
                  <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: "1px solid #1e293b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "Outfit", fontSize: 24, fontWeight: 900, color: "#f1f5f9", margin: 0 }}>{CITY_NAMES[selectedCity]}</h2>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{selectedCity}</span>
                      </div>
                      {obs.temp_f != null && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 28, fontWeight: 900, color: obsStale ? "#f59e0b" : "#3b82f6" }}>{obs.temp_f}F</div>
                          <div style={{ fontSize: 10, color: obsStale ? "#f59e0b" : "#64748b" }}>
                            {obsStale ? `${Math.round(obs.obs_age_min / 60)}h ago` : "Current"} {obs.station && `(${obs.station})`}
                            {obsStale && " — STALE"}
                          </div>
                        </div>
                      )}
                    </div>
                    {obs.pace_delta != null && !obsStale && (
                      <div style={{ marginTop: 10, padding: "6px 12px", borderRadius: 6, background: obs.pace_delta > 1 ? "rgba(239,68,68,0.08)" : obs.pace_delta < -1 ? "rgba(59,130,246,0.08)" : "rgba(100,116,139,0.08)" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: obs.pace_delta > 0 ? "#ef4444" : obs.pace_delta < -1 ? "#3b82f6" : "#64748b" }}>
                          {obs.pace_delta > 0 ? "+" : ""}{obs.pace_delta}F {obs.pace_delta > 1 ? "RUNNING HOT" : obs.pace_delta < -1 ? "RUNNING COLD" : "ON PACE"}
                        </span>
                        <span style={{ fontSize: 11, color: "#475569", marginLeft: 8 }}>vs HRRR expected {obs.expected_now}F</span>
                      </div>
                    )}
                  </div>

                  {/* Per-date cards */}
                  {Object.entries(forecast).map(([date, ens]) => {
                    const dateEdges = allCityEdges.filter(e => e.date === date).sort((a, b) => {
                      // Sort: less first (ascending threshold), then between (ascending), then greater (descending)
                      const order = { less: 0, between: 1, greater: 2 };
                      if ((order[a.strike_type] || 1) !== (order[b.strike_type] || 1)) return (order[a.strike_type] || 1) - (order[b.strike_type] || 1);
                      const aThresh = a.cap || a.floor || 0;
                      const bThresh = b.cap || b.floor || 0;
                      return aThresh - bThresh;
                    });
                    const highEdges = dateEdges.filter(e => e.type === "high");
                    const lowEdges = dateEdges.filter(e => e.type === "low");

                    // Find the event ticker for Kalshi link (from first edge)
                    const highEventUrl = highEdges[0] ? kalshiUrl(highEdges[0]) : "";
                    const lowEventUrl = lowEdges[0] ? kalshiUrl(lowEdges[0]) : "";

                    return (
                    <div key={date} style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, border: "1px solid #1e293b" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{date}</span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{ens.model_count} models</span>
                      </div>

                      {/* HIGH section */}
                      <div style={{ marginBottom: 20 }}>
                        <ModelRange models={ens.high_models} mean={ens.high_mean} std={ens.high_std} typeColor="#ef4444" typeLabel="HIGH" />
                        {/* Coverage Ladder */}
                        {highEdges.length > 0 && (<>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>COVERAGE LADDER</span>
                            {highEventUrl && <a href={highEventUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textDecoration: "none", letterSpacing: 1 }}>KALSHI LIVE &rarr;</a>}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {highEdges.map((e, i) => {
                              const hasEdge = Math.abs(e.edge) >= (META?.edge_threshold || 0.05);
                              const edgeVal = e.edge || 0;
                              const isSignal = e.signal != null;
                              return (
                              <a key={i} href={kalshiUrl(e)} target="_blank" rel="noopener noreferrer"
                                style={{ flex: "1 1 72px", minWidth: 72, maxWidth: 120, padding: "8px 6px", borderRadius: 8, textAlign: "center", textDecoration: "none",
                                  background: isSignal ? `${getSignalColor(e.signal)}0d` : "#0a0f1a",
                                  border: `1px solid ${isSignal ? getSignalColor(e.signal) + "55" : "#1e293b"}` }}>
                                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>
                                  {e.strike_type === "less" ? `< ${e.threshold}` : e.strike_type === "greater" ? `> ${e.threshold}` : e.threshold}F
                                </div>
                                <div style={{ fontSize: 16, fontWeight: 900, color: "#e2e8f0" }}>{pct(e.our_prob)}</div>
                                <div style={{ fontSize: 10, color: "#64748b" }}>KSH {pct(e.market_mid)}</div>
                                {hasEdge && <div style={{ fontSize: 10, fontWeight: 800, color: edgeVal > 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                                  {edgeVal > 0 ? "+" : ""}{(edgeVal * 100).toFixed(0)}%
                                </div>}
                              </a>
                              );
                            })}
                          </div>
                        </>)}
                      </div>

                      {/* LOW section */}
                      {ens.low_mean && (
                        <div>
                          <ModelRange models={ens.low_models} mean={ens.low_mean} std={ens.low_std} typeColor="#3b82f6" typeLabel="LOW" />
                          {/* Coverage Ladder */}
                          {lowEdges.length > 0 && (<>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>COVERAGE LADDER</span>
                              {lowEventUrl && <a href={lowEventUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textDecoration: "none", letterSpacing: 1 }}>KALSHI LIVE &rarr;</a>}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {lowEdges.map((e, i) => {
                                const hasEdge = Math.abs(e.edge) >= (META?.edge_threshold || 0.05);
                                const edgeVal = e.edge || 0;
                                const isSignal = e.signal != null;
                                return (
                                <a key={i} href={kalshiUrl(e)} target="_blank" rel="noopener noreferrer"
                                  style={{ flex: "1 1 72px", minWidth: 72, maxWidth: 120, padding: "8px 6px", borderRadius: 8, textAlign: "center", textDecoration: "none",
                                    background: isSignal ? `${getSignalColor(e.signal)}0d` : "#0a0f1a",
                                    border: `1px solid ${isSignal ? getSignalColor(e.signal) + "55" : "#1e293b"}` }}>
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>
                                    {e.strike_type === "less" ? `< ${e.threshold}` : e.strike_type === "greater" ? `> ${e.threshold}` : e.threshold}F
                                  </div>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: "#e2e8f0" }}>{pct(e.our_prob)}</div>
                                  <div style={{ fontSize: 10, color: "#64748b" }}>KSH {pct(e.market_mid)}</div>
                                  {hasEdge && <div style={{ fontSize: 10, fontWeight: 800, color: edgeVal > 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                                    {edgeVal > 0 ? "+" : ""}{(edgeVal * 100).toFixed(0)}%
                                  </div>}
                                </a>
                                );
                              })}
                            </div>
                          </>)}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              );
            })()}

            {!selectedCity && (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
                Select a city above to view forecasts and markets
              </div>
            )}
          </div>
        )}

        {/* ==================== RESULTS TAB ==================== */}
        {tab === "results" && (() => {
          const summary = RESULTS?.summary || {};
          const tiers = RESULTS?.tiers || [];
          const directions = RESULTS?.directions || [];
          const allPicks = (RESULTS?.picks || []).map(p => ({
            resolved_at: p[0], city: p[1], date: p[2], type: p[3],
            threshold: p[4], signal: p[5], edge: p[6], our_prob: p[7],
            market_mid: p[8], actual_temp: p[9], result: p[10],
            buy_price: p[11], pnl: p[12],
          }));
          const picks = resultsView === "last100" ? allPicks.slice(0, 100) : allPicks;

          // Recompute summary for "last 100" view
          const viewSummary = resultsView === "overall" || allPicks.length <= 100 ? summary : (() => {
            const s = picks;
            const w = s.filter(p => p.result === "WIN").length;
            const pnl = s.reduce((a, p) => a + (p.pnl || 0), 0);
            const risked = s.reduce((a, p) => a + Math.abs(p.buy_price || 0), 0);
            let streak = 0;
            if (s.length) {
              const sr = s[0].result;
              for (const p of s) { if (p.result === sr) streak++; else break; }
              if (sr === "LOSS") streak = -streak;
            }
            return { total: s.length, wins: w, losses: s.length - w,
              win_rate: s.length ? w / s.length : 0, total_pnl: pnl,
              total_risked: risked, roi: risked > 0 ? (pnl / risked * 100) : 0,
              current_streak: streak };
          })();

          const streakStr = viewSummary.current_streak > 0 ? `${viewSummary.current_streak}W` : viewSummary.current_streak < 0 ? `${Math.abs(viewSummary.current_streak)}L` : "—";
          const streakColor = viewSummary.current_streak > 0 ? "#22c55e" : viewSummary.current_streak < 0 ? "#ef4444" : "#64748b";
          const wrColor = viewSummary.win_rate >= 0.55 ? "#22c55e" : viewSummary.win_rate >= 0.50 ? "#f59e0b" : "#ef4444";
          const pnlColor = viewSummary.total_pnl >= 0 ? "#22c55e" : "#ef4444";

          return (
          <div>
            {/* View toggle */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20 }}>
              {[["last100", "Last 100"], ["overall", "Overall"]].map(([key, label]) => (
                <div key={key} onClick={() => setResultsView(key)}
                  style={{ padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700,
                    background: resultsView === key ? "rgba(59,130,246,0.15)" : "transparent",
                    color: resultsView === key ? "#3b82f6" : "#64748b",
                    border: resultsView === key ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent" }}>
                  {label}
                </div>
              ))}
            </div>

            {/* Empty state */}
            {viewSummary.total === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1f4ca;</div>
                <h3 style={{ fontFamily: "Outfit", fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>No Results Yet</h3>
                <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
                  Picks resolve when markets close — typically early morning UTC the day after the forecast.
                  First results will appear within 24h of the pipeline going live.
                </p>
              </div>
            )}

            {/* Hero stats */}
            {viewSummary.total > 0 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
                  {[
                    { label: "Win Rate", value: `${(viewSummary.win_rate * 100).toFixed(1)}%`, color: wrColor },
                    { label: "Record", value: `${viewSummary.wins}-${viewSummary.losses}`, color: "#e2e8f0" },
                    { label: "Streak", value: streakStr, color: streakColor },
                    { label: "Total P&L", value: `$${viewSummary.total_pnl >= 0 ? "+" : ""}${viewSummary.total_pnl.toFixed(2)}`, color: pnlColor },
                    { label: "ROI", value: `${viewSummary.roi >= 0 ? "+" : ""}${viewSummary.roi.toFixed(1)}%`, color: pnlColor },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", textAlign: "center", border: "1px solid #1e293b" }}>
                      <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Edge Tier Breakdown */}
                <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Accuracy by Edge Size</div>
                  {tiers.filter(t => t.total > 0).map(t => {
                    const wr = t.total > 0 ? t.wins / t.total : 0;
                    const tierColor = t.label === "STRONG" ? "#22c55e" : t.label === "SOLID" ? "#f59e0b" : "#3b82f6";
                    return (
                      <div key={t.label} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 800, color: tierColor }}>{t.label}</span>
                            <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>{t.desc}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.wins}/{t.total}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: wr >= 0.55 ? "#22c55e" : wr >= 0.50 ? "#f59e0b" : "#ef4444" }}>{(wr * 100).toFixed(0)}%</span>
                            <span style={{ fontSize: 10, color: t.pnl >= 0 ? "#22c55e" : "#ef4444" }}>${t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}</span>
                          </div>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(wr * 100, 100)}%`, borderRadius: 3, background: tierColor, transition: "width 0.3s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* By Direction */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  {directions.filter(d => d.total > 0).map(d => {
                    const wr = d.total > 0 ? d.wins / d.total : 0;
                    const dirColor = d.label === "YES" ? "#22c55e" : "#ef4444";
                    return (
                      <div key={d.label} style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", border: `1px solid ${dirColor}22` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: dirColor, color: "#fff" }}>{d.label}</span>
                          <span style={{ fontSize: 14, fontWeight: 900, color: wr >= 0.55 ? "#22c55e" : wr >= 0.50 ? "#f59e0b" : "#ef4444" }}>{(wr * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {d.wins}-{d.total - d.wins} record
                          <span style={{ marginLeft: 8, color: d.pnl >= 0 ? "#22c55e" : "#ef4444" }}>${d.pnl >= 0 ? "+" : ""}{d.pnl.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Picks Table */}
                <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                    {resultsView === "last100" ? "Last 100 Picks" : "All Picks"} ({picks.length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #334155" }}>
                          {["", "Date", "City", "Type", "Threshold", "Signal", "Edge", "Us vs Mkt", "Actual", "P&L"].map(h => (
                            <th key={h} style={{ padding: "6px 6px", textAlign: "left", color: "#64748b", fontWeight: 700, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {picks.map((p, i) => {
                          const isWin = p.result === "WIN";
                          return (
                          <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                            <td style={{ padding: "6px 4px", fontSize: 14 }}>{isWin ? "\u2705" : "\u274c"}</td>
                            <td style={{ padding: "6px 6px", color: "#94a3b8" }}>{p.date?.slice(5)}</td>
                            <td style={{ padding: "6px 6px", fontWeight: 600, color: "#f1f5f9" }}>{p.city}</td>
                            <td style={{ padding: "6px 6px" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: p.type === "high" ? "#ef444422" : "#3b82f622", color: p.type === "high" ? "#ef4444" : "#3b82f6" }}>
                                {p.type === "high" ? "H" : "L"}
                              </span>
                            </td>
                            <td style={{ padding: "6px 6px", fontWeight: 600 }}>{p.threshold}F</td>
                            <td style={{ padding: "6px 6px" }}>
                              <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 3, background: getSignalColor(p.signal), color: "#fff" }}>{p.signal}</span>
                            </td>
                            <td style={{ padding: "6px 6px", fontWeight: 800, color: getEdgeColor(p.edge) }}>{signPct(p.edge)}</td>
                            <td style={{ padding: "6px 6px", color: "#94a3b8", fontSize: 11 }}>{pct(p.our_prob)} vs {pct(p.market_mid)}</td>
                            <td style={{ padding: "6px 6px", fontWeight: 700, color: "#e2e8f0" }}>{p.actual_temp != null ? `${p.actual_temp}F` : "—"}</td>
                            <td style={{ padding: "6px 6px", fontWeight: 800, color: (p.pnl || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                              {p.pnl != null ? `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
          );
        })()}

        {/* ==================== GUIDE TAB ==================== */}
        {tab === "guide" && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            {[
              {
                title: "How It Works",
                content: "We fetch temperature forecasts from 3 high-accuracy models — HRRR (3km, best short-range), NBM (2.5km, NOAA's 31-model blend), and ECMWF (best global model) — and build a probability distribution for each city's high and low temperature. We compare our probabilities against Kalshi market pricing to find mispriced contracts."
              },
              {
                title: "The Ensemble",
                content: "HRRR is NOAA's 3km rapid-refresh model — king of same-day forecasts with hourly updates. NBM is NOAA's National Blend, which already bias-corrects and optimally weights 31 model systems. ECMWF is the gold-standard global model that adds independent value at 2+ day horizons. Three focused models beat seven noisy ones."
              },
              {
                title: "Edge Detection",
                content: `For each Kalshi contract (e.g. "Will NYC high be above 72F?"), we calculate P(above 72F) from our ensemble distribution and compare against the market's implied probability (the contract's midpoint price). If our probability differs by more than ${(META?.edge_threshold || 0.05) * 100}%, we flag it as a signal.`
              },
              {
                title: "Pace Tracking",
                content: "For same-day markets, we compare the current observed temperature against the HRRR model's hourly forecast curve. If reality is running hotter or colder than expected, we adjust our high/low forecast accordingly. This is the intraday edge signal."
              },
              {
                title: "Signal Strength",
                content: "STRONG (20%+ edge) — High confidence, models strongly disagree with market. SOLID (10-20%) — Good edge worth considering. LEAN (5-10%) — Marginal edge, proceed with caution."
              },
            ].map((section, i) => (
              <div key={i} style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, border: "1px solid #1e293b" }}>
                <h3 style={{ fontFamily: "Outfit", fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>{section.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: "#94a3b8" }}>{section.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* FOOTER */}
        <div style={{ textAlign: "center", marginTop: 40, paddingBottom: 24 }}>
          <a href="https://www.buymeacoffee.com/Trickriggin" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "linear-gradient(135deg, #3b82f6, #06b6d4)", color: "#fff", borderRadius: 8, fontFamily: "Outfit, sans-serif", fontSize: 14, fontWeight: 800, textDecoration: "none", transition: "transform 0.2s, box-shadow 0.2s", boxShadow: "0 2px 8px rgba(59,130,246,0.3)", letterSpacing: 0.5 }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(59,130,246,0.5)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(59,130,246,0.3)"; }}>
            Donate Tokens
          </a>
          <p style={{ fontSize: 11, color: "#334155", marginTop: 12, letterSpacing: 1 }}>PLEASE GAMBLE RESPONSIBLY</p>
        </div>
      </div>
    </div>
  );
}

export default App;
