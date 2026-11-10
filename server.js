require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PUNTERSEDGE_API_KEY || "";
const PROVIDER_PLAN = String(process.env.PUNTERSEDGE_PLAN || "free").toLowerCase();
const SCHEDULE_HORIZON_HOURS = PROVIDER_PLAN === "standard" ? 48 : (["plus","premium","pro","enterprise"].includes(PROVIDER_PLAN) ? 168 : 24);
const BASE = "https://api.puntersedge.online";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
let writeQueue = Promise.resolve();
const lastMarketSignatures = new Map();
const MARKET_HISTORY_LIMIT = 25000;
const MARKET_HISTORY_DAYS = 30;

app.use(express.static(path.join(__dirname, "public")));

async function readHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const value = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    if (!Array.isArray(value.picks)) value.picks = [];
    return value;
  } catch (e) { if (e.code === "ENOENT") return { picks: [] }; throw e; }
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
  const response = await fetch(url, { headers: { "X-API-Key": API_KEY }, signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Racing provider ${response.status}: ${body.slice(0,300)}`);
  return JSON.parse(body);
}
function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  return data.races || data.results || data.data || data.events || [];
}
function valueOf(r, keys) {
  for (const key of keys) if (r && r[key] != null && r[key] !== "") return r[key];
  return null;
}
function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function categoryOf(r) {
  const c = String(valueOf(r, ["category","code","race_type","type"]) || "").toLowerCase();
  return c.includes("grey") || c.includes("dog") ? "greyhound" : "horse";
}
function venueOf(r) {
  return valueOf(r, ["venue","track_name","venue_canonical","track","meeting_name"]) || "Unknown track";
}
function raceNumberOf(r) {
  return valueOf(r, ["race_number","race_no","raceNumber","number"]);
}
function startTimeOf(r) {
  return valueOf(r, ["start_time","race_time","startTime","scheduled_start","start_at","date"]);
}
function raceId(r) {
  return String(valueOf(r, ["race_id","id","event_id"]) || `${venueOf(r)}-${raceNumberOf(r) || "x"}-${startTimeOf(r) || ""}`);
}
function localRaceDate(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", {
    timeZone:"Australia/Brisbane", year:"numeric", month:"2-digit", day:"2-digit"
  }).format(d);
}
function raceMatchKey(r) {
  const venue = normalizeName(venueOf(r));
  const number = raceNumberOf(r);
  const day = localRaceDate(startTimeOf(r));
  return venue && number != null && day ? `${categoryOf(r)}|${venue}|r${number}|${day}` : null;
}
function findMatchingPick(picks, result) {
  const id = raceId(result);
  const exact = picks.filter(p => p.raceId === id);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const key = raceMatchKey(result);
  if (!key) return null;
  const matches = picks.filter(p => p.raceMatchKey === key ||
    (!p.raceMatchKey && categoryOf(result) === p.category &&
      normalizeName(p.venue) === normalizeName(venueOf(result)) &&
      String(p.raceNumber) === String(raceNumberOf(result)) &&
      localRaceDate(p.startTime) === localRaceDate(startTimeOf(result))));
  return matches.length === 1 ? matches[0] : null;
}
async function recordMarketSnapshots(races, capturedAt) {
  const history = await readHistory();
  const cutoff = Date.now() - MARKET_HISTORY_DAYS * 86400000;
  history.marketSnapshots = history.marketSnapshots.filter(x => Date.parse(x.capturedAt) >= cutoff);
  let added = 0;
  for (const race of races) {
    const runners = (race.runners || []).map(r => ({
      name:r.name || r.runner_name || r.horse_name || r.greyhound_name || "Runner",
      number:r.number ?? r.runner_number ?? null,
      quotes:runnerQuotes(r).map(q => ({
        bookmaker:q.bookmaker || q.name || q.key || "Bookmaker",
        price:Number(q.win_price ?? q.win ?? q.price),
        ageSeconds:q.age_seconds ?? null
      })).sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker))
    }));
    const favourite = selectFavourite(race);
    const signature = JSON.stringify({runners, favourite});
    const id = raceId(race);
    if (lastMarketSignatures.get(id) === signature) continue;
    lastMarketSignatures.set(id, signature);
    history.marketSnapshots.push({
      raceId:id, category:categoryOf(race), venue:venueOf(race),
      raceNumber:raceNumberOf(race), startTime:startTimeOf(race),
      capturedAt, favourite, runners,
      quoteCount:runners.reduce((n,r)=>n+r.quotes.length,0),
      status:favourite ? "priced" : "waiting_for_odds"
    });
    added++;
  }
  if (added) {
    history.marketSnapshots = history.marketSnapshots.slice(-MARKET_HISTORY_LIMIT);
    await saveHistory(history);
  }
  return { added, total:history.marketSnapshots.length };
}
function bookmakerKey(q) {
  return String(q.key || q.bookmaker || q.name || "").toLowerCase().replace(/[^a-z0-9]/g,"");
}
function runnerQuotes(runner) {
  return (runner.bookmakers || runner.odds || []).filter(q => Number(q.win_price ?? q.win ?? q.price) > 1 && !q.stale);
}
function selectFavourite(race) {
  const entries = (race.runners || []).map(r => {
    const quotes = runnerQuotes(r);
    const b365 = quotes.find(q => ["bet365","bet365au"].includes(bookmakerKey(q)));
    const prices = quotes.map(q => Number(q.win_price ?? q.win ?? q.price)).sort((a,b)=>a-b);
    const median = prices.length ? prices[Math.floor((prices.length-1)/2)] : null;
    return { runner:r, quotes, b365, median };
  });
  // Never mix Bet365 prices and other bookmakers in the same race ranking.
  const hasBet365Market = entries.some(x => x.b365);
  const candidates = entries.filter(x => hasBet365Market ? !!x.b365 : x.median != null);
  candidates.sort((a,b) => (hasBet365Market ? Number(a.b365.win_price ?? a.b365.win ?? a.b365.price) : a.median) -
    (hasBet365Market ? Number(b.b365.win_price ?? b.b365.win ?? b.b365.price) : b.median));
  const best = candidates[0];
  if (!best) return null;
  const r = best.runner;
  return {
    name: r.name || r.runner_name || r.horse_name || r.greyhound_name,
    number: r.number ?? r.runner_number ?? null,
    price: hasBet365Market ? Number(best.b365.win_price ?? best.b365.win ?? best.b365.price) : best.median,
    priceSource: hasBet365Market ? "Bet365" : "market median",
    bet365Price: best.b365 ? Number(best.b365.win_price ?? best.b365.win ?? best.b365.price) : null,
    quoteCount: best.quotes.length
  };
}
function winnerFromResult(r) {
  const direct = valueOf(r, ["winner_name","winning_runner_name","first_place_name"]);
  if (direct) return { name: direct, number: valueOf(r, ["winner_number","winning_runner_number"]) };
  const directWinner = r.winner || r.winning_runner;
  if (typeof directWinner === "string") return { name: directWinner, number: null };
  if (directWinner && typeof directWinner === "object") return {
    name: directWinner.name || directWinner.runner_name || directWinner.horse_name || directWinner.greyhound_name,
    number: directWinner.number ?? directWinner.runner_number ?? null
  };
  const runners = r.runners || r.results || r.placings || r.finishers || [];
  const winner = runners.find(x => Number(x.position ?? x.placing ?? x.place ?? x.finish_position ?? x.position_number) === 1);
  if (winner) return {
    name: winner.name || winner.runner_name || winner.horse_name || winner.greyhound_name,
    number: winner.number ?? winner.runner_number ?? null
  };
  return null;
}
function isSameRunner(pick, winner) {
  const a = normalizeName(pick.runnerName), b = normalizeName(winner.name);
  if (a && b && a === b) return true;
  if (pick.runnerNumber != null && winner.number != null) return String(pick.runnerNumber) === String(winner.number);
  return false;
}

app.get("/api/health", (_req,res) => res.json({ok:true, liveFeedConfigured:!!API_KEY, storage:DATA_DIR}));
// Keep the priced feed and full schedule on separate cache windows. The browser
// can refresh its display every 5 seconds without forcing a paid provider request
// on every visitor refresh.
let pricedCache = { at: 0, rows: [] };
let scheduleCache = { at: 0, rows: [], horizonHours: SCHEDULE_HORIZON_HOURS };
let refreshInFlight = null;
let providerErrors = { schedule: null, odds: null };
async function getGlobalRaces() {
  const now = Date.now();
  if (now - pricedCache.at >= 15000 || now - scheduleCache.at >= 60000) {
    if (!refreshInFlight) refreshInFlight = (async () => {
      const tasks = [];
      if (now - scheduleCache.at >= 60000) tasks.push((async () => {
        try {
          const data = await provider("/v1/racing/events", { hours_ahead:SCHEDULE_HORIZON_HOURS, categories:"horse,greyhound" });
          scheduleCache = { at: Date.now(), rows: rowsFrom(data), horizonHours: SCHEDULE_HORIZON_HOURS };
          providerErrors.schedule = null;
          console.info("FEED_CHECK schedule", JSON.stringify({ ok:true, fetchedAt:new Date(scheduleCache.at).toISOString(), races:scheduleCache.rows.length, sample:scheduleCache.rows.slice(0,3).map(r=>({venue:venueOf(r),race:raceNumberOf(r),start:startTimeOf(r),runners:(r.runners||[]).length})) }));
        } catch (err) { providerErrors.schedule = err.message; console.error("FEED_CHECK schedule", JSON.stringify({ok:false,error:err.message,at:new Date().toISOString()})); }
      })());
      if (now - pricedCache.at >= 15000) tasks.push((async () => {
        try {
          const data = await provider("/v1/racing/next-to-go", { num_races:200, categories:"horse,greyhound" });
          pricedCache = { at: Date.now(), rows: rowsFrom(data) };
          providerErrors.odds = null;
          const sample = pricedCache.rows.slice(0,3).map(r=>({venue:venueOf(r),race:raceNumberOf(r),start:startTimeOf(r),runners:(r.runners||[]).slice(0,4).map(x=>({name:x.name||x.runner_name||x.horse_name||x.greyhound_name,quotes:runnerQuotes(x).slice(0,4).map(q=>({bookmaker:q.bookmaker||q.name||q.key,price:q.win_price??q.win??q.price}))}))}));
          console.info("FEED_CHECK odds", JSON.stringify({ ok:true, fetchedAt:new Date(pricedCache.at).toISOString(), races:pricedCache.rows.length, pricedRunners:pricedCache.rows.reduce((n,r)=>n+(r.runners||[]).filter(x=>runnerQuotes(x).length).length,0), sample }));
        } catch (err) { providerErrors.odds = err.message; console.error("FEED_CHECK odds", JSON.stringify({ok:false,error:err.message,at:new Date().toISOString()})); }
      })());
      await Promise.all(tasks);
    })().finally(() => { refreshInFlight = null; });
    await refreshInFlight;
  }
  const map = new Map();
  const keyFor = r => String(r.race_id || r.id || [r.country || "",r.category || "",normalizeName(venueOf(r)),raceNumberOf(r) || "",localRaceDate(startTimeOf(r))].join("|"));
  for (const r of scheduleCache.rows) map.set(keyFor(r), { ...r });
  for (const r of pricedCache.rows) {
    const key = keyFor(r);
    map.set(key, { ...(map.get(key) || {}), ...r, runners: r.runners || map.get(key)?.runners || [] });
  }
  const races = [...map.values()].filter(r => ["horse","greyhound"].includes(categoryOf(r)));
  if (!races.length && providerErrors.schedule && providerErrors.odds) {
    throw new Error("Racing provider unavailable: " + [providerErrors.schedule, providerErrors.odds].join(" | "));
  }
  return { races, scheduleFetchedAt: scheduleCache.at ? new Date(scheduleCache.at).toISOString() : null,
    oddsFetchedAt: pricedCache.at ? new Date(pricedCache.at).toISOString() : null,
    horizonHours: scheduleCache.horizonHours,
    feedErrors: Object.entries(providerErrors).filter(([,message]) => message).map(([feed,message]) => ({feed,message})) };
}

app.get("/api/races", async (_req, res) => {
  try {
    const feed = await getGlobalRaces();
    const races = feed.races;
    const history = await readHistory();
    let added = 0;
    for (const race of races) {
      const fav = selectFavourite(race);
      if (!fav || !fav.name) continue;
      const id = raceId(race), matchKey = raceMatchKey(race);
      if (history.picks.some(p => p.raceId === id || (matchKey && p.raceMatchKey === matchKey))) continue;
      history.picks.push({
        raceId:id, raceMatchKey:matchKey, category:categoryOf(race), venue:venueOf(race),
        raceNumber:raceNumberOf(race), startTime:startTimeOf(race),
        runnerName:fav.name, runnerNumber:fav.number, selectedOdds:fav.price,
        priceSource:fav.priceSource, quoteCount:fav.quoteCount,
        confidence:fav.priceSource === "Bet365" ? "Bet365 price" :
          fav.quoteCount >= 3 ? "stronger market coverage" :
          fav.quoteCount === 2 ? "limited market coverage" : "single bookmaker quote",
        selectedAt:new Date().toISOString(), status:"pending", winnerName:null, favouriteWon:null
      });
      added++;
    }
    if (added) await saveHistory(history);
    res.set("Cache-Control","no-store");
    res.json({races, mode:"live", fetchedAt:new Date().toISOString(),
      scheduleFetchedAt:feed.scheduleFetchedAt, oddsFetchedAt:feed.oddsFetchedAt,
      horizonHours:feed.horizonHours, providerPlan:PROVIDER_PLAN, feedErrors:feed.feedErrors, scope:"provider-supported worldwide",
      note:"Worldwide schedule and prices for horse and greyhound racing where covered by the provider. The schedule includes races before bookmaker prices open. The screen refreshes every 5 seconds, but bookmaker price updates vary by bookmaker and are not guaranteed every 5 seconds. Check quote age. Worldwide coverage is limited to races available in the provider feed; schedule horizon depends on provider plan."});
  } catch (err) { res.status(503).json({error:err.message,mode:"offline"}); }
});

app.post("/api/history/sync", async (_req,res) => {
  try {
    const results = rowsFrom(await provider("/v1/racing/results", {
      hours_back:72, country:"AU", status:"final", limit:300
    }));
    const history = await readHistory();
    let settled = 0, unmatched = 0, noWinner = 0;
    for (const result of results) {
      const winner = winnerFromResult(result);
      if (!winner || !winner.name) { noWinner++; continue; }
      const pick = findMatchingPick(history.picks, result);
      if (!pick || pick.status === "final") { unmatched++; continue; }
      pick.status = "final";
      pick.winnerName = winner.name;
      pick.favouriteWon = isSameRunner(pick,winner);
      pick.settledAt = new Date().toISOString();
      pick.resultMatch = "matched";
      settled++;
    }
    if (settled) await saveHistory(history);
    res.json({settled, unmatched, resultsReceived:results.length, resultsWithoutWinner:noWinner,
      pending:history.picks.filter(p=>p.status==="pending").length,
      total:history.picks.length, syncedAt:new Date().toISOString()});
  } catch (err) { res.status(503).json({error:err.message}); }
});

app.get("/api/market-history", async (req,res) => {
  try {
    const history = await readHistory();
    const snapshots = history.marketSnapshots.slice().sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
    const raceIdFilter = req.query.raceId ? String(req.query.raceId) : null;
    const rows = raceIdFilter ? snapshots.filter(x=>x.raceId===raceIdFilter) : snapshots;
    res.set("Cache-Control","no-store");
    res.json({ snapshots:rows.slice(0,100), total:rows.length,
      racesTracked:new Set(snapshots.map(x=>x.raceId)).size,
      capturedAt:snapshots[0]?.capturedAt || null,
      retentionDays:MARKET_HISTORY_DAYS });
  } catch(err) { res.status(500).json({error:err.message}); }
});

app.get("/api/history", async (_req,res) => {
  try {
    const history = await readHistory();
    const final = history.picks.filter(p=>p.status==="final");
    const wins = final.filter(p=>p.favouriteWon).length;
    const byCode = code => {
      const rows = final.filter(p=>p.category===code);
      const won = rows.filter(p=>p.favouriteWon).length;
      return {races:rows.length,wins:won,losses:rows.length-won,
        strikeRate:rows.length ? +(100*won/rows.length).toFixed(1) : null};
    };
    res.json({
      picks:history.picks.slice().sort((a,b)=>new Date(b.startTime||b.selectedAt)-new Date(a.startTime||a.selectedAt)),
      summary:{races:final.length,wins,losses:final.length-wins,
        strikeRate:final.length ? +(100*wins/final.length).toFixed(1) : null,
        pending:history.picks.filter(p=>p.status==="pending").length,
        horse:byCode("horse"),greyhound:byCode("greyhound")}
    });
  } catch (err) { res.status(500).json({error:err.message}); }
});
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`Racing Favourite Finder listening on ${PORT}`));
