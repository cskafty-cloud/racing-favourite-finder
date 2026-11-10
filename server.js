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
let betfairRetryAt = 0;
let betfairFeedRetryAt = 0;
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
  const rows = (Array.isArray(payload) ? payload : (Array.isArray(payload.races) ? payload.races : []))
    .map(r=>({...r,_publicDemo:true,runners:(r.runners||[]).map(x=>({...x,
      bookmakers:(x.bookmakers||x.odds||[]).map(q=>({...q,public_demo:true}))}))}));
  // An empty array is a valid off-hours response (Australian racing has no cards 24/7).
  // Cache it too, otherwise every browser refresh hammers both feeds and fills logs with false errors.
  demoRacingCache = { at: Date.now(), rows };
  return rows;
}

const publicDemoCache = new Map();
async function publicDemoRequest(pathname, params={}) {
  const url=new URL(BASE+pathname);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  const body=await response.text(); let data;
  try { data=JSON.parse(body); } catch { throw new Error("Public odds preview returned invalid JSON (HTTP "+response.status+")."); }
  if(!response.ok) throw new Error("Public odds preview "+response.status+": "+(data.detail||data.error||body.slice(0,180)));
  return data;
}
const MOVI_SPORT_SLUGS = {
  oddsdata_1:"soccer",oddsdata_3:"cricket",oddsdata_8:"rugby_union",oddsdata_9:"boxing",
  oddsdata_12:"american_football",oddsdata_13:"tennis",oddsdata_14:"snooker",oddsdata_15:"darts",
  oddsdata_16:"baseball",oddsdata_17:"ice_hockey",oddsdata_18:"basketball",oddsdata_19:"rugby_league",
  oddsdata_36:"australian_rules",oddsdata_75:"gaelic_sports",oddsdata_78:"handball",oddsdata_83:"futsal",
  oddsdata_90:"floorball",oddsdata_91:"volleyball",oddsdata_92:"table_tennis",oddsdata_94:"badminton",
  oddsdata_151:"esports",oddsdata_162:"mma",oddsdata_163:"bandy",oddsdata_164:"field_hockey"
};
const MOVI_WINNER_GROUPS = {
  oddsdata_1:["40","1777"],oddsdata_3:["1246","30154"],oddsdata_12:["1441","58"],
  oddsdata_13:["83","67"],oddsdata_16:["1096"],oddsdata_17:["972","96"],oddsdata_18:["1453","112"]
};
const PUBLIC_DEMO_SPORTS = {
  oddsdata_1:"soccer",oddsdata_3:"cricket",oddsdata_8:"rugby-union",oddsdata_9:"boxing",
  oddsdata_12:"nfl",oddsdata_13:"tennis",oddsdata_14:"snooker",oddsdata_15:"darts",
  oddsdata_16:"mlb",oddsdata_17:"nhl",oddsdata_18:"nba",oddsdata_19:"nrl",
  oddsdata_36:"afl",oddsdata_66:"bowls",oddsdata_75:"gaelic-sports",oddsdata_78:"handball",
  oddsdata_83:"futsal",oddsdata_90:"floorball",oddsdata_91:"volleyball",oddsdata_92:"table-tennis",
  oddsdata_94:"badminton",oddsdata_95:"beach-volleyball",oddsdata_107:"squash",oddsdata_110:"water-polo",
  oddsdata_151:"esports",oddsdata_162:"mma",oddsdata_163:"bandy",oddsdata_164:"field-hockey"
};
function publicDemoItems(payload) {
  if(Array.isArray(payload)) return payload;
  for(const key of ["items","events","results","data","matches"]) if(Array.isArray(payload?.[key])) return payload[key];
  return [];
}
const PUNTERS_EDGE_BOOK_SPORTS = {
  oddsdata_36:"afl",oddsdata_19:"nrl",oddsdata_18:"nba",
  oddsdata_3:"cricket",oddsdata_13:"tennis",oddsdata_8:"rugby-union"
};
const PUNTERS_EDGE_BEST_SPORTS = {oddsdata_36:"afl",oddsdata_19:"nrl",oddsdata_18:"nba"};
function addPublicOutcome(event, bookKey, name, price, updatedAt=null) {
  if(!Number.isFinite(Number(price))||Number(price)<=1||!name)return;
  const key=String(bookKey||"unknown").toLowerCase().replace(/[^a-z0-9]/g,"");
  let book=(event.bookmakers||[]).find(b=>String(b.key||b.name||"").toLowerCase().replace(/[^a-z0-9]/g,"")===key);
  if(!book){book={key:String(bookKey||"unknown").toLowerCase(),name:String(bookKey||"Unknown").replace(/[_-]/g," "),last_update:updatedAt,markets:[]};event.bookmakers.push(book);}
  let market=book.markets.find(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
  if(!market){market={key:"h2h",name:"Head to head",outcomes:[]};book.markets.push(market);}
  const existing=market.outcomes.find(o=>String(o.name).toLowerCase()===String(name).toLowerCase());
  if(existing)existing.price=Number(price);else market.outcomes.push({name:String(name),price:Number(price)});
}
function normalizePublicBookSport(item, book, sport) {
  const prices=Array.isArray(item.prices)?item.prices:Array.isArray(item.odds)?item.odds:
    (item.markets||[]).flatMap(m=>m.outcomes||m.selections||[]);
  const outcomes=prices.map(p=>({name:p.name||p.selection||p.label||"Selection",price:Number(p.price??p.odds??p.decimal??p.best_price)}))
    .filter(p=>Number.isFinite(p.price)&&p.price>1);
  const home=item.home_team||item.home||item.homeTeam||"";
  const away=item.away_team||item.away||item.awayTeam||"";
  const start=item.commence_time||item.start_time||item.kickoff||item.time||null;
  const explicitLive=item.in_play===true||item.inplay===true||/^(live|in.?play|running)$/i.test(String(item.status||""));
  return {id:String(item.id||item.event_id||[home,away,start].join("|")),home_team:home||"Event",away_team:away,
    league:item.league||item.competition||item.tournament||"",sport_name:sport.title,commence_time:start,
    in_play:explicitLive,status:explicitLive?"LIVE":"UPCOMING",score:item.score||item.ss||null,
    bookmakers:outcomes.length?[{key:book,name:book==="sportsbet"?"Sportsbet":"Bet365",last_update:item.updated_at||item.last_update||null,
      markets:[{key:"h2h",name:"Head to head",outcomes}]}]:[],_publicDemo:true};
}
function normalizeBestOddsEvent(item,sport) {
  const home=item.home_team||item.home||"",away=item.away_team||item.away||"";
  const event={id:String(item.id||[home,away,item.commence_time].join("|")),home_team:home||"Event",away_team:away,
    league:item.league||item.competition||"",sport_name:sport.title,commence_time:item.commence_time||item.start_time||null,
    in_play:item.in_play===true||/^(live|in.?play|running)$/i.test(String(item.status||"")),
    status:item.in_play===true?"LIVE":"UPCOMING",score:item.score||null,bookmakers:[],_publicDemo:true,_bestOddsDemo:true};
  for(const selection of item.selections||[])addPublicOutcome(event,selection.best_bookmaker||selection.bookmaker||"best-odds",
    selection.name||selection.selection,selection.best_price??selection.price,item.updated_at||null);
  return event;
}
async function loadPublicDemoSport(sport) {
  const cached=publicDemoCache.get(sport.key);
  if(cached&&Date.now()-cached.at<85000)return cached;
  const bookSlug=PUNTERS_EDGE_BOOK_SPORTS[sport.key]||null;
  const bestSlug=PUNTERS_EDGE_BEST_SPORTS[sport.key]||null;
  const jobs=[
    bookSlug?publicDemoRequest("/v1/demo/book-sport",{book:"sportsbet",sport:bookSlug}):Promise.resolve(null),
    bookSlug?publicDemoRequest("/v1/demo/book-sport",{book:"bet365",sport:bookSlug}):Promise.resolve(null),
    bestSlug?publicDemoRequest("/v1/demo/best-odds",{sport:bestSlug}):Promise.resolve(null),
    (async()=>{
      const url=new URL("https://moviodds.com/odds");
      url.searchParams.set("sport",MOVI_SPORT_SLUGS[sport.key]||PUBLIC_DEMO_SPORTS[sport.key]||sport.key);
      const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
      const body=await response.text();let payload;
      try{payload=JSON.parse(body);}catch{throw new Error("MoviOdds returned invalid JSON (HTTP "+response.status+").");}
      if(!response.ok)throw new Error("MoviOdds "+response.status+": "+(payload.error||"unavailable"));
      return payload;
    })()
  ];
  const [sportsbetResult,bet365Result,bestOddsResult,moviResult]=await Promise.allSettled(jobs);
  const rowsByKey=new Map(),errors=[];
  for(const [index,result] of [sportsbetResult,bet365Result].entries()){
    const book=index===0?"sportsbet":"bet365";
    if(result.status!=="fulfilled"){errors.push(book+": "+result.reason.message);continue;}
    const payload=result.value;if(!payload)continue;
    for(const item of publicDemoItems(payload)){
      const event=normalizePublicBookSport(item,book,sport);
      const key=[event.home_team,event.away_team].join("|").toLowerCase();
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else for(const b of event.bookmakers)if(!rowsByKey.get(key).bookmakers.some(x=>x.key===b.key))rowsByKey.get(key).bookmakers.push(b);
    }
    if(payload.has_data===false)errors.push(book+": no public snapshot for this sport right now.");
  }
  if(bestOddsResult.status==="rejected")errors.push("PuntersEdge best-odds: "+bestOddsResult.reason.message);
  else if(bestOddsResult.value){
    const payload=bestOddsResult.value;
    for(const item of publicDemoItems(payload)){
      const event=normalizeBestOddsEvent(item,sport),key=[event.home_team,event.away_team].join("|").toLowerCase();
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else{
        const target=rowsByKey.get(key);
        for(const book of event.bookmakers)for(const market of book.markets||[])for(const outcome of market.outcomes||[])
          addPublicOutcome(target,book.key,outcome.name,outcome.price,book.last_update);
      }
    }
  }
  if(moviResult.status==="fulfilled"){
    const matches=Array.isArray(moviResult.value.matches)?moviResult.value.matches:[];
    for(const match of matches){
      const quotes=Array.isArray(match.quotes)?match.quotes:[];
      const groupIds=MOVI_WINNER_GROUPS[sport.key]||[];
      const main=quotes.filter(q=>groupIds.includes(String(q.group_id))||/full time result|to win|match winner|match result|3.?way result|moneyline|game winner/i.test(String(q.group_name||q.market_name||"")));
      const outcomes=main.map(q=>({name:q.label||q.name||"Selection",price:Number(q.odds_dec??q.price)}))
        .filter(q=>Number.isFinite(q.price)&&q.price>1);
      if(!outcomes.length)continue;
      const event={id:String(match.id||[match.home,match.away,match.kickoff_utc].join("|")),
        home_team:match.home||"Event",away_team:match.away||"",league:match.league||"",
        sport_name:sport.title,commence_time:match.kickoff_utc||null,in_play:!!match.in_play,
        status:match.in_play?"LIVE":"UPCOMING",score:match.score||null,
        bookmakers:[{key:"bet365_movi",name:"Bet365 via MoviOdds",last_update:match.updated_at||null,
          markets:[{key:"h2h",name:"Head to head",outcomes}],public_demo:true}],_publicDemo:true};
      const key=[event.home_team,event.away_team].join("|").toLowerCase();
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else{
        const target=rowsByKey.get(key);
        for(const book of event.bookmakers)if(!target.bookmakers.some(x=>x.key===book.key))target.bookmakers.push(book);
        if(event.in_play){target.in_play=true;target.status="LIVE";}
        if(!target.commence_time)target.commence_time=event.commence_time;
      }
    }
  }else errors.push("MoviOdds: "+moviResult.reason.message);
  const rows=[...rowsByKey.values()].filter(e=>{const t=Date.parse(e.commence_time||"");return e.in_play===true||!Number.isFinite(t)||t>=Date.now();})
    .sort((a,b)=>Number(b.in_play)-Number(a.in_play)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
  const result={at:Date.now(),rows,errors,provider:"PuntersEdge public demo · Sportsbet + Bet365 snapshots + best odds; MoviOdds"};
  publicDemoCache.set(sport.key,result);
  console.info("PUBLIC_DEMO_SPORT",JSON.stringify({sport:sport.title,bookSlug,bestSlug,events:rows.length,live:rows.filter(x=>x.in_play).length,
    sportsbet:rows.filter(x=>x.bookmakers.some(b=>b.key==="sportsbet")).length,
    bet365:rows.filter(x=>x.bookmakers.some(b=>String(b.key).startsWith("bet365"))).length,
    bestOdds:rows.filter(x=>x._bestOddsDemo).length,errors:errors.length}));
  return result;
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
let oddsDataApiRetryAt=0;
let oddsDataApiLastError="";
async function oddsApi(pathname, params={}) {
  if (!ODDS_API_TOKEN) throw new Error("ODDS_DATA_API_TOKEN is not active in Railway.");
  if(Date.now()<oddsDataApiRetryAt) throw new Error("Sports odds provider paused after its previous access/limit response: "+oddsDataApiLastError);
  const url = new URL((process.env.ODDS_API_BASE || "https://api.odds-data-api.com") + pathname);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  url.searchParams.set("token",ODDS_API_TOKEN);
  let response;
  try { response = await fetch(url,{signal:AbortSignal.timeout(12000)}); }
  catch (err) {
    oddsDataApiLastError="network connection unavailable";
    oddsDataApiRetryAt=Date.now()+60*1000;
    throw new Error("Odds Data API connection failed: "+(err.cause?.code||err.name||err.message));
  }
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("Odds Data API returned invalid JSON (HTTP "+response.status+")."); }
  if (!response.ok || data.success !== 1) {
    const message="Odds Data API: "+(data.error||response.status)+(data.error_detail?" · "+data.error_detail:"");
    if(response.status===401||response.status===403||response.status===429||/rate limit|quota|credit limit|unauthori[sz]ed|forbidden/i.test(message)) {
      oddsDataApiLastError=message;
      oddsDataApiRetryAt=Date.now()+6*60*60*1000;
    }
    throw new Error(message);
  }
  oddsDataApiRetryAt=0;oddsDataApiLastError="";
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


const ODDS_DATA_SPORTS = [
 [1,"Soccer"],[2,"Horse Racing"],[3,"Cricket"],[4,"Greyhounds"],[8,"Rugby Union"],[9,"Boxing"],
 [12,"American Football"],[13,"Tennis"],[14,"Snooker"],[15,"Darts"],[16,"Baseball"],[17,"Ice Hockey"],
 [18,"Basketball"],[19,"Rugby League"],[36,"Australian Rules"],[66,"Bowls"],[75,"Gaelic Sports"],
 [78,"Handball"],[83,"Futsal"],[90,"Floorball"],[91,"Volleyball"],[92,"Table Tennis"],[94,"Badminton"],
 [95,"Beach Volleyball"],[107,"Squash"],[110,"Water Polo"],[151,"E-sports"],[162,"MMA/UFC"],[163,"Bandy"],[164,"Field Hockey"]
].map(([id,title])=>({id,title,key:"oddsdata_"+id,provider:"Odds Data API / Bet365"}));
const oddsDataSportCache = new Map();
function oddsDataEvent(raw,sport) {
 const status=String(raw.time_status??"0");
 const live=status==="1"||status==="7"||status==="10";
 const epoch=Number(raw.time);
 const start=Number.isFinite(epoch)&&epoch>0?new Date(epoch*1000).toISOString():null;
 return {id:String(raw.id||raw.bet365_id||""),bet365_id:String(raw.bet365_id||""),sport_id:String(sport.id),sport_name:sport.title,
  league:raw.league?.name||"",home_team:raw.home?.name||raw.home_team||"Team TBA",
  away_team:raw.away?.name||raw.away_team||"Team TBA",commence_time:start,
  in_play:live,status:live?"LIVE":(status==="2"?"TIME TBA":"UPCOMING"),
  score:raw.ss||null,timer:raw.timer||null,scores:raw.scores||null,
  bookmakers:[],_source:"Odds Data API / Bet365"};
}
function oddsDataMarketOutcomes(row,event) {
 const outcomes=[];
 const pairs=[["home_od",event.home_team],["draw_od","Draw"],["away_od",event.away_team],
  ["over_od","Over"],["under_od","Under"],["yes_od","Yes"],["no_od","No"]];
 for(const [field,name] of pairs){const p=Number(row?.[field]);if(Number.isFinite(p)&&p>1)outcomes.push({name,price:p});}
 return outcomes;
}
async function loadOddsDataSport(sport, options={}) {
 const cacheKey=sport.key+(options.bulk?":bulk":":full");
 const prior=oddsDataSportCache.get(cacheKey);
 if(prior&&Date.now()-prior.at<8*60*1000)return prior;
 const [upcomingResult,inplayResult]=await Promise.allSettled([
  oddsApi("/v3/events/upcoming",{sport_id:sport.id,page:1,skip_esports:1}),
  oddsApi("/v3/events/inplay",{sport_id:sport.id})
 ]);
 const errors=[];
 const upcoming=upcomingResult.status==="fulfilled"?(upcomingResult.value.data.results||[]):[];
 const inplay=inplayResult.status==="fulfilled"?(inplayResult.value.data.results||[]):[];
 if(upcomingResult.status==="rejected")errors.push("Upcoming: "+upcomingResult.reason.message);
 if(inplayResult.status==="rejected")errors.push("Live: "+inplayResult.reason.message);
 const byId=new Map();
 for(const item of [...inplay,...upcoming]){const event=oddsDataEvent(item,sport);if(event.id)byId.set(event.id,event);}
 const events=[...byId.values()].sort((a,b)=>Number(b.in_play)-Number(a.in_play)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 if(!events.length&&errors.length)throw new Error(errors.join(" · "));
 const priced=events.slice(0,options.bulk?2:6);
 const summaries=await Promise.allSettled(priced.map(e=>oddsApi("/v2/event/odds/summary",{event_id:e.id})));
 summaries.forEach((result,index)=>{
  if(result.status!=="fulfilled"){errors.push("Odds "+priced[index].id+": "+result.reason.message);return;}
  const e=priced[index],root=result.value.data.results||{},bet365=root.Bet365||root.bet365||{};
  const snapshots=bet365.odds?.end||bet365.odds?.kickoff||bet365.odds?.start||{};
  const markets=[];
  for(const [marketKey,marketRow] of Object.entries(snapshots)){
   const outcomes=oddsDataMarketOutcomes(marketRow,e);
   if(outcomes.length)markets.push({key:/_1$/.test(marketKey)?"h2h":marketKey,name:marketKey,outcomes});
  }
  if(markets.length)e.bookmakers=[{key:"bet365",name:"Bet365",last_update:new Date().toISOString(),markets}];
 });
 const result={at:Date.now(),rows:events,errors,provider:"Odds Data API / Bet365"};
 oddsDataSportCache.set(cacheKey,result);
 console.info("ODDS_DATA_SPORT",JSON.stringify({sport:sport.title,id:sport.id,events:events.length,live:events.filter(x=>x.in_play).length,priced:events.filter(x=>x.bookmakers.length).length,errors:errors.length,errorSamples:errors.slice(0,3),bulk:!!options.bulk}));
 return result;
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
let krokRacingCache = {at:0,races:[],meta:null,creditsRemaining:null,errors:[]};
let krokRetryAt = 0;
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
  const now=Date.now();
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Melbourne",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(krokRetryAt && now<krokRetryAt) {
    return {races:krokRacingCache.races,scheduleFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,
      oddsFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,horizonHours:24,
      feedErrors:krokRacingCache.errors.map(message=>({feed:"Krok Odds",message})),
      feedSource:"Krok Odds",creditsRemaining:krokRacingCache.creditsRemaining,meta:krokRacingCache.meta};
  }
  if(!krokRacingCache.at || now-krokRacingCache.at>=60000) {
    const codes=["T","G","H"];
    const results=await Promise.all(codes.map(async code=>{
      try { return await fetchKrokRacing(today,code); }
      catch(error) { return {races:[],meta:null,creditsRemaining:null,error:code+": "+error.message}; }
    }));
    const races=results.flatMap(x=>x.races||[]);
    const errors=results.filter(x=>x.error).map(x=>x.error);
    const quotaBlocked=errors.some(message=>/429|monthly api limit|credit limit/i.test(message));
    krokRetryAt=quotaBlocked?now+24*60*60*1000:0;
    krokRacingCache={at:now,races,meta:results.map(x=>x.meta).filter(Boolean),
      creditsRemaining:results.map(x=>x.creditsRemaining).filter(x=>x!=null).join(", ")||null,errors};
    console.info("KROK_RACING_FEED",JSON.stringify({at:new Date(krokRacingCache.at).toISOString(),
      raceCount:races.length,categories:Object.fromEntries(["horse","greyhound","harness"].map(k=>[k,races.filter(r=>r.category===k).length])),
      pricedRaces:races.filter(r=>r.runners.some(x=>x.bookmakers.length)).length,
      runners:races.reduce((n,r)=>n+r.runners.length,0),creditsRemaining:krokRacingCache.creditsRemaining,
      retryAt:krokRetryAt?new Date(krokRetryAt).toISOString():null,errors}));
  }
  return {races:krokRacingCache.races,scheduleFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,
    oddsFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,horizonHours:24,
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
function isAustralianRace(race) {
  const country=String(race.country||race.country_code||race.region||"").trim().toLowerCase();
  if (/^(au|aus|australia|australian)(\b|$)/.test(country)) return true;
  if (country && !/^(unknown|n\/?a|not supplied|country not supplied|unspecified)$/.test(country)) return false;
  const venue=String(race.venue||race.track||race.course||"").toLowerCase();
  return !/\b(zia park|horseshoe indiana|star pelaw|pelaw|wolverhampton|kempton|newcastle uk|chelmsford|santa anita|del mar|gulfstream|churchill downs|aqueduct|belmont park|saratoga|woodbine|monmouth park|turf paradise|tampa bay downs|fair grounds|laurel park|prairie meadows|remington park|sam houston|lone star park|keeneland|pimlico|finger lakes|mountaineer|charles town|evangeline downs|thistledown|presque isle|hawthorne|horseshoe indianapolis)\b/.test(venue);
}

async function getGlobalRaces() {
  const failures=[];
  // Primary licensed schedule/odds source. If its free quota is exhausted, fall
  // through to the already-configured alternate providers rather than stopping.
  if (API_KEY && process.env.PUBLIC_ONLY_FEEDS !== "true") {
    try {
      const primary=await loadPuntersEdgeRaces();
      if (primary.races?.length) return primary;
      failures.push({feed:"PuntersEdge",message:"Schedule and next-to-go endpoints returned no races."});
    } catch(error) {
      console.error("PUNTERS_EDGE_PRIMARY_FAILED",error.message);
      failures.push({feed:"PuntersEdge",message:error.message});
    }
  }
  // Krok Odds is a separately configured racing provider. It is queried only
  // after the primary feed fails and is cached for 60 seconds by getKrokRaces().
  if (KROKODDS_API_KEY && process.env.PUBLIC_ONLY_FEEDS !== "true") {
    try {
      const alternate=await getKrokRaces();
      if (alternate.races?.length) {
        return {...alternate,feedErrors:failures.concat(alternate.feedErrors||[]),
          feedSource:"Krok Odds Australian racing",
          note:"Australian horse, greyhound and harness race prices from the configured Krok Odds feed. Bookmaker coverage and quote timestamps depend on provider availability."};
      }
      failures.push({feed:"Krok Odds",message:(alternate.feedErrors||[]).map(x=>typeof x==="string"?x:(x.message||JSON.stringify(x))).join(" · ")||"No racing markets returned."});
    } catch(error) {
      failures.push({feed:"Krok Odds",message:error.message});
    }
  }
  // Use the direct, read-only Betfair Exchange API integration before the
  // optional external proxy URL. This path was implemented but previously
  // never called by the production racing feed selector.
  if (BETFAIR_APP_KEY && BETFAIR_SESSION_TOKEN && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()>=betfairRetryAt) {
    try {
      const exchange=await getBetfairRaces();
      if (exchange.races?.length) return {...exchange,feedErrors:failures,
        note:"Australian racing markets and delayed exchange prices from Betfair. Exchange prices are not fixed bookmaker odds. Display-only; no betting actions are enabled."};
      failures.push({feed:"Betfair Exchange",message:"No Australian racing markets returned."});
    } catch(error) {
      console.error("BETFAIR_DIRECT_API_FAILED",error.message);
      betfairRetryAt=Date.now()+( /403|401/.test(error.message)?6*60*60*1000:15*60*1000 );
      failures.push({feed:"Betfair Exchange",message:error.message});
    }
  } else if (BETFAIR_APP_KEY && BETFAIR_SESSION_TOKEN && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()<betfairRetryAt) {
    failures.push({feed:"Betfair Exchange",message:"Access temporarily paused after the previous provider response."});
  }
  if (BETFAIR_FEED_URL && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()>=betfairFeedRetryAt) {
    try {
      const response=await fetch(BETFAIR_FEED_URL,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(response.ok && Array.isArray(data.races) && data.races.length) return {...data,feedErrors:failures,feedSource:data.feedSource||"Betfair Exchange"};
      failures.push({feed:"Betfair feed adapter",message:data.error||"No Australian markets returned (HTTP "+response.status+")."});
      betfairFeedRetryAt=Date.now()+6*60*60*1000;
    } catch(error) {
      failures.push({feed:"Betfair feed adapter",message:error.message});
      betfairFeedRetryAt=Date.now()+6*60*60*1000;
    }
  } else if (BETFAIR_FEED_URL && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()<betfairFeedRetryAt) {
    failures.push({feed:"Betfair feed adapter",message:"Connection temporarily paused after the previous network failure."});
  }
  // Combine the public multi-bookmaker teaser with an independent Bet365-only racing board.
  let publicRaceRows=[];
  try {
    publicRaceRows=await demoRacingFeed();
    if(!publicRaceRows.length) failures.push({feed:"PuntersEdge public demo",message:"No races returned at this refresh."});
  } catch(error) { failures.push({feed:"PuntersEdge public demo",message:error.message}); }
  try {
    const response=await fetch("https://moviodds.com/racing?code=all&near=100",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});
    const body=await response.text(); let payload;
    try { payload=JSON.parse(body); } catch { throw new Error("MoviOdds returned invalid JSON (HTTP "+response.status+")."); }
    if(!response.ok) throw new Error("MoviOdds "+response.status);
    const raw=Array.isArray(payload.races)?payload.races:(payload.meetings||[]).flatMap(m=>(m.races||[]).map(r=>({...r,venue:r.venue||r.track||r.course||m.track||m.course||m.name,country:r.country||m.country})));
    const races=raw.map(r=>{
      const code=String(r.code||r.race_code||r.category||"horse").toLowerCase();
      const category=(code==="g"||/greyhound|dog/.test(code))?"greyhound":(code==="h"||/harness|trots|pacing/.test(code))?"harness":"horse";
      const runners=(r.runners||[]).map(x=>{
        const price=Number(x.win_odds??x.fixed_win??x.win_price??x.odds),updated=x.updated_at||r.updated_at||payload.server_time||null;
        return {number:x.number??x.runner_number??x.box??null,name:x.name||x.runner_name||"Runner",
          bookmakers:Number.isFinite(price)&&price>1?[{key:"bet365",bookmaker:"Bet365 via MoviOdds",name:"Bet365",win_price:price,
            last_update:updated,age_seconds:updated?Math.max(0,Math.floor((Date.now()-Date.parse(updated))/1000)):null,
            source_url:x.url||x.source_url||null,public_demo:true}]:[]};
      });
      const rawStart=r.jump_utc||r.start_time||r.start_at||r.jump_time||r.commence_time||r.time||null;
      const start=typeof rawStart==="number"?(rawStart>1000000000000?new Date(rawStart).toISOString():new Date(rawStart*1000).toISOString()):rawStart;
      const venue=r.course||r.venue||r.track||r.meeting||r.name||"Track TBA";
      const status=String(r.status||"scheduled").toLowerCase();
      const live=!!r.in_play||/live|in.?play|running/.test(status);
      return {race_id:String(r.id||r.race_id||[venue,r.race_number,start].join("-")),id:String(r.id||r.race_id||[venue,r.race_number,start].join("-")),
        category,code:category==="horse"?"thoroughbred":category,venue,track:venue,race_number:r.race_number??r.number??null,
        start_time:start,country:r.country||"Country not supplied",status,in_play:live,
        closed:/abandon|result|closed/.test(status),runners};
    }).filter(r=>r.start_time&&!r.closed&&r.runners.length&&isAustralianRace(r));
    if(races.length||publicRaceRows.length) return {races:dedupeRaces([...publicRaceRows,...races]),
      scheduleFetchedAt:payload.server_time||new Date(demoRacingCache.at||Date.now()).toISOString(),
      oddsFetchedAt:payload.server_time||new Date(demoRacingCache.at||Date.now()).toISOString(),
      horizonHours:24,feedErrors:failures,feedSource:"Free public previews · PuntersEdge + Bet365 via MoviOdds",scope:"Australia",
      note:"Free no-key public previews combined: Australian-only MoviOdds Bet365 racing snapshots plus PuntersEdge multi-bookmaker samples, including Sportsbet where quoted. Overseas meetings are filtered out. Coverage is limited by each public preview and is not guaranteed to include every Australian meeting. Quote age and jump times depend on each source."};
    failures.push({feed:"MoviOdds public Bet365 preview",message:"No priced Australian races returned."});
  } catch(error) {
    failures.push({feed:"MoviOdds public Bet365 preview",message:error.message});
  }
  if(publicRaceRows.length) return {races:publicRaceRows,
    scheduleFetchedAt:new Date(demoRacingCache.at).toISOString(),oddsFetchedAt:new Date(demoRacingCache.at).toISOString(),
    horizonHours:24,feedErrors:failures,feedSource:"PuntersEdge public demo",scope:"Australia",
    note:"Free no-key public preview: a limited sample of Australian races and bookmaker prices. It is not a complete national race card."};
  if(failures.length) throw new Error(failures.map(x=>x.feed+": "+x.message).join(" · "));
  throw new Error("No free public Australian racing snapshot is available at this refresh.");
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
    if (!/demo|public/i.test(String(feed.feedSource||""))) for (const race of races) {
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
    res.json({races, providerBookmakers, mode:/demo|public/i.test(String(feed.feedSource||""))?"demo":"live", feedSource:feed.feedSource || "Configured Australian racing feed", fetchedAt:new Date().toISOString(),
      scheduleFetchedAt:feed.scheduleFetchedAt, oddsFetchedAt:feed.oddsFetchedAt,
      horizonHours:feed.horizonHours, providerPlan:feed.providerPlan||feed.meta?.tier||PROVIDER_PLAN, creditsRemaining:feed.creditsRemaining ?? null, feedMeta:feed.meta || null, feedErrors:feed.feedErrors, scope:"Australia",
      note:feed.note||"Racing cards appear only when a connected provider returns them. Official public fields/results are linked separately below; no bookmaker prices are inferred."});
  } catch (err) {
    const raw=String(err.message||"");
    const safeWarnings=[];
    if(/PuntersEdge|402|credit limit/i.test(raw)) safeWarnings.push({feed:"PuntersEdge",message:"Free API quota exhausted; public live widgets remain available."});
    if(/Krok Odds|429|monthly api limit/i.test(raw)) safeWarnings.push({feed:"Krok Odds",message:"Monthly API quota reached; waiting for provider reset."});
    if(/Betfair|403|fetch failed/i.test(raw)) safeWarnings.push({feed:"Betfair",message:"The current hosting route cannot access the Betfair feed."});
    res.set("Cache-Control","no-store");
    res.json({races:[],providerBookmakers:[],mode:"public-widgets",feedSource:"Free public racing widgets",
      fetchedAt:new Date().toISOString(),scheduleFetchedAt:null,oddsFetchedAt:null,scope:"Australia",
      feedErrors:safeWarnings,note:"The authenticated race-card feeds are temporarily unavailable. Free public racing widgets and official Australian racing links remain below. No sample races or estimated prices are shown."});
  }
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
let bet365LiveCache={at:0,events:[],errors:[]};
app.get("/api/live-sports",async(_req,res)=>{
 try{
  if(!bet365LiveCache.at||Date.now()-bet365LiveCache.at>85000){
   const sports=ODDS_DATA_SPORTS.filter(x=>![2,4].includes(x.id));
   const settled=[];
   for(let i=0;i<sports.length;i+=4) settled.push(...await Promise.allSettled(sports.slice(i,i+4).map(loadPublicDemoSport)));
   const events=[],errors=[];
   settled.forEach((result,index)=>{
    if(result.status!=="fulfilled"){errors.push(sports[index].title+": "+result.reason.message);return;}
    for(const e of result.value.rows||[])if(e.in_play===true)events.push({id:e.id,sport:sports[index].title,
      home:e.home_team,away:e.away_team,name:(e.away_team||"")+" @ "+(e.home_team||""),
      commenceTime:e.commence_time,status:"LIVE",score:null,bookmakers:e.bookmakers||[],bookmakerFavourites:[],
      quoteCount:(e.bookmakers||[]).reduce((n,b)=>n+(b.markets||[]).reduce((m,x)=>m+(x.outcomes||[]).length,0),0)});
   });
   bet365LiveCache={at:Date.now(),events,errors};
   console.info("PUBLIC_LIVE_SPORTS",JSON.stringify({events:events.length,sportsChecked:sports.length,errors:errors.length}));
  }
  res.set("Cache-Control","no-store");
  res.json({configured:true,provider:"Free public Sportsbet + Bet365 snapshots",events:bet365LiveCache.events,
    sports:ODDS_DATA_SPORTS.length,bookmakers:["Sportsbet","Bet365"],resultsFetchedAt:new Date(bet365LiveCache.at).toISOString(),
    ageSeconds:Math.round((Date.now()-bet365LiveCache.at)/1000),
    note:"Live events are included only when the public bookmaker snapshot explicitly marks them in-play. This no-key preview may omit live markets; no event or score is inferred."});
 }catch(err){res.status(502).json({error:err.message,provider:"Free public sports demo"});}
});


// Sports catalogue is cached for six hours. Sports odds are fetched on demand
// per selected sport and cached for 15 minutes to control provider credit use.
// Krok Odds is the single source for the sports catalogue and pre-match sports prices.
let sportsCatalogueCache = { at:0, rows:[], meta:null };
const sportsOddsCache = new Map();
app.get("/api/sports", async (_req,res) => {
  const sports=ODDS_DATA_SPORTS.filter(x=>![2,4].includes(x.id)).map(s=>({
    key:s.key,title:s.title,name:s.title,category:"Sports",event_count:0,
    provider:"Free public Sportsbet + Bet365 snapshots",active:true
  }));
  res.set("Cache-Control","no-store");
  res.json({sports,fetchedAt:new Date().toISOString(),
    provider:"Free public Sportsbet + Bet365 snapshots",refreshSeconds:90,liveInPlayAvailable:true,
    providerErrors:[],
    note:"Free no-key public preview for the available sport catalogue. Sportsbet and Bet365 prices are shown where their public snapshot returns them; coverage is limited and not every sport has a live market."});
});
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

const bet365ResultsCache = new Map();
// Finished fixtures are retrieved per sport, then enriched with Bet365's final-result endpoint.
// One batched result request covers up to ten fixture IDs; cache prevents repeated credit use.
app.get("/api/sports/results", async (req,res) => {
  const sportId=String(req.query.sport_id||"1");
  if(!/^\\d+$/.test(sportId)) return res.status(400).json({error:"Invalid sport_id"});
  const cached=bet365ResultsCache.get(sportId);
  if(cached && Date.now()-cached.at<5*60*1000) return res.json(cached.payload);
  try {
    const day=new Date().toISOString().slice(0,10).replace(/-/g,"");
    const ended=await oddsApi("/v3/events/ended",{sport_id:sportId,day,page:1,skip_esports:1});
    const fixtures=(ended.data.results||[]).filter(x=>x.bet365_id||x.id).slice(0,10);
    let finished=[];
    if(fixtures.length) {
      const ids=fixtures.map(x=>String(x.bet365_id||"")).filter(Boolean);
      if(ids.length) {
        const details=await oddsApi("/v1/bet365/result",{event_id:ids.join(",")});
        const raw=details.data.results||[];
        const byId=new Map(raw.map(x=>[String(x.id||""),x]));
        finished=fixtures.map(f=>{
          const fi=String(f.bet365_id||"");
          const r=byId.get(fi);
          if(!r) return null;
          return {
            id:fi, event_id:String(f.id||r.our_event_id||""),
            sport_id:sportId, league:r.league?.name||f.league?.name||"",
            home_team:r.home?.name||f.home?.name||"Team TBA",
            away_team:r.away?.name||f.away?.name||"Team TBA",
            score:r.ss||null, scores:r.scores||null,
            status:"FINISHED", time:r.time||f.time||null,
            stats:r.stats||null, events:r.events||[],
            provider:"Bet365", updatedAt:new Date().toISOString()
          };
        }).filter(Boolean);
      }
    }
    const payload={sport_id:sportId,results:finished,fetchedAt:new Date().toISOString(),
      provider:"Odds Data API / Bet365",requested:fixtures.length,
      note:"Final scores and match details are returned by the Bet365 results endpoint. Only completed fixtures returned by the provider are shown."};
    bet365ResultsCache.set(sportId,{at:Date.now(),payload});
    res.set("Cache-Control","no-store"); return res.json(payload);
  } catch(err) {
    return res.status(503).json({error:err.message,provider:"Odds Data API / Bet365",sport_id:sportId});
  }
});

app.get("/api/public-sports/:sportKey",async(req,res)=>{
  const sport=ODDS_DATA_SPORTS.find(x=>x.key===String(req.params.sportKey||"").toLowerCase());
  if(!sport)return res.status(404).json({error:"Sport is not in the public sports catalogue."});
  try{
    const data=await loadPublicDemoSport(sport);
    res.set("Cache-Control","no-store");
    return res.json({sport:{key:sport.key,title:sport.title},events:data.rows,fetchedAt:new Date(data.at).toISOString(),
      provider:data.provider,providerErrors:data.errors,publicDemo:true,
      note:"Free no-key feeds: PuntersEdge Sportsbet and Bet365 book-by-sport snapshots plus its best-odds sample for selected sports; MoviOdds supplies additional mapped fixtures. Each preview is truncated and coverage varies by sport. Times are shown in Brisbane time; absent prices and fixtures are never invented."});
  }catch(error){return res.status(502).json({error:error.message,publicDemo:true});}
});
app.get("/api/sports/:sportKey", async (req,res) => {
  const oddsSport=ODDS_DATA_SPORTS.find(x=>x.key===String(req.params.sportKey||"").toLowerCase());
  if(oddsSport) {
    try {
      const bulk=req.query.mode==="all";
      const data=await loadOddsDataSport(oddsSport,{bulk});
      res.set("Cache-Control","no-store");
      return res.json({sport:{key:oddsSport.key,title:oddsSport.title},events:data.rows,
        fetchedAt:new Date(data.at).toISOString(),provider:data.provider,providerErrors:data.errors,
        refreshSeconds:60,liveInPlayAvailable:true,
        note:"Fixtures and live scores from the Bet365 data feed. Bookmaker prices are checked for up to "+(bulk?2:6)+" events per sport per refresh; no missing prices are estimated."});
    } catch(err) { return res.status(503).json({error:err.message,provider:"Odds Data API / Bet365"}); }
  }
  return res.status(404).json({error:"Sport is not in the connected Bet365 sports catalogue."});
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
