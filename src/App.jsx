import { useState, useMemo } from "react";
import "./App.css";
import { EDGES } from "./edges.js";
import { FORECASTS } from "./forecasts.js";
import { MARKETS } from "./markets.js";
import { OBSERVATIONS } from "./observations.js";
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

const EDGE_THRESHOLD = META?.edge_threshold ?? 0.12;
const HIGH_EDGE_THRESHOLD = META?.high_edge_threshold ?? EDGE_THRESHOLD;
const MAX_DISAGREEMENT = META?.max_disagreement ?? 0.2;
const SIGNAL_BLOCKLIST = new Set((META?.signal_blocklist ?? []).map(([c, t]) => `${c}|${t}`));
const SUPPRESS_HIGH_YES = META?.suppress_high_yes ?? false;
const edgeFloorFor = (type) => (type === "high" ? HIGH_EDGE_THRESHOLD : EDGE_THRESHOLD);

// ========== HELPERS ==========
const pct = (v, digits = 0) => v != null ? `${(v * 100).toFixed(digits)}%` : "—";
const signPct = (v) => v != null ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—";

const getSignalColor = (signal) => signal === "YES" ? "#22c55e" : signal === "NO" ? "#ef4444" : "#64748b";
const getEdgeColor = (edge) => {
  const abs = Math.abs(edge || 0);
  if (abs >= 0.15) return "#22c55e";
  if (abs >= 0.08) return "#f59e0b";
  return "#64748b";
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

const formatBoardDate = (dateStr) => {
  if (!dateStr) return "Live";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const getLocalIsoDate = () => new Date().toLocaleDateString("sv-SE");

const pickBoardDate = (dates) => {
  if (!dates.length) return "";
  const localToday = getLocalIsoDate();
  if (dates.includes(localToday)) return localToday;
  return dates.find((date) => date > localToday) || dates[dates.length - 1];
};

const getRecommendationState = (edge) => {
  if (edge?.signal) {
    const color = getSignalColor(edge.signal);
    return {
      label: edge.signal,
      detail: "Actionable",
      background: color,
      border: color,
      text: "#ffffff",
    };
  }

  const absEdge = Math.abs(edge?.edge || 0);
  const floor = edgeFloorFor(edge?.type);

  if (edge?.strike_type === "between") {
    return {
      label: "RANGE",
      detail: "Bucket only",
      background: "rgba(148, 163, 184, 0.12)",
      border: "rgba(148, 163, 184, 0.22)",
      text: "#cbd5e1",
    };
  }

  if (absEdge > MAX_DISAGREEMENT) {
    return {
      label: "PASS",
      detail: "Kill switch",
      background: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.24)",
      text: "#f6b756",
    };
  }

  if (SIGNAL_BLOCKLIST.has(`${edge?.city}|${edge?.type}`)) {
    return {
      label: "BLOCKED",
      detail: "City calibration off",
      background: "rgba(148, 163, 184, 0.14)",
      border: "rgba(148, 163, 184, 0.28)",
      text: "#cbd5e1",
    };
  }

  if (SUPPRESS_HIGH_YES && edge?.type === "high" && edge?.edge > 0 && absEdge >= floor) {
    return {
      label: "PASS",
      detail: "High-YES suppressed",
      background: "rgba(100, 116, 139, 0.14)",
      border: "rgba(100, 116, 139, 0.24)",
      text: "#94a3b8",
    };
  }

  if (absEdge < floor) {
    return {
      label: "NO BET",
      detail: edge?.type === "high" ? "Below high floor" : "Below floor",
      background: "rgba(100, 116, 139, 0.14)",
      border: "rgba(100, 116, 139, 0.24)",
      text: "#94a3b8",
    };
  }

  return {
    label: "WATCH",
    detail: "No entry",
    background: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.24)",
    text: "#93c5fd",
  };
};

