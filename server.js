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
// Snapshots were growing past 20k entries (every race, every ~20s), which pushed the
// Node heap over its limit and crash-looped the service. Keep the archive small.
const MARKET_HISTORY_LIMIT = 3000;
const MARKET_HISTORY_DAYS = 3;
const SNAPSHOT_MIN_INTERVAL_MS = 60000;
const SNAPSHOT_WINDOW_MS = 90 * 60000;
const lastSnapshotAt = new Map();
let historyCache = null;

app.use(express.static(path.join(__dirname, "public")));

async function readHistory() {
  if (historyCache) return historyCache;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const value = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    if (!Array.isArray(value.picks)) value.picks = [];
    if (!Array.isArray(value.marketSnapshots)) value.marketSnapshots = [];
    value.marketSnapshots = value.marketSnapshots.slice(-MARKET_HISTORY_LIMIT);
    return (historyCache = value);
  } catch (e) { if (e.code === "ENOENT") return (historyCache = { picks: [], marketSnapshots: [] }); throw e; }
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
  if (c.includes("harness") || c.includes("trotting") || c.includes("pacing")) return "harness";
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
    const startMs = Date.parse(startTimeOf(race));
    if (Number.isFinite(startMs) && (startMs - Date.now() > SNAPSHOT_WINDOW_MS || startMs < Date.now() - 600000)) continue;
    if (lastMarketSignatures.get(id) === signature) continue;
    if (Date.now() - (lastSnapshotAt.get(id) || 0) < SNAPSHOT_MIN_INTERVAL_MS) continue;
    lastMarketSignatures.set(id, signature);
    lastSnapshotAt.set(id, Date.now());
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
  // Preserve every valid provider-returned price; stale/age metadata is displayed, not used to erase quotes.
  return (runner.bookmakers || runner.odds || []).filter(q => Number(q.win_price ?? q.win ?? q.price) > 1);
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


