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
let demoRacingCache = { at: 0, rows: [] };
async function demoRacingFeed() {
  if (demoRacingCache.at && Date.now() - demoRacingCache.at < 25000) return demoRacingCache.rows;
  const response = await fetch(BASE + "/v1/demo/racing/next-to-go", { signal: AbortSignal.timeout(12000) });
  const body = await response.text();
  if (!response.ok) throw new Error("Public racing demo feed " + response.status + ": " + body.slice(0, 240));
  const payload = JSON.parse(body);
  const rows = Array.isArray(payload) ? payload : (Array.isArray(payload.races) ? payload.races : []);
  if (!rows.length) throw new Error("Public racing demo feed returned no races.");
  demoRacingCache = { at: Date.now(), rows };
  return rows;
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
  const median = values => { const x=values.slice().sort((a,b)=>a-b); return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null; };
  const entries=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=runnerQuotes(r).filter(q=>{
      const key=bookmakerKey(q),age=Number(q.age_seconds);
      if(!key||seen.has(key)||q.stale===true||(Number.isFinite(age)&&age>=180))return false;
      seen.add(key);return true;
    });
    const prices=quotes.map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1);
    const fair=median(prices),spread=fair&&prices.length>1?(Math.max(...prices)-Math.min(...prices))/fair:1;
    return {runner:r,quotes,fair,spread};
  }).filter(x=>x.fair!=null).sort((a,b)=>a.fair-b.fair);
  const best=entries[0];if(!best)return null;
  const second=entries[1],gap=second?Math.max(0,(1/best.fair-1/second.fair)/(1/best.fair)):0;
  const signalScore=Math.round(Math.min(40,best.quotes.length/3*40)+Math.max(0,30*(1-best.spread/0.35))+Math.min(30,gap/0.15*30));
  const r=best.runner;
  return {name:r.name||r.runner_name||r.horse_name||r.greyhound_name,number:r.number??r.runner_number??null,
    price:best.fair,priceSource:"multi-bookmaker median",quoteCount:best.quotes.length,
    spreadPct:+(best.spread*100).toFixed(1),gapPct:+(gap*100).toFixed(1),signalScore,
    signalLabel:best.quotes.length>=3&&signalScore>=65?"STRONG SIGNAL":signalScore>=45?"CAUTION":"NO BET · WEAK SIGNAL"};
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
  let response;
  try { response = await fetch(url,{signal:AbortSignal.timeout(12000)}); }
  catch (err) { throw new Error("Odds Data API connection failed: "+(err.cause?.code||err.name||err.message)); }
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("Odds Data API returned invalid JSON (HTTP "+response.status+")."); }
  if (!response.ok || data.success !== 1) throw new Error("Odds Data API: "+(data.error||response.status)+(data.error_detail?" · "+data.error_detail:""));
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
// Back off exhausted provider feeds instead of retrying every browser refresh.
// HTTP 402 means the provider account has exhausted its plan credits; never auto-upgrade.
const providerRetryAt = { schedule: 0, odds: 0 };
function providerRetryDelay(error) {
  return /Racing provider 402/.test(String(error)) ? 6 * 60 * 60 * 1000 : 60 * 1000;
}
async function getGlobalRaces() {
  const now = Date.now();
  if (now - pricedCache.at >= 15000 || now - scheduleCache.at >= 60000) {
    if (!refreshInFlight) refreshInFlight = (async () => {
      const tasks = [];
      if (now - scheduleCache.at >= 60000) tasks.push((async () => {
        try {
          const data = now < providerRetryAt.schedule ? { races: await demoRacingFeed() } : await provider("/v1/racing/events", { hours_ahead:SCHEDULE_HORIZON_HOURS, categories:"horse,harness,greyhound" });
          scheduleCache = { at: Date.now(), rows: rowsFrom(data), horizonHours: SCHEDULE_HORIZON_HOURS };
          providerErrors.schedule = null;
          console.info("FEED_CHECK schedule", JSON.stringify({ ok:true, fetchedAt:new Date(scheduleCache.at).toISOString(), races:scheduleCache.rows.length, sample:scheduleCache.rows.slice(0,3).map(r=>({venue:venueOf(r),race:raceNumberOf(r),start:startTimeOf(r),runners:(r.runners||[]).length})) }));
        } catch (err) {
          providerErrors.schedule = err.message;
          providerRetryAt.schedule = Date.now() + providerRetryDelay(err.message);
          try {
            const rows = await demoRacingFeed();
            scheduleCache = { at: Date.now(), rows, horizonHours: 0 };
            providerErrors.schedule = null;
            console.warn("FEED_FALLBACK schedule", JSON.stringify({source:"PuntersEdge public demo",races:rows.length,at:new Date(scheduleCache.at).toISOString(),primaryError:err.message}));
          } catch (fallbackError) {
            providerErrors.schedule = err.message + " | fallback: " + fallbackError.message;
            console.error("FEED_CHECK schedule", JSON.stringify({ok:false,retryAt:new Date(providerRetryAt.schedule).toISOString(),error:providerErrors.schedule,at:new Date().toISOString()}));
          }
        }
      })());
      if (now - pricedCache.at >= 15000) tasks.push((async () => {
        try {
          const data = now < providerRetryAt.odds ? { races: await demoRacingFeed() } : await provider("/v1/racing/next-to-go", { num_races:200, categories:"horse,harness,greyhound" });
          pricedCache = { at: Date.now(), rows: rowsFrom(data) };
          providerErrors.odds = null;
          try {
            const recorded = await recordMarketSnapshots(pricedCache.rows, new Date(pricedCache.at).toISOString());
            console.info("MARKET_HISTORY", JSON.stringify({capturedAt:new Date(pricedCache.at).toISOString(), added:recorded.added, retained:recorded.total}));
          } catch (historyError) { console.error("MARKET_HISTORY_ERROR", historyError.message); }
          const sample = pricedCache.rows.slice(0,3).map(r=>({venue:venueOf(r),race:raceNumberOf(r),start:startTimeOf(r),runners:(r.runners||[]).slice(0,4).map(x=>({name:x.name||x.runner_name||x.horse_name||x.greyhound_name,quotes:runnerQuotes(x).slice(0,4).map(q=>({bookmaker:q.bookmaker||q.name||q.key,price:q.win_price??q.win??q.price}))}))}));
          console.info("FEED_CHECK odds", JSON.stringify({ ok:true, fetchedAt:new Date(pricedCache.at).toISOString(), races:pricedCache.rows.length, pricedRunners:pricedCache.rows.reduce((n,r)=>n+(r.runners||[]).filter(x=>runnerQuotes(x).length).length,0), sample }));
        } catch (err) {
          providerErrors.odds = err.message;
          providerRetryAt.odds = Date.now() + providerRetryDelay(err.message);
          try {
            const rows = await demoRacingFeed();
            pricedCache = { at: Date.now(), rows };
            providerErrors.odds = null;
            console.warn("FEED_FALLBACK odds", JSON.stringify({source:"PuntersEdge public demo",races:rows.length,at:new Date(pricedCache.at).toISOString(),primaryError:err.message}));
            try { await recordMarketSnapshots(pricedCache.rows, new Date(pricedCache.at).toISOString()); }
            catch (historyError) { console.error("MARKET_HISTORY_ERROR", historyError.message); }
          } catch (fallbackError) {
            providerErrors.odds = err.message + " | fallback: " + fallbackError.message;
            console.error("FEED_CHECK odds", JSON.stringify({ok:false,retryAt:new Date(providerRetryAt.odds).toISOString(),error:providerErrors.odds,at:new Date().toISOString()}));
          }
        }
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
      if (!fav || !fav.name || fav.quoteCount < 3 || fav.signalScore < 65) continue;
      const id = raceId(race), matchKey = raceMatchKey(race);
      if (history.picks.some(p => p.raceId === id || (matchKey && p.raceMatchKey === matchKey))) continue;
      history.picks.push({
        raceId:id, raceMatchKey:matchKey, category:categoryOf(race), venue:venueOf(race),
        raceNumber:raceNumberOf(race), startTime:startTimeOf(race),
        runnerName:fav.name, runnerNumber:fav.number, selectedOdds:fav.price,
        priceSource:fav.priceSource, quoteCount:fav.quoteCount,
        confidence:fav.signalLabel, signalScore:fav.signalScore, spreadPct:fav.spreadPct, gapPct:fav.gapPct,
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



const RAPID_ODDS_KEY = process.env.RAPIDODDSAPI_API_KEY || "";
const RAPID_ODDS_BASE = "https://api.rapidoddsapi.com";
const RAPID_BOOKMAKERS = ["Sportsbet","Bet365","TAB","PointsBet","Ladbrokes","Unibet","TABtouch","Betr","BetRight","PalmerBet","NextBet","PickleBet","Dabble","Amused","Betmakers","GenWeb","AllBets","PuntersTech","BetCloud"];
const RAPID_LIVE_SPORTS = ["AFL","NRL","NBA","NFL","MLB","WNBA"];
let liveSportsCache={at:0,events:[],error:null,credits:null,bySport:{},resultsAt:0,resultsBySport:{}};
let liveSportsRefresh=null;
let liveResultsRefresh=null;
async function rapidOdds(pathname, params={}) {
 if(!RAPID_ODDS_KEY) throw new Error("RAPIDODDSAPI_API_KEY is missing in Railway variables.");
 const url=new URL(RAPID_ODDS_BASE+pathname);
 url.searchParams.set("api_key",RAPID_ODDS_KEY);
 for(const [k,v] of Object.entries(params)) {
  if(Array.isArray(v)) v.forEach(x=>url.searchParams.append(k,x));
  else url.searchParams.set(k,String(v));
 }
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 const body=await response.text(); let data;
 try{data=JSON.parse(body);}catch{throw new Error("RapidOddsAPI returned invalid JSON (HTTP "+response.status+").");}
 if(!response.ok) throw new Error("RapidOddsAPI "+response.status+": "+(data.detail||data.error||"request failed"));
 return {data,remaining:response.headers.get("X-RateLimit-Remaining")};
}
function sportsTeamKey(v){return String(v||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g,"");}
function liveScoreSummary(score){
 if(!score)return null;
 const side=x=>x?Object.fromEntries(Object.entries(x).filter(([k,v])=>k!=="team"&&v!=null)):{};
 return {home:side(score.home),away:side(score.away),periodState:score.period_state||[],totals:score.totals||null};
}
app.get("/api/live-sports",async(_req,res)=>{
 try{
  if(!RAPID_ODDS_KEY) return res.status(503).json({configured:false,error:"Add RAPIDODDSAPI_API_KEY to Railway and deploy."});
  // Odds are refreshed every 15 minutes. Results are checked every 2 minutes;
  // RapidOddsAPI charges 1 credit per results request only when live games are returned.
  if(!liveSportsCache.at || Date.now()-liveSportsCache.at>15*60*1000){
   if(!liveSportsRefresh) liveSportsRefresh=(async()=>{
    const bySport={}; const oddsGames={};
    for(const sport of RAPID_LIVE_SPORTS){
     try{
      const result=await rapidOdds("/sports/"+encodeURIComponent(sport)+"/markets",{
       market_type:["head_to_head"],bookmaker:RAPID_BOOKMAKERS
      });
      bySport[sport]={ok:true,count:(result.data.games||[]).length};
      oddsGames[sport]=result.data.games||[];
     }catch(err){bySport[sport]={ok:false,error:err.message};oddsGames[sport]=[];}
    }
    liveSportsCache={...liveSportsCache,at:Date.now(),bySport,oddsGames,error:Object.values(bySport).every(x=>!x.ok)?"No bookmaker odds returned from RapidOddsAPI for the selected sports.":null};
   })().finally(()=>{liveSportsRefresh=null;});
   await liveSportsRefresh;
  }
  if(!liveSportsCache.resultsAt || Date.now()-liveSportsCache.resultsAt>120000){
   if(!liveResultsRefresh) liveResultsRefresh=(async()=>{
    const resultsBySport={};
    for(const sport of ["AFL","NRL","MLB","WNBA"]){
     try{
      const result=await rapidOdds("/results/"+encodeURIComponent(sport),{status:"live",include:"scores"});
      resultsBySport[sport]={ok:true,games:result.data.games||[]};
     }catch(err){resultsBySport[sport]={ok:false,error:err.message,games:[]};}
    }
    liveSportsCache.resultsBySport=resultsBySport;
    liveSportsCache.resultsAt=Date.now();
    console.info("RAPIDODDS_LIVE_RESULTS",JSON.stringify({at:new Date(liveSportsCache.resultsAt).toISOString(),bySport:Object.fromEntries(Object.entries(resultsBySport).map(([k,v])=>[k,{ok:v.ok,count:v.games.length,error:v.error||null}]))}));
   })().finally(()=>{liveResultsRefresh=null;});
   await liveResultsRefresh;
  }
  const events=[];
  const resultSports=liveSportsCache.resultsBySport||{};
  for(const [sport,resultSet] of Object.entries(resultSports)){
   if(!resultSet.ok)continue;
   for(const entry of resultSet.games||[]){
    const game=entry.game||{};
    if(String(game.status||"").toUpperCase()!=="LIVE")continue;
    const odds=(liveSportsCache.oddsGames?.[sport]||[]).find(item=>{
     const g=item.game||{};
     return sportsTeamKey(g.home_team)===sportsTeamKey(game.home_team)&&sportsTeamKey(g.away_team)===sportsTeamKey(game.away_team);
    });
    const books=(odds?.bookmakers||[]).map(book=>({
     name:book.name,lastUpdate:book.last_update,
     markets:(book.markets||[]).map(m=>({key:m.key,outcomes:(m.outcomes||[]).map(o=>({name:o.name,price:Number(o.price)}))}))
    }));
    const prices=books.flatMap(book=>book.markets.flatMap(m=>m.outcomes.map(o=>({...o,bookmaker:book.name,lastUpdate:book.lastUpdate})))).filter(o=>o.price>1);
    const bookmakerFavourites=books.map(book=>{
     const qs=book.markets.flatMap(m=>m.outcomes).filter(o=>Number(o.price)>1).sort((a,b)=>a.price-b.price);
     return {bookmaker:book.name,favourite:qs[0]||null,lastUpdate:book.lastUpdate||null};
    });
    events.push({id:String(game.game_id||[sport,game.home_team,game.away_team].join("|")),sport,
     home:game.home_team,away:game.away_team,name:(game.away_team||"")+" @ "+(game.home_team||""),
     commenceTime:game.commence_time,gameUrl:odds?.game?.game_url||null,status:"LIVE",
     score:liveScoreSummary(entry.score),lastUpdate:game.last_update||null,
     bookmakers:books,bookmakerFavourites,quoteCount:prices.length});
   }
  }
  const resultsErrors=Object.entries(resultSports).filter(([,v])=>!v.ok).map(([k,v])=>k+": "+v.error);
  res.set("Cache-Control","no-store");
  res.json({configured:true,provider:"RapidOddsAPI",events,
   sports:liveSportsCache.bySport,resultsSports:Object.fromEntries(Object.entries(resultSports).map(([k,v])=>[k,{ok:v.ok,count:v.games.length,error:v.error||null}])),
   fetchedAt:liveSportsCache.at?new Date(liveSportsCache.at).toISOString():null,
   resultsFetchedAt:liveSportsCache.resultsAt?new Date(liveSportsCache.resultsAt).toISOString():null,
   ageSeconds:liveSportsCache.resultsAt?Math.round((Date.now()-liveSportsCache.resultsAt)/1000):null,
   error:events.length?null:(resultsErrors.length?"Live results feed warning: "+resultsErrors.join(" · "):"No confirmed in-play fixtures returned by the live results feed."),
   bookmakers:RAPID_BOOKMAKERS,
   note:"Only fixtures marked LIVE by RapidOddsAPI Results are shown here. Scores come from the confirmed live results feed. Odds are shown only where the bookmaker returned a matching market; missing prices are not inferred. Live results are checked every 2 minutes."});
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
const RAPID_SPORT_ALIASES={
 nfl:"NFL",americanfootball_nfl:"NFL",nba:"NBA",basketball_nba:"NBA",wnba:"WNBA",mlb:"MLB",baseball_mlb:"MLB",nhl:"NHL",icehockey_nhl:"NHL",
 afl:"AFL",australianrules_afl:"AFL",nrl:"NRL",rugby_nrl:"NRL",epl:"EPL",soccer_epl:"EPL",mls:"MLS",soccer_usa_mls:"MLS",
 nbl:"NBL",basketball_nbl:"NBL",ncaab:"NCAAB",basketball_ncaab:"NCAAB",world_cup:"WORLD_CUP",
 mens_ao:"MENS_AO",mens_rg:"MENS_RG",mens_wimbledon:"MENS_WIMBLEDON",mens_uso:"MENS_USO"
};
const rapidSportsOddsCache=new Map();
function rapidSportId(key,title){
 const k=String(key||"").toLowerCase();
 if(RAPID_SPORT_ALIASES[k])return RAPID_SPORT_ALIASES[k];
 const t=String(title||"").toLowerCase();
 if(t.includes("australian rules")||t==="afl")return "AFL";
 if(t.includes("rugby league")||t==="nrl")return "NRL";
 if(t.includes("national basketball league")||t==="nbl")return "NBL";
 return null;
}
function mergeRapidOdds(baseEvents,rapidGames){
 const events=(baseEvents||[]).map(e=>({...e,bookmakers:[...(e.bookmakers||[])]}));
 for(const entry of rapidGames||[]){
  const g=entry.game||{};
  const home=String(g.home_team||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const away=String(g.away_team||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  let target=events.find(e=>{
   const eh=String(e.home_team||"").toLowerCase().replace(/[^a-z0-9]/g,"");
   const ea=String(e.away_team||"").toLowerCase().replace(/[^a-z0-9]/g,"");
   return eh===home&&ea===away;
  });
  if(!target){
   target={id:String(g.game_id||[home,away,g.commence_time].join("|")),home_team:g.home_team,away_team:g.away_team,
    commence_time:g.commence_time,bookmakers:[],_source:"RapidOddsAPI"};
   events.push(target);
  }
  for(const book of entry.bookmakers||[]){
   target.bookmakers.push({key:book.name,name:book.name,title:book.name,last_update:book.last_update,
    markets:(book.markets||[]).map(m=>({key:m.key==="head_to_head"?"h2h":m.key,outcomes:(m.outcomes||[]).map(o=>({name:o.name,price:Number(o.price),point:o.point}))}))});
  }
 }
 return events;
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
      const baseRows=rowsFrom(data);
      const sport=sportsCatalogueCache.rows.find(x=>String(x.key).toLowerCase()===key);
      const rapidId=rapidSportId(key,sport?.title||sport?.name);
      let rapidRows=[],rapidError=null,rapidFetchedAt=null;
      if(RAPID_ODDS_KEY && rapidId){
       try{
        let rc=rapidSportsOddsCache.get(rapidId);
        if(!rc||Date.now()-rc.at>=15*60*1000){
         const rr=await rapidOdds("/sports/"+encodeURIComponent(rapidId)+"/markets",{
          market_type:["head_to_head"],bookmaker:RAPID_BOOKMAKERS
         });
         rc={at:Date.now(),games:rr.data.games||[]};rapidSportsOddsCache.set(rapidId,rc);
        }
        rapidRows=rc.games;rapidFetchedAt=new Date(rc.at).toISOString();
       }catch(err){rapidError=err.message;}
      }
      cached={at:Date.now(),rows:mergeRapidOdds(baseRows,rapidRows),rapidFetchedAt,rapidError,rapidSport:rapidId,
       rapidGames:rapidRows.length};
      sportsOddsCache.set(key,cached);
    }
    res.set("Cache-Control","no-store");
    res.json({sport:sportsCatalogueCache.rows.find(x=>String(x.key).toLowerCase()===key),
      events:cached.rows, fetchedAt:new Date(cached.at).toISOString(), rapidFetchedAt:cached.rapidFetchedAt,
      rapidSport:cached.rapidSport,rapidGames:cached.rapidGames,rapidError:cached.rapidError,
      bookmakers:RAPID_BOOKMAKERS,refreshSeconds:900,liveInPlayAvailable:false,
      note:"Upcoming/pre-match head-to-head prices. Sportsbet, Bet365 and other bookmaker feeds are merged when the RapidOddsAPI feed has a matching fixture. Odds update on the provider's refresh cycle; this is not a second-by-second in-play odds feed."});
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
