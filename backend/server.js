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
let   lineupCache = { date: null, data: null, fetchedAt: 0 }; // 5 min TTL

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

// ── Lineup fetching ────────────────────────────────────────────────────────
// Returns { "Player Name": { battingOrder, status, teamAbb, gamePk } }
// status: 'posted' | 'pending' | 'scratched'
async function fetchLineups() {
  const today = todayStr();
  const now = Date.now();
  // 5min cache, but bust if day changed
  if (lineupCache.date === today && lineupCache.data && (now - lineupCache.fetchedAt) < 300_000) {
    return lineupCache.data;
  }

  try {
    const data = await mlb(`/schedule?sportId=1&date=${today}&hydrate=lineups,probablePitcher`);
    const games = data.dates?.[0]?.games || [];
    const lineups = {};
    const allPlayersByTeam = {}; // teamAbb -> Set of names in lineup

    for (const g of games) {
      const homeAbb = g.teams?.home?.team?.abbreviation;
      const awayAbb = g.teams?.away?.team?.abbreviation;
      const gamePk = g.gamePk;
      const homeBatters = g.lineups?.homePlayers || [];
      const awayBatters = g.lineups?.awayPlayers || [];

      const processList = (batters, teamAbb) => {
        if (!batters.length) return; // not posted
        if (!allPlayersByTeam[teamAbb]) allPlayersByTeam[teamAbb] = new Set();
        batters.forEach((p, i) => {
          const name = p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim();
          if (!name) return;
          lineups[name] = {
            battingOrder: i + 1,
            status: "posted",
            teamAbb,
            gamePk,
            playerId: p.id,
          };
          allPlayersByTeam[teamAbb].add(name);
        });
      };

      processList(homeBatters, homeAbb);
      processList(awayBatters, awayAbb);
    }

    lineupCache = { date: today, data: { lineups, postedTeams: Object.keys(allPlayersByTeam), allPlayersByTeam }, fetchedAt: now };
    return lineupCache.data;
  } catch (e) {
    console.error("[lineups]", e.message);
    return lineupCache.data || { lineups: {}, postedTeams: [], allPlayersByTeam: {} };
  }
}

