import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ── Config (set via environment variables) ─────────────────────────────────
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN;
const PUSHOVER_USER  = process.env.PUSHOVER_USER;
const PORT           = process.env.PORT || 3001;
const POLL_INTERVAL  = 60_000; // 60 seconds

// ── State ──────────────────────────────────────────────────────────────────
const seenHRs    = new Set(); // "gamePk-playId" already alerted
let   liveHRs    = [];        // today's HRs in memory
let   lastPoll   = null;
let   isFirstPoll = true;     // skip push notifications on startup

// ── MLB Stats API helpers ──────────────────────────────────────────────────
const MLB = "https://statsapi.mlb.com/api/v1";

async function mlb(path) {
  const r = await fetch(`${MLB}${path}`);
  if (!r.ok) throw new Error(`MLB API ${r.status}: ${path}`);
  return r.json();
}

function getCTDate(offsetDays = 0) {
  const now = new Date();
  // Get current CT time string and parse it properly
  const ctParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false
  }).formatToParts(now);
  const get = (type) => ctParts.find(p => p.type === type)?.value;
  let year  = parseInt(get("year"));
  let month = parseInt(get("month"));
  let day   = parseInt(get("day"));
  const hour = parseInt(get("hour"));
  // Hold at current date until 11pm CT (don't roll to next day yet)
  if (hour >= 23) {
    // stay on current CT date — don't advance
  }
  // Apply offset using Date math to handle month/year boundaries
  const base = new Date(year, month - 1, day);
  base.setDate(base.getDate() + offsetDays);
  const yyyy = base.getFullYear();
  const mm   = String(base.getMonth() + 1).padStart(2, "0");
  const dd   = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayStr() { return getCTDate(0); }

async function getTodayGames() {
  const data = await mlb(`/schedule?sportId=1&date=${todayStr()}&hydrate=linescore`);
  return (data.dates?.[0]?.games || []).map(g => g.gamePk);
}

async function getGameHRs(gamePk) {
  const [pbpData, boxData] = await Promise.all([
    mlb(`/game/${gamePk}/playByPlay`),
    mlb(`/game/${gamePk}/boxscore`),
  ]);
  const data = pbpData;
  const plays = data.allPlays || [];
  // Try multiple sources for abbreviation
  const awayAbb =
    boxData?.teams?.away?.team?.abbreviation ||
    data.gameData?.teams?.away?.abbreviation ||
    data.gameData?.teams?.away?.teamCode ||
    "???";
  const homeAbb =
    boxData?.teams?.home?.team?.abbreviation ||
    data.gameData?.teams?.home?.abbreviation ||
    data.gameData?.teams?.home?.teamCode ||
    "???";
  return plays
    .filter(p => p.result?.eventType === "home_run")
    .map(p => {
      const isTop = p.about?.halfInning === "top";
      return {
        id:          `${gamePk}-${p.atBatIndex}`,
        gamePk,
        playerId:    p.matchup?.batter?.id || null,
        player:      p.matchup?.batter?.fullName || "Unknown",
        team:        isTop ? awayAbb : homeAbb,
        opponent:    isTop ? homeAbb : awayAbb,
        inning:      p.about?.inning,
        half:        p.about?.halfInning,
        distance:    p.hitData?.totalDistance || null,
        exitVelo:    p.hitData?.launchSpeed   || null,
        launchAngle: p.hitData?.launchAngle   || null,
        description: p.result?.description    || "",
        timestamp:   p.about?.endTime         || new Date().toISOString(),
        seasonHRs:   null,
      };
    });
}

async function getPlayerSeasonHRs(playerId) {
  try {
    const data = await mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${new Date().getFullYear()}`);
    const stats = data.stats?.[0]?.splits?.[0]?.stat;
    return stats?.homeRuns ?? null;
  } catch { return null; }
}

// ── Pushover alert ─────────────────────────────────────────────────────────
async function sendPush(hr) {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) {
    console.log("[PUSH skipped - no credentials]", hr.player);
    return;
  }
  const dist  = hr.distance   ? ` · ${hr.distance} ft`   : "";
  const velo  = hr.exitVelo   ? ` · ${hr.exitVelo} mph`   : "";
  const seas  = hr.seasonHRs  ? ` (#${hr.seasonHRs} this season)` : "";
  const teams = (hr.team && hr.opponent && !["AWY","HME","???"].includes(hr.team)) ? `${hr.team} vs ${hr.opponent} · ` : "";
  const msg   = `${hr.player}${seas}\n${teams}Inn. ${hr.inning}${dist}${velo}`;

  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token:   PUSHOVER_TOKEN,
      user:    PUSHOVER_USER,
      title:   "💥 HOME RUN",
      message: msg,
      sound:   "cashregister",
      priority: 1,
    }),
  });
  console.log(`[PUSH sent] ${hr.player}`);
}

