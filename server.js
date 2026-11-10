require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.PUNTERSEDGE_API_KEY || "";
const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY || "";
const BETFAIR_SESSION_TOKEN = process.env.BETFAIR_SESSION_TOKEN || "";
const BETFAIR_RPC_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1";
const BETFAIR_FEED_URL = process.env.BETFAIR_FEED_URL || "";
let betfairRacingCache = { at:0, races:[], eventTypes:[], error:null };
let betfairRacingRefresh = null;
async function betfairRpc(method, params) {
  if (!BETFAIR_APP_KEY || !BETFAIR_SESSION_TOKEN) throw new Error("Betfair delayed app key or session token is missing in Railway.");
  const response = await fetch(BETFAIR_RPC_URL, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "X-Application":BETFAIR_APP_KEY,
      "X-Authentication":BETFAIR_SESSION_TOKEN,
      "Accept":"application/json"
    },
    body:JSON.stringify([{jsonrpc:"2.0",method:"SportsAPING/v1.0/"+method,params,id:1}]),
    signal:AbortSignal.timeout(20000)
  });
  const body = await response.text();
  let payload;
  try { payload=JSON.parse(body); } catch { throw new Error("Betfair returned invalid JSON (HTTP "+response.status+")."); }
  const item=Array.isArray(payload)?payload[0]:payload;
  if (!response.ok || item?.error || item?.result == null) {
    const detail=item?.error?.data?.APINGException?.errorCode || item?.error?.data?.errorCode ||
      item?.error?.message || "request failed";
    throw new Error("Betfair "+(response.status||"API")+": "+detail);
  }
  return item.result;
}
function betfairCategory(eventTypeName, eventName, marketName) {
  const value=[eventTypeName,eventName,marketName].join(" ").toLowerCase();
  if (/greyhound/.test(value)) return "greyhound";
  if (/harness|trotting|pacing/.test(value)) return "harness";
  return "horse";
}
async function loadBetfairRaces() {
  const eventTypes=await betfairRpc("listEventTypes",{filter:{marketCountries:["AU"]}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:x.eventType.name}));
  const racingTypes=types.filter(x=>/horse racing|greyhound racing|harness racing/i.test(x.name));
  if (!racingTypes.length) throw new Error("Betfair returned no Australian horse, greyhound or harness event types.");
  const from=new Date(), to=new Date(Date.now()+24*60*60*1000);
  const catalogueGroups=await Promise.all(racingTypes.map(async type=>{
    const markets=await betfairRpc("listMarketCatalogue",{
      filter:{eventTypeIds:[type.id],marketCountries:["AU"],marketTypeCodes:["WIN"],
        marketStartTime:{from:from.toISOString(),to:to.toISOString()}},
      marketProjection:["EVENT","MARKET_START_TIME","RUNNER_DESCRIPTION","MARKET_DESCRIPTION"],
      sort:"FIRST_TO_START",maxResults:"200"
    });
    return {type,markets:markets||[]};
  }));
  const all=catalogueGroups.flatMap(group=>group.markets.map(m=>({...m,_eventTypeName:group.type.name})));
  const books=[];
  for(let i=0;i<all.length;i+=40) {
    const batch=all.slice(i,i+40);
    const result=await betfairRpc("listMarketBook",{
      marketIds:batch.map(m=>m.marketId),
      priceProjection:{priceData:["EX_BEST_OFFERS"],virtualise:true}
    });
    books.push(...(result||[]));
  }
  const bookById=new Map(books.map(b=>[b.marketId,b]));
  const capturedAt=new Date().toISOString();
  const races=all.map(m=>{
    const book=bookById.get(m.marketId);
    if(!book) return null;
    const eventName=m.event?.name||"Unknown track";
    const marketName=m.marketName||"Win";
    const category=betfairCategory(m._eventTypeName,eventName,marketName);
    const raceNumberMatch=(eventName+" "+marketName).match(/(?:race|r)\s*(\d+)/i);
    const runners=(m.runners||[]).map(r=>{
      const priced=(book.runners||[]).find(x=>x.selectionId===r.selectionId);
      const back=priced?.ex?.availableToBack||[];
      const lay=priced?.ex?.availableToLay||[];
      const quote=back[0]?.price||lay[0]?.price||null;
      if(!quote||!Number.isFinite(Number(quote))||Number(quote)<=1||priced?.status==="REMOVED") return {number:r.sortPriority||null,name:r.runnerName,bookmakers:[]};
      return {number:r.sortPriority||null,name:r.runnerName,bookmakers:[{
        bookmaker:"Betfair Exchange (delayed)",name:"Betfair Exchange (delayed)",key:"betfair",
        win_price:Number(quote),age_seconds:null,last_update:capturedAt,source:"Betfair Exchange"
      }]};
    });
    return {race_id:"betfair-"+m.marketId,id:"betfair-"+m.marketId,category,
      code:category==="horse"?"thoroughbred":category,venue:eventName,track:eventName,
      race_number:raceNumberMatch?Number(raceNumberMatch[1]):null,
      start_time:m.marketStartTime,country:"Australia",status:book.status==="OPEN"?(book.inplay?"in_play":"scheduled"):String(book.status||"scheduled").toLowerCase(),
      in_play:!!book.inplay,closed:book.status!=="OPEN",captured_at:capturedAt,
      market_id:m.marketId,market_name:marketName,runners};
  }).filter(r=>r&&!r.closed&&r.runners.length);
  return {races,eventTypes:types};
}
async function getBetfairRaces() {
  if(!betfairRacingCache.at||Date.now()-betfairRacingCache.at>=30000) {
    if(!betfairRacingRefresh) betfairRacingRefresh=(async()=>{
      const result=await loadBetfairRaces();
      betfairRacingCache={at:Date.now(),races:result.races,eventTypes:result.eventTypes,error:null};
      console.info("BETFAIR_RACING_FEED",JSON.stringify({at:new Date(betfairRacingCache.at).toISOString(),
        races:result.races.length,categories:Object.fromEntries(["horse","greyhound","harness"].map(k=>[k,result.races.filter(r=>r.category===k).length])),
        pricedRaces:result.races.filter(r=>r.runners.some(x=>x.bookmakers.length)).length}));
    })().catch(error=>{betfairRacingCache.error=error.message;throw error;}).finally(()=>{betfairRacingRefresh=null;});
    await betfairRacingRefresh;
  }
  return {races:betfairRacingCache.races,scheduleFetchedAt:new Date(betfairRacingCache.at).toISOString(),
    oddsFetchedAt:new Date(betfairRacingCache.at).toISOString(),horizonHours:24,
    feedErrors:[],feedSource:"Betfair Exchange Delayed API",scope:"Australia",
    note:"Australian racing markets and exchange prices from Betfair's delayed application key. Prices are delayed and may not represent current bookmaker odds. Display-only integration; no betting actions are enabled."};
}
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
  // An empty array is a valid off-hours response (Australian racing has no cards 24/7).
  // Cache it too, otherwise every browser refresh hammers both feeds and fills logs with false errors.
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
  const raw = valueOf(r, ["race_type","raceType","race_code","code","category","sport","type"]);
  const c = String(raw || "").trim().toLowerCase().replace(/[ _-]+/g,"");
  if (c === "h" || c.includes("harness") || c.includes("trotting") || c.includes("pacing")) return "harness";
  if (c === "g" || c.includes("grey") || c.includes("dog")) return "greyhound";
  return "horse";
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
  // One current quote per independent bookmaker; ignore scratched runners and invalid prices.
  const unique=new Map();
  for(const q of (runner.bookmakers || runner.odds || [])) {
    const price=Number(q.win_price ?? q.win ?? q.price), key=bookmakerKey(q);
    if(!key || !Number.isFinite(price) || price<=1 || q.stale===true) continue;
    const previous=unique.get(key);
    const stamp=Date.parse(q.last_update||q.updated_at||"")||0;
    const previousStamp=Date.parse(previous?.last_update||previous?.updated_at||"")||0;
    if(!previous || stamp>=previousStamp) unique.set(key,q);
  }
  return [...unique.values()];
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
  const spreadPct=best.spread*100;
  // Quote agreement is a hard quality gate: broad disagreement must never be called strong.
  const rawScore=Math.round(Math.min(40,best.quotes.length/3*40)+Math.max(0,30*(1-best.spread/0.35))+Math.min(30,gap/0.15*30));
  const signalScore=spreadPct>25?Math.min(rawScore,25):spreadPct>15?Math.min(rawScore,55):rawScore;
  const signalLabel=best.quotes.length>=3&&spreadPct<=10&&signalScore>=65?"STRONG SIGNAL"
    :best.quotes.length>=2&&spreadPct<=25&&signalScore>=40?"CAUTION":"NO BET · WEAK SIGNAL";
  const r=best.runner;
  return {name:r.name||r.runner_name||r.horse_name||r.greyhound_name,number:r.number??r.runner_number??null,
    price:best.fair,priceSource:"multi-bookmaker median",quoteCount:best.quotes.length,
    spreadPct:+spreadPct.toFixed(1),gapPct:+(gap*100).toFixed(1),signalScore,signalLabel};
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