const ODDS_API_TOKEN = process.env.ODDS_DATA_API_TOKEN || "";
async function oddsApi(pathname, params={}) {
  if (!ODDS_API_TOKEN) throw new Error("ODDS_DATA_API_TOKEN is not active in Railway.");
  const url = new URL((process.env.ODDS_API_BASE || "https://api.b365api.com") + pathname);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  url.searchParams.set("token",ODDS_API_TOKEN);
  const response = await fetch(url,{signal:AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok || data.success !== 1) throw new Error("Odds Data API: "+(data.error||response.status));
  return {data, headers: {remaining:response.headers.get("X-RateLimit-Remaining"), reset:response.headers.get("X-RateLimit-Reset")}};
}
function fractionalDecimal(value) {
  if (!value) return null;
  const s=String(value);
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m=s.match(/^(\d+)\/(\d+)$/);
  return m && Number(m[2]) ? 1+Number(m[1])/Number(m[2]) : null;
}
function parseBet365Live(rows) {
  const flat=Array.isArray(rows?.[0])?rows.flat():Array.isArray(rows)?rows:[];
  const ev=flat.find(x=>x.type==="EV")||{};
  const teams=flat.filter(x=>x.type==="TE");
  const home=teams.find(x=>String(x.OR)==="0")||teams[0]||{};
  const away=teams.find(x=>String(x.OR)==="1")||teams[1]||{};
  const markets=[]; let current=null;
  let group="";
  for(const x of flat){
    if(x.type==="MG"){group=x.NA||"";}
    else if(x.type==="MA"){current={name:x.NA||group||"Market",group,suspended:String(x.SU)==="1",selections:[]};markets.push(current);}
    else if(x.type==="PA"&&current) current.selections.push({name:x.NA||x.HD||"Selection",price:fractionalDecimal(x.OD),suspended:String(x.SU)==="1"||current.suspended});
  }
  const usable=markets.filter(m=>m.selections.length>=2);
  const main=usable.find(m=>/full.?time result|match (winner|result|betting)|money ?line|to win|winner/i.test(m.name+" "+m.group))||usable[0];
  // The favourite is the shortest-priced team/player; a draw is not a favourite.
  const valid=(main?.selections||[]).filter(x=>x.price>1&&!x.suspended&&!/^draw$/i.test(x.name));
  const favourite=[...valid].sort((a,b)=>a.price-b.price)[0]||null;
  return {id:ev.FI||null,name:ev.NA||[home.NA,away.NA].filter(Boolean).join(" v "),
    league:ev.CT||null,score:ev.SS||null,minute:ev.TM||null,second:ev.TS||null,
    status:"IN PLAY",updatedAt:ev.TU||null,home:home.NA||null,away:away.NA||null,
    favourite,markets,bookmaker:"bet365"};
}

app.get("/api/health", (_req,res) => res.json({ok:true, liveFeedConfigured:!!API_KEY, liveSportsConfigured:!!ODDS_API_TOKEN, storage:DATA_DIR}));
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
          const data = await provider("/v1/racing/events", { hours_ahead:SCHEDULE_HORIZON_HOURS, categories:"horse,harness,greyhound" });
          scheduleCache = { at: Date.now(), rows: rowsFrom(data), horizonHours: SCHEDULE_HORIZON_HOURS };
          providerErrors.schedule = null;
          console.info("FEED_CHECK schedule", JSON.stringify({ ok:true, fetchedAt:new Date(scheduleCache.at).toISOString(), races:scheduleCache.rows.length, sample:scheduleCache.rows.slice(0,3).map(r=>({venue:venueOf(r),race:raceNumberOf(r),start:startTimeOf(r),runners:(r.runners||[]).length})) }));
        } catch (err) { providerErrors.schedule = err.message; console.error("FEED_CHECK schedule", JSON.stringify({ok:false,error:err.message,at:new Date().toISOString()})); }
      })());
      if (now - pricedCache.at >= 15000) tasks.push((async () => {
        try {
          const data = await provider("/v1/racing/next-to-go", { num_races:200, categories:"horse,harness,greyhound" });
          pricedCache = { at: Date.now(), rows: rowsFrom(data) };
          providerErrors.odds = null;
          try {
            const recorded = await recordMarketSnapshots(pricedCache.rows, new Date(pricedCache.at).toISOString());
            console.info("MARKET_HISTORY", JSON.stringify({capturedAt:new Date(pricedCache.at).toISOString(), added:recorded.added, retained:recorded.total}));
          } catch (historyError) { console.error("MARKET_HISTORY_ERROR", historyError.message); }
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
  const races = [...map.values()].filter(r => ["horse","harness","greyhound"].includes(categoryOf(r)));
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
    const providerBookmakers = [...new Map(pricedCache.rows.flatMap(r => (r.runners || []).flatMap(x => runnerQuotes(x).map(q => {
      const name = q.bookmaker || q.name || q.key || "Bookmaker";
      return [bookmakerKey(q), name];
    }))).filter(([key]) => !!key)).entries()].map(([key,name]) => ({key,name}));
    res.json({races, providerBookmakers, mode:"live", fetchedAt:new Date().toISOString(),
      scheduleFetchedAt:feed.scheduleFetchedAt, oddsFetchedAt:feed.oddsFetchedAt,
      horizonHours:feed.horizonHours, providerPlan:PROVIDER_PLAN, feedErrors:feed.feedErrors, scope:"provider-supported worldwide",
      note:"Worldwide schedule and prices for horse, harness and greyhound racing where covered by the provider. The schedule includes races before bookmaker prices open. The screen refreshes every 5 seconds, but bookmaker price updates vary by bookmaker and are not guaranteed every 5 seconds. Check quote age. Worldwide coverage is limited to races available in the provider feed; schedule horizon depends on provider plan."});
  } catch (err) { res.status(503).json({error:err.message,mode:"offline"}); }
});



let liveSportsCache={at:0,events:[],error:null,rateLimitRemaining:null};
let liveSportsRefresh=null;
app.get("/api/live-sports",async(_req,res)=>{
 try{
  if(!ODDS_API_TOKEN)return res.status(503).json({configured:false,error:"Add ODDS_DATA_API_TOKEN to Railway and deploy it."});
  // Refresh at 30 seconds and cap detail lookups to 20 events. This keeps
  // the list + detail polling below the provider's documented 3,600/hour limit.
  if(!liveSportsCache.at || Date.now()-liveSportsCache.at>30000){
   if(!liveSportsRefresh)liveSportsRefresh=(async()=>{
    try{
     // sport_id is optional on Bet365 InPlay Filter. Unlike /v3/events/inplay,
     // this endpoint returns the all-sports Bet365 in-play list and FI ids.
     const list=await oddsApi("/v1/bet365/inplay_filter",{skip_esports:1});
     const fixtures=(list.data.results||[]).filter(e=>e.id).slice(0,20);
     const details=await Promise.all(fixtures.map(async e=>{
      try{
       const d=await oddsApi("/v1/bet365/event",{FI:e.id});
       return parseBet365Live(d.data.results);
      }catch(err){
       return {id:e.id,name:[e.home?.name,e.away?.name].filter(Boolean).join(" v ")||"Live event",
        league:e.league?.name||null,score:e.ss||null,minute:null,status:"IN PLAY",
        error:err.message,bookmaker:"bet365"};
      }
     }));
     liveSportsCache={at:Date.now(),events:details,error:null,rateLimitRemaining:list.headers.remaining,
      totalInPlay:list.data.results?.length||0};
     console.info("BET365_INPLAY_REFRESH",JSON.stringify({
      fetchedAt:new Date(liveSportsCache.at).toISOString(),
      totalInPlay:liveSportsCache.totalInPlay,
      detailed:details.length,
      withScore:details.filter(x=>!!x.score).length,
      withFavourite:details.filter(x=>!!x.favourite?.price).length,
      withMarkets:details.filter(x=>(x.markets||[]).length>0).length,
      eventErrors:details.filter(x=>!!x.error).length,
      rateLimitRemaining:liveSportsCache.rateLimitRemaining,
      sample:details.slice(0,3).map(x=>({name:x.name,score:x.score,minute:x.minute,favourite:x.favourite}))
     }));
    }catch(err){
     liveSportsCache={...liveSportsCache,at:Date.now(),error:err.message};
     console.error("BET365_INPLAY_ERROR",JSON.stringify({at:new Date().toISOString(),error:err.message}));
    }
   })().finally(()=>{liveSportsRefresh=null;});
   await liveSportsRefresh;
  }
  res.set("Cache-Control","no-store");
  res.json({configured:true,provider:"Odds Data API / bet365",events:liveSportsCache.events,
   totalInPlay:liveSportsCache.totalInPlay??null,
   fetchedAt:liveSportsCache.at?new Date(liveSportsCache.at).toISOString():null,
   ageSeconds:liveSportsCache.at?Math.round((Date.now()-liveSportsCache.at)/1000):null,
   rateLimitRemaining:liveSportsCache.rateLimitRemaining,error:liveSportsCache.error,
   note:"Bet365 in-play scores and prices where returned. Up to 20 events are detailed per refresh; data is cached for 30 seconds. Sportsbet in-play prices are not provided by this connection."});
 }catch(err){res.status(503).json({error:err.message});}
});

// Sports catalogue is cached for six hours. Sports odds are fetched on demand
// per selected sport and cached for 15 minutes to control provider credit use.
let sportsCatalogueCache = { at:0, rows:[] };
const sportsOddsCache = new Map();
app.get("/api/sports", async (_req,res) => {
  try {
    if (!sportsCatalogueCache.at || Date.now()-sportsCatalogueCache.at >= 6*60*60*1000) {
      const data = await provider("/v1/sports");
      sportsCatalogueCache = { at:Date.now(), rows:rowsFrom(data).filter(x=>x.active!==false) };
    }
    res.set("Cache-Control","no-store");
    res.json({sports:sportsCatalogueCache.rows, fetchedAt:new Date(sportsCatalogueCache.at).toISOString(),
      refreshSeconds:900, liveInPlayAvailable:false,
      note:"Upcoming sports fixtures and pre-match odds only. This provider does not supply in-play sports odds; fixtures leave the odds feed when they start."});
  } catch(err) { res.status(503).json({error:err.message}); }
});
async function ensureSportsCatalogue() {
  if (!sportsCatalogueCache.at || Date.now()-sportsCatalogueCache.at >= 6*60*60*1000) {
    const data = await provider("/v1/sports");
    sportsCatalogueCache = { at:Date.now(), rows:rowsFrom(data).filter(x=>x.active!==false) };
  }
}
app.get("/api/sports/:sportKey", async (req,res) => {
  const key = String(req.params.sportKey||"").toLowerCase();
  if (!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({error:"Invalid sport key"});
  try { await ensureSportsCatalogue(); } catch(err) { return res.status(503).json({error:err.message,sportKey:key}); }
  const known = sportsCatalogueCache.rows.some(x=>String(x.key).toLowerCase()===key);
  if (!known) return res.status(404).json({error:"Sport is not in the active provider catalogue. Refresh the sports list."});
  try {
    let cached=sportsOddsCache.get(key);
    if (!cached || Date.now()-cached.at>=15*60*1000) {
      const data=await provider("/v1/sports/"+encodeURIComponent(key)+"/odds",{markets:"h2h",oddsFormat:"decimal"});
      cached={at:Date.now(),rows:rowsFrom(data)};
      sportsOddsCache.set(key,cached);
    }
    res.set("Cache-Control","no-store");
    res.json({sport:sportsCatalogueCache.rows.find(x=>String(x.key).toLowerCase()===key),
      events:cached.rows, fetchedAt:new Date(cached.at).toISOString(), refreshSeconds:900,
      liveInPlayAvailable:false,
      note:"Pre-match head-to-head odds only. No live/in-play sports market is supplied by this provider."});
  } catch(err) { res.status(503).json({error:err.message,sportKey:key}); }
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