// ── Poll loop ──────────────────────────────────────────────────────────────
async function poll() {
  try {
    lastPoll = new Date().toISOString();
    const pollDate = getCTDate(0);

    // Reset at start of new CT day
    if (playsCache.date && playsCache.date !== pollDate) {
      console.log("[poll] new day:", pollDate, "clearing all state");
      playsCache = { date: null, data: null, hrCount: 0, generating: false };
      seenHRs.clear();
      liveHRs = [];
      isFirstPoll = true;
    }

    const gamePks = await getTodayGames();
    const newHRs  = [];

    for (const pk of gamePks) {
      const hrs = await getGameHRs(pk);
      for (const hr of hrs) {
        // Track in memory regardless
        if (!liveHRs.find(h => h.id === hr.id)) {
          liveHRs.push(hr);
        }
        // Alert only on new ones — skip on first poll (catch-up)
        if (!seenHRs.has(hr.id)) {
          seenHRs.add(hr.id);
          if (!isFirstPoll) {
            newHRs.push(hr);
            await sendPush(hr);
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    // Sort newest first
    liveHRs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (newHRs.length) console.log(`[poll] +${newHRs.length} new HRs`);
    isFirstPoll = false;
  } catch (e) {
    console.error("[poll error]", e.message);
  }
}

// ── Player deep dive ───────────────────────────────────────────────────────
async function getPlayerStats(playerId) {
  const year = new Date().getFullYear();
  const [season, last14, last7, vsL, vsR, home, away] = await Promise.allSettled([
    mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
    mlb(`/people/${playerId}/stats?stats=lastXGames&group=hitting&season=${year}&gamePks=&limit=14`),
    mlb(`/people/${playerId}/stats?stats=lastXGames&group=hitting&season=${year}&gamePks=&limit=7`),
    mlb(`/people/${playerId}/stats?stats=vsTeamTotal&group=hitting&season=${year}&opposingTeamId=&sitCodes=vl`),
    mlb(`/people/${playerId}/stats?stats=vsTeamTotal&group=hitting&season=${year}&opposingTeamId=&sitCodes=vr`),
    mlb(`/people/${playerId}/stats?stats=homeAndAway&group=hitting&season=${year}&sitCodes=h`),
    mlb(`/people/${playerId}/stats?stats=homeAndAway&group=hitting&season=${year}&sitCodes=a`),
  ]);

  const extract = (r) => {
    if (r.status !== "fulfilled") return null;
    const splits = r.value?.stats?.[0]?.splits;
    return splits?.[0]?.stat || null;
  };

  const seasonStat = extract(season);
  console.log("[getPlayerStats]", playerId, "season HR:", seasonStat?.homeRuns, "avg:", seasonStat?.avg);

  return {
    season:  seasonStat,
    last14:  extract(last14),
    last7:   extract(last7),
    vsLeft:  extract(vsL),
    vsRight: extract(vsR),
    home:    extract(home),
    away:    extract(away),
  };
}

async function getPlayerInfo(playerId) {
  const data = await mlb(`/people/${playerId}`);
  return data.people?.[0] || {};
}

// ── Search players ─────────────────────────────────────────────────────────
async function searchPlayers(name) {
  const data = await mlb(`/people/search?names=${encodeURIComponent(name)}&sportId=1`);
  return (data.people || []).slice(0, 5).map(p => ({
    id:       p.id,
    name:     p.fullName,
    team:     p.currentTeam?.name || "",
    position: p.primaryPosition?.abbreviation || "",
  }));
}

// ── Park factors (static lookup, updated annually) ─────────────────────────
const PARK_FACTORS = {
  "Dodger Stadium":         { factor: 135, city: "Los Angeles, CA" },
  "Coors Field":            { factor: 132, city: "Denver, CO" },
  "Sutter Health Park":     { factor: 128, city: "Sacramento, CA" },
  "Camden Yards":           { factor: 121, city: "Baltimore, MD" },
  "Great American Ball Park":{ factor: 118, city: "Cincinnati, OH" },
  "Truist Park":            { factor: 113, city: "Atlanta, GA" },
  "Citizens Bank Park":     { factor: 110, city: "Philadelphia, PA" },
  "Fenway Park":            { factor: 107, city: "Boston, MA" },
  "Yankee Stadium":         { factor: 106, city: "New York, NY" },
  "American Family Field":  { factor: 105, city: "Milwaukee, WI" },
  "Globe Life Field":       { factor: 104, city: "Arlington, TX" },
  "Wrigley Field":          { factor: 103, city: "Chicago, IL" },
  "T-Mobile Park":          { factor: 101, city: "Seattle, WA" },
  "Minute Maid Park":       { factor: 97,  city: "Houston, TX" },
  "Oracle Park":            { factor: 94,  city: "San Francisco, CA" },
  "Tropicana Field":        { factor: 91,  city: "St. Petersburg, FL" },
  "loanDepot park":         { factor: 90,  city: "Miami, FL" },
  "Progressive Field":      { factor: 96,  city: "Cleveland, OH" },
  "Kauffman Stadium":       { factor: 93,  city: "Kansas City, MO" },
  "Busch Stadium":          { factor: 95,  city: "St. Louis, MO" },
  "PNC Park":               { factor: 92,  city: "Pittsburgh, PA" },
  "Petco Park":             { factor: 89,  city: "San Diego, CA" },
  "Target Field":           { factor: 98,  city: "Minneapolis, MN" },
  "Comerica Park":          { factor: 91,  city: "Detroit, MI" },
  "Angel Stadium":          { factor: 96,  city: "Anaheim, CA" },
  "Guaranteed Rate Field":  { factor: 102, city: "Chicago, IL" },
  "Oakland Coliseum":       { factor: 88,  city: "Oakland, CA" },
  "Rogers Centre":          { factor: 109, city: "Toronto, Canada" },
  "Nationals Park":         { factor: 99,  city: "Washington, DC" },
  "Chase Field":            { factor: 100, city: "Phoenix, AZ" },
};

// ── Routes ─────────────────────────────────────────────────────────────────
app.get("/api/live-hrs", (req, res) => {
  res.json({ hrs: liveHRs, lastPoll, count: liveHRs.length });
});

app.get("/api/yesterday-hrs", async (req, res) => {
  try {
    const dateStr = getCTDate(-1);
    console.log("[yesterday-hrs] fetching date:", dateStr, "today is:", todayStr());

    const data = await mlb(`/schedule?sportId=1&date=${dateStr}`);
    const pks = (data.dates?.[0]?.games || []).map(g => g.gamePk);
    const allHRs = [];

    for (const pk of pks) {
      const hrs = await getGameHRs(pk);
      allHRs.push(...hrs);
    }

    res.json({ hrs: allHRs.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/player/search", async (req, res) => {
  try {
    const results = await searchPlayers(req.query.q || "");
    res.json({ players: results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/player/:id", async (req, res) => {
  try {
    const [info, stats] = await Promise.all([
      getPlayerInfo(req.params.id),
      getPlayerStats(req.params.id),
    ]);
    res.json({ info, stats });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/park-factors", (req, res) => {
  const sorted = Object.entries(PARK_FACTORS)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.factor - a.factor);
  res.json({ parks: sorted });
});

app.get("/api/today-games", async (req, res) => {
  try {
    const data = await mlb(`/schedule?sportId=1&date=${todayStr()}&hydrate=team,linescore,weather,venue`);
    const games = (data.dates?.[0]?.games || []).map(g => ({
      gamePk:  g.gamePk,
      status:  g.status?.detailedState,
      home:    g.teams?.home?.team?.name,
      away:    g.teams?.away?.team?.name,
      homeAbb: g.teams?.home?.team?.abbreviation,
      awayAbb: g.teams?.away?.team?.abbreviation,
      venue:   g.venue?.name,
      city:    g.venue?.location?.city,
      time:    g.gameDate,
      weather: g.weather || null,
      linescore: {
        inning: g.linescore?.currentInning,
        half:   g.linescore?.inningHalf,
        runs: {
          home: g.linescore?.teams?.home?.runs,
          away: g.linescore?.teams?.away?.runs,
        }
      },
      parkFactor: PARK_FACTORS[g.venue?.name]?.factor || 100,
    }));
    res.json({ games });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/hr-leaders", async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const data = await mlb(`/stats/leaders?leaderCategories=homeRuns&season=${year}&sportId=1&limit=20&statGroup=hitting`);
    const leaders = (data.leagueLeaders?.[0]?.leaders || []).map(l => ({
      rank:   l.rank,
      player: l.person?.fullName,
      playerId: l.person?.id,
      team:   l.team?.abbreviation,
      value:  l.value,
    }));
    res.json({ leaders });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
// ── Game detail — HRs hit so far + live status ────────────────────────────
app.get("/api/game/:gamePk", async (req, res) => {
  try {
    const { gamePk } = req.params;
    const [boxscore, pbp] = await Promise.all([
      mlb(`/game/${gamePk}/boxscore`),
      mlb(`/game/${gamePk}/playByPlay`),
    ]);

    const awayAbb = boxscore?.teams?.away?.team?.abbreviation || "?";
    const homeAbb = boxscore?.teams?.home?.team?.abbreviation || "?";
    const awayName = boxscore?.teams?.away?.team?.name || awayAbb;
    const homeName = boxscore?.teams?.home?.team?.name || homeAbb;

    // Get all HRs from play by play
    const hrs = (pbp.allPlays || [])
      .filter(p => p.result?.eventType === "home_run")
      .map(p => {
        const isTop = p.about?.halfInning === "top";
        return {
          player:   p.matchup?.batter?.fullName || "Unknown",
          team:     isTop ? awayAbb : homeAbb,
          teamName: isTop ? awayName : homeName,
          inning:   p.about?.inning,
          half:     p.about?.halfInning,
          distance: p.hitData?.totalDistance ? Math.round(p.hitData.totalDistance) : null,
          exitVelo: p.hitData?.launchSpeed   ? Math.round(p.hitData.launchSpeed)   : null,
          description: p.result?.description || "",
        };
      });

    // Current game state
    const linescore = await mlb(`/game/${gamePk}/linescore`);
    const status = {
      inning:     linescore?.currentInning,
      half:       linescore?.inningHalf,
      awayRuns:   linescore?.teams?.away?.runs,
      homeRuns:   linescore?.teams?.home?.runs,
      awayAbb, homeAbb, awayName, homeName,
    };

    res.json({ hrs, status, gamePk });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 3-day HR analysis for improving plays ─────────────────────────────────
app.get("/api/hr-analysis", async (req, res) => {
  try {
    const counts = {};
    const details = {};
    for (let i = 1; i <= 3; i++) {
      const date = getCTDate(-i);
      const sched = await mlb(`/schedule?sportId=1&date=${date}`);
      const games = sched.dates?.[0]?.games || [];
      for (const g of games) {
        try {
          const [pbp, box] = await Promise.all([
            mlb(`/game/${g.gamePk}/playByPlay`),
            mlb(`/game/${g.gamePk}/boxscore`),
          ]);
          const awayAbb = box?.teams?.away?.team?.abbreviation || "?";
          const homeAbb = box?.teams?.home?.team?.abbreviation || "?";
          for (const p of pbp.allPlays || []) {
            if (p.result?.eventType === "home_run") {
              const name = p.matchup?.batter?.fullName;
              const id   = p.matchup?.batter?.id;
              const isTop = p.about?.halfInning === "top";
              counts[name] = (counts[name] || 0) + 1;
              if (!details[name]) details[name] = { playerId: id, team: isTop ? awayAbb : homeAbb, dates: [] };
              details[name].dates.push(date);
            }
          }
        } catch {}
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([player, count]) => ({ player, count, ...details[player] }));
    res.json({ players: sorted, days: 3 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/clear-plays-cache", (req, res) => {
  playsCache = { date: null, data: null, hrCount: 0, generating: false };
  res.json({ ok: true, message: "plays cache cleared" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, lastPoll, seenHRs: seenHRs.size });
});

// ── Start ──────────────────────────────────────────────────────────────────

// ── Smart plays cache — regenerates when new HRs hit ─────────────────────
let playsCache = { date: null, data: null, hrCount: 0, generating: false };


// ── Statcast data via Baseball Savant ──────────────────────────────────────
async function getProbablePitchers(date) {
  try {
    const data = await mlb(`/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`);
    const games = data.dates?.[0]?.games || [];
    const pitchers = [];
    for (const g of games) {
      const awayPP = g.teams?.away?.probablePitcher;
      const homePP = g.teams?.home?.probablePitcher;
      const awayAbb = g.teams?.away?.team?.abbreviation || "";
      const homeAbb = g.teams?.home?.team?.abbreviation || "";
      if (awayPP) pitchers.push({ id: awayPP.id, name: awayPP.fullName, team: awayAbb, opponent: homeAbb, venue: g.venue?.name });
      if (homePP) pitchers.push({ id: homePP.id, name: homePP.fullName, team: homeAbb, opponent: awayAbb, venue: g.venue?.name });
    }
    return pitchers;
  } catch(e) {
    console.error("[probable pitchers]", e.message);
    return [];
  }
}

async function getPitcherStatcastSplits(pitcherId) {
  try {
    const year = new Date().getFullYear();
    // Get pitcher stats vs LHB and RHB
    const [vsL, vsR, season] = await Promise.allSettled([
      mlb(`/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vl`),
      mlb(`/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vr`),
      mlb(`/people/${pitcherId}/stats?stats=season&group=pitching&season=${year}`),
    ]);
    const extract = (r) => r.status === "fulfilled" ? r.value?.stats?.[0]?.splits?.[0]?.stat : null;
    const s = extract(season);
    return {
      vsLeft:  extract(vsL),
      vsRight: extract(vsR),
      season:  s,
      era:     s?.era,
      whip:    s?.whip,
      hr9:     s?.homeRunsPer9,
      so9:     s?.strikeoutsPer9,
    };
  } catch(e) { return null; }
}

async function getHitterStatcastSplits(hitterId) {
  try {
    const year = new Date().getFullYear();
    const [season, last14, vsL, vsR] = await Promise.allSettled([
      mlb(`/people/${hitterId}/stats?stats=season&group=hitting&season=${year}`),
      mlb(`/people/${hitterId}/stats?stats=lastXDays&group=hitting&season=${year}&limit=14`),
      mlb(`/people/${hitterId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
      mlb(`/people/${hitterId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
    ]);
    const extract = (r) => r.status === "fulfilled" ? r.value?.stats?.[0]?.splits?.[0]?.stat : null;
    const s = extract(season);
    const l14 = extract(last14);
    return {
      season: s,
      last14: l14,
      vsLeft: extract(vsL),
      vsRight: extract(vsR),
      avg: s?.avg,
      ops: s?.ops,
      hr: s?.homeRuns,
      iso: s?.slugging && s?.avg ? (parseFloat(s.slugging) - parseFloat(s.avg)).toFixed(3) : null,
      last14hr: l14?.homeRuns,
      last14ops: l14?.ops,
    };
  } catch(e) { return null; }
}

// Search for player ID by name
async function findPlayerId(name) {
  try {
    const data = await mlb(`/people/search?names=${encodeURIComponent(name)}&sportId=1`);
    return data.people?.[0]?.id || null;
  } catch { return null; }
}

async function generatePlays(today, todayHRs) {
  playsCache.generating = true;
  console.log("[plays] starting full data pull for", today);

  try {
    const year = new Date().getFullYear();

    // ── Step 1: Schedule + probable pitchers ─────────────────────────────
    const schedData = await mlb(`/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,venue`);
    const games = schedData.dates?.[0]?.games || [];
    console.log("[plays] games today:", games.length);

    // ── Step 2: Pull real pitcher data ────────────────────────────────────
    const pitcherCache = {};
    async function getRealPitcherData(pp) {
      if (!pp?.id) return null;
      if (pitcherCache[pp.id]) return pitcherCache[pp.id];
      try {
        const [info, seasonStats, vsL, vsR] = await Promise.allSettled([
          mlb(`/people/${pp.id}`),
          mlb(`/people/${pp.id}/stats?stats=season&group=pitching&season=${year}`),
          mlb(`/people/${pp.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vl`),
          mlb(`/people/${pp.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vr`),
        ]);
        const s  = seasonStats.status === "fulfilled" ? seasonStats.value?.stats?.[0]?.splits?.[0]?.stat : null;
        const sl = vsL.status === "fulfilled" ? vsL.value?.stats?.[0]?.splits?.[0]?.stat : null;
        const sr = vsR.status === "fulfilled" ? vsR.value?.stats?.[0]?.splits?.[0]?.stat : null;
        const hand = info.status === "fulfilled" ? info.value?.people?.[0]?.pitchHand?.code : "?";
        const result = {
          name: pp.fullName,
          hand,
          era:    s?.era    || "?",
          whip:   s?.whip   || "?",
          hr9:    s?.homeRunsPer9 ? parseFloat(s.homeRunsPer9).toFixed(2) : "?",
          vsLHB:  sl ? `avg ${sl.avg || "?"} HR/9 ${sl.homeRunsPer9 ? parseFloat(sl.homeRunsPer9).toFixed(2) : "?"}` : "?",
          vsRHB:  sr ? `avg ${sr.avg || "?"} HR/9 ${sr.homeRunsPer9 ? parseFloat(sr.homeRunsPer9).toFixed(2) : "?"}` : "?",
        };
        pitcherCache[pp.id] = result;
        return result;
      } catch { return null; }
    }

    // ── Step 3: Pull real hitter data per team ────────────────────────────
    const hitterCache = {};
    async function getRealHitterData(playerId, name) {
      if (hitterCache[playerId]) return hitterCache[playerId];
      try {
        const [info, season, last7, vsL, vsR] = await Promise.allSettled([
          mlb(`/people/${playerId}`),
          mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
          mlb(`/people/${playerId}/stats?stats=lastXGames&group=hitting&season=${year}&limit=7`),
          mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
          mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
        ]);
        const s   = season.status  === "fulfilled" ? season.value?.stats?.[0]?.splits?.[0]?.stat  : null;
        const l7  = last7.status   === "fulfilled" ? last7.value?.stats?.[0]?.splits?.[0]?.stat   : null;
        const sl  = vsL.status     === "fulfilled" ? vsL.value?.stats?.[0]?.splits?.[0]?.stat     : null;
        const sr  = vsR.status     === "fulfilled" ? vsR.value?.stats?.[0]?.splits?.[0]?.stat     : null;
        const bats = info.status   === "fulfilled" ? info.value?.people?.[0]?.batSide?.code : "?";
        const seasonHR = parseInt(s?.homeRuns || 0);
        if (seasonHR < 1) return null; // skip non-power hitters
        const iso = s?.slugging && s?.avg
          ? (parseFloat(s.slugging) - parseFloat(s.avg)).toFixed(3) : "?";
        const result = {
          name,
          playerId,
          bats,
          seasonHR,
          avg:    s?.avg    || "?",
          ops:    s?.ops    || "?",
          iso,
          last7HR: parseInt(l7?.homeRuns || 0),
          last7OPS: l7?.ops || "?",
          vsLHP_HR: parseInt(sl?.homeRuns || 0),
          vsRHP_HR: parseInt(sr?.homeRuns || 0),
          vsLHP_avg: sl?.avg || "?",
          vsRHP_avg: sr?.avg || "?",
        };
        hitterCache[playerId] = result;
        return result;
      } catch { return null; }
    }

    async function getTeamHitters(teamId) {
      try {
        const roster = await mlb(`/teams/${teamId}/roster?rosterType=active`);
        const posPlayers = (roster.roster || [])
          .filter(p => !["P","TWP"].includes(p.position?.type));
        const hitters = [];
        // Fetch in batches of 4 to be respectful of rate limits
        for (let i = 0; i < posPlayers.length; i += 4) {
          const batch = posPlayers.slice(i, i + 4);
          const results = await Promise.all(
            batch.map(p => getRealHitterData(p.person.id, p.person.fullName))
          );
          hitters.push(...results.filter(Boolean));
          await new Promise(r => setTimeout(r, 100)); // small delay between batches
        }
        return hitters.sort((a, b) => b.seasonHR - a.seasonHR).slice(0, 7);
      } catch { return []; }
    }

    // ── Step 4: Pull last 3 days real HR leaders ──────────────────────────
    const recentHRCounts = {};
    for (let i = 1; i <= 3; i++) {
      const date = getCTDate(-i);
      try {
        const sched = await mlb(`/schedule?sportId=1&date=${date}`);
        const dayGames = sched.dates?.[0]?.games || [];
        for (const g of dayGames) {
          try {
            const pbp = await mlb(`/game/${g.gamePk}/playByPlay`);
            for (const p of pbp.allPlays || []) {
              if (p.result?.eventType === "home_run") {
                const name = p.matchup?.batter?.fullName;
                recentHRCounts[name] = (recentHRCounts[name] || 0) + 1;
              }
            }
          } catch {}
        }
      } catch {}
    }
    const recentHRLeaders = Object.entries(recentHRCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => `${name}(${count}HR)`)
      .join(", ");
    console.log("[plays] recent HR leaders:", recentHRLeaders.slice(0, 150));

    // ── Step 5: Build game contexts with all real data ────────────────────
    const gameContexts = [];
    for (const g of games) {
      const awayAbb = g.teams?.away?.team?.abbreviation || "?";
      const homeAbb = g.teams?.home?.team?.abbreviation || "?";
      const venue   = g.venue?.name || "?";
      const parkF   = PARK_FACTORS[venue]?.factor || 100;
      const awayPP  = g.teams?.away?.probablePitcher;
      const homePP  = g.teams?.home?.probablePitcher;

      const [awayPitcher, homePitcher, awayHitters, homeHitters] = await Promise.all([
        getRealPitcherData(awayPP),
        getRealPitcherData(homePP),
        g.teams?.away?.team?.id ? getTeamHitters(g.teams.away.team.id) : [],
        g.teams?.home?.team?.id ? getTeamHitters(g.teams.home.team.id) : [],
      ]);

      const fmtPitcher = (pp, stats) => {
        if (!pp && !stats) return "TBD";
        const name = stats?.name || pp?.fullName || "TBD";
        if (!stats) return name;
        return `${name}(${stats.hand}) ERA:${stats.era} HR/9:${stats.hr9} WHIP:${stats.whip} vsLHB:[${stats.vsLHB}] vsRHB:[${stats.vsRHB}]`;
      };

      const fmtHitter = (h) =>
        `${h.name}(${h.bats}) ${h.seasonHR}HR .${(h.avg||"000").replace(".","").slice(0,3)}AVG ${h.ops}OPS ISO${h.iso} L7:${h.last7HR}HR vsL:${h.vsLHP_HR}HR vsR:${h.vsRHP_HR}HR`;

      const awayHitterStr = awayHitters.map(fmtHitter).join(" | ");
      const homeHitterStr = homeHitters.map(fmtHitter).join(" | ");

      gameContexts.push(
        `${awayAbb}@${homeAbb} at ${venue}(park ${parkF})
` +
        `  Away SP: ${fmtPitcher(awayPP, awayPitcher)}
` +
        `  Home SP: ${fmtPitcher(homePP, homePitcher)}
` +
        `  ${awayAbb} hitters: ${awayHitterStr || "none"}
` +
        `  ${homeAbb} hitters: ${homeHitterStr || "none"}`
      );
    }

    // ── Step 6: Build prompt with all real data ───────────────────────────
    const alreadyHit = todayHRs.length
      ? `EXCLUDE — already hit HR today: ${todayHRs.map(h => h.player).join(", ")}`
      : "";

    const gamesStr = gameContexts.join("

");
    console.log("[plays] all data pulled. Games:", games.length, "Hitters cached:", Object.keys(hitterCache).length, "Pitchers cached:", Object.keys(pitcherCache).length);

    const result = await callClaude(
      `Today ${today}. All data below is REAL — from MLB Stats API pulled today. Do NOT use your training data for player stats. Only use the numbers provided.

REAL GAME DATA (pitcher ERA/HR9/splits + hitter HR/AVG/OPS/ISO/last7HR/vsL/vsR):
${gamesStr}

HOTTEST BATS last 3 days (real play-by-play):
${recentHRLeaders || "unavailable"}

${alreadyHit}

PICK the best HR props using ONLY the real data above:
- HIGH: player with 3+ last7HR OR top recent HR list + faces pitcher with HR/9 > 1.3 + park >= 95. Must be playing today.
- MED: 1-2 last7HR + favorable pitcher splits for their handedness + decent park
- WATCH: low recent HR but matchup is good, flag the concern honestly
- Do NOT include players not listed in today's games above
- Do NOT use any stats not provided above
- ${alreadyHit ? "Do NOT include players who already hit today" : ""}

Return JSON only — no markdown, start with {:
{"plays":[{"player":string,"team":string,"opponent":string,"pitcher":string,"pitcherHand":"L" or "R","last7HRs":number,"parkFactor":number,"confidence":"HIGH" or "MED" or "WATCH","hotStreak":boolean,"note":string,"concern":string}]}`
    );

    if (result?.plays) {
      playsCache = { date: today, data: result, hrCount: todayHRs.length, generating: false };
      console.log("[plays] generated", result.plays.length, "plays. Hitters pulled:", Object.keys(hitterCache).length);
    }
    return result;

  } catch(e) {
    console.error("[plays] error:", e.message);
    playsCache.generating = false;
    throw e;
  }
}


app.get("/api/ai/plays-cached", async (req, res) => {
  const today = getCTDate(0); // always use CT date
  const currentHRCount = liveHRs.length;

  // If cache is from a different day, clear it
  if (playsCache.date && playsCache.date !== today) {
    console.log("[plays] new day detected, clearing cache. was:", playsCache.date, "now:", today);
    playsCache = { date: null, data: null, hrCount: 0, generating: false };
    seenHRs.clear();
    liveHRs = [];
    isFirstPoll = true;
  }

  // Serve cache if fresh and HR count unchanged
  if (playsCache.date === today && playsCache.data && playsCache.hrCount === currentHRCount) {
    return res.json(playsCache.data);
  }

  // If already generating, return stale cache or pending status
  if (playsCache.generating) {
    if (playsCache.data) return res.json(playsCache.data);
    return res.json({ plays: [], generating: true });
  }

  // Trigger background generation — respond immediately
  if (playsCache.data) {
    // Return stale data right away, regenerate in background
    generatePlays(today, liveHRs).catch(e => console.error("[plays bg]", e.message));
    return res.json(playsCache.data);
  }

  // No cache at all — wait for first generation (but with timeout)
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 25000));
    const result = await Promise.race([generatePlays(today, liveHRs), timeout]);
    res.json(result || { plays: [] });
  } catch(e) {
    console.error("[plays] first-gen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dingers backend running on port ${PORT}`);
  setTimeout(() => {
    poll();
    setInterval(poll, POLL_INTERVAL);
  }, 3000);
});

// ── AI proxy routes (keeps Anthropic key server-side) ──────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(prompt) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: "You are an MLB analytics expert. Respond with ONLY a raw JSON object. No markdown fences, no ```json, no explanation, no preamble. Start with { end with }. Nothing else.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  console.log("[claude raw]", text.slice(0, 200));
  // Strip any markdown or prose before/after JSON
  text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  // Remove any text before the first {
  const firstBrace = text.indexOf("{");
  if (firstBrace > 0) text = text.slice(firstBrace);
  text = text.trim();
  // Find outermost { }
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object in response");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch(parseErr) {
          // Try to find next closing brace
          console.error("[JSON parse attempt failed]", parseErr.message);
        }
      }
    }
  }
  // Last resort: try parsing the whole cleaned text
  try { return JSON.parse(text); } catch {}
  throw new Error("Malformed JSON: " + text.slice(0, 100));
}

app.post("/api/ai/plays", async (req, res) => {
  try {
    const gamesList = req.body?.gamesList || "today's MLB games";
    const today = req.body?.today || new Date().toDateString();
    console.log("[ai/plays] gamesList:", gamesList, "today:", today);
    const result = await callClaude(
      `Today is ${today}. Based on current MLB 2026 season data, identify the top 5 players most likely to hit a home run today considering matchups, recent form, and park factors. Games today include: ${gamesList}.
      Return JSON: { "plays": [ { "player": string, "playerId": null, "team": string, "opponent": string, "pitcher": string, "pitcherHand": "L", "last7HRs": number, "parkFactor": number, "confidence": "HIGH", "hotStreak": false, "note": string } ] }`
    );
    res.json(result);
  } catch(e) {
    console.error("[ai/plays error]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ai/player-analysis", async (req, res) => {
  try {
    const { playerName, stats, info } = req.body;
    const s = stats?.season || {};
    const l14 = stats?.last14 || {};
    const vsL = stats?.vsLeft || {};
    const vsR = stats?.vsRight || {};
    const home = stats?.home || {};
    const away = stats?.away || {};
    const iso = s.slugging && s.avg
      ? (parseFloat(s.slugging) - parseFloat(s.avg)).toFixed(3)
      : null;

    const lines = [
      `Player: ${playerName}`,
      `Team: ${info?.currentTeam?.name || "?"}`,
      `Bats: ${info?.batSide?.description || "?"}`,
      `Position: ${info?.primaryPosition?.abbreviation || "?"}`,
      `2026 season: ${s.homeRuns ?? "0"}HR, .${(s.avg||"000").replace(".", "")} AVG, ${s.ops || "?"}OPS, ${s.gamesPlayed || "?"}G`,
      iso ? `ISO: ${iso}` : null,
      `Last 14 days: ${l14.homeRuns ?? "0"}HR, ${l14.ops || "?"}OPS`,
      `vs LHP: ${vsL.homeRuns ?? "0"}HR, ${vsL.avg || "?"}AVG in ${vsL.gamesPlayed || "?"}G`,
      `vs RHP: ${vsR.homeRuns ?? "0"}HR, ${vsR.avg || "?"}AVG in ${vsR.gamesPlayed || "?"}G`,
      `Home: ${home.homeRuns ?? "0"}HR | Away: ${away.homeRuns ?? "0"}HR`,
    ].filter(Boolean).join("\n");

    console.log("[player-analysis] stats for", playerName, "season HR:", stats?.season?.homeRuns, "avg:", stats?.season?.avg, "ops:", stats?.season?.ops);

    const result = await callClaude(
      `You are analyzing ${playerName} for an HR prop bet today. Use the stats below — even if some are zero or limited, give a real analysis based on what IS available. Do not say "insufficient data." If stats are low, explain what they suggest and what to watch for.

Stats:
${lines}

Return JSON: {"summary":string,"strengths":[string],"watchouts":[string],"confidence":"HIGH" or "MED" or "WATCH"}

- summary: 2-3 sentences on HR likelihood today
- strengths: 1-3 specific reasons to like them
- watchouts: 1-2 honest concerns
- confidence based on available evidence`
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
