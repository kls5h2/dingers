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
          style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: i < hrs.length - 1 ? "1px solid #f3f4f6" : "none", cursor: hr.playerId ? "pointer" : "default" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>💥</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{hr.player}</div>
              {hr.count > 1 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#c8102e", borderRadius: 10, padding: "1px 7px" }}>{hr.count}x</span>}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {hr.team && <span style={{ fontWeight: 600, color: "#374151" }}>{hr.team}</span>}
              {hr.opponent ? ` vs ${hr.opponent}` : ""}
              {hr.inning ? ` · Inn. ${hr.inning}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              {hr.distance && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>📏 {fmt(hr.distance)} ft</span>}
              {hr.exitVelo && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>⚡ {fmt(hr.exitVelo)} mph</span>}
              {hr.launchAngle && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>📐 {hr.launchAngle}°</span>}
              {hr.pitcher && <span style={{ fontSize: 10, color: "#6b7280", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>off {hr.pitcher}</span>}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {hr.seasonHRs && <div style={{ fontSize: 22, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{hr.seasonHRs}</div>}
            {hr.seasonHRs && <div style={{ fontSize: 9, color: "#9ca3af" }}>HR 2026</div>}
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
              Deep Dive →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conditions ─────────────────────────────────────────────────────────────
function Conditions({ games, parkData }) {
  const [parkSearch, setParkSearch] = useState("");

  // Today's game conditions (existing logic)
  const venues = new Set((games || []).map(g => g.venue));
  const todayParks = (parkData?.parks || []).filter(p => venues.has(p.name));

  const relevant = todayParks.map(p => {
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
    if (parkHot)  factors.push(`Park factor ${p.factor} — hitter-friendly`);
    if (parkDead) factors.push(`Park factor ${p.factor} — suppresses HRs`);
    if (windOut)  factors.push(`Wind OUT ${speed} mph`);
    if (windIn)   factors.push(`Wind IN ${speed} mph`);
    if (game?.weather?.temp) factors.push(`${game.weather.temp}°F`);

    const col = { BOOST: "#059669", SUPPRESS: "#c8102e", MIXED: "#b45309" };
    const bg2 = { BOOST: "#f0fdf4", SUPPRESS: "#fef2f2", MIXED: "#fffbeb" };
    const awayAbb = game?.awayAbb || "";
    const homeAbb = game?.homeAbb || "";
    const beneficiary = overall === "BOOST" ? `${awayAbb} & ${homeAbb} hitters benefit`
      : overall === "SUPPRESS" ? `Pitchers favored`
      : `Mixed — check pull tendencies`;

    return { p, overall, factors, col, bg2, awayAbb, homeAbb, beneficiary };
  }).filter(Boolean);

  // All parks: filter to boost (>105) or suppress (<95) only
  const allSignificant = (parkData?.parks || [])
    .filter(p => p.factor > 105 || p.factor < 95)
    .filter(p => !parkSearch || p.name.toLowerCase().includes(parkSearch.toLowerCase()) || (p.city || "").toLowerCase().includes(parkSearch.toLowerCase()))
    .sort((a, b) => b.factor - a.factor);

  return (
    <div style={{ paddingTop: 8 }}>
      {/* Today's game conditions */}
      {relevant.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.12em", marginBottom: 8 }}>TODAY'S CONDITIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {relevant.map(({ p, overall, factors, col, bg2, awayAbb, homeAbb, beneficiary }, i) => (
              <div key={i} style={{ background: bg2[overall], borderRadius: 10, padding: "11px 13px", border: `1px solid ${col[overall]}22` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{p.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: col[overall], background: "#fff", padding: "2px 8px", borderRadius: 20, border: `1px solid ${col[overall]}44` }}>{overall}</span>
                </div>
                <div style={{ fontSize: 11, color: "#374151", marginBottom: 5 }}>{factors.join(" · ")}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: col[overall] }}>→ {beneficiary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!relevant.length && (
        <div style={{ padding: "10px 0 14px", fontSize: 12, color: "#9ca3af" }}>No significant park or weather factors today.</div>
      )}

      {/* Park factors reference */}
      <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.12em", marginBottom: 8 }}>PARK FACTORS (BOOST & SUPPRESS)</div>
      <div style={{ display: "flex", alignItems: "center", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>🔍</span>
        <input value={parkSearch} onChange={e => setParkSearch(e.target.value)} placeholder="Search park..."
          style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: "#111827" }} />
        {parkSearch && <button onClick={() => setParkSearch("")} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {allSignificant.map((p, i) => {
          const isBoost = p.factor > 105;
          const isSuppress = p.factor < 95;
          const color = isBoost ? "#059669" : "#c8102e";
          const bg = isBoost ? "#f0fdf4" : "#fef2f2";
          const isToday = venues.has(p.name);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", background: isToday ? bg : "#fff", borderRadius: 8, border: isToday ? `1px solid ${color}33` : "1px solid transparent" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: "#111827" }}>
                  {p.name}
                  {isToday && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: color, background: bg, border: `1px solid ${color}44`, padding: "1px 5px", borderRadius: 8 }}>TODAY</span>}
                </div>
                {p.city && <div style={{ fontSize: 10, color: "#9ca3af" }}>{p.city}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color }}>{p.factor}</div>
                <div style={{ fontSize: 9, color: "#9ca3af" }}>{isBoost ? "BOOST" : "SUPPRESS"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Today's Matchup Card ──────────────────────────────────────────────────
// Shows tonight's specific matchup context for a player — pitcher splits,
// park factor, edge assessment, and any HRs already hit today
function MatchupCard({ playerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    apiFetch(`/api/player-matchup/${playerId}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [playerId]);

  if (loading) return (
    <div style={{ padding: "12px 16px", fontSize: 12, color: "#9ca3af", background: "#f9fafb", borderRadius: 12, marginBottom: 10 }}>
      Loading tonight's matchup...
    </div>
  );

  if (!data?.playing) return (
    <div style={{ padding: "12px 16px", fontSize: 12, color: "#9ca3af", background: "#f9fafb", borderRadius: 12, marginBottom: 10 }}>
      No game scheduled today.
    </div>
  );

  const edgeColors = { HIGH: "#c8102e", MED: "#b45309", WEAK: "#6b7280" };
  const edgeBg     = { HIGH: "#fef2f2", MED: "#fffbeb", WEAK: "#f9fafb" };
  const edgeColor  = edgeColors[data.edge?.overall] || "#6b7280";
  const edgeBgCol  = edgeBg[data.edge?.overall]     || "#f9fafb";

  const gameTime = data.game?.gameTime
    ? new Date(data.game.gameTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT"
    : "";

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Today's HR if they already hit one */}
      {data.todayHRs?.length > 0 && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", letterSpacing: "0.1em", marginBottom: 6 }}>💥 ALREADY HIT TODAY</div>
          {data.todayHRs.map((hr, i) => (
            <div key={i} style={{ fontSize: 13, color: "#065f46" }}>
              Inn. {hr.inning}{hr.distance ? ` · ${Math.round(hr.distance)} ft` : ""}{hr.exitVelo ? ` · ${Math.round(hr.exitVelo)} mph exit velo` : ""}
              {hr.pitcher ? ` · off ${hr.pitcher}` : ""}
            </div>
          ))}
        </div>
      )}

      {/* Matchup card */}
      <div style={{ background: edgeBgCol, border: `1px solid ${edgeColor}33`, borderRadius: 12, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.12em", marginBottom: 3 }}>TONIGHT'S MATCHUP</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
              {data.game?.myTeam} {data.game?.isHome ? "vs" : "@"} {data.game?.opponent}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{data.game?.venue} · {gameTime}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: edgeColor, background: "#fff", border: `1px solid ${edgeColor}44`, padding: "3px 10px", borderRadius: 20 }}>
              {data.edge?.overall} EDGE
            </div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>Park factor {data.game?.parkFactor}</div>
          </div>
        </div>

        {/* Pitcher section */}
        {data.pitcher && (
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 6 }}>OPPOSING PITCHER</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 4 }}>
              {data.pitcher.name} ({data.pitcher.hand}HP)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[
                ["ERA", data.pitcher.era],
                ["HR/9 overall", data.pitcher.hr9],
                [`HR/9 vs ${data.player?.bats}HB`, data.pitcher.relevantHr9],
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#fff", borderRadius: 8, padding: "7px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2, letterSpacing: "0.06em" }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: parseFloat(val) > 1.3 && label.includes("HR/9") ? "#c8102e" : "#111827" }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hitter context */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 6 }}>
            HITTER vs {data.pitcher?.hand || "R"}HP THIS SEASON
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {[
              ["AB/HR", data.hitterContext?.abPerHR],
              ["wOBA", data.hitterContext?.woba],
              ["HR vs this hand", data.hitterContext?.relevantSplitHR],
              ["Split AVG", data.hitterContext?.relevantSplitAvg],
            ].map(([label, val]) => (
              <div key={label} style={{ background: "#fff", borderRadius: 8, padding: "7px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2, letterSpacing: "0.04em" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{val ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Edge factors and concerns */}
        <div style={{ padding: "10px 14px" }}>
          {data.edge?.factors?.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: "#059669", marginBottom: 3 }}>✓ {f}</div>
          ))}
          {data.edge?.concerns?.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "#d97706", marginTop: 3 }}>⚠ {c}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Player Profile ────────────────────────────────────────────────────────
function DeepDive({ playerId, playerName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [calOpen, setCalOpen] = useState(false);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true); setData(null); setError(null);
    apiFetch(`/api/player-profile/${playerId}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [playerId]);

  const streakColors = { HOT: "#c8102e", WARM: "#b45309", NEUTRAL: "#6b7280", COLD: "#3b82f6" };
  const streakBg     = { HOT: "#fef2f2", WARM: "#fffbeb", NEUTRAL: "#f9fafb", COLD: "#eff6ff" };
  const edgeColors   = { HIGH: "#c8102e", MED: "#b45309", WEAK: "#6b7280" };

  if (loading) return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 12, textAlign: "center" }}>
      <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading player profile...</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "#c8102e" }}>⚠ Could not load profile</div>
    </div>
  );

  const { info, season, splits, streak, matchup, hrHistory, todayHRs } = data;
  const streakColor = streakColors[streak?.status] || "#6b7280";
  const streakBgCol = streakBg[streak?.status]     || "#f9fafb";

  // Monthly calendar from hrHistory
  const byMonth = {};
  for (const g of hrHistory || []) {
    const d = new Date(g.date + "T12:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(g);
  }
  const months = Object.keys(byMonth).sort().reverse();
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>

      {/* ── Header ── */}
      <div style={{ background: "#1a2f5e", padding: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{info?.name || playerName}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
            {info?.team} · {info?.position} · Bats {info?.bats}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{season?.hr ?? "—"}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>HR {new Date().getFullYear()}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      </div>

      <div style={{ padding: 16 }}>

        {/* ── Today's HR alert ── */}
        {todayHRs?.length > 0 && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", letterSpacing: "0.1em", marginBottom: 4 }}>💥 ALREADY HIT TODAY</div>
            {todayHRs.map((hr, i) => (
              <div key={i} style={{ fontSize: 13, color: "#065f46" }}>
                Inn. {hr.inning}{hr.distance ? ` · ${Math.round(hr.distance)} ft` : ""}{hr.exitVelo ? ` · ${Math.round(hr.exitVelo)} mph` : ""}
              </div>
            ))}
          </div>
        )}

        {/* ── Zone 1: Current streak ── */}
        <div style={{ background: streakBgCol, borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: `1px solid ${streakColor}22` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: streakColor, letterSpacing: "0.1em" }}>
                {streak?.status === "HOT" ? "🔥 HOT STREAK" : streak?.status === "WARM" ? "📈 WARMING UP" : streak?.status === "COLD" ? "❄️ COLD STRETCH" : "📊 NEUTRAL"}
              </span>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {streak?.daysSinceLastHR === 0 ? "Hit today" :
                 streak?.daysSinceLastHR === 1 ? "Last HR: 1 day ago" :
                 streak?.daysSinceLastHR > 1 ? `Last HR: ${streak.daysSinceLastHR} days ago` : "No HR in 30 days"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, textAlign: "center" }}>
              {[["L7", streak?.last7HRs], ["L14", streak?.last14HRs], ["L30", streak?.last30HRs]].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: val > 0 ? streakColor : "#9ca3af", lineHeight: 1 }}>{val ?? "—"}</div>
                  <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>
            Season avg {streak?.seasonHRper7?.toFixed(1)} HR/7 games
          </div>
        </div>

        {/* ── Zone 2: Tonight's matchup ── */}
        {matchup ? (
          <div style={{ background: matchup.edge === "HIGH" ? "#fef2f2" : matchup.edge === "MED" ? "#fffbeb" : "#f9fafb", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: `1px solid ${edgeColors[matchup.edge] || "#e5e7eb"}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", marginBottom: 2 }}>TONIGHT'S MATCHUP</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                  {matchup.myTeam} {matchup.isHome ? "vs" : "@"} {matchup.opponent}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
                  {matchup.venue} · PF {matchup.park}
                  {matchup.weather?.wind ? ` · ${matchup.weather.wind}` : ""}
                  {matchup.weather?.temp ? ` · ${matchup.weather.temp}°F` : ""}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: edgeColors[matchup.edge], background: "#fff", border: `1px solid ${edgeColors[matchup.edge]}44`, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
                {matchup.edge} EDGE
              </span>
            </div>

            {matchup.pitcher && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
                  vs {matchup.pitcher.name} ({matchup.pitcher.hand}HP)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {[
                    ["ERA", matchup.pitcher.era],
                    ["HR/9", matchup.pitcher.hr9],
                    [`HR/9 vs ${info?.bats}HB`, matchup.pitcher.relevantHr9],
                  ].map(([label, val]) => (
                    <div key={label} style={{ background: "#fff", borderRadius: 8, padding: "7px 6px", textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: parseFloat(val) > 1.3 && label.includes("HR/9") ? "#c8102e" : "#111827" }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {matchup.factors?.map((f, i) => <div key={i} style={{ fontSize: 12, color: "#059669" }}>✓ {f}</div>)}
              {matchup.concerns?.map((c, i) => <div key={i} style={{ fontSize: 12, color: "#d97706" }}>⚠ {c}</div>)}
            </div>
          </div>
        ) : (
          <div style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px", marginBottom: 12, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
            No game scheduled today
          </div>
        )}

        {/* ── Zone 3: Season stats grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
          {[
            ["AB/HR", season?.abPerHR ? parseFloat(season.abPerHR).toFixed(1) : "—"],
            ["wOBA",  season?.woba    ? season.woba : "—"],
            ["OPS",   season?.ops     || "—"],
            ["ISO",   season?.iso     || "—"],
          ].map(([label, val]) => (
            <div key={label} style={{ background: "#f9fafb", borderRadius: 10, padding: "9px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Splits */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          {[
            ["vs LHP", splits?.vsLHP],
            ["vs RHP", splits?.vsRHP],
            ["Home",   splits?.home],
            ["Away",   splits?.away],
          ].map(([label, s]) => (
            <div key={label} style={{ background: "#f9fafb", borderRadius: 10, padding: "9px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <div><div style={{ fontSize: 16, fontWeight: 800, color: "#c8102e" }}>{s?.hr ?? "—"}</div><div style={{ fontSize: 8, color: "#9ca3af" }}>HR</div></div>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{s?.avg || "—"}</div><div style={{ fontSize: 8, color: "#9ca3af" }}>AVG</div></div>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{s?.ops || "—"}</div><div style={{ fontSize: 8, color: "#9ca3af" }}>OPS</div></div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Zone 4: HR Calendar ── */}
        <div onClick={() => setCalOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid #f3f4f6", cursor: "pointer", userSelect: "none" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#374151", letterSpacing: "0.12em" }}>
            HR CALENDAR — {hrHistory?.length || 0} GAMES THIS SEASON
          </span>
          <span style={{ fontSize: 16, color: "#d1d5db", transform: calOpen ? "rotate(90deg)" : "none", transition: "0.2s" }}>›</span>
        </div>

        {calOpen && (
          <div style={{ paddingTop: 4 }}>
            {months.map(monthKey => {
              const [yr, mo] = monthKey.split("-");
              const firstDay = new Date(parseInt(yr), parseInt(mo)-1, 1).getDay();
              const daysInMonth = new Date(parseInt(yr), parseInt(mo), 0).getDate();
              const dayMap = {};
              for (const g of byMonth[monthKey]) {
                dayMap[new Date(g.date + "T12:00:00").getDate()] = g;
              }
              const monthHRs = byMonth[monthKey].reduce((s,g)=>s+g.hrs,0);
              return (
                <div key={monthKey} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{monthNames[parseInt(mo)-1]} {yr}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#c8102e", background: "#fef2f2", borderRadius: 10, padding: "2px 8px" }}>{monthHRs} HR</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                    {["S","M","T","W","T","F","S"].map((d,i) => (
                      <div key={i} style={{ fontSize: 9, color: "#9ca3af", textAlign: "center", paddingBottom: 4, fontWeight: 600 }}>{d}</div>
                    ))}
                    {Array.from({ length: firstDay }).map((_,i) => <div key={`e${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_,i) => {
                      const day = i+1;
                      const game = dayMap[day];
                      const hasHR = game && game.hrs > 0;
                      const multi = game && game.hrs > 1;
                      return (
                        <div key={day} style={{
                          aspectRatio: "1",
                          borderRadius: 6,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          position: "relative",
                          background: hasHR ? (multi ? "#c8102e" : "#fef2f2") : "#f9fafb",
                          border: hasHR ? `1px solid ${multi ? "#c8102e" : "#fecaca"}` : "1px solid #f0f0f0",
                        }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: hasHR ? 800 : 400,
                            color: hasHR ? (multi ? "#fff" : "#c8102e") : "#9ca3af",
                          }}>
                            {multi ? game.hrs : day}
                          </span>
                          {hasHR && !multi && (
                            <div style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "#c8102e" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
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
            <Section title="HR CONDITIONS" accent="#f59e0b" defaultOpen={true}>
              <Conditions games={gamesToday} parkData={parkData.data} />
            </Section>
            <Section title="SEASON HR LEADERS" accent="#c8102e" defaultOpen={false}>
              <div style={{ paddingTop: 8 }}>
                {(leaders.data?.leaders || []).slice(0, 15).map((l, i) => (
                  <div key={i} onClick={() => l.playerId && handlePlayerClick({ playerId: l.playerId, playerName: l.player })}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < 14 ? "1px solid #f3f4f6" : "none", cursor: l.playerId ? "pointer" : "default" }}>
                    <div style={{ width: 22, textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: i < 3 ? "#c8102e" : "#9ca3af" }}>#{l.rank}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.player}</div>
                      <div style={{ fontSize: 10, color: "#9ca3af" }}>{l.team}</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: i < 3 ? "#c8102e" : "#374151", lineHeight: 1, flexShrink: 0 }}>{l.value}</div>
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
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: i < dedupedYest.length - 1 ? "1px solid #f3f4f6" : "none", cursor: hr.playerId ? "pointer" : "default" }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>💥</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{hr.player}</div>
                      {hr.count > 1 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#c8102e", borderRadius: 10, padding: "1px 7px" }}>{hr.count}x</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {hr.team && <span style={{ fontWeight: 600, color: "#374151" }}>{hr.team}</span>}
                      {hr.opponent ? ` vs ${hr.opponent}` : ""}
                      {hr.inning ? ` · Inn. ${hr.inning}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                      {hr.distance && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>📏 {fmt(hr.distance)} ft</span>}
                      {hr.exitVelo && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>⚡ {fmt(hr.exitVelo)} mph</span>}
                      {hr.launchAngle && <span style={{ fontSize: 10, fontWeight: 600, color: "#374151", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>📐 {hr.launchAngle}°</span>}
                      {hr.pitcher && <span style={{ fontSize: 10, color: "#6b7280", background: "#f3f4f6", borderRadius: 5, padding: "2px 6px" }}>off {hr.pitcher}</span>}
                    </div>
                  </div>
                  {hr.seasonHRs && <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 22, fontWeight: 800, color: "#c8102e", lineHeight: 1 }}>{hr.seasonHRs}</div><div style={{ fontSize: 9, color: "#9ca3af" }}>HR</div></div>}
                </div>
              ))}
            </div>
          </Section>
        )}

      </div>
    </div>
  );
}