const getPriceLabel = (edge) => {
  const buyPrice = getBuyPrice(edge);
  if (buyPrice != null) return `${Math.round(buyPrice * 100)}¢ entry`;
  if (edge?.market_mid != null) return `${Math.round(edge.market_mid * 100)}¢ mid`;
  return "—";
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
  const todayDate = pickBoardDate(availableDates);
  const todayOptionLabel = todayDate === getLocalIsoDate() ? "Today" : "Latest";

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
  }, [activeDate, filterCity, filterType, sortBy]);

  const boardStatus = useMemo(() => ({
    rangeOnly: allEdges.filter((edge) => !edge.signal && edge.strike_type === "between" && Math.abs(edge.edge || 0) >= edgeFloorFor(edge.type)).length,
    killed: allEdges.filter((edge) => !edge.signal && edge.strike_type !== "between" && Math.abs(edge.edge || 0) > MAX_DISAGREEMENT).length,
    blocked: allEdges.filter((edge) => !edge.signal && SIGNAL_BLOCKLIST.has(`${edge.city}|${edge.type}`) && Math.abs(edge.edge || 0) >= edgeFloorFor(edge.type)).length,
    highYes: allEdges.filter((edge) => !edge.signal && SUPPRESS_HIGH_YES && edge.type === "high" && edge.edge > 0 && Math.abs(edge.edge) >= edgeFloorFor(edge.type) && Math.abs(edge.edge) <= MAX_DISAGREEMENT && edge.strike_type !== "between" && !SIGNAL_BLOCKLIST.has(`${edge.city}|${edge.type}`)).length,
  }), [allEdges]);

  const cityList = Object.keys(CITY_NAMES);
  const activeDateLabel = activeDate ? formatBoardDate(activeDate) : "All dates";
  const updatedAtLabel = META?.last_updated
    ? new Date(META.last_updated).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    : "Awaiting refresh";

  return (
    <div className="weather-app">
      <div className="app-shell">
        <section className="hero-panel">
          <div className="hero-kicker">AA Weather Edge</div>
          <h1 className="hero-title">Faster reads on weather markets.</h1>
          <p className="hero-copy">
            Pace-aware temperature probabilities for the highest-volume Kalshi cities, tuned by city,
            month, and forecast horizon without wasting the top of the page on vanity stats.
          </p>
          <div className="hero-status-row">
            <span className="status-pill is-warm"><strong>{signals.length}</strong> live signals</span>
            <span className="status-pill"><strong>{META?.total_contracts || MARKETS.length}</strong> contracts indexed</span>
            <span className="status-pill"><strong>{activeDateLabel}</strong> board focus</span>
            <span className="status-pill"><strong>{updatedAtLabel}</strong> last refresh</span>
          </div>
        </section>

        {/* TAB BAR */}
        <div className="nav-chrome">
          <button type="button" className={`tab-pill${tab === "scanner" ? " is-active" : ""}`} onClick={() => setTab("scanner")}>
            Scanner
            {signals.length > 0 && <span className="tab-pill-count">{signals.length}</span>}
          </button>
          <button type="button" className={`tab-pill${tab === "cities" ? " is-active" : ""}`} onClick={() => setTab("cities")}>Cities</button>
          <button type="button" className={`tab-pill${tab === "results" ? " is-active" : ""}`} onClick={() => setTab("results")}>
            Results
            {(RESULTS?.summary?.total || 0) > 0 && <span className="tab-pill-count">{RESULTS.summary.total}</span>}
          </button>
          <button type="button" className={`tab-pill${tab === "guide" ? " is-active" : ""}`} onClick={() => setTab("guide")}>Guide</button>
        </div>

        {/* ==================== SCANNER TAB ==================== */}
        {tab === "scanner" && (
          <div>
            {/* Filters */}
            <div className="control-bar">
              <div className="control-group">
                <span className="control-label">Date</span>
                <select className="control-select" value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                  <option value="today">{todayOptionLabel} ({todayDate?.slice(5)})</option>
                  {availableDates.filter(d => d !== todayDate).map(d => <option key={d} value={d}>{d.slice(5)}</option>)}
                  <option value="all">All Dates</option>
                </select>
              </div>
              <div className="control-group">
                <span className="control-label">City</span>
                <select className="control-select" value={filterCity} onChange={e => setFilterCity(e.target.value)}>
                  <option value="all">All Cities</option>
                  {cityList.map(c => <option key={c} value={c}>{CITY_NAMES[c]}</option>)}
                </select>
              </div>
              <div className="control-group">
                <span className="control-label">Type</span>
                <select className="control-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="high">Highs</option>
                  <option value="low">Lows</option>
                </select>
              </div>
              <div className="control-group">
                <span className="control-label">Sort</span>
                <select className="control-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="edge">Sort: Edge</option>
                  <option value="ev">Sort: EV</option>
                  <option value="volume">Sort: Volume</option>
                </select>
              </div>
              <div className="control-summary">
                <strong style={{ color: "#ebf4ff" }}>{allEdges.length}</strong> priced contracts on the board
              </div>
            </div>

            {/* ===== SIGNAL CARDS — Paywall-Style Market Cards ===== */}
            {signals.length > 0 && filterCity === "all" && filterType === "all" && (
              <div style={{ marginBottom: 24 }}>
                <div className="section-header">
                  <div>
                    <div className="section-kicker">Live opportunities</div>
                    <div className="section-title">Top signals</div>
                  </div>
                  <div className="section-copy">
                    Highest-conviction prices first. Edges use the ensemble forecast only; pace drift is shown as a live indicator but not fed into probabilities.
                  </div>
                </div>
                <div className="signals-grid">
                  {signals.slice(0, 8).map((e) => {
                    const obs = OBSERVATIONS?.[e.city] || {};
                    const fcst = getForecastData(e);
                    const isToday = e.date === todayDate;
                    const hasPace = isToday && e.type === "high" && obs.adjusted_high != null;
                    const forecastVal = fcst.mean;
                    const forecastLabel = "FORECAST";

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
                    const ourWidth = `${Math.max(8, Math.min(100, (e.our_prob || 0) * 100))}%`;
                    const marketWidth = `${Math.max(8, Math.min(100, (e.market_mid || 0) * 100))}%`;
                    const paceText = obs.pace_delta != null
                      ? `${obs.pace_delta > 0 ? "+" : ""}${obs.pace_delta.toFixed(1)}F pace`
                      : null;
                    const priceText = buyPrice != null ? `${Math.round(buyPrice * 100)}c entry` : "No entry";

                    return (
                      <article
                        key={e.ticker}
                        className="signal-card"
                        style={{ "--signal-border": sigBorder, "--signal-accent": sigColor, "--signal-bg": sigBg }}
                      >
                        <div className="signal-card-topline">
                          <div className="signal-card-market">
                            <span className="signal-card-type">{e.type.toUpperCase()}</span>
                            <span className="signal-card-city">{e.city_name}</span>
                            <span className="signal-card-date">{formatBoardDate(e.date)}</span>
                          </div>
                          <a
                            href={kalshiUrl(e)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={ev => ev.stopPropagation()}
                            className="signal-card-link"
                          >
                            Kalshi
                          </a>
                        </div>

                        <div className="signal-card-main">
                          <div>
                            <div className="signal-card-badge">{e.signal}</div>
                            <div className="signal-card-headline">
                              {e.strike_type === "less" ? "Under" : e.strike_type === "greater" ? "Over" : "Range"} {e.threshold}F
                            </div>
                            <div className="signal-card-subline">
                              {priceText} · {winProb != null ? `${(winProb * 100).toFixed(0)}% win rate` : "No modeled win rate"}
                            </div>
                          </div>
                          <div className="signal-card-ev">
                            <strong>{realEV >= 0 ? "+" : ""}{realEV.toFixed(0)}%</strong>
                            <span>expected value</span>
                          </div>
                        </div>

                        <div className="signal-card-stats">
                          <div className="signal-stat">
                            <span className="signal-stat-label">{forecastLabel}</span>
                            <strong>{forecastVal != null ? `${forecastVal.toFixed(1)}°` : "—"}</strong>
                          </div>
                          <div className="signal-stat">
                            <span className="signal-stat-label">Threshold</span>
                            <strong>{e.strike_type === "less" ? "<" : e.strike_type === "greater" ? ">" : ""}{e.threshold}°</strong>
                          </div>
                          <div className="signal-stat">
                            <span className="signal-stat-label">Gap</span>
                            <strong style={{ color: gap != null ? (gapFavorable ? "#22c55e" : "#f6b756") : "#64748b" }}>
                              {gap != null ? `${gap.toFixed(1)}°` : "—"}
                            </strong>
                          </div>
                        </div>

                        <div className="signal-probability-panel">
                          <div className="signal-probability-row">
                            <div className="signal-probability-label">
                              <span>Model</span>
                              <strong>{pct(e.our_prob, 0)}</strong>
                            </div>
                            <div className="signal-probability-track">
                              <div className="signal-probability-fill is-model" style={{ width: ourWidth }} />
                            </div>
                          </div>
                          <div className="signal-probability-row">
                            <div className="signal-probability-label">
                              <span>Market</span>
                              <strong>{pct(e.market_mid, 0)}</strong>
                            </div>
                            <div className="signal-probability-track">
                              <div className="signal-probability-fill is-market" style={{ width: marketWidth }} />
                            </div>
                          </div>
                          <div className="signal-edge-strip">
                            <span>Edge {signPct(e.edge)}</span>
                            <span>{fcst.modelCount ? `${fcst.modelCount} models` : "Model count unavailable"}</span>
                          </div>
                        </div>

                        <div className="signal-card-meta">
                          <span className="signal-meta-chip">{priceText}</span>
                          {paceText && <span className="signal-meta-chip">{paceText}</span>}
                          {isToday && obs.temp_f != null && <span className="signal-meta-chip">Obs {obs.temp_f}F</span>}
                          {hasPace && obs.hrrr_high != null && <span className="signal-meta-chip">HRRR {obs.hrrr_high}F</span>}
                          <span className="signal-meta-chip">Vol {(e.volume || 0).toLocaleString()}</span>
                          <span className="signal-meta-chip">{timeUntil(e.close_time)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {signals.length === 0 && filterCity === "all" && filterType === "all" && (
              <div className="scanner-note">
                <strong>No actionable signals for {activeDateLabel}.</strong>
                <span>
                  {boardStatus.rangeOnly > 0
                    ? ` ${boardStatus.rangeOnly} of the biggest moves are range buckets, which the model shows for context but never recommends.`
                    : ""}
                  {boardStatus.killed > 0
                    ? ` ${boardStatus.killed} more were blocked by the ${Math.round(MAX_DISAGREEMENT * 100)}% disagreement kill switch.`
                    : ""}
                  {boardStatus.highYes > 0
                    ? ` ${boardStatus.highYes} high-YES edges were suppressed (the model's weakest signal type in backtesting).`
                    : ""}
                  {boardStatus.blocked > 0
                    ? ` ${boardStatus.blocked} were blocked because that city/type has unreliable calibration right now.`
                    : ""}
                </span>
              </div>
            )}

            {/* ===== MARKET TABLE ===== */}
            <div className="section-header">
              <div>
                <div className="section-kicker">Scanner</div>
                <div className="section-title">Market board</div>
              </div>
              <div className="section-copy">
                Full contract list sorted by the signal you care about. Click any row to jump directly into the city breakdown.
              </div>
            </div>
            <div className="table-shell" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["Market", "Edge", "EV", "Status", "Price", "Vol", "Expires"].map(h => (
                      <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: "#64748b", fontWeight: 700, letterSpacing: 0.5, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allEdges.slice(0, 100).map((e) => {
                    const bp = getBuyPrice(e);
                    const ev = e.ev || 0;
                    const rec = getRecommendationState(e);
                    return (
                      <tr key={e.ticker} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer", transition: "background 0.15s" }}
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
                          {ev > 0 ? `+${(ev * 100).toFixed(0)}%` : "n/a"}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <div className="table-status-cell">
                            <span
                              className="table-status-pill"
                              style={{ background: rec.background, borderColor: rec.border, color: rec.text }}
                            >
                              {rec.label}
                            </span>
                            <span className="table-status-detail">{rec.detail}</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px", color: bp != null ? "#e2e8f0" : "#94a3b8", fontWeight: 600 }}>
                          {getPriceLabel(e)}
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
            <div className="section-header">
              <div>
                <div className="section-kicker">City desk</div>
                <div className="section-title">Forecast ladders</div>
              </div>
              <div className="section-copy">
                Pick a city to compare the model range, current pace, and live Kalshi thresholds in one place.
              </div>
            </div>
            <div className="city-chip-grid">
              {cityList.map(c => {
                const isSelected = selectedCity === c;
                const obs = OBSERVATIONS?.[c] || {};
                const citySignals = (EDGES || []).filter(e => e.city === c && e.signal).length;
                return (
                  <div key={c} onClick={() => setSelectedCity(isSelected ? null : c)} className={`city-chip${isSelected ? " is-active" : ""}`}>
                    <div className="city-chip-code">{c}
                      {citySignals > 0 && <span className="city-chip-signal">{citySignals}</span>}
                    </div>
                    <div className="city-chip-temp">{obs.temp_f != null ? `${obs.temp_f}F` : "—"}</div>
                    <div className="city-chip-meta">{CITY_NAMES[c]}</div>
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

              const ForecastSnapshot = ({ models, mean, std, typeColor, typeLabel, extraChip }) => {
                if (!models) return null;
                const sorted = Object.entries(models).sort((a, b) => a[1] - b[1]);
                const temps = sorted.map(([, temp]) => temp);
                const low = Math.min(...temps);
                const high = Math.max(...temps);
                const spread = high - low;
                const modelSummary = sorted
                  .map(([model, temp]) => `${MODEL_LABELS[model]} ${temp.toFixed(1)}F`)
                  .join("  ·  ");

                return (
                  <div className="forecast-snapshot">
                    <div className="forecast-snapshot-head">
                      <div>
                        <div className="forecast-snapshot-kicker" style={{ color: typeColor }}>{typeLabel}</div>
                        <div className="forecast-snapshot-temp">{mean}F</div>
                      </div>
                      <div className="forecast-snapshot-meta">
                        <span>{low.toFixed(0)}-{high.toFixed(0)}F range</span>
                        <span>{spread.toFixed(1)}F spread</span>
                        <span>±{std?.toFixed(1) || "—"}F sigma</span>
                      </div>
                    </div>

                    <div className="forecast-chip-row">
                      <span className="forecast-chip">Ensemble {mean}F</span>
                      {extraChip ? <span className="forecast-chip">{extraChip}</span> : null}
                    </div>

                    <div className="forecast-model-summary">
                      {sorted.map(([model]) => (
                        <span key={model} className="forecast-model-dot" style={{ "--model-color": MODEL_COLORS[model] || "#94a3b8" }} />
                      ))}
                      <span>{modelSummary}</span>
                    </div>
                  </div>
                );
              };

              const getContractAnchor = (edge) => {
                if (edge.strike_type === "between") {
                  const parts = String(edge.threshold).split("-").map(Number);
                  if (parts.length === 2 && parts.every((part) => !Number.isNaN(part))) {
                    return (parts[0] + parts[1]) / 2;
                  }
                }
                const numeric = parseFloat(edge.threshold);
                return Number.isNaN(numeric) ? null : numeric;
              };

              const pickCoverageRows = (edges, referenceTemp) => {
                if (!edges.length) return [];

                const picks = [];
                const seen = new Set();
                const addPick = (edge, label) => {
                  if (!edge || seen.has(edge.ticker)) return;
                  picks.push({ edge, label });
                  seen.add(edge.ticker);
                };

                const strongestSignal = [...edges]
                  .filter((edge) => edge.signal)
                  .sort((a, b) => Math.abs(b.edge || 0) - Math.abs(a.edge || 0))[0];
                addPick(strongestSignal, "signal");

                const nearestLine = [...edges]
                  .filter((edge) => getContractAnchor(edge) != null && referenceTemp != null)
                  .sort((a, b) => Math.abs(getContractAnchor(a) - referenceTemp) - Math.abs(getContractAnchor(b) - referenceTemp))[0];
                addPick(nearestLine, "closest");

                const biggestDisagreement = [...edges]
                  .sort((a, b) => Math.abs(b.edge || 0) - Math.abs(a.edge || 0))[0];
                addPick(biggestDisagreement, "largest edge");

                return picks;
              };

              const CoverageRows = ({ edges, eventUrl, referenceTemp }) => {
                if (!edges.length) return null;
                const featuredRows = pickCoverageRows(edges, referenceTemp);
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>COVERAGE LADDER</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {edges.length > featuredRows.length ? (
                          <span style={{ fontSize: 10, color: "#64748b" }}>showing {featuredRows.length} of {edges.length}</span>
                        ) : null}
                        {eventUrl && <a href={eventUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textDecoration: "none", letterSpacing: 1 }}>KALSHI LIVE &rarr;</a>}
                      </div>
                    </div>
                    <div className="coverage-row-list">
                      {featuredRows.map(({ edge: e, label }) => {
                        const edgeVal = e.edge || 0;
                        const signalColor = e.signal ? getSignalColor(e.signal) : "#64748b";
                        const side = edgeVal >= 0 ? "YES" : "NO";
                        const actionLabel = e.signal ? `BET ${e.signal}` : `${side} lean`;
                        const actionTone = e.signal ? signalColor : edgeVal >= 0 ? "#22c55e" : "#ef4444";
                        return (
                          <a
                            key={e.ticker}
                            href={kalshiUrl(e)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="coverage-row"
                            style={{ borderColor: e.signal ? `${signalColor}66` : "#1e293b" }}
                          >
                            <div className="coverage-row-main">
                              <div className="coverage-row-label">{label}</div>
                              <div className="coverage-row-threshold">
                                {e.strike_type === "less" ? "<" : e.strike_type === "greater" ? ">" : ""}{e.threshold}F
                              </div>
                              <div className="coverage-row-probs">
                                <span>Us {pct(e.our_prob)}</span>
                                <span>Mkt {pct(e.market_mid)}</span>
                              </div>
                            </div>
                            <div className="coverage-row-side">
                              <div className="coverage-row-action">
                                <span className="coverage-row-action-chip" style={{ background: `${actionTone}18`, color: actionTone, borderColor: `${actionTone}55` }}>
                                  {actionLabel}
                                </span>
                              </div>
                              <div className="coverage-row-edge" style={{ color: edgeVal > 0 ? "#22c55e" : "#ef4444" }}>
                                {signPct(edgeVal)}
                              </div>
                              {e.signal ? (
                                <span className="coverage-row-signal" style={{ background: signalColor }}>
                                  {e.signal}
                                </span>
                              ) : (
                                <span className="coverage-row-note">watch</span>
                              )}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  </>
                );
              };

              return (
                <div>
                  {/* City header */}
                  <div style={{ background: "#0f172a", borderRadius: 12, padding: "16px 20px", marginBottom: 16, border: "1px solid #1e293b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 900, color: "#f1f5f9", margin: 0 }}>{CITY_NAMES[selectedCity]}</h2>
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
                        <ForecastSnapshot
                          models={ens.high_models}
                          mean={ens.high_mean}
                          std={ens.high_std}
                          typeColor="#ef4444"
                          typeLabel="HIGH"
                          extraChip={date === todayDate && obs.pace_delta != null ? `Pace ${obs.pace_delta > 0 ? "+" : ""}${obs.pace_delta.toFixed(1)}F` : null}
                        />
                        <CoverageRows edges={highEdges} eventUrl={highEventUrl} referenceTemp={ens.high_mean} />
                      </div>

                      {/* LOW section */}
                      {ens.low_mean && (
                        <div>
                          <ForecastSnapshot
                            models={ens.low_models}
                            mean={ens.low_mean}
                            std={ens.low_std}
                            typeColor="#3b82f6"
                            typeLabel="LOW"
                          />
                          <CoverageRows edges={lowEdges} eventUrl={lowEventUrl} referenceTemp={ens.low_mean} />
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              );
            })()}

            {!selectedCity && (
              <div className="empty-state">
                Select a city above to open its forecast stack and live contract ladder.
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
            <div className="section-header">
              <div>
                <div className="section-kicker">Track record</div>
                <div className="section-title">Resolved performance</div>
              </div>
              <div className="section-copy">
                Results stay separated from the live scanner so current opportunities and historical outcomes do not compete for attention.
              </div>
            </div>
            <div className="results-toggle">
              {[["last100", "Last 100"], ["overall", "Overall"]].map(([key, label]) => (
                <button key={key} type="button" className={resultsView === key ? "is-active" : ""} onClick={() => setResultsView(key)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Empty state */}
            {viewSummary.total === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1f4ca;</div>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontSize: 20, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>No Results Yet</h3>
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
                        {picks.map((p) => {
                          const isWin = p.result === "WIN";
                          return (
                          <tr key={`${p.resolved_at}-${p.city}-${p.threshold}-${p.signal}`} style={{ borderBottom: "1px solid #1e293b" }}>
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
          <div className="guide-shell" style={{ maxWidth: 760, margin: "0 auto" }}>
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
                <h3 style={{ fontFamily: "Syne, sans-serif", fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>{section.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: "#94a3b8" }}>{section.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* FOOTER */}
        <div style={{ textAlign: "center", marginTop: 40, paddingBottom: 24 }}>
          <a href="https://www.buymeacoffee.com/Trickriggin" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "linear-gradient(135deg, #3b82f6, #06b6d4)", color: "#fff", borderRadius: 8, fontFamily: "Syne, sans-serif", fontSize: 14, fontWeight: 800, textDecoration: "none", transition: "transform 0.2s, box-shadow 0.2s", boxShadow: "0 2px 8px rgba(59,130,246,0.3)", letterSpacing: 0.5 }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(59,130,246,0.5)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(59,130,246,0.3)"; }}>
            Donate Tokens
          </a>
          <p className="footer-note">Please gamble responsibly</p>
        </div>
      </div>
    </div>
  );
}

export default App;
