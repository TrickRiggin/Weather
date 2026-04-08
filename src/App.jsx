import { useState, useMemo } from "react";
import { EDGES } from "./edges.js";
import { FORECASTS } from "./forecasts.js";
import { MARKETS } from "./markets.js";
import { OBSERVATIONS } from "./observations.js";
import { AI_ANALYSIS } from "./ai_analysis.js";
import { META } from "./meta.js";
import { RESULTS } from "./results.js";

// ========== CITY CONFIG ==========
const CITY_NAMES = {
  NYC: "New York", LAX: "Los Angeles", CHI: "Chicago", MIA: "Miami",
  DAL: "Dallas", DEN: "Denver", PHI: "Philadelphia", ATL: "Atlanta",
  HOU: "Houston", PHX: "Phoenix",
};

const MODEL_LABELS = {
  gfs_seamless: "GFS", ecmwf_ifs025: "ECMWF", icon_seamless: "ICON",
  gem_seamless: "GEM", jma_seamless: "JMA", ncep_hrrr_conus: "HRRR",
  ncep_nbm_conus: "NBM",
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

function App() {
  const [tab, setTab] = useState("scanner");
  const [selectedCity, setSelectedCity] = useState(null);
  const [filterCity, setFilterCity] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState("edge");
  const [resultsView, setResultsView] = useState("last100");

  // ========== DERIVED DATA ==========
  const signals = useMemo(() =>
    (EDGES || []).filter(e => e.signal).sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)),
    []
  );

  const allEdges = useMemo(() => {
    let filtered = [...(EDGES || [])];
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
            Multi-Model Ensemble vs Kalshi Markets
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

            {/* Signal Cards (top edges) */}
            {signals.length > 0 && filterCity === "all" && filterType === "all" && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                  Top Signals
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                  {signals.slice(0, 6).map((e, i) => {
                    const badge = getConfidenceBadge(e.edge);
                    const obs = OBSERVATIONS?.[e.city] || {};
                    return (
                      <div key={i} style={{ background: "#0f172a", borderRadius: 10, padding: "12px 16px", border: `1px solid ${getSignalColor(e.signal)}33`, cursor: "pointer" }}
                        onClick={() => { setSelectedCity(e.city); setTab("cities"); }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{e.city_name}</span>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: getSignalColor(e.signal), color: "#fff" }}>
                            {e.signal}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                          {e.type === "high" ? "High" : "Low"} temp {e.strike_type === "greater" ? "> " : e.strike_type === "less" ? "< " : ""}{e.threshold}F
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <div>
                            <span style={{ fontSize: 11, color: "#64748b" }}>Us: </span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{pct(e.our_prob)}</span>
                            <span style={{ fontSize: 11, color: "#64748b", margin: "0 4px" }}>vs</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{pct(e.market_mid)}</span>
                            <span style={{ fontSize: 11, color: "#64748b" }}> Mkt</span>
                          </div>
                          <div>
                            <span style={{ fontSize: 14, fontWeight: 800, color: getEdgeColor(e.edge) }}>{signPct(e.edge)}</span>
                            {badge && <span style={{ fontSize: 9, fontWeight: 800, marginLeft: 6, padding: "2px 6px", borderRadius: 4, background: badge.bg, color: "#fff" }}>{badge.label}</span>}
                          </div>
                        </div>
                        {obs.temp_f && (
                          <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                            Current: {obs.temp_f}F {obs.pace_delta != null && `(${obs.pace_delta > 0 ? "+" : ""}${obs.pace_delta}F pace)`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Analysis */}
            {AI_ANALYSIS && Object.keys(AI_ANALYSIS).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                  AI Analysis
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 10 }}>
                  {Object.entries(AI_ANALYSIS).map(([model, data]) => (
                    <div key={model} style={{ background: "#0f172a", borderRadius: 10, padding: "14px 16px", border: "1px solid #1e293b" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: model === "claude" ? "#a78bfa" : "#22c55e", textTransform: "uppercase" }}>{model}</span>
                        {data.picks && <span style={{ fontSize: 10, color: "#64748b" }}>{data.picks.length} picks</span>}
                      </div>
                      {data.summary && <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, marginBottom: 8 }}>{data.summary}</p>}
                      {data.picks?.map((pick, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderTop: "1px solid #1e293b" }}>
                          <span style={{ fontSize: 11, color: "#e2e8f0" }}>
                            {pick.city} {pick.type} {String(pick.threshold).replace(/F$/i, "")}F
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                              background: pick.confidence === "STRONG" ? "#22c55e" : pick.confidence === "LEAN" ? "#3b82f6" : "#64748b",
                              color: "#fff" }}>{pick.confidence}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                              background: pick.signal === "YES" ? "#22c55e" : "#ef4444", color: "#fff" }}>{pick.signal}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full Market Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["City", "Date", "Type", "Threshold", "Our Prob", "Market", "Edge", "EV", "Signal", "Expires"].map(h => (
                      <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: "#64748b", fontWeight: 700, letterSpacing: 0.5, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allEdges.slice(0, 100).map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={ev => ev.currentTarget.style.background = "#1e293b"}
                      onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
                      onClick={() => { setSelectedCity(e.city); setTab("cities"); }}>
                      <td style={{ padding: "8px 6px", fontWeight: 600, color: "#f1f5f9" }}>{e.city_name}</td>
                      <td style={{ padding: "8px 6px", color: "#94a3b8" }}>{e.date?.slice(5)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: e.type === "high" ? "#ef444422" : "#3b82f622", color: e.type === "high" ? "#ef4444" : "#3b82f6" }}>
                          {e.type === "high" ? "HIGH" : "LOW"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 6px", fontWeight: 700 }}>{e.threshold}F</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{pct(e.our_prob, 1)}</td>
                      <td style={{ padding: "8px 6px", color: "#94a3b8" }}>{pct(e.market_mid, 1)}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 800, color: getEdgeColor(e.edge) }}>{signPct(e.edge)}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600, color: Math.abs(e.ev) > 0.5 ? "#22c55e" : "#94a3b8" }}>{signPct(e.ev)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {e.signal ? (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: getSignalColor(e.signal), color: "#fff" }}>{e.signal}</span>
                        ) : <span style={{ color: "#334155" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 6px", color: "#64748b", fontSize: 11 }}>{timeUntil(e.close_time)}</td>
                    </tr>
                  ))}
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
                return (
                  <div key={c} onClick={() => setSelectedCity(isSelected ? null : c)}
                    style={{ padding: "8px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
                      background: isSelected ? "rgba(59,130,246,0.15)" : "#0f172a",
                      border: isSelected ? "1px solid rgba(59,130,246,0.4)" : "1px solid #1e293b",
                      color: isSelected ? "#3b82f6" : "#94a3b8" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{c}</div>
                    {obs.temp_f && <div style={{ fontSize: 10, color: "#64748b" }}>{obs.temp_f}F</div>}
                  </div>
                );
              })}
            </div>

            {/* City Detail */}
            {selectedCity && (() => {
              const forecast = FORECASTS?.[selectedCity] || {};
              const obs = OBSERVATIONS?.[selectedCity] || {};
              const cityEdges = (EDGES || []).filter(e => e.city === selectedCity && e.signal)
                .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
              // Group edges by date
              const edgesByDate = {};
              cityEdges.forEach(e => {
                if (!edgesByDate[e.date]) edgesByDate[e.date] = [];
                edgesByDate[e.date].push(e);
              });
              // AI picks for this city
              const cityAiPicks = {};
              Object.entries(AI_ANALYSIS || {}).forEach(([model, data]) => {
                (data.picks || []).forEach(p => {
                  if (p.city === selectedCity) {
                    if (!cityAiPicks[model]) cityAiPicks[model] = [];
                    cityAiPicks[model].push(p);
                  }
                });
              });
              const obsStale = obs.obs_age_min != null && obs.obs_age_min > 90;

              return (
                <div>
                  {/* City header */}
                  <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: "1px solid #1e293b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "Outfit", fontSize: 24, fontWeight: 900, color: "#f1f5f9", margin: 0 }}>
                          {CITY_NAMES[selectedCity]}
                        </h2>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{selectedCity}</span>
                      </div>
                      {obs.temp_f != null && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 28, fontWeight: 900, color: obsStale ? "#f59e0b" : "#3b82f6" }}>{obs.temp_f}F</div>
                          <div style={{ fontSize: 10, color: obsStale ? "#f59e0b" : "#64748b" }}>
                            {obsStale ? `${Math.round(obs.obs_age_min / 60)}h ago` : "Current"} {obs.station && `(${obs.station})`}
                            {obsStale && " ⚠ STALE"}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pace */}
                    {obs.pace_delta != null && !obsStale && (
                      <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: obs.pace_delta > 1 ? "rgba(239,68,68,0.1)" : obs.pace_delta < -1 ? "rgba(59,130,246,0.1)" : "rgba(100,116,139,0.1)", border: `1px solid ${obs.pace_delta > 1 ? "#ef444433" : obs.pace_delta < -1 ? "#3b82f633" : "#33415533"}` }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: obs.pace_delta > 0 ? "#ef4444" : "#3b82f6" }}>
                          {obs.pace_delta > 0 ? "+" : ""}{obs.pace_delta}F {obs.pace_delta > 1 ? "RUNNING HOT" : obs.pace_delta < -1 ? "RUNNING COLD" : "ON PACE"}
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
                          vs HRRR expected {obs.expected_now}F at this hour
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Forecast by date — now with picks and edges inline */}
                  {Object.entries(forecast).map(([date, ens]) => {
                    const dateEdges = edgesByDate[date] || [];
                    const topPick = dateEdges[0]; // Already sorted by |edge|
                    const topBadge = topPick ? getConfidenceBadge(topPick.edge) : null;

                    return (
                    <div key={date} style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, border: "1px solid #1e293b" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{date}</span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{ens.model_count} models</span>
                      </div>

                      {/* High/Low summary */}
                      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 140, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid #ef444422" }}>
                          <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>HIGH</div>
                          <div style={{ fontSize: 22, fontWeight: 900, color: "#ef4444" }}>{ens.high_mean}F</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>+/- {ens.high_std}F ({ens.high_min}-{ens.high_max})</div>
                        </div>
                        {ens.low_mean && (
                          <div style={{ flex: 1, minWidth: 140, padding: "10px 14px", borderRadius: 8, background: "rgba(59,130,246,0.06)", border: "1px solid #3b82f622" }}>
                            <div style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>LOW</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: "#3b82f6" }}>{ens.low_mean}F</div>
                            <div style={{ fontSize: 10, color: "#64748b" }}>+/- {ens.low_std}F</div>
                          </div>
                        )}
                      </div>

                      {/* TOP PICK for this date */}
                      {topPick && (
                        <div style={{ padding: "12px 16px", borderRadius: 10, marginBottom: 12, background: `${getSignalColor(topPick.signal)}08`, border: `1px solid ${getSignalColor(topPick.signal)}33` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase" }}>TOP PICK</div>
                            <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: getSignalColor(topPick.signal), color: "#fff" }}>{topPick.signal}</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>
                            {topPick.type === "high" ? "High" : "Low"} {topPick.strike_type === "greater" ? "> " : topPick.strike_type === "less" ? "< " : ""}{topPick.threshold}F
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 4 }}>
                            <div>
                              <span style={{ fontSize: 11, color: "#64748b" }}>Us: </span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{pct(topPick.our_prob)}</span>
                              <span style={{ fontSize: 11, color: "#64748b", margin: "0 4px" }}>vs</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{pct(topPick.market_mid)}</span>
                              <span style={{ fontSize: 11, color: "#64748b" }}> Mkt</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 16, fontWeight: 800, color: getEdgeColor(topPick.edge) }}>{signPct(topPick.edge)}</span>
                              {topBadge && <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: topBadge.bg, color: "#fff" }}>{topBadge.label}</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                            {topPick.signal === "YES"
                              ? `Buy YES at ${pct(topPick.yes_ask, 1)} to win ${pct(1 - (topPick.yes_ask || topPick.market_mid), 1)}`
                              : `Buy NO at ${pct(1 - (topPick.yes_bid || topPick.market_mid), 1)} to win ${pct(topPick.yes_bid || topPick.market_mid, 1)}`
                            }
                            <span style={{ marginLeft: 8, color: "#475569" }}>Expires {timeUntil(topPick.close_time)}</span>
                          </div>
                        </div>
                      )}

                      {/* All edges for this date */}
                      {dateEdges.length > 1 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                            All Signals ({dateEdges.length})
                          </div>
                          {dateEdges.slice(1).map((e, i) => {
                            const badge = getConfidenceBadge(e.edge);
                            return (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < dateEdges.length - 2 ? "1px solid #1e293b44" : "none" }}>
                              <div>
                                <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 3, marginRight: 6, background: getSignalColor(e.signal), color: "#fff" }}>{e.signal}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>
                                  {e.type === "high" ? "High" : "Low"} {e.strike_type === "greater" ? "> " : e.strike_type === "less" ? "< " : ""}{e.threshold}F
                                </span>
                                <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>
                                  Us {pct(e.our_prob)} vs {pct(e.market_mid)}
                                </span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: getEdgeColor(e.edge) }}>{signPct(e.edge)}</span>
                                {badge && <span style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3, background: badge.bg, color: "#fff" }}>{badge.label}</span>}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Model breakdown */}
                      {ens.high_models && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>Model Breakdown (High)</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.entries(ens.high_models).map(([model, temp]) => {
                              const diff = temp - ens.high_mean;
                              return (
                                <div key={model} style={{ padding: "4px 10px", borderRadius: 6, background: "#1e293b", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
                                  <span style={{ fontWeight: 700, color: "#94a3b8" }}>{MODEL_LABELS[model] || model}</span>
                                  <span style={{ fontWeight: 800, color: "#f1f5f9" }}>{temp}F</span>
                                  <span style={{ fontSize: 9, color: diff > 1 ? "#ef4444" : diff < -1 ? "#3b82f6" : "#64748b" }}>
                                    {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {ens.low_models && (
                        <div>
                          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>Model Breakdown (Low)</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.entries(ens.low_models).map(([model, temp]) => {
                              const diff = temp - ens.low_mean;
                              return (
                                <div key={model} style={{ padding: "4px 10px", borderRadius: 6, background: "#1e293b", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
                                  <span style={{ fontWeight: 700, color: "#94a3b8" }}>{MODEL_LABELS[model] || model}</span>
                                  <span style={{ fontWeight: 800, color: "#f1f5f9" }}>{temp}F</span>
                                  <span style={{ fontSize: 9, color: diff > 1 ? "#ef4444" : diff < -1 ? "#3b82f6" : "#64748b" }}>
                                    {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}

                  {/* AI Analysis for this city */}
                  {Object.keys(cityAiPicks).length > 0 && (
                    <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, border: "1px solid #1e293b" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                        AI Picks for {CITY_NAMES[selectedCity]}
                      </div>
                      {Object.entries(cityAiPicks).map(([model, picks]) => (
                        <div key={model} style={{ marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: model === "claude" ? "#a78bfa" : "#22c55e", textTransform: "uppercase" }}>{model}</span>
                          {picks.map((pick, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e293b33" }}>
                              <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                                {pick.type} {String(pick.threshold).replace(/F$/i, "")}F — <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>{pick.reasoning}</span>
                              </div>
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: pick.confidence === "STRONG" ? "#22c55e" : pick.confidence === "LEAN" ? "#3b82f6" : "#f59e0b", color: "#fff" }}>{pick.confidence}</span>
                                <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: getSignalColor(pick.signal), color: "#fff" }}>{pick.signal}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* No city selected */}
            {!selectedCity && (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
                Select a city above to view forecasts and edges
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
                content: "We fetch temperature forecasts from 7 independent weather models (GFS, ECMWF, ICON, GEM, JMA, HRRR, NBM) and build a probability distribution for each city's high and low temperature. We then compare our probabilities against Kalshi market pricing to find contracts where the market is mispriced."
              },
              {
                title: "The Ensemble",
                content: "Each weather model uses different physics, resolution, and initialization data. When they agree, confidence is high. When they disagree, the spread tells us how uncertain the forecast is. We use the ensemble mean and standard deviation to build a gaussian probability distribution."
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