app.get("/api/health", (_req,res) => res.json({ok:true, liveFeedConfigured:!!API_KEY, liveSportsConfigured:!!ODDS_API_TOKEN, betfairConfigured:!!(BETFAIR_APP_KEY&&BETFAIR_SESSION_TOKEN), betfairMode:"delayed-read-only", storage:DATA_DIR}));
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
  return /(?:PuntersEdge[^\n]*|Racing provider) 402/.test(String(error)) ? 6 * 60 * 60 * 1000 : 60 * 1000;
}
// RapidOddsAPI is the single source of truth for Australian and NZ racing.
// Its racing endpoints return bookmaker-specific runner prices (win/place), not sports markets.
const RAPID_RACING_CODES = ["thoroughbred","harness","greyhound"];
const KROKODDS_API_KEY = process.env.KROKODDS_API_KEY || "";
const KROKODDS_BASE = "https://krokodds.com.au/api/v1";
let krokRacingCache = {at:0,races:[],meta:null,creditsRemaining:null};
async function fetchKrokRacing(date, raceType) {
  if (!KROKODDS_API_KEY) throw new Error("KROKODDS_API_KEY is missing in Railway variables.");
  const url = new URL(KROKODDS_BASE + "/odds-feed/racing");
  url.searchParams.set("date",date);
  // Free tier allows 10 racing rows per request; split by code.
  url.searchParams.set("race_type",raceType);
  url.searchParams.set("limit","10");
  const response = await fetch(url,{headers:{"X-API-Key":KROKODDS_API_KEY},signal:AbortSignal.timeout(20000)});
  const body = await response.text();
  let payload;
  try { payload=JSON.parse(body); } catch { throw new Error("Krok Odds returned invalid JSON (HTTP "+response.status+")."); }
  if (!response.ok || payload.success === false) throw new Error("Krok Odds "+response.status+": "+(payload.error||"request failed"));
  const grouped = new Map();
  const sourceRows=Array.isArray(payload.data)?payload.data:[];
  console.info("KROK_RACING_SCHEMA",JSON.stringify({
    payloadKeys:Object.keys(payload||{}),
    rowCount:sourceRows.length,
    rowKeys:sourceRows[0]?Object.keys(sourceRows[0]):[],
    raceTypeSamples:[...new Set(sourceRows.map(x=>String(x.race_type??x.category??x.type??"unknown")))].slice(0,12),
    raceKeys:sourceRows[0]?.races?.[0]?Object.keys(sourceRows[0].races[0]):[],
    runnerKeys:sourceRows[0]?.races?.[0]?.runners?.[0]?Object.keys(sourceRows[0].races[0].runners[0]):[],
    runnerSample:sourceRows[0]?.races?.[0]?.runners?.[0]||null
  }));
  for (const bookRow of sourceRows) {
    const book = bookRow.bookmaker_key || bookRow.bookmaker || "Unknown bookmaker";
    const venue = bookRow.venue || bookRow.venue_slug || "Unknown track";
    const rawType = valueOf(bookRow, ["race_type","raceType","race_code","code","category","sport","type"]);
      const code = String(rawType || "").trim().toUpperCase();
    const venueText = String(venue).toLowerCase();
    const category = code === "G" || /greyhound|dog/i.test(String(rawType||"")) ? "greyhound"
      : code === "H" || /harness|trotting|pacing/i.test(String(rawType||"")) ||
        /gloucester park|menangle|sulky|addington|alexandra park|ballarat harness|kilmore harness|bendigo harness|albion park harness/.test(venueText) ? "harness" : "horse";
    for (const race of (bookRow.races || [])) {
      const number = race.race_number ?? race.race_no ?? race.number;
      const start = race.start_time || race.jump_time || race.startTime || race.commence_time || race.scheduled_start || race.off_time || race.start_at || race.race_time || race.time || null;
      const id = String(race.race_id || race.id || [date,normalizeName(venue),code,number].join("-"));
      const key = id+"|"+category;
      if (!grouped.has(key)) grouped.set(key,{race_id:id,id,category,code:category==="horse"?"thoroughbred":category==="greyhound"?"greyhound":"harness",
        venue,track:venue,race_number:number,start_time:start||null,country:"Australia",
        status:race.status||race.market_status||race.event_status||(race.in_play||race.inplay||race.is_live?"in_play":"scheduled"),
        in_play:!!(race.in_play||race.inplay||race.is_live||/in[ _-]?play|live|running/i.test(String(race.status||race.market_status||race.event_status||""))),
        closed:/closed|final|result|abandon/i.test(String(race.status||race.market_status||race.event_status||"")),
        abandoned:/abandon/i.test(String(race.status||race.market_status||race.event_status||"")),captured_at:bookRow.captured_at||null,runners:[]});
      const target=grouped.get(key);
      if (race.status && (!target.status || target.status==="scheduled")) target.status=race.status;
      if (race.in_play || race.inplay || race.is_live || /in[ _-]?play|live|running/i.test(String(race.status||race.market_status||race.event_status||""))) target.in_play=true;
      if (start && !target.start_time) target.start_time=start;
      for (const runner of (race.runners || [])) {
        const name=runner.name||runner.runner_name||"Runner";
        const number=runner.number??runner.runner_number??null;
        let existing=target.runners.find(x=>number!=null?String(x.number)===String(number):normalizeName(x.name)===normalizeName(name));
        if(!existing){existing={number,name,bookmakers:[]};target.runners.push(existing);}
        const winRaw=runner.fixed_win??runner.win??runner.win_price??runner.odds;
        const placeRaw=runner.fixed_place??runner.place??runner.place_price;
        const win=Number(winRaw), place=Number(placeRaw);
        if(!runner.scratched && Number.isFinite(win)&&win>1) {
          const bookmakerId=String(book).toLowerCase().replace(/[^a-z0-9]/g,"");
          const quote={bookmaker:book,name:book,key:bookmakerId,win_price:win,
            place_price:Number.isFinite(place)&&place>1?place:null,age_seconds:null,
            last_update:runner.captured_at||runner.updated_at||bookRow.captured_at||null,url:runner.bet_link||null};
          const prior=existing.bookmakers.findIndex(q=>bookmakerKey(q)===bookmakerId);
          if(prior<0) existing.bookmakers.push(quote);
          else if(Date.parse(quote.last_update||"")>Date.parse(existing.bookmakers[prior].last_update||"")) existing.bookmakers[prior]=quote;
        }
      }
    }
  }
  return {races:[...grouped.values()],meta:payload.meta||null,
    creditsRemaining:response.headers.get("X-Credits-Remaining")};
}
async function getKrokRaces() {
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Melbourne",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(!krokRacingCache.at || Date.now()-krokRacingCache.at>=60000) {
    const codes=["T","G","H"];
    const results=await Promise.all(codes.map(async code=>{
      try { return await fetchKrokRacing(today,code); }
      catch(error) { return {races:[],meta:null,creditsRemaining:null,error:code+": "+error.message}; }
    }));
    const races=results.flatMap(x=>x.races||[]);
    const errors=results.filter(x=>x.error).map(x=>x.error);
    krokRacingCache={at:Date.now(),races,meta:results.map(x=>x.meta).filter(Boolean),
      creditsRemaining:results.map(x=>x.creditsRemaining).filter(x=>x!=null).join(", ")||null,errors};
    console.info("KROK_RACING_FEED",JSON.stringify({at:new Date(krokRacingCache.at).toISOString(),
      raceCount:races.length,categories:Object.fromEntries(["horse","greyhound","harness"].map(k=>[k,races.filter(r=>r.category===k).length])),
      pricedRaces:races.filter(r=>r.runners.some(x=>x.bookmakers.length)).length,
      runners:races.reduce((n,r)=>n+r.runners.length,0),creditsRemaining:krokRacingCache.creditsRemaining,errors}));
  }
  return {races:krokRacingCache.races,scheduleFetchedAt:new Date(krokRacingCache.at).toISOString(),
    oddsFetchedAt:new Date(krokRacingCache.at).toISOString(),horizonHours:24,
    feedErrors:krokRacingCache.errors.map(message=>({feed:"Krok Odds",message})),
    feedSource:"Krok Odds",creditsRemaining:krokRacingCache.creditsRemaining,meta:krokRacingCache.meta};
}

