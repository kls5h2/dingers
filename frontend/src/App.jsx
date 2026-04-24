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
  HIGH:  { label: "HIGH",    color: "#fff",    bg: "#c8102e", dot: "#c8102e", border: "#fecaca" },
  MED:   { label: "MED",     color: "#92400e", bg: "#fef3c7", dot: "#f59e0b", border: "#fde68a" },
  WATCH: { label: "WATCH",   color: "#1e40af", bg: "#eff6ff", dot: "#3b82f6", border: "#bfdbfe" },
};

function ConfBadge({ conf }) {
  const c = CONF[conf];
  if (!c) return null;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c.color, background: c.bg, padding: "3px 10px", borderRadius: 20, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{c.label}</span>;
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function Tabs({ active, onChange }) {
  const tabs = [
    { id: "today",   label: "TODAY"   },
    { id: "plays",   label: "PLAYS"   },
    { id: "stats",   label: "STATS"   },
    { id: "history", label: "HISTORY" },
  ];
  return (
    <div style={{ background: "#1a2f5e", padding: "8px 14px 12px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ background: "rgba(0,0,0,0.28)", borderRadius: 10, padding: 3, display: "flex", gap: 2 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{
              flex: 1, border: "none", cursor: "pointer",
              background: active === t.id ? "#fff" : "transparent",
              color: active === t.id ? "#1a2f5e" : "rgba(255,255,255,0.45)",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              padding: "7px 0", borderRadius: 8,
              transition: "all 0.15s",
            }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
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

// ── Game Modal ─────────────────────────────────────────────────────────────
function GameModal({ gamePk, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch(`/api/game/${gamePk}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [gamePk]);
  const st = data?.status;
  const hrs = data?.hrs || [];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "70vh", overflow: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            {st && <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{st.awayAbb} @ {st.homeAbb}</div>}
            {st && st.awayRuns != null && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{st.awayRuns}–{st.homeRuns}{st.inning ? ` · ${st.half === "top" ? "Top" : "Bot"} ${st.inning}` : " · Final"}</div>}
          </div>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {loading && <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Loading...</div>}
        {!loading && !hrs.length && <div style={{ textAlign: "center", color: "#9ca3af", padding: 20, fontSize: 14 }}>No home runs in this game yet.</div>}
        {hrs.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.14em", marginBottom: 10 }}>HOME RUNS THIS GAME</div>
            {hrs.map((hr, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < hrs.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>💥</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{hr.player}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{hr.team}</span>
                    {` · ${hr.half === "top" ? "Top" : "Bot"} ${hr.inning}`}
                    {hr.distance ? ` · ${hr.distance} ft` : ""}
                    {hr.exitVelo ? ` · ${hr.exitVelo} mph` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Games Slate ────────────────────────────────────────────────────────────
function GamesSlate({ games }) {
  const [selectedGame, setSelectedGame] = useState(null);
  if (!games?.length) return null;
  return (
    <>
      <div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px 10px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.14em", marginBottom: 10 }}>TODAY'S GAMES</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" }}>
          {games.map((g, i) => {
            const live  = g.status?.includes("Progress") || g.status?.includes("inning");
            const final = g.status?.includes("Final");
            const time  = new Date(g.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
            return (
              <div key={i} onClick={() => setSelectedGame(g.gamePk)}
                style={{ flexShrink: 0, background: live ? "#f0fdf4" : final ? "#fff5f5" : "#f9fafb", borderRadius: 10, padding: "9px 11px", border: live ? "1.5px solid #10b981" : final ? "1px solid #fecaca" : "1px solid #e5e7eb", minWidth: 96, textAlign: "center", cursor: "pointer" }}>
                {live  && <div style={{ fontSize: 9, fontWeight: 700, color: "#10b981", letterSpacing: "0.1em", marginBottom: 3 }}>● LIVE</div>}
                {final && <div style={{ fontSize: 9, fontWeight: 700, color: "#c8102e", letterSpacing: "0.1em", marginBottom: 3 }}>■ FINAL</div>}
                {!live && !final && <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 3 }}>{time} CT</div>}
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{g.awayAbb}</div>
                <div style={{ fontSize: 9, color: "#9ca3af", margin: "2px 0" }}>@</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{g.homeAbb}</div>
                {(live || final) && g.linescore?.runs && (
                  <div style={{ fontSize: 11, color: live ? "#059669" : "#c8102e", marginTop: 3, fontWeight: 700 }}>
                    {g.linescore.runs.away}–{g.linescore.runs.home}
                  </div>
                )}
                <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 4 }}>tap for HRs</div>
              </div>
            );
          })}
        </div>
      </div>
      {selectedGame && <GameModal gamePk={selectedGame} onClose={() => setSelectedGame(null)} />}
    </>
  );
}

// ── Today's HR list ────────────────────────────────────────────────────────
function TodayHRs({ hrs, loading, onPlayerClick }) {
  if (loading) return <div style={{ padding: "16px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Loading...</div>;
  if (!hrs.length) return <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No home runs yet today.</div>;
  return (
    <div>
      {hrs.map((hr, i) => (
        <div key={hr.id || i} onClick={() => hr.playerId && onPlayerClick({ playerId: hr.playerId, playerName: hr.player })}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < hrs.length - 1 ? "1px solid #f3f4f6" : "none", cursor: hr.playerId ? "pointer" : "default" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>💥</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{hr.player}</div>
              {hr.count > 1 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#c8102e", borderRadius: 10, padding: "1px 7px" }}>{hr.count}x</span>}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
              {hr.team ? <span style={{ fontWeight: 600, color: "#374151" }}>{hr.team}</span> : ""}
              {hr.opponent ? ` vs ${hr.opponent}` : ""}
              {hr.inning ? ` · Inn. ${hr.inning}` : ""}
              {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
              {hr.exitVelo ? ` · ${fmt(hr.exitVelo)} mph` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {hr.seasonHRs && <div style={{ fontSize: 20, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{hr.seasonHRs}</div>}
            {hr.seasonHRs && <div style={{ fontSize: 9, color: "#9ca3af" }}>HR</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Play Card ──────────────────────────────────────────────────────────────
function PlayCard({ p, onPlayerClick }) {
  const [open, setOpen] = useState(false);
  const conf = p.confidence;
  const c = CONF[conf] || CONF.MED;
  const isWatch = conf === "WATCH";
  return (
    <div onClick={() => setOpen(o => !o)} style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${c.border}`, background: "#fff", marginBottom: 8, boxShadow: conf === "HIGH" ? "0 2px 8px rgba(200,16,46,0.08)" : "none", cursor: "pointer" }}>
      {conf === "HIGH" && <div style={{ height: 3, background: "#c8102e" }} />}
      {conf === "WATCH" && <div style={{ height: 3, background: "#3b82f6" }} />}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{p.player}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {p.team} vs {p.opponent} · vs {p.pitcher} ({p.pitcherHand}){p.hotStreak ? " 🔥" : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ConfBadge conf={conf} />
          <span style={{ fontSize: 18, color: "#d1d5db", transform: open ? "rotate(90deg)" : "none", transition: "0.2s", lineHeight: 1 }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 14px 14px", background: "#fafafa" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[["Park Factor", p.parkFactor, p.parkFactor > 110 ? "#c8102e" : p.parkFactor > 100 ? "#b45309" : "#374151"],
              ["Last 7 HRs", p.last7HRs, p.last7HRs >= 3 ? "#059669" : "#374151"],
              ["Handedness", p.pitcherHand === "L" ? "vs LHP" : "vs RHP", "#374151"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: "#fff", borderRadius: 8, padding: "8px", textAlign: "center", border: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 3, letterSpacing: "0.08em" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.3 }}>{val ?? "—"}</div>
              </div>
            ))}
          </div>
          {p.note && (
            <div style={{ background: conf === "HIGH" ? "#fef2f2" : isWatch ? "#eff6ff" : "#fffbeb", borderRadius: 8, padding: "10px 12px", marginBottom: p.concern ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: c.dot, letterSpacing: "0.1em", marginBottom: 4 }}>WHY</div>
              <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: 0 }}>{p.note}</p>
            </div>
          )}
          {p.concern && (
            <div style={{ background: "#fffbeb", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#b45309", letterSpacing: "0.1em", marginBottom: 4 }}>CONCERN</div>
              <p style={{ fontSize: 13, color: "#92400e", lineHeight: 1.6, margin: 0 }}>{p.concern}</p>
            </div>
          )}
          {p.playerId && (
            <button onClick={e => { e.stopPropagation(); onPlayerClick({ playerId: p.playerId, playerName: p.player }); }}
              style={{ width: "100%", background: "#1a2f5e", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 10 }}>
              Full Player Stats →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conditions ─────────────────────────────────────────────────────────────
function Conditions({ games, parkData }) {
  const venues = new Set((games || []).map(g => g.venue));
  const allParks = (parkData?.parks || []).filter(p => !venues.size || venues.has(p.name));

  const relevant = allParks.map(p => {
    const game = (games || []).find(g => g.venue === p.name);
    const wind = game?.weather?.wind || "";
    const speed = parseInt(wind) || 0;
    const windOut = wind.toLowerCase().includes("out") && speed > 6;
    const windIn  = wind.toLowerCase().includes("in")  && speed > 6;
    const parkHot = p.factor > 108;
    const parkDead= p.factor < 93;
    if (!windOut && !windIn && !parkHot && !parkDead) return null;

    const overall = (windOut || parkHot) && !windIn && !parkDead ? "BOOST"
      : (windIn || parkDead) && !windOut && !parkHot ? "SUPPRESS"
      : "MIXED";

    const factors = [];
    if (parkHot)  factors.push(`Park factor ${p.factor} — historically hitter-friendly`);
    if (parkDead) factors.push(`Park factor ${p.factor} — historically suppresses HRs`);
    if (windOut)  factors.push(`Wind blowing OUT ${speed} mph — balls carry further`);
    if (windIn)   factors.push(`Wind blowing IN ${speed} mph — knocks down fly balls`);
    if (game?.weather?.temp) factors.push(`${game.weather.temp}°F`);

    const col = { BOOST: "#059669", SUPPRESS: "#c8102e", MIXED: "#b45309" };
    const bg2 = { BOOST: "#f0fdf4", SUPPRESS: "#fef2f2", MIXED: "#fffbeb" };

    // Which hitters benefit
    const awayAbb = game?.awayAbb || "";
    const homeAbb = game?.homeAbb || "";
    const beneficiary = overall === "BOOST"
      ? `Both ${awayAbb} & ${homeAbb} hitters benefit`
      : overall === "SUPPRESS"
      ? `Pitchers favored in this game`
      : `Mixed — check handedness and pull tendencies`;

    return { p, overall, factors, col, bg2, awayAbb, homeAbb, beneficiary };
  }).filter(Boolean);

  if (!relevant.length) return (
    <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No significant park or weather factors today.</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
      {relevant.map(({ p, overall, factors, col, bg2, awayAbb, homeAbb, beneficiary }, i) => (
        <div key={i} style={{ background: bg2[overall], borderRadius: 12, padding: "13px 14px", border: `1px solid ${col[overall]}22` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{p.city} · {awayAbb} @ {homeAbb}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: col[overall], background: "#fff", padding: "3px 10px", borderRadius: 20, border: `1px solid ${col[overall]}44`, whiteSpace: "nowrap" }}>{overall}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {factors.map((f, j) => (
              <div key={j} style={{ fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: col[overall] }}>•</span> {f}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: col[overall], background: "#fff", borderRadius: 8, padding: "6px 10px" }}>
            → {beneficiary}
          </div>
        </div>
      ))}
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
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>HR 2026</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      </div>
      {loading && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#9ca3af" }}>Loading stats...</div>}
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
          {aiLoad && <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>Analyzing...</div>}
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
    <div style={{ position: "relative", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "10px 14px", gap: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <span style={{ color: "#9ca3af" }}>🔍</span>
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

// ── Section card (collapsible) ─────────────────────────────────────────────
function Section({ title, accent, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      {title && (
        <div onClick={() => setOpen(o => !o)} style={{ padding: "13px 16px 11px", borderBottom: open ? "1px solid #f3f4f6" : "none", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
          {accent && <div style={{ width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }} />}
          <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.14em", flex: 1 }}>{title}</span>
          {badge != null && <span style={{ fontSize: 11, fontWeight: 700, color: "#c8102e", background: "#fef2f2", borderRadius: 10, padding: "2px 8px" }}>{badge}</span>}
          <span style={{ fontSize: 16, color: "#d1d5db", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", lineHeight: 1 }}>›</span>
        </div>
      )}
      {open && <div style={{ padding: "0 16px 8px" }}>{children}</div>}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]             = useState("today");
  const [liveHRs,    setLiveHRs]  = useState([]);
  const [liveLoading,setLiveLoad] = useState(true);
  const [yesterday,  setYest]     = useState({ loading: true, data: null });
  const [plays,      setPlays]    = useState({ loading: true, data: null, error: null });
  const [parkData,   setParkData] = useState({ data: null });
  const [leaders,    setLeaders]  = useState({ data: null });
  const [games,      setGames]    = useState({ data: null });
  const [deepDive,   setDeepDive] = useState(null);
  const [refreshing, setRefresh]  = useState(false);
  const pollRef = useRef(null);

  const getCTDate = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  const today = getCTDate();

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefresh(true);
    apiFetch("/api/live-hrs").then(d => { setLiveHRs(d.hrs || []); setLiveLoad(false); }).catch(() => setLiveLoad(false));
    apiFetch("/api/today-games").then(d => setGames({ data: d })).catch(() => {});
    apiFetch("/api/park-factors").then(d => setParkData({ data: d })).catch(() => {});
    apiFetch("/api/hr-leaders").then(d => setLeaders({ data: d })).catch(() => {});
    apiFetch("/api/yesterday-hrs").then(d => setYest({ loading: false, data: d })).catch(() => setYest({ loading: false, data: null }));
    setPlays({ loading: true, data: null, error: null });
    apiFetch("/api/ai/plays-cached").then(d => {
      if (d.generating) {
        setTimeout(() => apiFetch("/api/ai/plays-cached")
          .then(d2 => setPlays({ loading: false, data: d2, error: null }))
          .catch(e => setPlays({ loading: false, data: null, error: e.message })), 10000);
      } else {
        setPlays({ loading: false, data: d, error: null });
      }
    }).catch(e => setPlays({ loading: false, data: null, error: e.message }));
    if (refresh) setTimeout(() => setRefresh(false), 1200);
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => apiFetch("/api/live-hrs").then(d => { setLiveHRs(d.hrs || []); setLiveLoad(false); }).catch(() => {}), 60_000);
    return () => clearInterval(pollRef.current);
  }, []);

  function handlePlayerClick(p) {
    if (p?.playerId || p?.id) {
      setDeepDive({ playerId: p.playerId || p.id, playerName: p.player || p.name });
      setTab("stats");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const dedupeHRs = (hrs) => {
    const map = new Map();
    for (const hr of hrs) {
      const key = hr.player;
      if (map.has(key)) {
        const e = map.get(key);
        e.count = (e.count || 1) + 1;
        e.seasonHRs = hr.seasonHRs;
      } else map.set(key, { ...hr, count: 1 });
    }
    return Array.from(map.values());
  };

  const yHRs          = yesterday.data?.hrs || [];
  const dedupedLive   = dedupeHRs(liveHRs);
  const dedupedYest   = dedupeHRs(yHRs);
  const gamesToday    = games.data?.games || [];
  const allPlays      = plays.data?.plays || [];

  const normConf = (c) => {
    if (!c) return "MED";
    const u = c.toUpperCase().trim();
    if (u === "HIGH") return "HIGH";
    if (u === "MED" || u === "MEDIUM") return "MED";
    return "WATCH";
  };
  const normalizedPlays = allPlays.map(p => ({ ...p, confidence: normConf(p.confidence) }));
  const highPlays  = normalizedPlays.filter(p => p.confidence === "HIGH");
  const medPlays   = normalizedPlays.filter(p => p.confidence === "MED");
  const watchPlays = normalizedPlays.filter(p => p.confidence === "WATCH");

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <style>{`* { box-sizing: border-box; margin: 0; } input::placeholder { color: #9ca3af; } ::-webkit-scrollbar { display: none; } body { background: #f3f4f6; }`}</style>

      {/* Header */}
      <div style={{ background: "#1a2f5e", paddingTop: "max(14px, env(safe-area-inset-top))", paddingBottom: 0, paddingLeft: 16, paddingRight: 16, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>DINGERS</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em", marginTop: 2 }}>HR BETTING INTEL</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: "5px 10px" }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>{today}</span>
            </div>
            <button onClick={() => load(true)} disabled={refreshing}
              style={{ background: refreshing ? "#7f1d1d" : "#c8102e", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: refreshing ? "not-allowed" : "pointer" }}>
              {refreshing ? "..." : "↻"}
            </button>
          </div>
        </div>
        <Tabs active={tab} onChange={setTab} />
      </div>

      <LiveBar hrs={liveHRs} />

      <div style={{ padding: "14px 14px 80px" }}>

        {/* ── TODAY TAB ── */}
        {tab === "today" && (
          <>
            <GamesSlate games={gamesToday} />
            <Section title="TODAY'S HOME RUNS" accent="#10b981" badge={dedupedLive.length || null} defaultOpen={true}>
              <TodayHRs hrs={dedupedLive} loading={liveLoading} onPlayerClick={handlePlayerClick} />
            </Section>
          </>
        )}

        {/* ── PLAYS TAB ── */}
        {tab === "plays" && (
          <>
            {plays.loading && (
              <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px 0", fontSize: 14 }}>Analyzing today's matchups...</div>
            )}
            {plays.error && (
              <div style={{ background: "#fef2f2", borderRadius: 12, padding: 16, color: "#c8102e", fontSize: 13 }}>⚠ {plays.error}</div>
            )}
            {highPlays.length > 0 && (
              <Section title="HIGH CONFIDENCE" accent="#c8102e" badge={highPlays.length} defaultOpen={true}>
                <div style={{ paddingTop: 10 }}>
                  {highPlays.map((p, i) => <PlayCard key={i} p={p} onPlayerClick={handlePlayerClick} />)}
                </div>
              </Section>
            )}
            {medPlays.length > 0 && (
              <Section title="SOLID PLAYS" accent="#f59e0b" badge={medPlays.length} defaultOpen={true}>
                <div style={{ paddingTop: 10 }}>
                  {medPlays.map((p, i) => <PlayCard key={i} p={p} onPlayerClick={handlePlayerClick} />)}
                </div>
              </Section>
            )}
            {watchPlays.length > 0 && (
              <Section title="PROCEED WITH CAUTION" accent="#3b82f6" badge={watchPlays.length} defaultOpen={false}>
                <div style={{ paddingTop: 10 }}>
                  {watchPlays.map((p, i) => <PlayCard key={i} p={p} onPlayerClick={handlePlayerClick} />)}
                </div>
              </Section>
            )}
            {!plays.loading && normalizedPlays.length === 0 && !plays.error && (
              <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px 0", fontSize: 14 }}>No plays available yet.</div>
            )}
          </>
        )}

        {/* ── STATS TAB ── */}
        {tab === "stats" && (
          <>
            <PlayerSearch onSelect={handlePlayerClick} />
            {deepDive && <DeepDive playerId={deepDive.playerId} playerName={deepDive.playerName} onClose={() => setDeepDive(null)} />}
            <Section title="CONDITIONS TODAY" accent="#f59e0b" defaultOpen={true}>
              <Conditions games={gamesToday} parkData={parkData.data} />
            </Section>
            <Section title="SEASON HR LEADERS" accent="#c8102e" defaultOpen={false}>
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
            </Section>
          </>
        )}

        {/* ── YESTERDAY TAB ── */}
        {tab === "history" && (
          <Section title="YESTERDAY'S HOME RUNS" accent="#1a2f5e" badge={dedupedYest.length || null} defaultOpen={true}>
            {yesterday.loading && <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af" }}>Loading...</div>}
            <div>
              {dedupedYest.map((hr, i) => (
                <div key={hr.id || i} onClick={() => hr.playerId && handlePlayerClick({ playerId: hr.playerId, playerName: hr.player })}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < dedupedYest.length - 1 ? "1px solid #f3f4f6" : "none", cursor: hr.playerId ? "pointer" : "default" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>💥</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{hr.player}</div>
                      {hr.count > 1 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#c8102e", borderRadius: 10, padding: "1px 7px" }}>{hr.count}x</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                      {hr.team ? <span style={{ fontWeight: 600, color: "#374151" }}>{hr.team}</span> : ""}
                      {hr.opponent ? ` vs ${hr.opponent}` : ""}
                      {hr.inning ? ` · Inn. ${hr.inning}` : ""}
                      {hr.distance ? ` · ${fmt(hr.distance)} ft` : ""}
                    </div>
                  </div>
                  {hr.seasonHRs && <div style={{ textAlign: "right" }}><div style={{ fontSize: 20, fontWeight: 800, color: "#c8102e" }}>{hr.seasonHRs}</div><div style={{ fontSize: 9, color: "#9ca3af" }}>HR</div></div>}
                </div>
              ))}
            </div>
          </Section>
        )}

      </div>
    </div>
  );
}
