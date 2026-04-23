import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}${path}`, opts);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const fmt = (n) => n == null ? "—" : Math.round(n);
const fmtAvg = (n) => n == null ? "—" : Number(n).toFixed(3).replace(/^0/, "");

const CONF = {
  HIGH: { color: "#fff",    bg: "#c8102e", dot: "#c8102e"  },
  MED:  { color: "#92400e", bg: "#fef3c7", dot: "#f59e0b"  },
  LOW:  { color: "#374151", bg: "#f3f4f6", dot: "#9ca3af"  },
  PASS: { color: "#6b7280", bg: "#f3f4f6", dot: "#d1d5db"  },
};

function ConfBadge({ conf }) {
  const c = CONF[conf] || CONF.LOW;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c.color, background: c.bg, padding: "3px 10px", borderRadius: 20, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{conf}</span>;
}

function LiveBar({ hrs }) {
  const [idx, setIdx] = useState(0);
  const shown = hrs || [];
  useEffect(() => {
    if (shown.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % shown.length), 4000);
    return () => clearInterval(t);
  }, [shown.length]);
  return (
    <div style={{ background: "#064e3b", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399" }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", letterSpacing: "0.14em" }}>LIVE</span>
      </div>
      {!shown.length
        ? <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>No HRs yet — watching every 60s</span>
        : <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>
            <strong>{shown[idx]?.player}</strong>
            {shown[idx]?.team && shown[idx]?.opponent ? ` · ${shown[idx].team} vs ${shown[idx].opponent}` : ""}
            {shown[idx]?.inning ? ` · Inn. ${shown[idx].inning}` : ""}
            {shown[idx]?.distance ? ` · ${fmt(shown[idx].distance)} ft` : ""}
          </span>}
      {shown.length > 1 && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>{idx + 1}/{shown.length}</span>}
    </div>
  );
}

function PlayCard({ p, onPlayerClick }) {
  const [open, setOpen] = useState(false);
  const conf = p.confidence || "LOW";
  const c = CONF[conf] || CONF.LOW;
  const isPass = conf === "PASS";
  return (
    <div onClick={() => setOpen(o => !o)} style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: `1px solid ${conf === "HIGH" ? "#fecaca" : "#e5e7eb"}`, opacity: isPass ? 0.7 : 1, boxShadow: conf === "HIGH" ? "0 2px 8px rgba(200,16,46,0.1)" : "0 1px 3px rgba(0,0,0,0.05)", cursor: "pointer" }}>
      {conf === "HIGH" && <div style={{ height: 3, background: "#c8102e" }} />}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{p.player}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>vs {p.pitcher} ({p.pitcherHand}) · {p.last7HRs} HR last 7{p.hotStreak ? " 🔥" : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ConfBadge conf={conf} />
          <span style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 14px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[["Park Factor", p.parkFactor, p.parkFactor > 108 ? "#c8102e" : "#374151"],
              ["Last 7 HRs", p.last7HRs, p.last7HRs >= 3 ? "#059669" : "#374151"],
              ["Opponent", p.opponent, "#374151"],
              ["Hand", p.pitcherHand === "L" ? "vs LHP" : "vs RHP", "#374151"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color }}>{val ?? "—"}</div>
              </div>
            ))}
          </div>
          {p.note && <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: "0 0 10px" }}>{p.note}</p>}
          {p.playerId && (
            <button onClick={e => { e.stopPropagation(); onPlayerClick({ playerId: p.playerId, playerName: p.player }); }}
              style={{ width: "100%", background: "#1a2f5e", color: "#fff", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              View Full Player Stats →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, accent, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 }}>
        {accent && <div style={{ width: 3, height: 16, borderRadius: 2, background: accent }} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.14em" }}>{title}</span>
      </div>
      <div style={{ padding: "0 16px 4px" }}>{children}</div>
    </div>
  );
}

function DeepDive({ playerId, playerName, onClose }) {
  const [data, setData]         = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [aiLoading, setAiLoad]  = useState(false);
  const [error, setError]       = useState(null);
  useEffect(() => {
    if (!playerId) return;
    setLoading(true); setData(null); setAnalysis(null);
    apiFetch(`/api/player/${playerId}`)
      .then(d => { setData(d); setLoading(false); runAI(d); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [playerId]);
  async function runAI(d) {
    setAiLoad(true);
    try {
      const r = await apiFetch("/api/ai/player-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerName, stats: d.stats, info: d.info }) });
      setAnalysis(r);
    } catch {}
    setAiLoad(false);
  }
  const st = data?.stats; const info = data?.info;
  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 14, boxShadow: "0 2px 16px rgba(0,0,0,0.12)" }}>
      <div style={{ background: "#1a2f5e", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{info?.fullName || playerName}</div>
          {info && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{info.currentTeam?.name} · {info.primaryPosition?.abbreviation} · {info.batSide?.description}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{st?.season?.homeRuns ?? "—"}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>HR 2026</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      </div>
      {loading && <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Loading stats...</div>}
      {error && <div style={{ padding: 16, fontSize: 12, color: "#c8102e" }}>⚠ {error}</div>}
      {!loading && data && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
            {[["LAST 7", `${st?.last7?.homeRuns ?? "—"}`, st?.last7?.homeRuns > 1 ? "#059669" : "#111827"],
              ["vs LHP", `${st?.vsLeft?.homeRuns ?? "—"}`, "#111827"],
              ["vs RHP", `${st?.vsRight?.homeRuns ?? "—"}`, "#111827"],
              ["AVG", fmtAvg(st?.season?.avg), "#111827"],
              ["LAST 14", `${st?.last14?.homeRuns ?? "—"}`, "#111827"],
              ["HOME", `${st?.home?.homeRuns ?? "—"}`, "#111827"],
              ["AWAY", `${st?.away?.homeRuns ?? "—"}`, "#111827"],
              ["OPS", st?.season?.ops ? Number(st.season.ops).toFixed(3) : "—", "#111827"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#f9fafb", borderRadius: 10, padding: "9px 6px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>
          {aiLoading && <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: 8 }}>Analyzing...</div>}
          {analysis && (
            <div style={{ background: analysis.confidence === "HIGH" ? "#fef2f2" : "#f9fafb", borderRadius: 12, padding: 14, border: `1px solid ${analysis.confidence === "HIGH" ? "#fecaca" : "#e5e7eb"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.1em" }}>TODAY'S ANALYSIS</span>
                <ConfBadge conf={analysis.confidence} />
              </div>
              <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: "0 0 8px" }}>{analysis.summary}</p>
              {analysis.strengths?.map((s, i) => <div key={i} style={{ fontSize: 12, color: "#059669", marginBottom: 3 }}>✓ {s}</div>)}
              {analysis.watchouts?.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#d97706", marginTop: 3 }}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerSearch({ onSelect }) {
  const [q, setQ] = useState("");
  const [results, setRes] = useState([]);
  const timer = useRef(null);
  useEffect(() => {
    if (q.length < 2) { setRes([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const d = await apiFetch(`/api/player/search?q=${encodeURIComponent(q)}`); setRes(d.players || []); } catch {}
    }, 400);
  }, [q]);
  return (
    <div style={{ position: "relative", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "10px 14px", gap: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <span style={{ color: "#9ca3af" }}>🔍</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any player for deep dive..."
          style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: "#111827", background: "transparent" }} />
        {q && <button onClick={() => { setQ(""); setRes([]); }} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>}
      </div>
      {results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
          {results.map(p => (
            <div key={p.id} onClick={() => { onSelect(p); setQ(""); setRes([]); }}
              style={{ padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>{p.name}</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{p.team} · {p.position}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [liveHRs,     setLiveHRs]     = useState([]);
  const [yesterday,   setYesterday]   = useState({ loading: true, data: null, error: null });
  const [plays,       setPlays]       = useState({ loading: true, data: null, error: null });
  const [parkData,    setParkData]    = useState({ loading: true, data: null, error: null });
  const [leaders,     setLeaders]     = useState({ loading: true, data: null, error: null });
  const [games,       setGames]       = useState({ loading: true, data: null, error: null });
  const [deepDive,    setDeepDive]    = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showAllYest, setShowAllYest] = useState(false);
  const pollRef = useRef(null);
  const today = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {});
    apiFetch("/api/today-games").then(d => setGames({ loading: false, data: d, error: null })).catch(() => setGames({ loading: false, data: null, error: null }));
    apiFetch("/api/park-factors").then(d => setParkData({ loading: false, data: d, error: null })).catch(() => {});
    apiFetch("/api/hr-leaders").then(d => setLeaders({ loading: false, data: d, error: null })).catch(() => {});
    apiFetch("/api/yesterday-hrs").then(d => setYesterday({ loading: false, data: d, error: null })).catch(e => setYesterday({ loading: false, data: null, error: e.message }));
    setPlays({ loading: true, data: null, error: null });
    apiFetch("/api/ai/plays-cached").then(d => setPlays({ loading: false, data: d, error: null })).catch(e => setPlays({ loading: false, data: null, error: e.message }));
    if (refresh) setTimeout(() => setRefreshing(false), 1200);
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => apiFetch("/api/live-hrs").then(d => setLiveHRs(d.hrs || [])).catch(() => {}), 60_000);
    return () => clearInterval(pollRef.current);
  }, []);

  function handlePlayerClick(p) {
    if (p?.playerId || p?.id) {
      setDeepDive({ playerId: p.playerId || p.id, playerName: p.player || p.name });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const yHRs = yesterday.data?.hrs || [];
  const visibleYHRs = showAllYest ? yHRs : yHRs.slice(0, 5);
  const gamesToday = games.data?.games || [];
  const venues = new Set(gamesToday.map(g => g.venue));
  const todayParks = (parkData.data?.parks || []).filter(p => !venues.size || venues.has(p.name)).slice(0, 6);
  const outdoor = gamesToday.filter(g => g.weather?.temp).slice(0, 5);

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <style>{`* { box-sizing: border-box; margin: 0; } input::placeholder { color: #9ca3af; } ::-webkit-scrollbar { display: none; }`}</style>

      <div style={{ background: "#1a2f5e", padding: "14px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>DINGERS</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em", marginTop: 2 }}>HR BETTING INTEL</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 10px" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>{today}</div>
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            style={{ background: refreshing ? "#7f1d1d" : "#c8102e", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: refreshing ? "not-allowed" : "pointer" }}>
            {refreshing ? "..." : "↻"}
          </button>
        </div>
      </div>

      <LiveBar hrs={liveHRs} />

      <div style={{ padding: "14px 14px 80px" }}>
        <PlayerSearch onSelect={handlePlayerClick} />
        {deepDive && <DeepDive playerId={deepDive.playerId} playerName={deepDive.playerName} onClose={() => setDeepDive(null)} />}

        <Section title="TODAY'S TOP PLAYS" accent="#c8102e">
          {plays.loading && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Analyzing today's matchups...</div>}
          {plays.error && <div style={{ padding: "12px 0", fontSize: 12, color: "#c8102e" }}>⚠ {plays.error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, paddingBottom: 12 }}>
            {(plays.data?.plays || []).map((p, i) => <PlayCard key={i} p={p} onPlayerClick={handlePlayerClick} />)}
          </div>
        </Section>

        <Section title="YESTERDAY'S HRs" accent="#1a2f5e">
          {yesterday.loading && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Loading...</div>}
          {yesterday.error && <div style={{ padding: "12px 0", fontSize: 12, color: "#c8102e" }}>⚠ {yesterday.error}</div>}
          <div>
            {visibleYHRs.map((hr, i) => (
              <div key={hr.id || i} onClick={() => hr.playerId && handlePlayerClick({ playerId: hr.playerId, playerName: hr.player })}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #f3f4f6", cursor: hr.playerId ? "pointer" : "default" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 16 }}>💥</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{hr.player}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                    {hr.team}{hr.inning ? ` · Inn. ${hr.inning}` : ""}{hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}{hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
                  </div>
                </div>
                {hr.seasonHRs && (
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{hr.seasonHRs}</div>
                    <div style={{ fontSize: 9, color: "#9ca3af" }}>HR</div>
                  </div>
                )}
              </div>
            ))}
            {yHRs.length > 5 && (
              <button onClick={() => setShowAllYest(s => !s)}
                style={{ width: "100%", background: "none", border: "none", color: "#1a2f5e", fontSize: 12, fontWeight: 700, padding: "12px 0 8px", cursor: "pointer" }}>
                {showAllYest ? "Show less ↑" : `Show all ${yHRs.length} HRs ↓`}
              </button>
            )}
          </div>
        </Section>

        <Section title="PARK FACTORS — TODAY" accent="#f59e0b">
          <div>
            {todayParks.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < todayParks.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{p.city}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 56, height: 4, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, (p.factor - 80) / 60 * 100))}%`, height: "100%", background: p.factor > 110 ? "#c8102e" : p.factor > 100 ? "#f59e0b" : "#9ca3af", borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: p.factor > 110 ? "#c8102e" : p.factor > 100 ? "#b45309" : "#9ca3af", minWidth: 30, textAlign: "right" }}>{p.factor}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {outdoor.length > 0 && (
          <Section title="BALLPARK WEATHER" accent="#3b82f6">
            <div>
              {outdoor.map((g, i) => {
                const wind = g.weather?.wind || "";
                const speed = parseInt(wind) || 0;
                const impact = wind.toLowerCase().includes("out") && speed > 10 ? "BOOST" : wind.toLowerCase().includes("in") && speed > 8 ? "SUPPRESS" : "NEUTRAL";
                const col = { BOOST: "#059669", NEUTRAL: "#9ca3af", SUPPRESS: "#c8102e" };
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < outdoor.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{g.venue}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{g.city} · {g.weather?.temp}°F · {wind}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: col[impact] }}>{impact}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="SEASON HR LEADERS" accent="#c8102e">
          <div>
            {(leaders.data?.leaders || []).slice(0, 8).map((l, i) => (
              <div key={i} onClick={() => l.playerId && handlePlayerClick({ playerId: l.playerId, playerName: l.player })}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < 7 ? "1px solid #f3f4f6" : "none", cursor: l.playerId ? "pointer" : "default" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: i < 3 ? "#1a2f5e" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: i < 3 ? "#fff" : "#6b7280" }}>#{l.rank}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{l.player}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{l.team}</div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#c8102e" }}>{l.value}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
