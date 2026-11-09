require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PUNTERSEDGE_API_KEY || "";
const BASE = "https://api.puntersedge.online";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
let writeQueue = Promise.resolve();

app.use(express.static(path.join(__dirname, "public")));

async function readHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { return JSON.parse(await fs.readFile(HISTORY_FILE, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return { picks: [] }; throw e; }
}
async function saveHistory(history) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = HISTORY_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(history, null, 2));
    await fs.rename(tmp, HISTORY_FILE);
  });
  return writeQueue;
}
async function provider(pathname, params = {}) {
  if (!API_KEY) throw new Error("Add PUNTERSEDGE_API_KEY to the server environment to enable the authenticated live feed.");
  const url = new URL(BASE + pathname);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));
  const response = await fetch(url, {
    headers: { "X-API-Key": API_KEY },
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Racing provider ${response.status}: ${body.slice(0,300)}`);
  return JSON.parse(body);
}
function rowsFrom(data) {
  return Array.isArray(data) ? data : (data.races || data.data || data.events || []);
}
function runnerQuotes(runner) {
  return (runner.bookmakers || []).filter(q => Number(q.win_price) > 1 && !q.stale);
}
function selectFavourite(race) {
  const runners = (race.runners || []).map(r => {
    const quotes = runnerQuotes(r);
    if (!quotes.length) return null;
    const prices = quotes.map(q => Number(q.win_price)).sort((a,b)=>a-b);
    const median = prices[Math.floor((prices.length-1)/2)];
    const b365 = quotes.find(q => ["bet365","bet_365"].includes(String(q.key || q.bookmaker || "").toLowerCase()));
    return {
      name: r.name, number: r.number ?? r.runner_number ?? null,
      price: b365 ? Number(b365.win_price) : median,
      priceSource: b365 ? "Bet365" : "market median",
      bet365Price: b365 ? Number(b365.win_price) : null,
      quoteCount: quotes.length
    };
  }).filter(Boolean);
  runners.sort((a,b)=>a.price-b.price);
  return runners[0] || null;
}
function categoryOf(r) {
  const c = String(r.category || r.code || r.race_type || "").toLowerCase();
  return c.includes("grey") || c.includes("dog") ? "greyhound" : "horse";
}
function raceId(r) {
  return String(r.race_id || r.id || `${r.venue || r.track_name || "track"}-${r.race_number || "x"}-${r.start_time || ""}`);
}
function winnerFromResult(r) {
  if (r.winner_name) return { name: r.winner_name, number: r.winner_number ?? null };
  const runners = r.runners || r.results || r.placings || [];
  const winner = runners.find(x => Number(x.position ?? x.placing ?? x.place ?? x.finish_position) === 1);
  if (winner) return { name: winner.name || winner.runner_name || winner.horse_name || winner.greyhound_name || "Winner", number: winner.number ?? winner.runner_number ?? null };
  if (typeof r.winner === "string") return { name: r.winner, number: null };
  if (r.winner && typeof r.winner === "object") return { name: r.winner.name || r.winner.runner_name || "Winner", number: r.winner.number ?? null };
  return null;
}
function isSameRunner(pick, winner) {
  if (pick.runnerNumber != null && winner.number != null) return String(pick.runnerNumber) === String(winner.number);
  return String(pick.runnerName).trim().toLowerCase() === String(winner.name).trim().toLowerCase();
}

app.get("/api/health", (_req,res) => res.json({ok:true, liveFeedConfigured:!!API_KEY, storage:DATA_DIR}));
app.get("/api/races", async (_req, res) => {
  try {
    const data = await provider("/v1/racing/next-to-go", {
      num_races: 200, categories: "horse,greyhound", country: "AU", include_unresolved: "true"
    });
    const races = rowsFrom(data);
    const history = await readHistory();
    let added = 0;
    for (const race of races) {
      const fav = selectFavourite(race);
      if (!fav) continue;
      const id = raceId(race);
      if (history.picks.some(p => p.raceId === id)) continue;
      history.picks.push({
        raceId: id, category: categoryOf(race),
        venue: race.venue || race.track_name || "Unknown track",
        raceNumber: race.race_number ?? null,
        startTime: race.start_time || null,
        runnerName: fav.name, runnerNumber: fav.number,
        selectedOdds: fav.price, priceSource: fav.priceSource,
        selectedAt: new Date().toISOString(), status: "pending",
        winnerName: null, favouriteWon: null
      });
      added++;
    }
    if (added) await saveHistory(history);
    res.set("Cache-Control", "no-store");
    res.json({
      races, mode: "live", fetchedAt: new Date().toISOString(),
      note: "Live Australian racing feed. Favourite is selected from Bet365 win odds where available; otherwise from the median of current bookmaker quotes. Historical picks are saved when first seen."
    });
  } catch (err) {
    res.status(503).json({ error: err.message, mode: "offline" });
  }
});

app.post("/api/history/sync", async (_req,res) => {
  try {
    const results = rowsFrom(await provider("/v1/racing/results", {
      hours_back: 48, country: "AU", status: "final", limit: 200
    }));
    const history = await readHistory();
    let settled = 0;
    for (const result of results) {
      const id = raceId(result);
      const pick = history.picks.find(p => p.raceId === id);
      if (!pick || pick.status === "final") continue;
      const winner = winnerFromResult(result);
      if (!winner) continue;
      pick.status = "final";
      pick.winnerName = winner.name;
      pick.favouriteWon = isSameRunner(pick, winner);
      pick.settledAt = new Date().toISOString();
      settled++;
    }
    if (settled) await saveHistory(history);
    res.json({ settled, total: history.picks.length, syncedAt: new Date().toISOString() });
  } catch (err) { res.status(503).json({ error: err.message }); }
});

app.get("/api/history", async (_req,res) => {
  try {
    const history = await readHistory();
    const final = history.picks.filter(p=>p.status==="final");
    const wins = final.filter(p=>p.favouriteWon).length;
    const byCode = code => {
      const rows = final.filter(p=>p.category===code);
      const won = rows.filter(p=>p.favouriteWon).length;
      return { races: rows.length, wins: won, losses: rows.length-won, strikeRate: rows.length ? +(100*won/rows.length).toFixed(1) : null };
    };
    res.json({
      picks: history.picks.slice().sort((a,b)=>new Date(b.startTime||b.selectedAt)-new Date(a.startTime||a.selectedAt)),
      summary: { races: final.length, wins, losses: final.length-wins, strikeRate: final.length ? +(100*wins/final.length).toFixed(1) : null, pending: history.picks.filter(p=>p.status==="pending").length, horse: byCode("horse"), greyhound: byCode("greyhound") }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("*", (_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Racing Favourite Finder listening on ${PORT}`));
