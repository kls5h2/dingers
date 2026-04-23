import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, opts);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const fmtAvg = (n) => n == null ? "—" : Number(n).toFixed(3).replace(/^0/, "");
const fmt = (n) => n == null ? "—" : Math.round(n);

// ── Design tokens ──────────────────────────────────────────────────────────
const NAVY = "#1a2f5e";
const RED  = "#c8102e";
const CONF = { HIGH: { color: RED, bg: "#fff0f0", border: "#f5c1c1" }, MED: { color: "#b45309", bg: "#fffbeb", border: "#fcd34d" }, LOW: { color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb" }, PASS: { color: "#6b7280", bg: "#f3f4f6", border: "#d1d5db" } };

function Badge({ conf }) {
  const c = CONF[conf] || CONF.LOW;
  return <span style={{ fontSize: 11, fontWeight: 500, color: c.color, background: c.bg, border: `1px solid ${c.border}`, padding: "2px 10px", borderRadius: 20 }}>{conf}</span>;
}

function Card({ children, style = {} }) {
  return <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.14em", marginBottom: 12 }}>{children}</div>;
}

function Divider() {
  return <div style={{ height: "0.5px", background: "#f0f0f0", margin: "8px 0" }} />;
}

function Spinner() {
  return <div style={{ color: "#9ca3af", fontSize: 12, padding: "20px 0", textAlign: "center" }}>Loading...</div>;
}

function ErrMsg({ msg }) {
  return <div style={{ color: RED, fontSize: 11, padding: "10px 0" }}>⚠ {msg}</div>;
}

// ── Live Alerts ────────────────────────────────────────────────────────────
function LiveAlerts({ hrs }) {
  const shown = (hrs || []).slice(0, 5);
  return (
    <div style={{ background: "#f0faf6", border: "1px solid #a7f3d0", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#065f46", letterSpacing: "0.14em", marginBottom: shown.length ? 10 : 0 }}>
        ● LIVE HR ALERTS
      </div>
      {!shown.length && <div style={{ fontSize: 12, color: "#6b7280" }}>No home runs yet today. Polling every 60 seconds.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map((hr, i) => (
          <div key={hr.id || i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "0.5px solid #a7f3d0", borderRadius: 8, padding: "9px 12px", opacity: i === 0 ? 1 : 0.65 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#064e3b" }}>{hr.player}</span>
              {hr.seasonHRs && <span style={{ fontSize: 11, color: "#6b7280" }}> (#{hr.seasonHRs})</span>}
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {hr.team && hr.opponent ? ` — ${hr.team} vs ${hr.opponent}` : ""}
                {hr.inning ? ` · Inn. ${hr.inning}` : ""}
                {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
                {hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>
              {hr.timestamp ? new Date(hr.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Yesterday HRs ──────────────────────────────────────────────────────────
function YesterdayHRs({ data, loading, error, onPlayerClick }) {
  const hrs = data?.hrs || [];
  return (
    <Card>
      <SectionLabel>YESTERDAY'S HRs</SectionLabel>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      {!loading && !error && !hrs.length && <div style={{ color: "#9ca3af", fontSize: 12 }}>No data.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {hrs.map((hr, i) => (
          <div key={hr.id || i} onClick={() => hr.playerId && onPlayerClick({ playerId: hr.playerId, playerName: hr.player })}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: "#f9fafb", borderRadius: 8, cursor: hr.playerId ? "pointer" : "default" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{hr.player}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {hr.team}{hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}{hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}{hr.inning ? ` · Inn. ${hr.inning}` : ""}
              </div>
            </div>
            {hr.seasonHRs && <span style={{ background: RED, color: "#fff", fontSize: 10, fontWeight: 500, padding: "3px 9px", borderRadius: 4 }}>{hr.seasonHRs} HR</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Today's Plays ──────────────────────────────────────────────────────────
function TopPlays({ data, loading, error, onPlayerClick }) {
  const plays = data?.plays || [];
  return (
    <Card>
      <SectionLabel>TODAY'S TOP PLAYS</SectionLabel>
      {loading && <div style={{ color: "#9ca3af", fontSize: 12, padding: "20px 0", textAlign: "center" }}>Analyzing today's matchups...</div>}
      {error && <ErrMsg msg={error} />}
      {!loading && !error && !plays.length && <div style={{ color: "#9ca3af", fontSize: 12 }}>No plays yet.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {plays.map((p, i) => {
          const conf = p.confidence || "LOW";
          const isPass = conf === "PASS";
          return (
            <div key={i} onClick={() => p.playerId && onPlayerClick({ playerId: p.playerId, playerName: p.player })}
              style={{ padding: "10px 12px", background: isPass ? "#fafafa" : "#f9fafb", borderRadius: 8, borderLeft: `3px solid ${CONF[conf]?.color || "#d1d5db"}`, cursor: p.playerId ? "pointer" : "default", opacity: isPass ? 0.75 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{p.player}</div>
                <Badge conf={conf} />
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: p.note ? 4 : 0 }}>
                vs {p.pitcher} ({p.pitcherHand}) · Park {p.parkFactor} · {p.last7HRs} HR last 7{p.hotStreak ? " 🔥" : ""}
              </div>
              {p.note && <div style={{ fontSize: 11, color: isPass ? "#9ca3af" : "#374151", lineHeight: 1.5 }}>{p.note}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Player Deep Dive ───────────────────────────────────────────────────────
function DeepDive({ playerId, playerName, onClose }) {
  const [data, setData]       = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true); setData(null); setAnalysis(null);
    apiFetch(`/api/player/${playerId}`)
      .then(d => { setData(d); setLoading(false); runAI(d); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [playerId]);

  async function runAI(d) {
    setAiLoading(true);
    try {
      const r = await apiFetch("/api/ai/player-analysis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, stats: d.stats, info: d.info }),
      });
      setAnalysis(r);
    } catch {}
    setAiLoading(false);
  }

  const st = data?.stats;
  const info = data?.info;

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionLabel>PLAYER DEEP DIVE</SectionLabel>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>
      </div>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      {!loading && data && (
        <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 500, color: "#111827" }}>{info?.fullName || playerName}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{info?.currentTeam?.name} · {info?.primaryPosition?.abbreviation} · {info?.batSide?.description}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 28, fontWeight: 500, color: RED, lineHeight: 1 }}>{st?.season?.homeRuns ?? "—"}</div>
              <div style={{ fontSize: 10, color: "#6b7280" }}>HR THIS SEASON</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 10 }}>
            {[["LAST 7", `${st?.last7?.homeRuns ?? "—"} HR`, st?.last7?.homeRuns > 1 ? "#059669" : "#111827"],
              ["LAST 14", `${st?.last14?.homeRuns ?? "—"} HR`, "#111827"],
              ["vs LHP", `${st?.vsLeft?.homeRuns ?? "—"} HR`, "#111827"],
              ["vs RHP", `${st?.vsRight?.homeRuns ?? "—"} HR`, "#111827"],
              ["HOME HR", st?.home?.homeRuns ?? "—", "#111827"],
              ["AWAY HR", st?.away?.homeRuns ?? "—", "#111827"],
              ["AVG", fmtAvg(st?.season?.avg), "#111827"],
              ["OPS", st?.season?.ops ? Number(st.season.ops).toFixed(3) : "—", "#111827"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, color }}>{val}</div>
              </div>
            ))}
          </div>
          {aiLoading && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>Analyzing matchup...</div>}
          {analysis && (
            <div style={{ marginTop: 10, background: analysis.confidence === "HIGH" ? "#f0fdf4" : analysis.confidence === "PASS" ? "#f9fafb" : "#fffbeb", border: `1px solid ${analysis.confidence === "HIGH" ? "#bbf7d0" : analysis.confidence === "PASS" ? "#e5e7eb" : "#fde68a"}`, borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em" }}>AI ANALYSIS</div>
                <Badge conf={analysis.confidence} />
              </div>
              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>{analysis.summary}</div>
              {analysis.strengths?.map((s, i) => <div key={i} style={{ fontSize: 11, color: "#059669", marginBottom: 2 }}>✓ {s}</div>)}
              {analysis.watchouts?.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#d97706", marginBottom: 2, marginTop: 2 }}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Park Factors ───────────────────────────────────────────────────────────
function ParkFactors({ data, loading, error, games }) {
  const venues = new Set((games || []).map(g => g.venue));
  const parks = (data?.parks || []).filter(p => !venues.size || venues.has(p.name)).slice(0, 8);
  return (
    <Card>
      <SectionLabel>PARK FACTORS</SectionLabel>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {parks.map((p, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>{p.city}</div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: p.factor > 108 ? RED : p.factor < 93 ? "#9ca3af" : "#b45309" }}>{p.factor}</span>
            </div>
            {i < parks.length - 1 && <Divider />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Weather ────────────────────────────────────────────────────────────────
function Weather({ games, loading, error }) {
  const outdoor = (games || []).filter(g => g.weather?.temp);
  function impact(w) {
    if (!w?.wind) return "NEUTRAL";
    const s = parseInt(w.wind) || 0;
    if (w.wind.toLowerCase().includes("out") && s > 10) return "BOOST";
    if (w.wind.toLowerCase().includes("in") && s > 8) return "SUPPRESS";
    return "NEUTRAL";
  }
  const impactColor = { BOOST: "#059669", NEUTRAL: "#9ca3af", SUPPRESS: RED };
  return (
    <Card>
      <SectionLabel>WEATHER</SectionLabel>
      {loading && <Spinner />}
      {!loading && !outdoor.length && <div style={{ fontSize: 12, color: "#9ca3af" }}>No outdoor game data.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {outdoor.slice(0, 6).map((g, i) => {
          const imp = impact(g.weather);
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{g.venue}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>{g.city} · {g.weather?.temp}°F · {g.weather?.wind}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: impactColor[imp] }}>{imp}</span>
              </div>
              {i < outdoor.length - 1 && <Divider />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── HR Leaders ─────────────────────────────────────────────────────────────
function HRLeaders({ data, loading, error, onPlayerClick }) {
  return (
    <Card>
      <SectionLabel>SEASON HR LEADERS</SectionLabel>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(data?.leaders || []).slice(0, 8).map((l, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => l.playerId && onPlayerClick({ playerId: l.playerId, playerName: l.player })}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#9ca3af", width: 18 }}>#{l.rank}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{l.player}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>{l.team}</div>
                </div>
              </div>
              <span style={{ fontSize: 18, fontWeight: 500, color: RED }}>{l.value}</span>
            </div>
            {i < 7 && <Divider />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Player Search ──────────────────────────────────────────────────────────
function PlayerSearch({ onSelect }) {
  const [q, setQ]   = useState("");
  const [results, setResults] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const d = await apiFetch(`/api/player/search?q=${encodeURIComponent(q)}`); setResults(d.players || []); } catch {}
    }, 400);
  }, [q]);

  return (
    <div style={{ marginBottom: 14, position: "relative" }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any player..."
        style={{ width: "100%", background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", color: "#111827", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      {results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, marginTop: 4, zIndex: 20, overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          {results.map(p => (
            <div key={p.id} onClick={() => { onSelect(p); setQ(""); setResults([]); }}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "0.5px solid #f3f4f6", fontSize: 13, color: "#111827" }}>
              {p.name} <span style={{ color: "#9ca3af", fontSize: 11 }}>{p.team} · {p.position}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [liveHRs,   setLiveHRs]   = useState([]);
  const [yesterday, setYesterday] = useState({ loading: true, data: null, error: null });
  const [plays,     setPlays]     = useState({ loading: true, data: null, error: null });
  const [parkData,  setParkData]  = useState({ loading: true, data: null, error: null });
  const [leaders,   setLeaders]   = useState({ loading: true, data: null, error: null });
  const [games,     setGames]     = useState({ loading: true, data: null, error: null });
  const [deepDive,  setDeepDive]  = useState(null);
  const [refreshing,setRefreshing]= useState(false);
  const pollRef = useRef(null);

  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);

    apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {});
    apiFetch("/api/today-games").then(d => setGames({ loading: false, data: d, error: null })).catch(e => setGames({ loading: false, data: null, error: e.message }));
    apiFetch("/api/park-factors").then(d => setParkData({ loading: false, data: d, error: null })).catch(e => setParkData({ loading: false, data: null, error: e.message }));
    apiFetch("/api/hr-leaders").then(d => setLeaders({ loading: false, data: d, error: null })).catch(e => setLeaders({ loading: false, data: null, error: e.message }));
    apiFetch("/api/yesterday-hrs").then(d => setYesterday({ loading: false, data: d, error: null })).catch(e => setYesterday({ loading: false, data: null, error: e.message }));

    // AI plays — cached daily on backend
    setPlays({ loading: true, data: null, error: null });
    apiFetch("/api/ai/plays-cached")
      .then(d => setPlays({ loading: false, data: d, error: null }))
      .catch(e => setPlays({ loading: false, data: null, error: e.message }));

    if (refresh) setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => { apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {}); }, 60_000);
    return () => clearInterval(pollRef.current);
  }, []);

  function handlePlayerClick(p) {
    if (p?.playerId || p?.id) setDeepDive({ playerId: p.playerId || p.id, playerName: p.player || p.name });
  }

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`* { box-sizing: border-box; margin: 0; } input::placeholder { color: #9ca3af; }`}</style>

      <div style={{ background: NAVY, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 500, color: "#fff", letterSpacing: "0.04em" }}>DINGERS</span>
          <div style={{ height: 14, width: "0.5px", background: "rgba(255,255,255,0.2)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.16em" }}>HR BETTING INTEL</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 4 }}>{today}</span>
          <button onClick={() => load(true)} disabled={refreshing} style={{ background: refreshing ? "rgba(255,255,255,0.2)" : RED, color: "#fff", border: "none", padding: "6px 16px", borderRadius: 6, fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", cursor: refreshing ? "not-allowed" : "pointer" }}>
            {refreshing ? "LOADING..." : "↻ REFRESH"}
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 1360, margin: "0 auto" }}>
        <LiveAlerts hrs={liveHRs} />
        <PlayerSearch onSelect={handlePlayerClick} />
        {deepDive && <DeepDive playerId={deepDive.playerId} playerName={deepDive.playerName} onClose={() => setDeepDive(null)} />}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <YesterdayHRs {...yesterday} onPlayerClick={handlePlayerClick} />
          <TopPlays {...plays} onPlayerClick={handlePlayerClick} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <ParkFactors {...parkData} games={games.data?.games} />
          <Weather games={games.data?.games} loading={games.loading} error={games.error} />
          <HRLeaders {...leaders} onPlayerClick={handlePlayerClick} />
        </div>
      </div>
    </div>
  );
}