// Enrich plays with lineup status + adjust confidence
function enrichPlaysWithLineups(plays, lineupData) {
  if (!plays || !lineupData) return plays;
  const { lineups, postedTeams, allPlayersByTeam } = lineupData;

  return plays.map(p => {
    const lookup = lineups[p.player];
    let lineup;

    if (lookup) {
      lineup = { battingOrder: lookup.battingOrder, status: "posted" };
    } else if (postedTeams.includes(p.team)) {
      // Team posted lineup but player not in it = scratched
      lineup = { battingOrder: null, status: "scratched" };
    } else {
      lineup = { battingOrder: null, status: "pending" };
    }

    // Adjust confidence
    let confidence = p.confidence;
    let edgeAdj = null;
    if (lineup.status === "scratched") {
      confidence = "VOID";
      edgeAdj = "Scratched from lineup";
    } else if (lineup.status === "posted") {
      const bo = lineup.battingOrder;
      if (bo <= 3) {
        edgeAdj = `Batting ${bo} — premium PA count`;
        if (confidence === "WATCH") confidence = "MED";
        else if (confidence === "MED") confidence = "HIGH";
      } else if (bo >= 8) {
        edgeAdj = `Batting ${bo} — limited PAs`;
        if (confidence === "HIGH") confidence = "MED";
        else if (confidence === "MED") confidence = "WATCH";
      } else if (bo >= 6) {
        edgeAdj = `Batting ${bo} — moderate PAs`;
      } else {
        edgeAdj = `Batting ${bo}`;
      }
    }

    return { ...p, lineup, confidence, lineupNote: edgeAdj };
  });
}

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
  const last14Stat = extract(last14);
  console.log("[getPlayerStats]", playerId, "season HR:", seasonStat?.homeRuns, "avg:", seasonStat?.avg, "last14 HR:", last14Stat?.homeRuns);

  return {
    season:  seasonStat,
    last14:  last14Stat,
    last7:   last14Stat, // 14-day proxy — lastXGames/7 is often empty
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
  const todayCT = getCTDate(0); // e.g. "2026-05-21"
  const todayHRs = liveHRs.filter(hr => {
    if (!hr.timestamp) return false;
    // Convert UTC timestamp to CT date string for comparison
    const d = new Date(hr.timestamp);
    const ctStr = d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
    return ctStr === todayCT;
  });
  res.json({ hrs: todayHRs, lastPoll, count: todayHRs.length });
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

// ── Player matchup for today ──────────────────────────────────────────────
// Returns today's specific matchup context for a player:
// their game, opposing pitcher with real splits, park factor,
// and any HRs they've already hit today
app.get("/api/player-matchup/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const today = getCTDate(0);
    const year = new Date().getFullYear();

    // Step 1: Find today's game for this player
    const schedData = await mlb(`/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,roster`);
    const games = schedData.dates?.[0]?.games || [];

    // Get player info to find their team
    const personData = await mlb(`/people/${playerId}`);
    const person = personData.people?.[0];
    const teamId = person?.currentTeam?.id;
    const bats = person?.batSide?.code || "?";
    const fullName = person?.fullName || "";

    if (!teamId) return res.json({ playing: false });

    // Find the game where this player's team is playing today
    const game = games.find(g =>
      g.teams?.away?.team?.id === teamId ||
      g.teams?.home?.team?.id === teamId
    );

    if (!game) return res.json({ playing: false, reason: "No game today" });

    // Step 2: Identify opposing pitcher
    const isHome = game.teams?.home?.team?.id === teamId;
    const oppPP = isHome
      ? game.teams?.away?.probablePitcher   // home team faces away pitcher
      : game.teams?.home?.probablePitcher;  // away team faces home pitcher
    const myTeamAbb  = isHome ? game.teams?.home?.team?.abbreviation : game.teams?.away?.team?.abbreviation;
    const oppTeamAbb = isHome ? game.teams?.away?.team?.abbreviation : game.teams?.home?.team?.abbreviation;
    const venue = game.venue?.name || "?";
    const parkFactor = PARK_FACTORS[venue]?.factor || 100;
    const gameTime = game.gameDate;
    const status = game.status?.detailedState || "Scheduled";

    // Step 3: Fetch real pitcher splits
    let pitcherData = null;
    if (oppPP?.id) {
      const [pitcherInfo, seasonStats, vsL, vsR] = await Promise.allSettled([
        mlb(`/people/${oppPP.id}`),
        mlb(`/people/${oppPP.id}/stats?stats=season&group=pitching&season=${year}`),
        mlb(`/people/${oppPP.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vl`),
        mlb(`/people/${oppPP.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vr`),
      ]);
      const s  = seasonStats.status === "fulfilled" ? seasonStats.value?.stats?.[0]?.splits?.[0]?.stat : null;
      const sl = vsL.status === "fulfilled" ? vsL.value?.stats?.[0]?.splits?.[0]?.stat : null;
      const sr = vsR.status === "fulfilled" ? vsR.value?.stats?.[0]?.splits?.[0]?.stat : null;
      const hand = pitcherInfo.status === "fulfilled" ? pitcherInfo.value?.people?.[0]?.pitchHand?.code : "?";

      // The relevant split is based on the batter's handedness
      // A left-handed batter (L) faces the pitcher's "vs LHB" split
      const relevantSplit = bats === "L" ? sl : bats === "R" ? sr : null;

      pitcherData = {
        id: oppPP.id,
        name: oppPP.fullName,
        hand,
        era:   s?.era    || "?",
        whip:  s?.whip   || "?",
        hr9:   s?.homeRunsPer9 ? parseFloat(s.homeRunsPer9).toFixed(2) : "?",
        // Season-level splits
        vsLHB_hr9: sl?.homeRunsPer9 ? parseFloat(sl.homeRunsPer9).toFixed(2) : "?",
        vsRHB_hr9: sr?.homeRunsPer9 ? parseFloat(sr.homeRunsPer9).toFixed(2) : "?",
        vsLHB_avg: sl?.avg || "?",
        vsRHB_avg: sr?.avg || "?",
        // The split that actually applies to this batter
        relevantHr9:  relevantSplit?.homeRunsPer9 ? parseFloat(relevantSplit.homeRunsPer9).toFixed(2) : s?.homeRunsPer9 ? parseFloat(s.homeRunsPer9).toFixed(2) : "?",
        relevantAvg:  relevantSplit?.avg || s?.avg || "?",
      };
    }

    // Step 4: Get hitter's own stats for matchup context
    const [hitterSeason, hitterSaber, vsL, vsR] = await Promise.allSettled([
      mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
      mlb(`/people/${playerId}/stats?stats=sabermetrics&group=hitting&season=${year}`),
      mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
      mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
    ]);
    const hs  = hitterSeason.status === "fulfilled" ? hitterSeason.value?.stats?.[0]?.splits?.[0]?.stat : null;
    const sab = hitterSaber.status  === "fulfilled" ? hitterSaber.value?.stats?.[0]?.splits?.[0]?.stat  : null;
    const hsl = vsL.status === "fulfilled" ? vsL.value?.stats?.[0]?.splits?.[0]?.stat : null;
    const hsr = vsR.status === "fulfilled" ? vsR.value?.stats?.[0]?.splits?.[0]?.stat : null;

    // Pick the relevant hitting split based on pitcher handedness
    const pitcherHand = pitcherData?.hand || "R";
    const relevantHittingSplit = pitcherHand === "L" ? hsl : hsr;

    const abPerHR = hs?.atBatsPerHomeRun ? parseFloat(hs.atBatsPerHomeRun).toFixed(1) : "?";
    const woba    = sab?.woba ? parseFloat(sab.woba).toFixed(3) : "?";
    const iso     = hs?.slugging && hs?.avg ? (parseFloat(hs.slugging) - parseFloat(hs.avg)).toFixed(3) : "?";

    // Step 5: Check if this player has already hit a HR today
    const todayHRs_forPlayer = liveHRs.filter(hr =>
      hr.player?.toLowerCase().includes(fullName.split(" ")[1]?.toLowerCase() || "")
    );

    // Step 6: Build edge assessment
    const edgeFactors = [];
    const concerns = [];
    const abHR = parseFloat(abPerHR) || 999;
    const wobaNum = parseFloat(woba) || 0;
    const hr9Num = parseFloat(pitcherData?.relevantHr9) || 0;

    if (abHR < 15) edgeFactors.push(`Elite power rate (AB/HR ${abPerHR})`);
    else if (abHR < 20) edgeFactors.push(`Strong power rate (AB/HR ${abPerHR})`);
    else concerns.push(`Moderate power rate (AB/HR ${abPerHR})`);

    if (wobaNum > .370) edgeFactors.push(`High contact quality (wOBA ${woba})`);
    else if (wobaNum > .330) edgeFactors.push(`Solid contact quality (wOBA ${woba})`);
    else if (wobaNum > .290) concerns.push(`Below-avg wOBA (${woba})`);

    if (hr9Num > 1.5) edgeFactors.push(`Pitcher very vulnerable (HR/9 ${pitcherData?.relevantHr9} vs ${bats}HB)`);
    else if (hr9Num > 1.3) edgeFactors.push(`Pitcher vulnerable (HR/9 ${pitcherData?.relevantHr9} vs ${bats}HB)`);
    else if (hr9Num > 0) concerns.push(`Pitcher HR/9 only ${pitcherData?.relevantHr9} vs ${bats}HB`);

    if (parkFactor > 108) edgeFactors.push(`Hitter-friendly park (factor ${parkFactor})`);
    else if (parkFactor < 93) concerns.push(`Pitcher-friendly park (factor ${parkFactor})`);

    const splitHR = pitcherHand === "L" ? (hsl?.homeRuns || 0) : (hsr?.homeRuns || 0);
    if (splitHR > 5) edgeFactors.push(`${splitHR} HR vs ${pitcherHand}HP this season`);

    const overallEdge = edgeFactors.length >= 3 ? "HIGH"
      : edgeFactors.length >= 2 ? "MED"
      : concerns.length > edgeFactors.length ? "WEAK"
      : "MED";

    res.json({
      playing: true,
      player: { id: playerId, name: fullName, bats },
      game: {
        gamePk: game.gamePk,
        myTeam: myTeamAbb,
        opponent: oppTeamAbb,
        venue,
        parkFactor,
        gameTime,
        status,
        isHome,
      },
      pitcher: pitcherData,
      hitterContext: {
        abPerHR,
        woba,
        iso,
        ops: hs?.ops || "?",
        seasonHR: hs?.homeRuns || 0,
        vsLHP_HR: hsl?.homeRuns || 0,
        vsRHP_HR: hsr?.homeRuns || 0,
        relevantSplitHR: splitHR,
        relevantSplitAvg: relevantHittingSplit?.avg || "?",
        relevantSplitOPS: relevantHittingSplit?.ops || "?",
      },
      edge: { overall: overallEdge, factors: edgeFactors, concerns },
      todayHRs: todayHRs_forPlayer,
    });

  } catch(e) {
    console.error("[player-matchup]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Player full profile — streak + matchup + history ─────────────────────
app.get("/api/player-profile/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const today = getCTDate(0);
    const year = new Date().getFullYear();

    // Fetch in parallel: person info, season stats, sabermetrics, game log, splits
    const [personRes, seasonRes, saberRes, gameLogRes, vsLRes, vsRRes, homeAwayRes] = await Promise.allSettled([
      mlb(`/people/${playerId}`),
      mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
      mlb(`/people/${playerId}/stats?stats=sabermetrics&group=hitting&season=${year}`),
      mlb(`/people/${playerId}/stats?stats=gameLog&group=hitting&season=${year}&gameType=R`),
      mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
      mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
      mlb(`/people/${playerId}/stats?stats=homeAndAway&group=hitting&season=${year}`),
    ]);

    const person  = personRes.status  === "fulfilled" ? personRes.value?.people?.[0]  : null;
    const season  = seasonRes.status  === "fulfilled" ? seasonRes.value?.stats?.[0]?.splits?.[0]?.stat : null;
    const saber   = saberRes.status   === "fulfilled" ? saberRes.value?.stats?.[0]?.splits?.[0]?.stat  : null;
    const games   = gameLogRes.status === "fulfilled" ? gameLogRes.value?.stats?.[0]?.splits || [] : [];
    const vsL     = vsLRes.status     === "fulfilled" ? vsLRes.value?.stats?.[0]?.splits?.[0]?.stat    : null;
    const vsR     = vsRRes.status     === "fulfilled" ? vsRRes.value?.stats?.[0]?.splits?.[0]?.stat    : null;
    const haRes   = homeAwayRes.status === "fulfilled" ? homeAwayRes.value?.stats?.[0]?.splits || [] : [];

    const homeStat = haRes.find(s => s.split?.code === "H")?.stat || null;
    const awayStat = haRes.find(s => s.split?.code === "A")?.stat || null;

    // Build last 30 days activity from game log
    const todayDate = new Date(today + "T12:00:00");
    const last30 = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const game = games.find(g => g.date === dateStr);
      last30.push({
        date: dateStr,
        played: !!game,
        hrs: game ? parseInt(game.stat?.homeRuns || 0) : 0,
        ab:  game ? parseInt(game.stat?.atBats   || 0) : 0,
      });
    }

    // Streak analysis
    const hrGames = last30.filter(d => d.hrs > 0);
    const daysSinceLastHR = last30.findIndex(d => d.hrs > 0); // -1 if none in 30 days
    const last7HRs  = last30.slice(0, 7).reduce((s, d) => s + d.hrs, 0);
    const last14HRs = last30.slice(0, 14).reduce((s, d) => s + d.hrs, 0);
    const last30HRs = last30.reduce((s, d) => s + d.hrs, 0);

    // Season HR rate
    const seasonHR = parseInt(season?.homeRuns || 0);
    const gamesPlayed = parseInt(season?.gamesPlayed || 1);
    const seasonHRper7 = ((seasonHR / gamesPlayed) * 7).toFixed(2);

    // Hot/cold classification
    let streak = "NEUTRAL";
    if (last7HRs > parseFloat(seasonHRper7) * 1.5) streak = "HOT";
    else if (last7HRs === 0 && daysSinceLastHR > 7) streak = "COLD";
    else if (last7HRs >= 2) streak = "WARM";

    // Find today's game + pitcher
    const schedData = await mlb(`/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,venue,weather`);
    const schedGames = schedData.dates?.[0]?.games || [];
    const teamId = person?.currentTeam?.id;
    const bats = person?.batSide?.code || "?";

    const todayGame = schedGames.find(g =>
      g.teams?.away?.team?.id === teamId ||
      g.teams?.home?.team?.id === teamId
    );

    let matchup = null;
    if (todayGame) {
      const isHome = todayGame.teams?.home?.team?.id === teamId;
      const oppPP = isHome ? todayGame.teams?.away?.probablePitcher : todayGame.teams?.home?.probablePitcher;
      const venue = todayGame.venue?.name || "?";
      const park = PARK_FACTORS[venue]?.factor || 100;
      const weather = todayGame.weather || {};

      let pitcher = null;
      if (oppPP?.id) {
        const [pInfo, pSeason, pVsL, pVsR] = await Promise.allSettled([
          mlb(`/people/${oppPP.id}`),
          mlb(`/people/${oppPP.id}/stats?stats=season&group=pitching&season=${year}`),
          mlb(`/people/${oppPP.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vl`),
          mlb(`/people/${oppPP.id}/stats?stats=statSplits&group=pitching&season=${year}&sitCodes=vr`),
        ]);
        const ps  = pSeason.status === "fulfilled" ? pSeason.value?.stats?.[0]?.splits?.[0]?.stat : null;
        const psl = pVsL.status   === "fulfilled" ? pVsL.value?.stats?.[0]?.splits?.[0]?.stat   : null;
        const psr = pVsR.status   === "fulfilled" ? pVsR.value?.stats?.[0]?.splits?.[0]?.stat   : null;
        const hand = pInfo.status === "fulfilled" ? pInfo.value?.people?.[0]?.pitchHand?.code : "?";
        const relevantSplit = bats === "L" ? psl : psr;
        pitcher = {
          id: oppPP.id, name: oppPP.fullName, hand,
          era:  ps?.era  || "?",
          hr9:  ps?.homeRunsPer9  ? parseFloat(ps.homeRunsPer9).toFixed(2)  : "?",
          whip: ps?.whip || "?",
          relevantHr9: relevantSplit?.homeRunsPer9
            ? parseFloat(relevantSplit.homeRunsPer9).toFixed(2)
            : ps?.homeRunsPer9 ? parseFloat(ps.homeRunsPer9).toFixed(2) : "?",
          relevantAvg: relevantSplit?.avg || ps?.avg || "?",
        };
      }

      // Edge score
      const abHR    = parseFloat(season?.atBatsPerHomeRun) || 999;
      const wobaNum = parseFloat(saber?.woba) || 0;
      const hr9Num  = parseFloat(pitcher?.relevantHr9) || 0;
      const factors = [];
      const concerns = [];
      if (abHR < 15)    factors.push(`Elite power rate (AB/HR ${abHR.toFixed(1)})`);
      else if (abHR < 20) factors.push(`Strong power rate (AB/HR ${abHR.toFixed(1)})`);
      else               concerns.push(`Moderate power rate (AB/HR ${abHR.toFixed(1)})`);
      if (wobaNum > .370) factors.push(`Elite contact quality (wOBA ${saber?.woba?.slice(1)})`);
      else if (wobaNum > .330) factors.push(`Solid contact quality (wOBA ${saber?.woba?.slice(1)})`);
      if (hr9Num > 1.5)  factors.push(`Pitcher very hittable (HR/9 ${pitcher?.relevantHr9} vs ${bats}HB)`);
      else if (hr9Num > 1.3) factors.push(`Pitcher vulnerable (HR/9 ${pitcher?.relevantHr9} vs ${bats}HB)`);
      else if (hr9Num > 0)   concerns.push(`Pitcher HR/9 ${pitcher?.relevantHr9} vs ${bats}HB — below threshold`);
      if (park > 108)   factors.push(`Hitter-friendly park (factor ${park})`);
      else if (park < 93) concerns.push(`Pitcher-friendly park (factor ${park})`);
      if (streak === "HOT" || streak === "WARM") factors.push(`${last7HRs} HR in last 7 days — hot streak`);
      else if (streak === "COLD") concerns.push(`${daysSinceLastHR} days since last HR`);

      const edge = factors.length >= 3 ? "HIGH" : factors.length >= 2 ? "MED" : concerns.length > factors.length ? "WEAK" : "MED";

      matchup = {
        gamePk: todayGame.gamePk,
        myTeam: isHome ? todayGame.teams?.home?.team?.abbreviation : todayGame.teams?.away?.team?.abbreviation,
        opponent: isHome ? todayGame.teams?.away?.team?.abbreviation : todayGame.teams?.home?.team?.abbreviation,
        isHome, venue, park,
        gameTime: todayGame.gameDate,
        status: todayGame.status?.detailedState,
        weather: { temp: weather.temp, wind: weather.wind, condition: weather.condition },
        pitcher,
        edge, factors, concerns,
      };
    }

    // Build HR game history for calendar
    const hrGameLog = games
      .filter(g => parseInt(g.stat?.homeRuns || 0) > 0)
      .map(g => ({
        date: g.date,
        opponent: g.opponent?.abbreviation || "?",
        isHome: g.isHome,
        hrs: parseInt(g.stat?.homeRuns || 0),
        ab:  parseInt(g.stat?.atBats   || 0),
        rbi: parseInt(g.stat?.rbi      || 0),
        ops: g.stat?.ops || "?",
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      info: {
        id: playerId,
        name: person?.fullName,
        team: person?.currentTeam?.name,
        teamAbb: person?.currentTeam?.abbreviation,
        position: person?.primaryPosition?.abbreviation,
        bats,
        jerseyNumber: person?.primaryNumber,
      },
      season: {
        hr: seasonHR,
        avg: season?.avg,
        ops: season?.ops,
        slg: season?.slg,
        obp: season?.obp,
        woba: saber?.woba,
        abPerHR: season?.atBatsPerHomeRun,
        gamesPlayed,
        iso: season?.slugging && season?.avg
          ? (parseFloat(season.slugging) - parseFloat(season.avg)).toFixed(3) : null,
      },
      splits: {
        vsLHP: { hr: vsL?.homeRuns, avg: vsL?.avg, ops: vsL?.ops, ab: vsL?.atBats },
        vsRHP: { hr: vsR?.homeRuns, avg: vsR?.avg, ops: vsR?.ops, ab: vsR?.atBats },
        home:  { hr: homeStat?.homeRuns, avg: homeStat?.avg, ops: homeStat?.ops },
        away:  { hr: awayStat?.homeRuns, avg: awayStat?.avg, ops: awayStat?.ops },
      },
      streak: {
        status: streak,
        daysSinceLastHR,
        last7HRs, last14HRs, last30HRs,
        seasonHRper7: parseFloat(seasonHRper7),
        last30days: last30,
      },
      matchup,
      hrHistory: hrGameLog.slice(0, 40),
      todayHRs: liveHRs.filter(hr =>
        hr.player?.toLowerCase().includes((person?.fullName?.split(" ")[1] || "").toLowerCase())
      ),
    });

  } catch(e) {
    console.error("[player-profile]", e.message);
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

// ── Test Baseball Savant access ───────────────────────────────────────────
// ── Slate environment classification ─────────────────────────────────────
let envCache = { date: null, data: null };

app.get("/api/environment", async (req, res) => {
  const today = getCTDate(0);
  if (envCache.date === today && envCache.data) return res.json(envCache.data);
  try {
    const schedData = await mlb(`/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,venue,weather`);
    const games = schedData.dates?.[0]?.games || [];
    const parkFs = games.map(g => PARK_FACTORS[g.venue?.name]?.factor || 100);
    const avgPark = Math.round(parkFs.reduce((a,b)=>a+b,0)/(parkFs.length||1));
    const hotParks = parkFs.filter(f=>f>108).length;
    const coldParks = parkFs.filter(f=>f<93).length;
    let windOutCount=0, coldCount=0, hotCount=0;
    for (const g of games) {
      const w = g.weather || {};
      const wind = w.wind || "";
      const speed = parseInt(wind) || 0;
      if (wind.toLowerCase().includes("out") && speed > 8) windOutCount++;
      const temp = parseInt(w.temp) || 70;
      if (temp < 55) coldCount++;
      if (temp > 78) hotCount++;
    }
    let fatiguedTeams = 0;
    for (const g of games.slice(0,6)) {
      const [af, hf] = await Promise.all([
        g.teams?.away?.team?.id ? getBullpenFatigue(g.teams.away.team.id) : null,
        g.teams?.home?.team?.id ? getBullpenFatigue(g.teams.home.team.id) : null,
      ]);
      if (af?.fatigued) fatiguedTeams++;
      if (hf?.fatigued) fatiguedTeams++;
    }
    let type="Standard Night", confidence=55, reasons=[], archetypesFavored=["Elite Barrel Bat"];
    if (windOutCount>=3 && hotParks>=3) {
      type="Airborne Damage Night"; confidence=78;
      reasons=[`Wind blowing out in ${windOutCount} parks`,`${hotParks} hitter-friendly parks`];
      archetypesFavored=["Elite Barrel Bat","Pull-Side Power","Hot Streak Hitter"];
    } else if (fatiguedTeams>=4) {
      type="Bullpen Collapse Environment"; confidence=72;
      reasons=[`${fatiguedTeams} fatigued bullpens`,`Relief pitchers vulnerable late`];
      archetypesFavored=["Hot Streak Hitter","Platoon Specialist","Solid Contact Bat"];
    } else if (coldCount>=4 || (coldCount>=3 && windOutCount===0)) {
      type="Suppressed Carry Night"; confidence=70;
      reasons=[`${coldCount} cold-weather games`,`Ball carries less in cold air`];
      archetypesFavored=["Elite Barrel Bat"];
    } else if (hotParks>=4 && hotCount>=3) {
      type="Fly-Ball Paradise"; confidence=74;
      reasons=[`${hotParks} hitter-friendly parks`,`Warm temps in ${hotCount} cities`];
      archetypesFavored=["Elite Barrel Bat","Pull-Side Power","Hot Streak Hitter"];
    } else if (windOutCount>=2 && avgPark>102) {
      type="Elevated Carry Slate"; confidence=65;
      reasons=[`Wind out in ${windOutCount} parks`,`Above-avg park slate (factor ${avgPark})`];
      archetypesFavored=["Elite Barrel Bat","Hot Streak Hitter"];
    } else {
      reasons=["Mixed conditions","No dominant environmental signal"];
    }
    const result = { type, confidence, reasons, archetypesFavored, stats:{ avgParkFactor:avgPark, hotParks, coldParks, windOutCount, fatiguedTeams, coldCount }, games:games.length };
    envCache = { date: today, data: result };
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
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
          hr9:       s?.homeRunsPer9 ? parseFloat(s.homeRunsPer9).toFixed(2) : "?",
          vsLHB_hr9: sl?.homeRunsPer9 ? parseFloat(sl.homeRunsPer9).toFixed(2) : "?",
          vsRHB_hr9: sr?.homeRunsPer9 ? parseFloat(sr.homeRunsPer9).toFixed(2) : "?",
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
        const [info, season, last14, vsL, vsR, saber] = await Promise.allSettled([
          mlb(`/people/${playerId}`),
          mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
          mlb(`/people/${playerId}/stats?stats=lastXGames&group=hitting&season=${year}&limit=14`),
          mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
          mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
          mlb(`/people/${playerId}/stats?stats=sabermetrics&group=hitting&season=${year}`),
        ]);
        const s    = season.status  === "fulfilled" ? season.value?.stats?.[0]?.splits?.[0]?.stat  : null;
        const l14  = last14.status  === "fulfilled" ? last14.value?.stats?.[0]?.splits?.[0]?.stat  : null;
        const sl   = vsL.status     === "fulfilled" ? vsL.value?.stats?.[0]?.splits?.[0]?.stat     : null;
        const sr   = vsR.status     === "fulfilled" ? vsR.value?.stats?.[0]?.splits?.[0]?.stat     : null;
        const sab  = saber.status   === "fulfilled" ? saber.value?.stats?.[0]?.splits?.[0]?.stat   : null;
        const bats = info.status    === "fulfilled" ? info.value?.people?.[0]?.batSide?.code : "?";
        const seasonHR = parseInt(s?.homeRuns || 0);
        if (seasonHR < 1) return null;
        const iso = s?.slugging && s?.avg
          ? (parseFloat(s.slugging) - parseFloat(s.avg)).toFixed(3) : "?";
        const abPerHR = s?.atBatsPerHomeRun ? parseFloat(s.atBatsPerHomeRun).toFixed(1) : "?";
        const result = {
          name, playerId, bats, seasonHR,
          avg:      s?.avg    || "?",
          ops:      s?.ops    || "?",
          slg:      s?.slg    || "?",
          iso,
          abPerHR,                                    // AB per HR — true power rate
          woba:     sab?.woba ? parseFloat(sab.woba).toFixed(3) : "?",  // quality metric
          last14HR: parseInt(l14?.homeRuns || 0),
          last14OPS: l14?.ops || "?",
          vsLHP_HR:  parseInt(sl?.homeRuns || 0),
          vsRHP_HR:  parseInt(sr?.homeRuns || 0),
          vsLHP_avg: sl?.avg || "?",
          vsRHP_avg: sr?.avg || "?",
          vsLHP_ops: sl?.ops || "?",
          vsRHP_ops: sr?.ops || "?",
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

    // ── Step 4: Collect ALL hitters across all games, rank globally ──────────
    // Fetch all teams first, dedupe by playerId
    const allTeamIds = new Set();
    for (const g of games) {
      if (g.teams?.away?.team?.id) allTeamIds.add(g.teams.away.team.id);
      if (g.teams?.home?.team?.id) allTeamIds.add(g.teams.home.team.id);
    }

    const allHittersMap = {}; // playerId -> hitter data
    await Promise.all([...allTeamIds].map(async (teamId) => {
      try {
        const roster = await mlb(`/teams/${teamId}/roster?rosterType=active`);
        const posPlayers = (roster.roster || []).filter(p => !["P","TWP"].includes(p.position?.type));
        for (let i = 0; i < posPlayers.length; i += 4) {
          const batch = posPlayers.slice(i, i + 4);
          const results = await Promise.all(batch.map(p => getRealHitterData(p.person.id, p.person.fullName)));
          for (const h of results.filter(Boolean)) allHittersMap[h.playerId] = h;
          await new Promise(r => setTimeout(r, 80));
        }
      } catch {}
    }));

    // Score each hitter by HR potential, take top 25
    const scoreHitter = (h) => {
      let score = 0;
      const abhr = parseFloat(h.abPerHR);
      if (!isNaN(abhr)) score += abhr < 12 ? 5 : abhr < 16 ? 3 : abhr < 20 ? 1 : 0;
      const woba = parseFloat(h.woba);
      if (!isNaN(woba)) score += woba > .400 ? 4 : woba > .370 ? 3 : woba > .340 ? 1 : 0;
      score += Math.min(h.seasonHR / 5, 4);
      return score;
    };
    const top25 = Object.values(allHittersMap)
      .sort((a, b) => scoreHitter(b) - scoreHitter(a))
      .slice(0, 25);

    // ── Step 5: Build lean game context (pitchers + park only) ───────────────
    const fmtPitcher = (pp, stats) => {
      if (!pp && !stats) return "TBD";
      const name = stats?.name || pp?.fullName || "TBD";
      if (!stats) return `${name}(hand:?,HR9:?)`;
      return `${name}(${stats.hand},HR9:${stats.hr9},vsL_HR9:${stats.vsLHB_hr9 || "?"},vsR_HR9:${stats.vsRHB_hr9 || "?"})`;
    };

    const fmtHitter = (h) =>
      `${h.name}(${h.bats},${h.seasonHR}HR,AB/HR:${h.abPerHR},wOBA:${h.woba},vsL:${h.vsLHP_HR},vsR:${h.vsRHP_HR})`;

    const gameContexts = [];
    for (const g of games) {
      const awayAbb = g.teams?.away?.team?.abbreviation || "?";
      const homeAbb = g.teams?.home?.team?.abbreviation || "?";
      const venue   = g.venue?.name || "?";
      const parkF   = PARK_FACTORS[venue]?.factor || 100;
      const awayPP  = g.teams?.away?.probablePitcher;
      const homePP  = g.teams?.home?.probablePitcher;

      const [awayPitcher, homePitcher] = await Promise.all([
        getRealPitcherData(awayPP),
        getRealPitcherData(homePP),
      ]);

      gameContexts.push({
        key: `${awayAbb}@${homeAbb}`,
        gameTime: g.gameDate,
        gamePk: g.gamePk,
        text: `${awayAbb}@${homeAbb} park:${parkF} gameTime:${g.gameDate} AwayP:${fmtPitcher(awayPP, awayPitcher)} HomeP:${fmtPitcher(homePP, homePitcher)}`
      });
    }

    const top25Str = top25.map(fmtHitter).join("\n");
    const gamesStr = gameContexts.map(g => g.text).join("\n");

    // ── Step 6: Build prompt ──────────────────────────────────────────────────
    const alreadyHit = todayHRs.length
      ? `EXCLUDE — already hit HR today: ${todayHRs.map(h => h.player).join(", ")}`
      : "";
    const gameTimeLookup = {};
    for (const g of gameContexts) {
      const [away, home] = g.key.split("@");
      gameTimeLookup[away] = { gameKey: g.key, gameTime: g.gameTime, gamePk: g.gamePk };
      gameTimeLookup[home] = { gameKey: g.key, gameTime: g.gameTime, gamePk: g.gamePk };
    }
    console.log("[plays] all data pulled. Games:", games.length, "Top hitters:", top25.length, "Pitchers cached:", Object.keys(pitcherCache).length);

    const prompt = `Today ${today}. Data below is REAL from MLB Stats API. Use ONLY these numbers.

GAMES (away@home park:factor gameTime awayPitcher homeP):
${gamesStr}

TOP HR CANDIDATES (name, bats, seasonHR, AB/HR, wOBA, vsLHP_HRs, vsRHP_HRs):
${top25Str}

${alreadyHit}

Each hitter plays in one of the games above — match them by team abbreviation.
Pick best HR props. A hitter facing the AWAY pitcher bats against the home team's SP, and vice versa.

RANKING (in order):
1. AB/HR < 12 = elite, < 16 = strong, > 25 = avoid
2. wOBA > .370 = quality contact, < .300 = avoid
3. Handedness — match bats vs pitcher hand using vsL/vsR HR counts
4. Pitcher HR/9 > 1.5 = vulnerable, < 0.8 = avoid
5. Park factor > 108 = boost, < 92 = suppress

CONFIDENCE:
- HIGH: AB/HR < 15, wOBA > .370, pitcher HR9 > 1.3, park >= 95, handedness favors
- MED: AB/HR < 20, wOBA > .330, 2+ other factors positive
- WATCH: one strong factor + one real concern
- Skip: AB/HR > 28 or wOBA < .300

WHY field: 2-3 plain English sentences. Lead with batter hand vs pitcher hand. Explain power rate and recent form simply.
CONCERN field: 1-2 plain English sentences on biggest risk.

Return JSON: {"plays":[{"player":string,"team":string,"opponent":string,"pitcher":string,"pitcherHand":"L" or "R","batterHand":"L" or "R" or "S","gameKey":string,"gameTime":string,"last7HRs":number,"parkFactor":number,"confidence":"HIGH" or "MED" or "WATCH","hotStreak":boolean,"note":string,"concern":string}]}`;

    const result = await callClaude(prompt, 8000);

    if (result?.plays) {
      result.plays = result.plays.map(p => {
        const g = gameTimeLookup[p.team] || gameTimeLookup[p.opponent] || {};
        return { ...p, gameKey: p.gameKey || g.gameKey, gameTime: p.gameTime || g.gameTime, gamePk: p.gamePk || g.gamePk };
      });
      playsCache = { date: today, data: result, hrCount: todayHRs.length, generating: false };
      console.log("[plays] generated", result.plays.length, "plays. Hitters pulled:", Object.keys(hitterCache).length);
    }
    return result;

  } catch(e) {
    console.error("[plays] error:", e.message, e.stack?.split("\n")[1]);
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

  // Helper: enrich + return
  const respondEnriched = async (data) => {
    if (!data?.plays) return res.json(data);
    try {
      const lineupData = await fetchLineups();
      const enrichedPlays = enrichPlaysWithLineups(data.plays, lineupData);
      return res.json({ ...data, plays: enrichedPlays, lineupsFetchedAt: lineupCache.fetchedAt });
    } catch (e) {
      console.error("[plays enrich]", e.message);
      return res.json(data);
    }
  };

  // Serve cache if same day — locked in, no regeneration mid-day
  if (playsCache.date === today && playsCache.data) {
    return respondEnriched(playsCache.data);
  }

  // If already generating, return stale cache or pending status
  if (playsCache.generating) {
    if (playsCache.data) return respondEnriched(playsCache.data);
    return res.json({ plays: [], generating: true });
  }

  // Trigger background generation — respond immediately
  if (playsCache.data) {
    // Return stale data right away, regenerate in background
    generatePlays(today, liveHRs).catch(e => console.error("[plays bg]", e.message));
    return respondEnriched(playsCache.data);
  }

  // No cache at all — wait for first generation (but with timeout)
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 90000));
    const result = await Promise.race([generatePlays(today, liveHRs), timeout]);
    return respondEnriched(result || { plays: [] });
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

async function callClaude(prompt, maxTokens = 2000) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: "You are an MLB analytics expert. Respond with ONLY a raw JSON object. No markdown fences, no ```json, no explanation, no preamble. Start with { end with }. Nothing else.",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  console.log("[claude raw]", text.slice(0, 200));
  // Prepend the { we used as prefill
  text = "{" + text;
  // Strip any markdown or prose
  text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
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
          console.error("[JSON parse attempt failed]", parseErr.message);
        }
      }
    }
  }
  // Last resort
  try { return JSON.parse(text); } catch {}
  throw new Error("Malformed JSON: " + text.slice(0, 200));
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
      `Analyze ${playerName} as an HR prop bet. Use ONLY the stats below. Be direct and specific.

${lines}

Return JSON only, start with {: {"summary":string,"strengths":[string],"watchouts":[string],"confidence":"HIGH" or "MED" or "WATCH"}

Rules:
- summary: 2 sentences max, cite specific numbers
- strengths: 1-3 items, each referencing an actual stat from above
- watchouts: 1-2 honest concerns with numbers
- HIGH if AB/HR < 15 and OPS > .850, MED if AB/HR < 22 and OPS > .750, WATCH otherwise
- Never say "insufficient data" — low stats ARE data, explain what they mean`
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