const RAPID_RACING_BOOKMAKERS = ["Sportsbet","Bet365","TAB","PointsBet","Ladbrokes","Unibet","TABtouch","Betr","BetRight","PalmerBet","NextBet","Picklebet","Dabble","Amused"];
let rapidRacingCache = { at:0, races:[], errors:[] };
let rapidRacingRefresh = null;
async function fetchRapidRacing(pathname, params={}) {
  if (!RAPID_ODDS_KEY) throw new Error("RAPIDODDSAPI_API_KEY is missing in Railway.");
  const url = new URL(RAPID_ODDS_BASE + pathname);
  url.searchParams.set("api_key", RAPID_ODDS_KEY);
  for (const [key,value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach(v=>url.searchParams.append(key,v));
    else if (value != null && value !== "") url.searchParams.set(key,String(value));
  }
  const response = await fetch(url,{signal:AbortSignal.timeout(20000)});
  const body = await response.text();
  let data;
  try { data=JSON.parse(body); } catch { throw new Error("RapidOddsAPI returned invalid JSON (HTTP "+response.status+")."); }
  if (!response.ok) throw new Error("RapidOddsAPI "+response.status+": "+(data.detail||data.error||"request failed"));
  return data;
}
function normalizeRapidRace(race) {
  const runners = new Map();
  for (const book of race.bookmakers || []) {
    for (const runner of book.runners || []) {
      const number = runner.number ?? null;
      const name = runner.name || "Runner";
      const key = number == null ? normalizeName(name) : "n"+number;
      if (!runners.has(key)) runners.set(key,{number,name,bookmakers:[]});
      const target = runners.get(key);
      const win = Number(runner.win), place = Number(runner.place);
      if (!runner.scratched && Number.isFinite(win) && win > 1) {
        target.bookmakers.push({bookmaker:book.bookmaker,name:book.bookmaker,win_price:win,place_price:Number.isFinite(place)&&place>1?place:null,
          age_seconds:book.last_update?Math.max(0,Math.floor((Date.now()-Date.parse(book.last_update))/1000)):null,
          last_update:book.last_update||null,url:book.url||null});
      }
    }
  }
  const code = race.code || "thoroughbred";
  return {race_id:race.race_id, id:race.race_id, category:code==="greyhound"?"greyhound":code==="harness"?"harness":"horse",
    code,venue:race.track,track:race.track,race_number:race.race_number,start_time:race.start_time,
    country:race.country,closed:!!race.closed,abandoned:!!race.abandoned,
    bookmakers:(race.bookmakers||[]).map(b=>({bookmaker:b.bookmaker,url:b.url||null,status:b.status,last_update:b.last_update})),
    runners:[...runners.values()]};
}
async function loadRapidRacing() {
  const errors=[];
  const meetingsByCode=await Promise.all(RAPID_RACING_CODES.map(async code=>{
    try {
      const data=await fetchRapidRacing("/racing/meetings",{countries:"AU",code});
      return {code,meetings:data.meetings||[]};
    } catch(err) { errors.push(code+" meetings: "+err.message); return {code,meetings:[]}; }
  }));
  const meetingJobs=meetingsByCode.flatMap(({code,meetings})=>meetings.map(async meeting=>{
    try {
      const data=await fetchRapidRacing("/racing/races",{track:meeting.track,code,countries:meeting.country||"AU,NZ",
        bookmakers:RAPID_RACING_BOOKMAKERS.join(","),countries:"AU"});
      return (data.races||[]).map(normalizeRapidRace);
    } catch(err) { errors.push(meeting.track+" ("+code+"): "+err.message); return []; }
  }));
  const groups=await Promise.all(meetingJobs);
  const races=groups.flat().filter(r=>r.start_time && !r.abandoned);
  return {races,errors};
}
// PuntersEdge is the primary Australian racing source: its schedule endpoint includes
// unpriced races and next-to-go supplies runner-by-runner quotes from the supported books.
const PUNTERS_EDGE_BOOKMAKERS = ["Sportsbet","BetRight","PointsBet","TAB","TABtouch","Palmerbet","Unibet","NextBet","Ladbrokes","Neds","bet365","BetDeluxe"];
const puntersEdgeCache = {
  schedule:{at:0,rows:[],etag:null}, priced:{at:0,rows:[],etag:null},
  errors:[]
};
let puntersEdgeRefresh = null;
async function fetchPuntersEdge(pathname, params, cacheName) {
  const cache=puntersEdgeCache[cacheName];
  const url=new URL(BASE+pathname);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const headers={"X-API-Key":API_KEY};
  if(cache.etag) headers["If-None-Match"]=cache.etag;
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
  if(response.status===304) {
    cache.at=Date.now();
    return cache.rows;
  }
  const body=await response.text();
  let payload;
  try{payload=JSON.parse(body);}catch{throw new Error("PuntersEdge "+pathname+" returned invalid JSON (HTTP "+response.status+").");}
  if(!response.ok) throw new Error("PuntersEdge "+pathname+" "+response.status+": "+(payload.detail||payload.error||body.slice(0,220)));
  cache.rows=rowsFrom(payload).filter(r=>{
    const country=String(r.country||r.country_code||"").toUpperCase();
    return !country || country==="AU";
  });
  cache.etag=response.headers.get("ETag")||null;
  cache.at=Date.now();
  return cache.rows;
}
async function loadPuntersEdgeRaces() {
  const errors=[];
  const now=Date.now();
  if((!puntersEdgeCache.schedule.at || now-puntersEdgeCache.schedule.at>=10*60*1000) && now>=providerRetryAt.schedule) {
    try {
      await fetchPuntersEdge("/v1/racing/events",{
        hours_ahead:SCHEDULE_HORIZON_HOURS,country:"AU",include_unresolved:"true",
        categories:"horse,greyhound,harness"
      },"schedule");
      providerRetryAt.schedule=0;
    } catch(err) {
      errors.push("Schedule: "+err.message);
      providerRetryAt.schedule=Date.now()+providerRetryDelay(err.message);
    }
  } else if(now<providerRetryAt.schedule) {
    errors.push("Schedule refresh paused after provider quota response; retrying after "+new Date(providerRetryAt.schedule).toISOString());
  }
  // Conditional ETag reads return HTTP 304 at no credit cost when the board is unchanged.
  if((!puntersEdgeCache.priced.at || now-puntersEdgeCache.priced.at>=60000) && now>=providerRetryAt.odds) {
    try {
      await fetchPuntersEdge("/v1/racing/next-to-go",{
        num_races:200,country:"AU",include_unresolved:"true",
        categories:"horse,greyhound,harness"
      },"priced");
      providerRetryAt.odds=0;
    } catch(err) {
      errors.push("Live odds: "+err.message);
      providerRetryAt.odds=Date.now()+providerRetryDelay(err.message);
    }
  } else if(now<providerRetryAt.odds) {
    errors.push("Live odds refresh paused after provider quota response; retrying after "+new Date(providerRetryAt.odds).toISOString());
  }
  const races=dedupeRaces([...(puntersEdgeCache.schedule.rows||[]),...(puntersEdgeCache.priced.rows||[])]);
  if(!races.length && errors.length) throw new Error(errors.join(" · "));
  console.info("PUNTERS_EDGE_RACING",JSON.stringify({
    scheduleCount:puntersEdgeCache.schedule.rows.length,pricedCount:puntersEdgeCache.priced.rows.length,
    mergedCount:races.length,books:[...new Set(races.flatMap(r=>(r.runners||[]).flatMap(x=>runnerQuotes(x).map(q=>q.bookmaker||q.name||q.key))))],
    errors
  }));
  return {
    races, scheduleFetchedAt:puntersEdgeCache.schedule.at?new Date(puntersEdgeCache.schedule.at).toISOString():null,
    oddsFetchedAt:puntersEdgeCache.priced.at?new Date(puntersEdgeCache.priced.at).toISOString():null,
    horizonHours:SCHEDULE_HORIZON_HOURS,feedErrors:errors.map(message=>({feed:"PuntersEdge",message})),
    feedSource:"PuntersEdge Australian racing",scope:"Australia",providerPlan:PROVIDER_PLAN,
    note:"Australian horse, greyhound and harness schedule merged with current runner prices from every bookmaker supported by the connected feed. Sportsbet, bet365 and other supported Australian books appear when they publish a quote. Quote age varies by bookmaker. The feed cannot include bookmakers or races its licensed data provider does not supply."
  };
}
async function getGlobalRaces() {
  const failures=[];
  if (API_KEY) {
    try {
      const primary=await loadPuntersEdgeRaces();
      if (primary.races?.length) return primary;
      failures.push({feed:"PuntersEdge",message:"Schedule and next-to-go endpoints returned no races."});
    } catch(error) {
      console.error("PUNTERS_EDGE_PRIMARY_FAILED",error.message);
      failures.push({feed:"PuntersEdge",message:error.message});
    }
  }
  if (BETFAIR_FEED_URL) {
    try {
      const response=await fetch(BETFAIR_FEED_URL,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(response.ok && Array.isArray(data.races) && data.races.length) {
        return {...data,feedErrors:failures,feedSource:data.feedSource||"Betfair Exchange"};
      }
      failures.push({feed:"Betfair AU service",message:data.error||"No Australian markets returned (HTTP "+response.status+")."});
    } catch(error) {
      failures.push({feed:"Betfair AU service",message:error.message});
    }
  }
  // Betfair delayed Exchange data is the no-cost read-only fallback.
  // It is queried only for catalogue and market prices; no order endpoints are used.
  if (BETFAIR_APP_KEY && BETFAIR_SESSION_TOKEN) {
    try {
      const fallback=await getBetfairRaces();
      if (fallback.races?.length) return {...fallback,feedErrors:failures};
      failures.push({feed:"Betfair",message:"No Australian racing markets returned in the next 24 hours."});
    } catch(error) {
      console.error("BETFAIR_RACING_FAILED",error.message);
      failures.push({feed:"Betfair",message:error.message});
    }
  }
  // Try RapidOdds before Krok: Krok free-tier requests are limited and may be
  // exhausted, while RapidOdds can provide the meeting schedule and race markets.
  if (RAPID_ODDS_KEY) {
    try {
      if (!rapidRacingCache.at || Date.now()-rapidRacingCache.at>=60000) {
        if (!rapidRacingRefresh) rapidRacingRefresh=(async()=>{
          const result=await loadRapidRacing();
          rapidRacingCache={at:Date.now(),races:result.races,errors:result.errors};
        })().finally(()=>{rapidRacingRefresh=null;});
        await rapidRacingRefresh;
      }
      if (rapidRacingCache.races.length) return {
        races:rapidRacingCache.races,
        scheduleFetchedAt:new Date(rapidRacingCache.at).toISOString(),
        oddsFetchedAt:new Date(rapidRacingCache.at).toISOString(),
        horizonHours:24,
        feedErrors:[...failures,...rapidRacingCache.errors.map(message=>({feed:"RapidOddsAPI",message}))],
        feedSource:"RapidOddsAPI Australian Racing",scope:"Australia"
      };
      failures.push({feed:"RapidOddsAPI",message:"No Australian races returned for the requested meetings."},
        ...rapidRacingCache.errors.map(message=>({feed:"RapidOddsAPI",message})));
    } catch(error) {
      failures.push({feed:"RapidOddsAPI",message:error.message});
    }
  }
  if (KROKODDS_API_KEY) {
    try {
      const fallback=await getKrokRaces();
      if (fallback.races?.length) return {...fallback,scope:"Australia",feedErrors:[...failures,...(fallback.feedErrors||[])]};
      failures.push(...(fallback.feedErrors||[]),{feed:"Krok Odds",message:"No Australian races returned."});
    } catch(error) {
      failures.push({feed:"Krok Odds",message:error.message});
    }
  }
  if (failures.length) throw new Error(failures.map(x=>x.feed+": "+x.message).join(" · "));
  throw new Error("No Australian racing feed API key is configured in Railway.");
}

function dedupeRaces(input) {
  const unique = new Map();
  for (const race of input || []) {
    const category = categoryOf(race), venue = normalizeName(venueOf(race));
    const number = String(raceNumberOf(race) ?? "").trim(), day = localRaceDate(startTimeOf(race));
    const key = [category, venue, number, day].join("|");
    if (!venue || !number || !day) { const fallback=raceId(race); if(!unique.has(fallback)) unique.set(fallback,race); continue; }
    if (!unique.has(key)) { unique.set(key,{...race,runners:(race.runners||[]).map(r=>({...r,bookmakers:[...(r.bookmakers||r.odds||[])]}))}); continue; }
    const target=unique.get(key);
    for (const runner of race.runners||[]) {
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const n=runner.number??runner.runner_number;
      let existing=(target.runners||[]).find(x=>n!=null&&(x.number??x.runner_number)!=null
        ? String(x.number??x.runner_number)===String(n)
        : normalizeName(x.name||x.runner_name)===normalizeName(name));
      if(!existing){existing={...runner,name,bookmakers:[]};target.runners.push(existing);}
      for(const q of runner.bookmakers||runner.odds||[]){
        const qkey=bookmakerKey(q); if(!qkey)continue;
        const ix=existing.bookmakers.findIndex(x=>bookmakerKey(x)===qkey);
        if(ix<0)existing.bookmakers.push(q);
        else {
          const old=existing.bookmakers[ix], fresh=Date.parse(q.last_update||q.updated_at||""), prior=Date.parse(old.last_update||old.updated_at||"");
          if((Number.isFinite(fresh)&&(!Number.isFinite(prior)||fresh>prior))||
             (q.age_seconds!=null&&(old.age_seconds==null||Number(q.age_seconds)<Number(old.age_seconds)))) existing.bookmakers[ix]=q;
        }
      }
    }
  }
  return [...unique.values()].sort((a,b)=>new Date(startTimeOf(a)||0)-new Date(startTimeOf(b)||0));
}

app.get("/api/races", async (_req, res) => {
  try {
    const feed = await getGlobalRaces();
    const races = dedupeRaces(feed.races);
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
    const providerBookmakers = [...new Map(races.flatMap(r => (r.runners || []).flatMap(x => runnerQuotes(x).map(q => {
      const name = q.bookmaker || q.name || q.key || "Bookmaker";
      return [bookmakerKey(q), name];
    }))).filter(([key]) => !!key)).entries()].map(([key,name]) => ({key,name}));
    res.json({races, providerBookmakers, mode:"live", feedSource:feed.feedSource || "RapidOddsAPI racing", fetchedAt:new Date().toISOString(),
      scheduleFetchedAt:feed.scheduleFetchedAt, oddsFetchedAt:feed.oddsFetchedAt,
      horizonHours:feed.horizonHours, providerPlan:feed.providerPlan||feed.meta?.tier||PROVIDER_PLAN, creditsRemaining:feed.creditsRemaining ?? null, feedMeta:feed.meta || null, feedErrors:feed.feedErrors, scope:"Australia",
      note:feed.note||"Australian horse, greyhound and harness races returned by the connected licensed feed. Bookmaker prices are shown only when supplied; coverage depends on the provider and supported bookmakers."});
  } catch (err) { res.status(503).json({error:err.message,mode:"offline"}); }
});




async function krokRequest(pathname, params={}) {
  if (!KROKODDS_API_KEY) throw new Error("KROKODDS_API_KEY is missing in Railway variables.");
  const url = new URL(KROKODDS_BASE + pathname);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,String(v)));
  const response = await fetch(url,{headers:{"X-API-Key":KROKODDS_API_KEY},signal:AbortSignal.timeout(20000)});
  const body = await response.text();
  let payload;
  try { payload=JSON.parse(body); } catch { throw new Error("Krok Odds returned invalid JSON (HTTP "+response.status+")."); }
  if (!response.ok || payload.success === false) throw new Error("Krok Odds "+response.status+": "+(payload.error||payload.message||"request failed"));
  return {payload, creditsRemaining:response.headers.get("X-Credits-Remaining")};
}

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
// Krok Odds is the single source for the sports catalogue and pre-match sports prices.
let sportsCatalogueCache = { at:0, rows:[], meta:null };
const sportsOddsCache = new Map();
app.get("/api/sports", async (_req,res) => {
  try {
    if (!sportsCatalogueCache.at || Date.now()-sportsCatalogueCache.at >= 300000) {
      const result = await krokRequest("/odds-feed/sports");
      const rows = Array.isArray(result.payload.data) ? result.payload.data : [];
      sportsCatalogueCache = {at:Date.now(),rows:rows.map(x=>({
        key:String(x.sport||x.key||"").toLowerCase(),
        title:x.label||x.title||x.sport||x.key,
        name:x.label||x.title||x.sport||x.key,
        category:x.category||"Sports",
        event_count:Number(x.event_count||0),
        bookmakers:x.bookmakers||[],
        href:x.href||null,
        active:true
      })).filter(x=>x.key),meta:result.payload.meta||null};
      console.info("KROK_SPORTS_INDEX",JSON.stringify({sports:sportsCatalogueCache.rows.length,
        eventCounts:sportsCatalogueCache.rows.reduce((n,x)=>n+x.event_count,0),
        creditsRemaining:result.creditsRemaining}));
    }
    res.set("Cache-Control","no-store");
    res.json({sports:sportsCatalogueCache.rows,fetchedAt:new Date(sportsCatalogueCache.at).toISOString(),
      provider:"Krok Odds",providerMeta:sportsCatalogueCache.meta,refreshSeconds:300,
      liveInPlayAvailable:false,
      note:"Sports catalogue and pre-match bookmaker odds are supplied by Krok Odds. In-play scores are not claimed unless a live-score source confirms them."});
  } catch(err) { res.status(503).json({error:err.message,provider:"Krok Odds"}); }
});
async function ensureSportsCatalogue() {
  if (!sportsCatalogueCache.at || Date.now()-sportsCatalogueCache.at >= 300000) {
    const result=await krokRequest("/odds-feed/sports");
    const rows=Array.isArray(result.payload.data)?result.payload.data:[];
    sportsCatalogueCache={at:Date.now(),rows:rows.map(x=>({
      key:String(x.sport||x.key||"").toLowerCase(),title:x.label||x.title||x.sport||x.key,
      name:x.label||x.title||x.sport||x.key,category:x.category||"Sports",
      event_count:Number(x.event_count||0),bookmakers:x.bookmakers||[],href:x.href||null,active:true
    })).filter(x=>x.key),meta:result.payload.meta||null};
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
  const key=String(req.params.sportKey||"").toLowerCase();
  if(!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({error:"Invalid sport key"});
  try {
    await ensureSportsCatalogue();
    const sport=sportsCatalogueCache.rows.find(x=>x.key===key);
    if(!sport) return res.status(404).json({error:"Sport is not in Krok Odds' live sports catalogue."});
    let cached=sportsOddsCache.get(key);
    if(!cached||Date.now()-cached.at>=60000){
      // Page the free sports feed up to its documented 100-event scan cap.
      const pages=[]; let cursor=null; let result=null;
      for(let page=0;page<4;page++){
        const params={limit:25,fresh:true};
        if(cursor) params.cursor=cursor;
        result=await krokRequest("/odds-feed/sports/"+encodeURIComponent(key),params);
        pages.push(...(Array.isArray(result.payload.data)?result.payload.data:[]));
        const next=result.payload.meta?.next_cursor||result.payload.meta?.next||null;
        if(!next||next===cursor) break;
        cursor=next;
      }
      const raw=pages;
      console.info("KROK_SPORT_SCHEMA",JSON.stringify({
        sport:key,payloadKeys:Object.keys(result.payload||{}),eventCount:raw.length,
        eventKeys:raw[0]?Object.keys(raw[0]):[],
        bookmakerKeys:raw[0]?.bookmakers?.[0]?Object.keys(raw[0].bookmakers[0]):[],
        marketKeys:raw[0]?.bookmakers?.[0]?.markets?.[0]?Object.keys(raw[0].bookmakers[0].markets[0]):[],
        selectionKeys:raw[0]?.bookmakers?.[0]?.markets?.[0]?.selections?.[0]?Object.keys(raw[0].bookmakers[0].markets[0].selections[0]):[],
        eventSample:raw[0]||null
      }));
      // Krok's feed is flat: each row is one event/bookmaker pair.
      // Group rows into one event and preserve each bookmaker's own markets.
      const eventMap=new Map();
      const toMarkets=(source)=> (source||[]).map(m=>({
        key:m.market_key||m.key||m.name||"h2h",
        name:m.market_label||m.name||m.market_key||"Head to head",
        outcomes:(m.selections||m.outcomes||[]).map(o=>({
          name:o.name||o.selection||o.label||"Selection",
          price:Number(o.odds??o.price??o.decimal_odds),
          point:o.point??o.line??null,
          suspended:!!o.suspended
        })).filter(o=>Number.isFinite(o.price)&&o.price>1&&!o.suspended)
      })).filter(m=>m.outcomes.length);
      for(const [i,e] of raw.entries()){
        const home=e.home_team||e.home||e.team_home||null;
        const away=e.away_team||e.away||e.team_away||null;
        const start=e.start_time||e.commence_time||e.event_start||null;
        const eventName=e.event||e.name||[home,away].filter(Boolean).join(" v ")||"Unknown event";
        const identity=[e.sport_slug||key,e.league_slug||e.competition||"",sportsTeamKey(home||eventName),sportsTeamKey(away||""),start||""].join("|");
        const eventId=String(e.event_id||e.id||identity);
        const groupKey=identity.replace(/\|+$/,"")||eventId;
        if(!eventMap.has(groupKey)) eventMap.set(groupKey,{
          ...e,id:eventId,home_team:home,away_team:away,event:eventName,
          commence_time:start,bookmakers:[],_source:"Krok Odds"
        });
        const target=eventMap.get(groupKey);
        const bookName=e.bookmaker||e.bookmaker_name||e.bookmaker_key||"Unknown bookmaker";
        const bookKey=String(e.bookmaker_key||e.bookmaker||e.bookmaker_name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
        let markets=toMarkets(e.markets||e.odds||[]);
        if(!markets.length&&(e.selections||e.outcomes||[]).length)
          markets=toMarkets([{key:"h2h",name:"Head to head",selections:e.selections||e.outcomes}]);
        // Also tolerate the nested response shape without losing its provider identity.
        const nested=(e.bookmakers||[]).map((b,j)=>({
          key:String(b.bookmaker_key||b.key||b.name||("book-"+j)).toLowerCase().replace(/[^a-z0-9]/g,""),
          name:b.bookmaker||b.bookmaker_name||b.name||b.bookmaker_key||"Bookmaker",
          last_update:b.captured_at||b.last_update||e.captured_at||null,
          markets:toMarkets(b.markets||[])
        }));
        const incoming=[...(markets.length?[{key:bookKey,name:bookName,last_update:e.captured_at||null,markets}]:[]),...nested];
        for(const b of incoming){
          if(!b.key||!b.markets.length) continue;
          const prior=target.bookmakers.findIndex(x=>x.key===b.key);
          if(prior<0) target.bookmakers.push(b);
          else {
            const merged=new Map(target.bookmakers[prior].markets.map(m=>[m.key,m]));
            for(const m of b.markets) merged.set(m.key,m);
            target.bookmakers[prior]={...target.bookmakers[prior],...b,markets:[...merged.values()]};
          }
        }
      }
      const events=[...eventMap.values()].map(e=>{
        const status=String(e.status||e.event_status||e.market_status||"").toLowerCase();
        const inPlay=!!(e.in_play||e.inplay||e.is_live||/in[ _-]?play|live|running/.test(status));
        return {...e,in_play:inPlay,status:inPlay?"IN PLAY":(e.status||"UPCOMING")};
      });
      cached={at:Date.now(),rows:events,meta:result?.payload?.meta||null,creditsRemaining:result?.creditsRemaining||null};
      sportsOddsCache.set(key,cached);
      console.info("KROK_SPORT_ODDS",JSON.stringify({sport:key,events:events.length,
        pricedEvents:events.filter(e=>e.bookmakers.some(b=>b.markets.some(m=>m.outcomes.length))).length,
        creditsRemaining:result.creditsRemaining}));
    }
    res.set("Cache-Control","no-store");
    res.json({sport,events:cached.rows,fetchedAt:new Date(cached.at).toISOString(),
      provider:"Krok Odds",providerMeta:cached.meta,creditsRemaining:cached.creditsRemaining,
      refreshSeconds:60,liveInPlayAvailable:cached.rows.some(e=>e.in_play),
      note:"Upcoming/pre-match events and bookmaker markets from Krok Odds. Live scores are not inferred; event prices depend on Krok's available coverage."});
  } catch(err) {res.status(503).json({error:err.message,sportKey:key,provider:"Krok Odds"});}
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
// Keep the racing feed warm even when nobody has the dashboard open. The browser
// still calls /api/races for display, while this server-side poll guarantees provider
// requests and cache refreshes happen independently of browser traffic.
async function refreshBackgroundRacingFeed() {
  if (puntersEdgeRefresh) return puntersEdgeRefresh;
  puntersEdgeRefresh = (async () => {
    try {
      const feed = await getGlobalRaces();
      console.info("RACING_BACKGROUND_REFRESH", JSON.stringify({
        source: feed.feedSource || "fallback",
        races: (feed.races || []).length,
        scheduleFetchedAt: feed.scheduleFetchedAt || null,
        oddsFetchedAt: feed.oddsFetchedAt || null,
        apiKeyConfigured: !!API_KEY,
        errors: feed.feedErrors || []
      }));
    } catch (error) {
      console.error("RACING_BACKGROUND_REFRESH_FAILED", error.message);
    }
  })().finally(() => { puntersEdgeRefresh = null; });
  return puntersEdgeRefresh;
}
app.listen(PORT,"0.0.0.0",()=>{
  console.log(`Racing Favourite Finder listening on ${PORT}`);
  console.log("RACING_FEED_CONFIG", JSON.stringify({
    puntersEdgeKeyConfigured: !!API_KEY,
    providerPlan: PROVIDER_PLAN,
    scheduleHorizonHours: SCHEDULE_HORIZON_HOURS
  }));
  setTimeout(refreshBackgroundRacingFeed, 1500);
  setInterval(refreshBackgroundRacingFeed, 60000);
});
