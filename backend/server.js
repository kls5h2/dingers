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

function todayStr() {
  return new Date().toISOString().split("T")[0];
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
  const [season, last30, last14, last7, vsL, vsR, home, away] = await Promise.allSettled([
    mlb(`/people/${playerId}/stats?stats=season&group=hitting&season=${year}`),
    mlb(`/people/${playerId}/stats?stats=lastXDays&group=hitting&season=${year}&limit=30`),
    mlb(`/people/${playerId}/stats?stats=lastXDays&group=hitting&season=${year}&limit=14`),
    mlb(`/people/${playerId}/stats?stats=lastXDays&group=hitting&season=${year}&limit=7`),
    mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vl`),
    mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=vr`),
    mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=h`),
    mlb(`/people/${playerId}/stats?stats=statSplits&group=hitting&season=${year}&sitCodes=a`),
  ]);

  const extract = (r) => r.status === "fulfilled" ? r.value?.stats?.[0]?.splits?.[0]?.stat : null;

  return {
    season:  extract(season),
    last30:  extract(last30),
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

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

async function generatePlays(today, todayHRs) {
  if (playsCache.generating) return; // prevent concurrent calls
  playsCache.generating = true;
  try {
    const schedData = await mlb(`/schedule?sportId=1&date=${today}&hydrate=team,venue`);
    const games = (schedData.dates?.[0]?.games || []).map(g =>
      `${g.teams?.away?.team?.abbreviation} @ ${g.teams?.home?.team?.abbreviation} at ${g.venue?.name} (park factor ${PARK_FACTORS[g.venue?.name]?.factor || 100})`
    ).join("; ");

    const alreadyHit = todayHRs.length
      ? `Players who have ALREADY hit a HR today (downgrade or remove): ${[...new Set(todayHRs.map(h => h.player))].join(", ")}.`
      : "No home runs yet today.";

    console.log("[plays] generating. HRs today:", todayHRs.length);
    console.log("[plays] games:", games.slice(0, 100));

    const result = await callClaude(
      `Today ${today}. Games: ${games}. ${alreadyHit}
      Best HR props today. MAX 6 PLAYS. Confidence: HIGH/MED/WATCH only.
      Notes max 15 words. Concerns max 10 words.
      Skip anyone who already hit today.
      JSON only: {"plays":[{"player":"","team":"","opponent":"","pitcher":"","pitcherHand":"L","last7HRs":0,"parkFactor":100,"confidence":"HIGH","hotStreak":false,"note":"","concern":""}]}`
    );
    playsCache = { date: today, data: result, hrCount: todayHRs.length, generating: false };
    console.log("[plays] generated", result?.plays?.length, "plays");
    return result;
  } catch(e) {
    console.error("[plays] error:", e.message);
    playsCache.generating = false;
    throw e;
  }
}

app.get("/api/ai/plays-cached", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const currentHRCount = liveHRs.length;

  // Serve cache if: same day AND hr count hasn't changed
  if (playsCache.date === today && playsCache.data && playsCache.hrCount === currentHRCount) {
    return res.json(playsCache.data);
  }

  // Need to regenerate
  try {
    const result = await generatePlays(today, liveHRs);
    res.json(result || playsCache.data);
  } catch(e) {
    // If generation fails but we have stale cache, return it
    if (playsCache.data) return res.json(playsCache.data);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dingers backend running on port ${PORT}`);
  // Delay initial poll so server stabilizes before hitting APIs
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
    const result = await callClaude(
      `Given this real MLB stats data for ${playerName}, analyze their HR potential today.
      Stats: ${JSON.stringify(stats)}
      Player info: ${JSON.stringify(info)}
      Return JSON: { "summary": string, "strengths": [string], "watchouts": [string], "confidence": "HIGH"|"MED"|"LOW", "reasoning": string }`
    );
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
