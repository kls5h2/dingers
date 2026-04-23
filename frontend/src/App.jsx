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
  HIGH: { color: "#fff",    bg: "#c8102e", dot: "#c8102e" },
  MED:  { color: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
  LOW:  { color: "#374151", bg: "#f3f4f6", dot: "#9ca3af" },
  PASS: { color: "#6b7280", bg: "#f3f4f6", dot: "#d1d5db" },
};
function ConfBadge({ conf }) {
  const c = CONF[conf] || CONF.LOW;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c.color, background: c.bg, padding: "3px 10px", borderRadius: 20, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{conf}</span>;
}

// ── Live Alert Bar ─────────────────────────────────────────────────────────
function LiveBar({ hrs }) {
  const [idx, setIdx] = useState(0);
  const shown = hrs || [];
  useEffect(() => {
    if (shown.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % shown.length), 4000);
    return () => clearInterval(t);
  }, [shown.length]);
  const hr = shown[idx];
  return (
    <div style={{ background: "#064e3b", padding: "9px 16px", display: "flex", alignItems: "center", gap: 10, minHeight: 42 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", letterSpacing: "0.12em", flexShrink: 0 }}>LIVE</span>
      {!shown.length
        ? <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>No HRs yet — watching every 60s</span>
        : <span style={{ fontSize: 13, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <strong>{hr?.player}</strong>
            {hr?.team && hr?.opponent ? ` · ${hr.team} vs ${hr.opponent}` : ""}
            {hr?.inning ? ` · Inn. ${hr.inning}` : ""}
            {hr?.distance ? ` · ${fmt(hr.distance)} ft` : ""}
          </span>}
      {shown.length > 1 && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{idx+1}/{shown.length}</span>}
    </div>
  );
}

// ── Games Slate ────────────────────────────────────────────────────────────
function GamesSlate({ games }) {
  if (!games?.length) return null;
  return (
    <div style={{ padding: "12px 0 4px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.14em", marginBottom: 10, paddingLeft: 2 }}>TODAY'S GAMES</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, WebkitOverflowScrolling: "touch" }}>
        {games.map((g, i) => {
          const live = g.status?.includes("In Progress") || g.status?.includes("inning");
          const final = g.status?.includes("Final");
          const time = new Date(g.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          return (
            <div key={i} style={{ flexShrink: 0, background: "#fff", borderRadius: 10, padding: "10px 12px", border: live ? "1.5px solid #10b981" : "1px solid #e5e7eb", minWidth: 110, textAlign: "center" }}>
              {live && <div style={{ fontSize: 9, fontWeight: 700, color: "#10b981", letterSpacing: "0.1em", marginBottom: 4 }}>● LIVE</div>}
              {final && <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.1em", marginBottom: 4 }}>FINAL</div>}
              {!live && !final && <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 4 }}>{time}</div>}
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{g.awayAbb}</div>
              <div style={{ fontSize: 9, color: "#9ca3af", margin: "2px 0" }}>vs</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{g.homeAbb}</div>
              {live && g.linescore?.runs && (
                <div style={{ fontSize: 11, color: "#374151", marginTop: 4, fontWeight: 600 }}>
                  {g.linescore.runs.away}–{g.linescore.runs.home}
                </div>
              )}
              <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{g.venue?.replace(/ Park| Field| Stadium| Centre/, "")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Expandable Section ─────────────────────────────────────────────────────
function Folder({ title, accent, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
        {accent && <div style={{ width: 3, height: 18, borderRadius: 2, background: accent, flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2f5e", letterSpacing: "0.1em", flex: 1 }}>{title}</span>
        {badge != null && <span style={{ fontSize: 11, fontWeight: 700, color: "#c8102e", background: "#fef2f2", borderRadius: 10, padding: "2px 8px" }}>{badge}</span>}
        <span style={{ fontSize: 16, color: "#9ca3af", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", lineHeight: 1 }}>›</span>
      </div>
      {open && <div style={{ borderTop: "1px solid #f3f4f6", padding: "0 16px 4px" }}>{children}</div>}
    </div>
  );
}

// ── Play Card ──────────────────────────────────────────────────────────────
function PlayCard({ p, onPlayerClick }) {
  const [open, setOpen] = useState(false);
  const conf = p.confidence || "LOW";
  const c = CONF[conf] || CONF.LOW;
  const isPass = conf === "PASS";
  return (
    <div onClick={() => setOpen(o => !o)} style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${conf === "HIGH" ? "#fecaca" : "#f0f0f0"}`, opacity: isPass ? 0.65 : 1, background: "#fff", marginBottom: 8, boxShadow: conf === "HIGH" ? "0 2px 8px rgba(200,16,46,0.08)" : "none", cursor: "pointer" }}>
      {conf === "HIGH" && <div style={{ height: 3, background: "#c8102e" }} />}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{p.player}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {p.team} vs {p.opponent} · {p.last7HRs} HR last 7{p.hotStreak ? " 🔥" : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ConfBadge conf={conf} />
          <span style={{ fontSize: 16, color: "#d1d5db", transform: open ? "rotate(90deg)" : "none", transition: "0.2s" }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 14px 14px", background: "#fafafa" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[["Pitcher", `${p.pitcher} (${p.pitcherHand})`, "#374151"],
              ["Park", p.parkFactor, p.parkFactor > 108 ? "#c8102e" : "#374151"],
              ["Last 7 HR", p.last7HRs, p.last7HRs >= 3 ? "#059669" : "#374151"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#fff", borderRadius: 8, padding: "8px", textAlign: "center", border: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 3, letterSpacing: "0.08em" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color, lineHeight: 1.2 }}>{val ?? "—"}</div>
              </div>
            ))}
          </div>
          {p.note && <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}>{p.note}</p>}
          {p.playerId && (
            <button onClick={e => { e.stopPropagation(); onPlayerClick({ playerId: p.playerId, playerName: p.player }); }}
              style={{ width: "100%", background: "#1a2f5e", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Full Player Stats →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Deep Dive ──────────────────────────────────────────────────────────────
function DeepDive({ playerId, playerName, onClose }) {
  const [data, setData]         = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [aiLoad, setAiLoad]     = useState(false);
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
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <div style={{ background: "#1a2f5e", padding: "16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>{info?.fullName || playerName}</div>
          {info && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{info.currentTeam?.name} · {info.primaryPosition?.abbreviation} · Bats {info.batSide?.code}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{st?.season?.homeRuns ?? "—"}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>HR 2026</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      </div>
      {loading && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Loading stats...</div>}
      {error && <div style={{ padding: 16, fontSize: 12, color: "#c8102e" }}>⚠ {error}</div>}
      {!loading && data && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
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
          {aiLoad && <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>Analyzing matchup...</div>}
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

// ── Search ─────────────────────────────────────────────────────────────────
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
      <div style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "10px 14px", gap: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <span style={{ color: "#9ca3af", fontSize: 15 }}>🔍</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search player for deep dive..."
          style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: "#111827", background: "transparent" }} />
        {q && <button onClick={() => { setQ(""); setRes([]); }} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>}
      </div>
      {results.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
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

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [liveHRs,     setLiveHRs]     = useState([]);
  const [yesterday,   setYesterday]   = useState({ loading: true, data: null, error: null });
  const [plays,       setPlays]       = useState({ loading: true, data: null, error: null });
  const [parkData,    setParkData]    = useState({ loading: true, data: null, error: null });
  const [leaders,     setLeaders]     = useState({ loading: true, data: null, error: null });
  const [games,       setGames]       = useState({ loading: true, data: null, error: null });
  const [deepDive,    setDeepDive]    = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
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
  const gamesToday = games.data?.games || [];
  const venues = new Set(gamesToday.map(g => g.venue));
  const todayParks = (parkData.data?.parks || []).filter(p => !venues.size || venues.has(p.name)).slice(0, 7);
  const outdoor = gamesToday.filter(g => g.weather?.temp);

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; }
        input::placeholder { color: #9ca3af; }
        ::-webkit-scrollbar { display: none; }
        body { background: #f3f4f6; }
      `}</style>

      {/* Header — env(safe-area-inset-top) handles Dynamic Island / notch */}
      <div style={{ background: "#1a2f5e", paddingTop: "max(14px, env(safe-area-inset-top))", paddingBottom: 12, paddingLeft: 16, paddingRight: 16, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>DINGERS</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em", marginTop: 2 }}>HR BETTING INTEL</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 10px" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>{today}</span>
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            style={{ background: refreshing ? "#7f1d1d" : "#c8102e", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: refreshing ? "not-allowed" : "pointer" }}>
            {refreshing ? "..." : "↻ REFRESH"}
          </button>
        </div>
      </div>

      <LiveBar hrs={liveHRs} />

      <div style={{ padding: "14px 14px 80px" }}>

        {/* Games Slate */}
        {gamesToday.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <GamesSlate games={gamesToday} />
          </div>
        )}

        <PlayerSearch onSelect={handlePlayerClick} />
        {deepDive && <DeepDive playerId={deepDive.playerId} playerName={deepDive.playerName} onClose={() => setDeepDive(null)} />}

        {/* Top Plays */}
        <Folder title="TODAY'S TOP PLAYS" accent="#c8102e" badge={plays.data?.plays?.length} defaultOpen={true}>
          {plays.loading && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Analyzing matchups...</div>}
          {plays.error && <div style={{ padding: "12px 0", fontSize: 12, color: "#c8102e" }}>⚠ {plays.error}</div>}
          <div style={{ paddingTop: 12, paddingBottom: 4 }}>
            {(plays.data?.plays || []).map((p, i) => <PlayCard key={i} p={p} onPlayerClick={handlePlayerClick} />)}
          </div>
        </Folder>

        {/* Yesterday HRs */}
        <Folder title="YESTERDAY'S HRs" accent="#1a2f5e" badge={yHRs.length} defaultOpen={false}>
          <div>
            {yHRs.map((hr, i) => (
              <div key={hr.id || i} onClick={() => hr.playerId && handlePlayerClick({ playerId: hr.playerId, playerName: hr.player })}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < yHRs.length - 1 ? "1px solid #f3f4f6" : "none", cursor: hr.playerId ? "pointer" : "default" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 16 }}>💥</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{hr.player}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                    {hr.team && hr.opponent ? `${hr.team} vs ${hr.opponent}` : hr.team || ""}
                    {hr.inning ? ` · Inn. ${hr.inning}` : ""}
                    {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
                    {hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
                  </div>
                </div>
                {hr.seasonHRs && (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{hr.seasonHRs}</div>
                    <div style={{ fontSize: 9, color: "#9ca3af" }}>HR</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Folder>

        {/* Park Factors */}
        <Folder title="PARK FACTORS" accent="#f59e0b" defaultOpen={false}>
          <div>
            {todayParks.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < todayParks.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{p.city}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 52, height: 4, background: "#f3f4f6", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, Math.max(4, (p.factor - 80) / 60 * 100))}%`, height: "100%", background: p.factor > 110 ? "#c8102e" : p.factor > 100 ? "#f59e0b" : "#9ca3af", borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: p.factor > 110 ? "#c8102e" : p.factor > 100 ? "#b45309" : "#9ca3af", minWidth: 28, textAlign: "right" }}>{p.factor}</span>
                </div>
              </div>
            ))}
          </div>
        </Folder>

        {/* Weather */}
        {outdoor.length > 0 && (
          <Folder title="BALLPARK WEATHER" accent="#3b82f6" defaultOpen={false}>
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
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{g.city} · {g.weather.temp}°F · {wind}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: col[impact] }}>{impact}</span>
                  </div>
                );
              })}
            </div>
          </Folder>
        )}

        {/* HR Leaders */}
        <Folder title="SEASON HR LEADERS" accent="#c8102e" defaultOpen={false}>
          <div>
            {(leaders.data?.leaders || []).slice(0, 10).map((l, i) => (
              <div key={i} onClick={() => l.playerId && handlePlayerClick({ playerId: l.playerId, playerName: l.player })}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < 9 ? "1px solid #f3f4f6" : "none", cursor: l.playerId ? "pointer" : "default" }}>
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
        </Folder>

      </div>
    </div>
  );
}
