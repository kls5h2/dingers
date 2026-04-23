import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n, dec = 0) => n == null ? "—" : Number(n).toFixed(dec);
const fmtAvg = (n) => n == null ? "—" : Number(n).toFixed(3).replace(/^0/, "");

async function apiFetch(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function extractJSON(text) {
  const s = text.indexOf("{");
  if (s === -1) return null;
  let d = 0;
  for (let i = s; i < text.length; i++) {
    if (text[i] === "{") d++;
    else if (text[i] === "}") { d--; if (d === 0) return text.slice(s, i + 1); }
  }
  return null;
}

// AI calls go through backend (keeps API key secure)
async function aiPlays(gamesList, today) {
  const r = await fetch(`${API}/api/ai/plays`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamesList, today }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function aiPlayerAnalysis(playerName, stats, info) {
  const r = await fetch(`${API}/api/ai/player-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerName, stats, info }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:       "#0d1830",
  surface:  "#1a2d50",
  card:     "#111e38",
  border:   "rgba(255,255,255,0.1)",
  text:     "#ffffff",
  muted:    "rgba(255,255,255,0.45)",
  dim:      "rgba(255,255,255,0.25)",
  red:      "#c8102e",
  amber:    "#e8a020",
  green:    "#2ec27e",
  blue:     "#6b9fff",
};

const s = {
  card: {
    background: C.surface,
    border: `0.5px solid ${C.border}`,
    borderRadius: 10,
    padding: 14,
  },
  innerCard: {
    background: C.card,
    border: `0.5px solid ${C.border}`,
    borderRadius: 7,
    padding: "9px 11px",
  },
  label: {
    fontSize: 10,
    color: C.muted,
    letterSpacing: "0.18em",
    marginBottom: 10,
    fontWeight: 500,
  },
  statBox: {
    background: C.bg,
    borderRadius: 6,
    padding: "9px 10px",
    textAlign: "center",
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function Badge({ children, color = C.red }) {
  return (
    <span style={{ background: color, color: "#fff", fontSize: 10, fontWeight: 500, padding: "3px 9px", borderRadius: 4 }}>
      {children}
    </span>
  );
}

function SectionTitle({ children }) {
  return <div style={s.label}>{children}</div>;
}

function Divider() {
  return <div style={{ height: "0.5px", background: "rgba(255,255,255,0.08)", margin: "7px 0" }} />;
}

function Spinner() {
  return <div style={{ color: C.muted, fontSize: 12, padding: "20px 0", textAlign: "center", letterSpacing: "0.12em" }}>LOADING...</div>;
}

function ErrMsg({ msg }) {
  return <div style={{ color: C.red, fontSize: 11, fontFamily: "monospace", padding: "10px 0" }}>⚠ {msg}</div>;
}

// ── Live Alerts ────────────────────────────────────────────────────────────
function LiveAlerts({ hrs, loading }) {
  const shown = (hrs || []).slice(0, 5);
  return (
    <div style={{ background: "#0a1f14", borderBottom: `1px solid #1a4a2a`, padding: "10px 20px" }}>
      <div style={{ fontSize: 10, color: C.green, letterSpacing: "0.2em", marginBottom: 8, fontWeight: 500 }}>
        ● LIVE HR ALERTS
      </div>
      {loading && <Spinner />}
      {!loading && !shown.length && (
        <div style={{ fontSize: 12, color: C.muted, padding: "4px 0" }}>No home runs yet today. Polling every 60 seconds.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map((hr, i) => (
          <div key={hr.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "#0a1f12", border: `0.5px solid #1e4a2a`,
            borderRadius: 6, padding: "9px 12px",
            opacity: i === 0 ? 1 : 0.65,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, flexShrink: 0, opacity: i === 0 ? 1 : 0.4 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{hr.player}</span>
              {hr.seasonHRs && <span style={{ fontSize: 11, color: C.muted }}> (#{hr.seasonHRs} this season)</span>}
              <span style={{ fontSize: 12, color: C.muted }}>
                {` — ${hr.team} vs ${hr.opponent} · Inn. ${hr.inning}`}
                {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
                {hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
              </span>
            </div>
            <span style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>
              {new Date(hr.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Yesterday HRs ──────────────────────────────────────────────────────────
function YesterdayHRs({ data, loading, error, onPlayerClick }) {
  return (
    <div style={s.card}>
      <SectionTitle>YESTERDAY'S HRs</SectionTitle>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      {!loading && !error && !(data?.hrs?.length) && <div style={{ color: C.muted, fontSize: 12 }}>No data.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {(data?.hrs || []).map((hr, i) => (
          <div key={hr.id || i}
            style={{ ...s.innerCard, cursor: "pointer" }}
            onClick={() => onPlayerClick && onPlayerClick(hr)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{hr.player}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {hr.team}
                  {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
                  {hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
                  {hr.inning ? ` · Inn. ${hr.inning}` : ""}
                </div>
              </div>
              {hr.seasonHRs && <Badge>{hr.seasonHRs} HR</Badge>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Today's Top Plays ──────────────────────────────────────────────────────
function TopPlays({ data, loading, error, onPlayerClick }) {
  const plays = data?.plays || [];
  const confColor = { HIGH: C.red, MED: C.amber, LOW: C.muted };

  return (
    <div style={s.card}>
      <SectionTitle>TODAY'S TOP PLAYS</SectionTitle>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      {!loading && !error && !plays.length && <div style={{ color: C.muted, fontSize: 12 }}>No plays yet.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {plays.map((p, i) => (
          <div key={i}
            style={{ ...s.innerCard, borderLeft: `2px solid ${confColor[p.confidence] || C.muted}`, cursor: "pointer" }}
            onClick={() => onPlayerClick && onPlayerClick({ player: p.player, playerId: p.playerId })}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{p.player}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: confColor[p.confidence] || C.muted }}>{p.confidence}</div>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              vs {p.pitcher} ({p.pitcherHand}) · Park {p.parkFactor} · {p.last7HRs} HR last 7
              {p.hotStreak ? " · 🔥" : ""}
            </div>
            {p.note && <div style={{ fontSize: 11, color: C.blue, marginTop: 4 }}>{p.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Player Deep Dive ───────────────────────────────────────────────────────
function DeepDive({ playerId, playerName, onClose }) {
  const [data, setData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    setData(null);
    setAnalysis(null);
    apiFetch(`/api/player/${playerId}`)
      .then(d => { setData(d); setLoading(false); runAI(d); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [playerId]);

  async function runAI(d) {
    setAiLoading(true);
    try {
      const result = await aiPlayerAnalysis(playerName, d.stats, d.info);
      setAnalysis(result);
    } catch(e) { /* AI optional */ }
    setAiLoading(false);
  }

  const st = data?.stats;
  const info = data?.info;
  const confColor = { HIGH: C.red, MED: C.amber, LOW: C.muted };

  return (
    <div style={{ ...s.card, marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle>PLAYER DEEP DIVE</SectionTitle>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>

      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}

      {!loading && data && (
        <div style={{ background: C.card, borderRadius: 8, border: `0.5px solid ${C.border}`, padding: 14 }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 500, color: C.text }}>{info?.fullName || playerName}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                {info?.currentTeam?.name} · {info?.primaryPosition?.abbreviation} · {info?.batSide?.description || ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 28, fontWeight: 500, color: C.red, lineHeight: 1 }}>{st?.season?.homeRuns ?? "—"}</div>
              <div style={{ fontSize: 10, color: C.muted }}>HR THIS SEASON</div>
            </div>
          </div>

          {/* Stat grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginBottom: 10 }}>
            {[
              ["LAST 7", `${st?.last7?.homeRuns ?? "—"} HR`, st?.last7?.homeRuns > 1 ? C.green : C.text],
              ["LAST 14", `${st?.last14?.homeRuns ?? "—"} HR`, C.text],
              ["LAST 30", `${st?.last30?.homeRuns ?? "—"} HR`, C.text],
              ["AVG", fmtAvg(st?.season?.avg), C.text],
              ["vs LHP", `${st?.vsLeft?.homeRuns ?? "—"} HR`, C.text],
              ["vs RHP", `${st?.vsRight?.homeRuns ?? "—"} HR`, C.text],
              ["HOME HR", `${st?.home?.homeRuns ?? "—"}`, C.text],
              ["AWAY HR", `${st?.away?.homeRuns ?? "—"}`, C.text],
            ].map(([label, val, color]) => (
              <div key={label} style={s.statBox}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* AI analysis */}
          {aiLoading && <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>Analyzing matchup...</div>}
          {analysis && (
            <div style={{ marginTop: 10, background: C.bg, borderRadius: 6, padding: 11, border: `0.5px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.12em" }}>AI ANALYSIS</div>
                <Badge color={confColor[analysis.confidence] || C.muted}>{analysis.confidence}</Badge>
              </div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{analysis.summary}</div>
              {analysis.strengths?.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  {analysis.strengths.map((s, i) => (
                    <div key={i} style={{ fontSize: 11, color: C.green, marginBottom: 2 }}>✓ {s}</div>
                  ))}
                </div>
              )}
              {analysis.watchouts?.length > 0 && (
                <div>
                  {analysis.watchouts.map((w, i) => (
                    <div key={i} style={{ fontSize: 11, color: C.amber, marginBottom: 2 }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Park Factors ───────────────────────────────────────────────────────────
function ParkFactors({ data, loading, error, games }) {
  const gameVenues = new Set((games || []).map(g => g.venue));
  const parks = (data?.parks || []).filter(p => gameVenues.size === 0 || gameVenues.has(p.name));

  return (
    <div style={s.card}>
      <SectionTitle>PARK FACTORS — TODAY'S VENUES</SectionTitle>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {parks.slice(0, 8).map((p, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, color: C.text }}>{p.name}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{p.city}</div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: p.factor > 108 ? C.red : p.factor < 93 ? C.muted : C.amber }}>
                {p.factor}
              </span>
            </div>
            {i < parks.length - 1 && <Divider />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Weather ────────────────────────────────────────────────────────────────
function Weather({ games, loading, error }) {
  const outdoor = (games || []).filter(g => g.weather);
  const impactColor = { BOOST: C.green, NEUTRAL: C.muted, SUPPRESS: C.red };

  function getImpact(w) {
    if (!w) return "NEUTRAL";
    const wind = w.wind || "";
    const speed = parseInt(wind) || 0;
    if (wind.toLowerCase().includes("out") && speed > 10) return "BOOST";
    if (wind.toLowerCase().includes("in") && speed > 8) return "SUPPRESS";
    return "NEUTRAL";
  }

  return (
    <div style={s.card}>
      <SectionTitle>WEATHER AT BALLPARKS</SectionTitle>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      {!loading && !outdoor.length && <div style={{ fontSize: 12, color: C.muted }}>No outdoor game weather data.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {outdoor.slice(0, 6).map((g, i) => {
          const impact = getImpact(g.weather);
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12, color: C.text }}>{g.venue}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>
                    {g.city} · {g.weather?.temp}°F · {g.weather?.wind}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: impactColor[impact] }}>{impact}</span>
              </div>
              {i < outdoor.length - 1 && <Divider />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 7-Day Leaders ──────────────────────────────────────────────────────────
function HRLeaders({ data, loading, error, onPlayerClick }) {
  return (
    <div style={s.card}>
      <SectionTitle>SEASON HR LEADERS</SectionTitle>
      {loading && <Spinner />}
      {error && <ErrMsg msg={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(data?.leaders || []).slice(0, 8).map((l, i) => (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => onPlayerClick && onPlayerClick({ player: l.player, playerId: l.playerId })}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: C.muted, width: 16 }}>#{l.rank}</span>
                <div>
                  <div style={{ fontSize: 12, color: C.text }}>{l.player}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{l.team}</div>
                </div>
              </div>
              <span style={{ fontSize: 16, fontWeight: 500, color: C.red }}>{l.value}</span>
            </div>
            {i < 7 && <Divider />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Player Search ──────────────────────────────────────────────────────────
function PlayerSearch({ onSelect }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await apiFetch(`/api/player/search?q=${encodeURIComponent(q)}`);
        setResults(d.players || []);
      } catch {}
      setSearching(false);
    }, 400);
  }, [q]);

  return (
    <div style={{ marginBottom: 10 }}>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search player name..."
        style={{
          width: "100%", background: C.card, border: `0.5px solid ${C.border}`,
          borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 13,
          outline: "none",
        }}
      />
      {(results.length > 0 || searching) && (
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 6, marginTop: 4, overflow: "hidden" }}>
          {searching && <div style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>Searching...</div>}
          {results.map(p => (
            <div key={p.id}
              onClick={() => { onSelect(p); setQ(""); setResults([]); }}
              style={{ padding: "9px 12px", cursor: "pointer", borderBottom: `0.5px solid ${C.border}`, fontSize: 13, color: C.text }}
            >
              {p.name} <span style={{ color: C.muted, fontSize: 11 }}>{p.team} · {p.position}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [liveHRs,    setLiveHRs]    = useState([]);
  const [yesterday,  setYesterday]  = useState({ loading: true, data: null, error: null });
  const [plays,      setPlays]      = useState({ loading: true, data: null, error: null });
  const [parkData,   setParkData]   = useState({ loading: true, data: null, error: null });
  const [leaders,    setLeaders]    = useState({ loading: true, data: null, error: null });
  const [games,      setGames]      = useState({ loading: true, data: null, error: null });
  const [deepDive,   setDeepDive]   = useState(null); // { playerId, playerName }
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);

  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);

    // Live HRs — always poll
    apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {});

    // Yesterday
    if (!yesterday.data || refresh) {
      setYesterday(p => ({ ...p, loading: true }));
      apiFetch("/api/yesterday-hrs")
        .then(d => setYesterday({ loading: false, data: d, error: null }))
        .catch(e => setYesterday({ loading: false, data: null, error: e.message }));
    }

    // Today's games + weather
    apiFetch("/api/today-games")
      .then(d => setGames({ loading: false, data: d, error: null }))
      .catch(e => setGames({ loading: false, data: null, error: e.message }));

    // Park factors
    if (!parkData.data || refresh) {
      setParkData(p => ({ ...p, loading: true }));
      apiFetch("/api/park-factors")
        .then(d => setParkData({ loading: false, data: d, error: null }))
        .catch(e => setParkData({ loading: false, data: null, error: e.message }));
    }

    // HR leaders
    if (!leaders.data || refresh) {
      setLeaders(p => ({ ...p, loading: true }));
      apiFetch("/api/hr-leaders")
        .then(d => setLeaders({ loading: false, data: d, error: null }))
        .catch(e => setLeaders({ loading: false, data: null, error: e.message }));
    }

    // AI-powered plays (sequential, rate limit safe)
    setPlays({ loading: true, data: null, error: null });
    try {
      const gamesData = await apiFetch("/api/today-games");
      const gamesList = gamesData.games?.slice(0, 5).map(g => `${g.awayAbb} @ ${g.homeAbb} (${g.venue}, park factor ${g.parkFactor})`).join(", ");
      const result = await aiPlays(gamesList || "check MLB schedule", today);
      setPlays({ loading: false, data: result, error: null });
    } catch(e) {
      setPlays({ loading: false, data: null, error: e.message });
    }

    if (refresh) setRefreshing(false);
  }, []);

  // Initial load + live poll every 60s
  useEffect(() => {
    load();
    pollRef.current = setInterval(() => {
      apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {});
    }, 60_000);
    return () => clearInterval(pollRef.current);
  }, []);

  function handlePlayerClick(p) {
    if (p?.playerId || p?.id) {
      setDeepDive({ playerId: p.playerId || p.id, playerName: p.player || p.name });
    }
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`* { box-sizing: border-box; margin: 0; } input::placeholder { color: rgba(255,255,255,0.3); }`}</style>

      {/* Header */}
      <div style={{
        background: "#0a1420", padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `2px solid ${C.red}`, position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 500, color: C.text, letterSpacing: "0.05em" }}>DINGERS</span>
          <div style={{ height: 14, width: "0.5px", background: "rgba(255,255,255,0.2)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.18em" }}>HR BETTING INTEL</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.08)", border: `0.5px solid rgba(255,255,255,0.15)`, borderRadius: 4, padding: "4px 12px" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em" }}>{today.toUpperCase()}</span>
          </div>
          <button onClick={() => load(true)} disabled={refreshing} style={{
            background: refreshing ? "rgba(255,255,255,0.1)" : C.red,
            color: "#fff", border: "none", padding: "5px 16px",
            borderRadius: 4, fontSize: 11, fontWeight: 500, letterSpacing: "0.08em",
            cursor: refreshing ? "not-allowed" : "pointer",
          }}>
            {refreshing ? "LOADING..." : "↻ REFRESH"}
          </button>
        </div>
      </div>

      {/* Live Alerts */}
      <LiveAlerts hrs={liveHRs} loading={games.loading} />

      {/* Body */}
      <div style={{ padding: "16px 20px", maxWidth: 1360, margin: "0 auto" }}>

        {/* Deep Dive — full width when open */}
        {deepDive && (
          <div style={{ marginBottom: 14 }}>
            <PlayerSearch onSelect={p => handlePlayerClick(p)} />
            <DeepDive
              playerId={deepDive.playerId}
              playerName={deepDive.playerName}
              onClose={() => setDeepDive(null)}
            />
          </div>
        )}

        {!deepDive && (
          <div style={{ marginBottom: 14 }}>
            <PlayerSearch onSelect={p => handlePlayerClick(p)} />
          </div>
        )}

        {/* Main 2-col */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <YesterdayHRs {...yesterday} onPlayerClick={handlePlayerClick} />
          <TopPlays {...plays} onPlayerClick={handlePlayerClick} />
        </div>

        {/* Bottom 3-col */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <ParkFactors {...parkData} games={games.data?.games} />
          <Weather games={games.data?.games} loading={games.loading} error={games.error} />
          <HRLeaders {...leaders} onPlayerClick={handlePlayerClick} />
        </div>

      </div>
    </div>
  );
}
