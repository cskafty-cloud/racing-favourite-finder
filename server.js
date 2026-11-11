require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
// This application is permanently display-only: it may read odds/results but must never place bets.
const AUTO_BETTING_ENABLED = false;
app.use((req, res, next) => {
  if (!AUTO_BETTING_ENABLED && req.path.startsWith("/api/") && !(req.method === "POST" && req.path === "/api/history/sync") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return res.status(403).json({ ok:false, error:"Bet placement and account actions are disabled. This is a read-only odds display." });
  }
  next();
});
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
    .map(r=>({...r,_publicDemo:true,runners:(r.runners||[]).map(x=>{
      const rawQuotes=x.bookmakers||x.odds||x.prices||[];
      const bookmakers=(Array.isArray(rawQuotes)?rawQuotes:[]).map(q=>{
        const rawBook=q.key||q.bookmaker_key||q.bookmaker||q.bookmaker_name||q.site||q.name||"";
        const key=canonicalBookmakerKey(rawBook);
        const price=Number(q.win_price??q.fixed_win_price??q.fixed_win??q.win_odds??q.odds_decimal??q.win);
        const placePrice=sportsbetDemoPlacePrice(q);
        const age=q.age_seconds??q.quote_age_seconds??null;
        const updated=q.last_update||q.updated_at||q.captured_at||q.timestamp||null;
        return {...q,key,bookmaker:key==="sportsbet"?"Sportsbet":key==="bet365"?"Bet365":q.bookmaker||q.name||rawBook,
          ...(Number.isFinite(price)&&price>1?{win_price:price,market_type:"fixed_win"}:{}),
          ...(placePrice?{place_price:placePrice,place_market_type:"fixed_place"}:{}),
          age_seconds:age==null?null:Number(age),last_update:updated,
          source:q.source||"PuntersEdge public live racing teaser",
          source_url:q.source_url||q.url||null,event_url:q.source_url||q.url||null,
          stale:q.stale===true||(age!=null&&Number(age)>=180),public_demo:true};
      }).filter(q=>q.key&&(Number.isFinite(q.win_price)&&q.win_price>1||Number.isFinite(q.place_price)&&q.place_price>1));
      return {...x,bookmakers};
    })}));
  // An empty array is a valid off-hours response (Australian racing has no cards 24/7).
  // Cache it too, otherwise every browser refresh hammers both feeds and fills logs with false errors.
  demoRacingCache = { at: Date.now(), rows };
  return rows;
}

const publicDemoCache = new Map();
let moviOddsAllSportsCache={at:0,items:[],error:null};
let moviOddsAllSportsRefresh=null;
async function loadMoviOddsAllSports(){
 if(moviOddsAllSportsCache.at&&Date.now()-moviOddsAllSportsCache.at<45000)return moviOddsAllSportsCache.items;
 if(!moviOddsAllSportsRefresh)moviOddsAllSportsRefresh=(async()=>{
  const response=await fetch("https://moviodds.com/odds?sport=all",{headers:{Accept:"application/json","Accept-Encoding":"gzip"},signal:AbortSignal.timeout(25000)});
  const body=await response.text();let payload;
  try{payload=JSON.parse(body);}catch{throw new Error("MoviOdds all-sports feed returned invalid JSON (HTTP "+response.status+").");}
  if(!response.ok)throw new Error("MoviOdds all-sports feed HTTP "+response.status+": "+(payload.error||"request failed"));
  const items=publicDemoItems(payload).map(item=>({...item,_moviServerTime:payload.server_time||payload.serverTime||null}));
  moviOddsAllSportsCache={at:Date.now(),items,error:null};
  console.info("MOVIODDS_ALL_SPORTS",JSON.stringify({items:items.length,keys:Object.keys(payload||{}).slice(0,20)}));
  return items;
 })().catch(error=>{moviOddsAllSportsCache.error=error.message;throw error;}).finally(()=>{moviOddsAllSportsRefresh=null;});
 return moviOddsAllSportsRefresh;
}
function moviSportMatches(item,sport){
 const wanted=String(sport.id),key=String(sport.key||"").toLowerCase(),slug=String(MOVI_SPORT_SLUGS[key]||PUBLIC_DEMO_SPORTS[key]||"").toLowerCase();
 const ids=[item.sport_id,item.sportId,item.sport?.id,item.sport?.sport_id,item.sport_key,item.sport].filter(x=>x!=null).map(x=>String(typeof x==="object"?(x.key||x.name||x.slug||x.id||""):x).toLowerCase());
 const names=[item.sport_name,item.sportName,item.sport?.name,item.sport?.slug,item.sport_slug,item.sport_key].filter(Boolean).map(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,""));
 const wantedNames=[slug,sport.title,key].map(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,""));
 return ids.includes(wanted)||ids.includes(key)||ids.includes(slug)||names.some(n=>wantedNames.includes(n));
}
function moviQuoteBookmakerKey(quote){
 // MoviOdds aggregates multiple books. Never infer the bookmaker from the
 // endpoint or event: every accepted price must identify its own bookmaker.
 const raw=quote?.bookmaker_key??quote?.bookmakerKey??quote?.bookmaker??
  quote?.bookmaker_name??quote?.bookmakerName??quote?.bookmaker_code??quote?.bookmakerCode??
  quote?.site??quote?.book??quote?.bookie??quote?.sportsbook??quote?.operator??
  quote?.price_source??quote?.priceSource??quote?.odds_source??quote?.oddsSource??
  quote?.source_name??quote?.sourceName??quote?.source??quote?.provider_name??null;
 const value=raw&&typeof raw==="object"?(raw.key||raw.name||raw.slug||raw.title||raw.code||""):raw;
 return canonicalBookmakerKey(value);
}
let puntersPublicDemoRetryAt=0;
let puntersPublicDemoLastError="";
async function publicDemoRequest(pathname, params={}) {
  if(Date.now()<puntersPublicDemoRetryAt)throw new Error("PuntersEdge public preview paused until "+new Date(puntersPublicDemoRetryAt).toISOString()+": "+puntersPublicDemoLastError);
  const url=new URL(BASE+pathname);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
  const body=await response.text(); let data;
  try { data=JSON.parse(body); } catch { throw new Error("Public odds preview returned invalid JSON (HTTP "+response.status+")."); }
  if(!response.ok) {
    const message="HTTP "+response.status+": "+(data.detail||data.error||body.slice(0,180));
    if(response.status===402||/monthly.*(limit|quota)|credit.*(limit|exhaust)/i.test(message)){
      puntersPublicDemoRetryAt=Date.now()+6*60*60*1000;puntersPublicDemoLastError=message;
    }else if(response.status===429||/rate.?limit/i.test(message)){
      puntersPublicDemoRetryAt=Date.now()+60*60*1000;puntersPublicDemoLastError=message;
    }
    throw new Error("Public odds preview "+message);
  }
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
  for(const key of ["items","events","results","data","matches","races","meetings"]) if(Array.isArray(payload?.[key])) return payload[key];
  return [];
}
const PUNTERS_EDGE_BOOK_SPORTS = {
  // The no-key bookmaker sandbox accepts display slugs, not ODDS_DATA sport IDs.
  oddsdata_1:"soccer",oddsdata_3:"cricket",oddsdata_8:"rugby-union",
  oddsdata_13:"tennis",oddsdata_18:"nba",oddsdata_19:"nrl",
  oddsdata_36:"afl",oddsdata_162:"mma"
};
// The best-odds sandbox takes canonical PuntersEdge sport keys (not bookmaker slugs).
const PUNTERS_EDGE_BEST_SPORTS = {
  oddsdata_1:"soccer_epl",oddsdata_3:"cricket",oddsdata_8:"rugby_union",
  oddsdata_13:"tennis",oddsdata_18:"nba",oddsdata_19:"nrl",
  oddsdata_36:"afl",oddsdata_162:"mma"
};
function addPublicOutcome(event, bookKey, name, price, updatedAt=null, ageSeconds=null) {
  if(!Number.isFinite(Number(price))||Number(price)<=1||!name)return;
  const key=canonicalBookmakerKey(bookKey);
  let book=(event.bookmakers||[]).find(b=>canonicalBookmakerKey(b.key||b.name)===key);
  if(!book){book={key,name:key==="sportsbet"?"Sportsbet":key==="bet365"?"Bet365":String(bookKey||"Unknown"),last_update:updatedAt,age_seconds:ageSeconds,source:"PuntersEdge public best-market endpoint",markets:[]};event.bookmakers.push(book);}
  let market=book.markets.find(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
  if(!market){market={key:"h2h",name:"Head to head",outcomes:[]};book.markets.push(market);}
  const candidate={name:String(name),price:Number(price),age_seconds:ageSeconds,last_update:updatedAt,observed_at:new Date().toISOString(),source:"PuntersEdge public best-market endpoint"};
  const existing=market.outcomes.find(o=>String(o.name).toLowerCase()===String(name).toLowerCase());
  const oldAge=existing?quoteAgeSecondsServer(existing):null,newAge=quoteAgeSecondsServer(candidate);
  if(!existing||newAge!=null&&(oldAge==null||newAge<oldAge)) {
    if(existing)Object.assign(existing,candidate);else market.outcomes.push(candidate);
  }
  const ages=market.outcomes.map(quoteAgeSecondsServer).filter(x=>x!=null);
  book.age_seconds=ages.length?Math.max(...ages):null;
}
function normalizePublicBookSport(item, book, sport) {
  const sourceMarkets=(item.markets||[]).filter(m=>["h2h","head_to_head","moneyline","match_winner","winner"].includes(String(m.key||m.market_key||m.name||"").toLowerCase().replace(/\\s+/g,"_")));
  const prices=Array.isArray(item.prices)?item.prices:Array.isArray(item.odds)?item.odds:
    sourceMarkets.flatMap(m=>(m.outcomes||m.selections||[]).map(o=>({...o,_market:m})));
  const outcomes=prices.map(p=>{
    const updatedAt=p.last_update||p.updated_at||p.captured_at||p.timestamp||p._market?.last_update||p._market?.updated_at||null;
    const ageSeconds=p.age_seconds??p.quote_age_seconds??p.quality?.age_seconds??p._market?.age_seconds??p._market?.quality?.age_seconds??item.age_seconds??item.quote_age_seconds??item.quality?.age_seconds??null;
    return {name:p.name||p.selection||p.label||"",price:Number(p.price??p.odds??p.decimal??p.best_price),age_seconds:ageSeconds==null?null:Number(ageSeconds),last_update:updatedAt,source:p.source||p.source_name||item.source||"PuntersEdge public bookmaker-specific endpoint"};
  }).filter(p=>p.name&&Number.isFinite(p.price)&&p.price>1);
  const home=item.home_team||item.home||item.homeTeam||"";
  const away=item.away_team||item.away||item.awayTeam||"";
  const start=item.commence_time||item.start_time||item.kickoff||item.time||null;
  const explicitLive=item.in_play===true||item.inplay===true||/^(live|in.?play|running)$/i.test(String(item.status||""));
  const canonical=canonicalBookmakerKey(book);
  const knownAges=outcomes.map(o=>quoteAgeSecondsServer(o)).filter(x=>x!=null);
  const observedAt=new Date().toISOString();
  const cleanOutcomes=outcomes.map(({name,price,age_seconds,last_update,source})=>({name,price,age_seconds,last_update,observed_at:observedAt,source}));
  return {id:String(item.id||item.event_id||[home,away,start].join("|")),home_team:home||"Event",away_team:away,
    league:item.league||item.competition||item.tournament||"",sport_name:sport.title,commence_time:start,
    in_play:explicitLive,status:explicitLive?"LIVE":"UPCOMING",score:item.score||item.ss||null,
    bookmakers:cleanOutcomes.length?[{key:canonical,name:canonical==="sportsbet"?"Sportsbet":"Bet365",
      age_seconds:knownAges.length===outcomes.length?Math.max(...knownAges):null,last_update:null,observed_at:observedAt,
      source:"PuntersEdge public bookmaker-specific endpoint",stale:item.stale===true,
      markets:[{key:"h2h",name:"Head to head",outcomes:cleanOutcomes}]}]:[],_publicDemo:true};
}
function normalizeBestOddsEvent(item,sport) {
  const home=item.home_team||item.home||"",away=item.away_team||item.away||"";
  const event={id:String(item.id||[home,away,item.commence_time].join("|")),home_team:home||"Event",away_team:away,
    league:item.league||item.competition||"",sport_name:sport.title,commence_time:item.commence_time||item.start_time||null,
    in_play:item.in_play===true||/^(live|in.?play|running)$/i.test(String(item.status||"")),
    status:item.in_play===true?"LIVE":"UPCOMING",score:item.score||null,bookmakers:[],_publicDemo:true,_bestOddsDemo:true};
  for(const selection of item.selections||[]){
    const sourceBook=selection.best_bookmaker||selection.bookmaker;
    // A best-price reference without a named bookmaker is not an independent book.
    if(!sourceBook)continue;
    addPublicOutcome(event,sourceBook,selection.name||selection.selection,
      selection.best_price??selection.price,selection.last_update||selection.updated_at||null,
      selection.age_seconds??selection.quote_age_seconds??selection.quality?.age_seconds??item.age_seconds??item.quote_age_seconds??null);
  }
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
      const all=await loadMoviOddsAllSports();
      const matches=all.filter(item=>moviSportMatches(item,sport));
      return {matches,source:"MoviOdds /odds?sport=all",has_data:matches.length>0};
    })(),
    (async()=>{
      const ids=RAPID_SPORT_IDS[sport.key]||[];
      if(!RAPID_ODDS_KEY||!ids.length)return [];
      return Promise.all(ids.map(async id=>{
        const result=await rapidOdds("/sports/"+id+"/markets",{market_type:"head_to_head",bookmaker:"Sportsbet"});
        return {sportId:id,data:result.data};
      }));
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
      const key=[normalizeName(event.home_team),normalizeName(event.away_team),String(event.commence_time||"").slice(0,13),normalizeName(event.league)].join("|");
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else for(const b of event.bookmakers)if(!rowsByKey.get(key).bookmakers.some(x=>x.key===b.key))rowsByKey.get(key).bookmakers.push(b);
    }
    if(payload.has_data===false)errors.push(book+": no public snapshot for this sport right now.");
  }
  if(bestOddsResult.status==="rejected")errors.push("PuntersEdge best-odds: "+bestOddsResult.reason.message);
  else if(bestOddsResult.value){
    const payload=bestOddsResult.value;
    for(const item of publicDemoItems(payload)){
      const event=normalizeBestOddsEvent(item,sport),key=[normalizeName(event.home_team),normalizeName(event.away_team),String(event.commence_time||"").slice(0,13),normalizeName(event.league)].join("|");
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else{
        const target=rowsByKey.get(key);
        for(const book of event.bookmakers)for(const market of book.markets||[])for(const outcome of market.outcomes||[])
          addPublicOutcome(target,book.key,outcome.name,outcome.price,book.last_update);
      }
    }
  }
  const rapidResult=await Promise.resolve(jobs[4]).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason}));
  if(rapidResult.status==="rejected")errors.push("RapidOddsAPI Sportsbet: "+rapidResult.reason.message);
  else for(const response of (rapidResult.value||[])){
    const payload=response.data||{};
    for(const entry of payload.games||[]){
      const game=entry.game||{},start=game.commence_time||null;
      if(!start||!Number.isFinite(Date.parse(start)))continue;
      const sourceBook=(entry.bookmakers||[]).find(b=>canonicalBookmakerKey(b.name||b.bookmaker)==="sportsbet");
      if(!sourceBook)continue;
      const lastUpdate=sourceBook.last_update||null;
      const age=lastUpdate?Math.max(0,Math.floor((Date.now()-Date.parse(lastUpdate))/1000)):null;
      const markets=(sourceBook.markets||[]).map(m=>({key:m.key,name:m.key,outcomes:(m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>({
        name:o.name,price:Number(o.price),point:o.point??null,last_update:lastUpdate,age_seconds:age,
        timestamp_status:lastUpdate?"bookmaker_timestamp":"unknown",stale:age==null||age>=180
      }))})).filter(m=>m.outcomes.length);
      if(!markets.length)continue;
      const event={id:String(game.game_id||[response.sportId,game.home_team,game.away_team,start].join("|")),
        home_team:game.home_team||"Team TBA",away_team:game.away_team||"Team TBA",league:game.league||"",
        sport_name:sport.title,commence_time:start,in_play:false,status:"UPCOMING",
        bookmakers:[{key:"sportsbet",name:"Sportsbet",last_update:lastUpdate,age_seconds:age,stale:age==null||age>=180,
          markets,source:"RapidOddsAPI Sportsbet bookmaker feed",public_demo:false}]};
      const key=[normalizeName(event.home_team),normalizeName(event.away_team),String(start).slice(0,13),normalizeName(event.league)].join("|");
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else{
        const target=rowsByKey.get(key);
        const old=target.bookmakers.find(b=>canonicalBookmakerKey(b.key||b.name)==="sportsbet");
        if(!old)target.bookmakers.push(...event.bookmakers);
        else for(const market of markets){
          const prior=old.markets.find(m=>m.key===market.key);
          if(!prior)old.markets.push(market);
          else for(const outcome of market.outcomes){
            const index=prior.outcomes.findIndex(o=>o.name===outcome.name);
            if(index<0)prior.outcomes.push(outcome);else prior.outcomes[index]=outcome;
          }
        }
      }
    }
  }
  if(moviResult.status==="fulfilled"){
    const matches=Array.isArray(moviResult.value.matches)?moviResult.value.matches:[];
    for(const match of matches){
      const quotes=Array.isArray(match.quotes)?match.quotes:[];
      const groupIds=MOVI_WINNER_GROUPS[sport.key]||[];
      const main=quotes.filter(q=>groupIds.includes(String(q.group_id))||/full time result|to win|match winner|match result|3.?way result|moneyline|game winner/i.test(String(q.group_name||q.market_name||"")));
      const byBook=new Map();
      for(const q of main){
        // MoviOdds documents /odds as its Bet365 odds feed. Accept its quotes as
        // Bet365 unless an explicit per-quote source contradicts that provenance.
        const explicitBook=moviQuoteBookmakerKey(q);
        if(explicitBook&&!["bet365","pm"].includes(explicitBook))continue;
        const bookKey="bet365";
        const name=q.label||q.name||q.selection||"Selection";
        const price=Number(q.odds_dec??q.price??q.decimal_odds);
        if(!Number.isFinite(price)||price<=1)continue;
        const groupStatus=match.group_status?.[String(q.group_id)]||match.group_status?.[q.group_id]||{};
        const polledAt=groupStatus.polled_at||match.polled_at||null;
        const serverTime=match._moviServerTime||match.server_time||new Date().toISOString();
        const pollAge=polledAt?Math.max(0,(Date.parse(serverTime)-Date.parse(polledAt))/1000):null;
        const quoteAge=pollAge??q.age_seconds??q.quote_age_seconds??null;
        if(!byBook.has(bookKey))byBook.set(bookKey,{key:bookKey,name:"Bet365",
          last_update:null,age_seconds:quoteAge,
          stale:groupStatus.stale===true,
          markets:[{key:"h2h",name:"Head to head",outcomes:[]}],public_demo:true,source:"MoviOdds documented Bet365-only odds feed"});
        const book=byBook.get(bookKey),outcomes=book.markets[0].outcomes;
        if(book.age_seconds==null||quoteAge!=null&&quoteAge>book.age_seconds)book.age_seconds=quoteAge;
        // Market-level stale state is applied to its individual outcomes below.
        const prior=outcomes.find(o=>String(o.name).toLowerCase()===String(name).toLowerCase());
        const outcome={name:String(name),price,last_update:null,
          age_seconds:quoteAge,observed_at:new Date().toISOString(),stale:groupStatus.stale===true};
        if(prior)Object.assign(prior,outcome);else outcomes.push(outcome);
      }
      const eventStart=match.kickoff_utc||match.start_time||match.commence_time||null;
      const eventLive=match.in_play===true||/^(live|in.?play|running)$/i.test(String(match.status||""));
      if(!eventLive&&(!eventStart||!Number.isFinite(Date.parse(eventStart))||Date.parse(eventStart)<Date.now()))continue;
      const event={id:String(match.id||match.event_id||[match.home,match.away,eventStart].join("|")),
        home_team:match.home||match.home_team||"Event",away_team:match.away||match.away_team||"",league:match.league||match.competition||"",
        sport_name:sport.title,commence_time:eventStart,in_play:eventLive,
        status:eventLive?"LIVE":"UPCOMING",score:match.score||null,
        bookmakers:[...byBook.values()],_publicDemo:true,_fixtureSource:"MoviOdds event feed"};
      const key=[event.home_team,event.away_team,event.commence_time||"",event.league].join("|").toLowerCase();
      if(!rowsByKey.has(key))rowsByKey.set(key,event);
      else{
        const target=rowsByKey.get(key);
        for(const book of event.bookmakers){
          const existing=target.bookmakers.find(x=>canonicalBookmakerKey(x.key||x.name)===book.key);
          if(!existing)target.bookmakers.push(book);
          else for(const market of book.markets||[]){
            const existingMarket=(existing.markets||[]).find(x=>String(x.key)===String(market.key));
            if(!existingMarket){existing.markets.push(market);continue;}
            for(const outcome of market.outcomes||[]){
              const old=existingMarket.outcomes.find(x=>String(x.name).toLowerCase()===String(outcome.name).toLowerCase());
              if(old)Object.assign(old,outcome);else existingMarket.outcomes.push(outcome);
            }
          }
        }
        if(event.in_play){target.in_play=true;target.status="LIVE";}
        if(!target.commence_time)target.commence_time=event.commence_time;
      }
    }
  }else errors.push("MoviOdds: "+moviResult.reason.message);
  const rows=[...rowsByKey.values()].filter(e=>{
    if(e.in_play===true)return true;
    const t=Date.parse(e.commence_time||"");
    return Number.isFinite(t)&&t>=Date.now();
  }).sort((a,b)=>Number(b.in_play)-Number(a.in_play)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
  const result={at:Date.now(),rows,errors,provider:"MoviOdds public event board + PuntersEdge bookmaker snapshots where available"};
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
function canonicalBookmakerKey(value) {
  const key=String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(/sportsbet|sportsbetcomau|sbcomau/.test(key))return "sportsbet";
  if(/bet365|betthree65/.test(key))return "bet365";
  if(/betfair|exchange/.test(key))return "betfair";
  if(key.includes("tabtouch"))return "tabtouch";
  if(key.includes("tab"))return "tab";
  if(key.includes("betr"))return "betr";
  return key;
}
function bookmakerKey(q) {
  return canonicalBookmakerKey([q.key,q.bookmaker,q.name,q.bookmaker_name,q.site].filter(Boolean).join(" "));
}
function quoteAgeSecondsServer(q) {
  const direct=q?.age_seconds!=null&&Number.isFinite(Number(q.age_seconds))?Math.max(0,Number(q.age_seconds)):null;
  const stamp=q?.last_update||q?.updated_at||q?.captured_at||q?.timestamp;
  const numeric=Number(stamp),ms=stamp==null?NaN:(Number.isFinite(numeric)&&numeric>1000000000?(numeric>1000000000000?numeric:numeric*1000):Date.parse(stamp));
  const stamped=Number.isFinite(ms)?Math.max(0,(Date.now()-ms)/1000):null;
  const observed=q?.observed_at?Date.parse(q.observed_at):NaN;
  const elapsed=Number.isFinite(observed)?Math.max(0,(Date.now()-observed)/1000):0;
  const agedDirect=direct==null?null:direct+elapsed;
  if(agedDirect!=null&&stamped!=null)return Math.max(agedDirect,stamped);
  if(agedDirect!=null)return agedDirect;
  if(stamped!=null)return stamped;
  // Public preview receipt time is a freshness window for the snapshot only,
  // not proof of when Sportsbet last changed the underlying price.
  if(q?.public_demo===true&&q?.feed_observed_at){
    const received=Date.parse(q.feed_observed_at);
    if(Number.isFinite(received))return Math.max(0,(Date.now()-received)/1000);
  }
  return null;
}
function racingWinPrice(q) {
  // Never fall back to generic price/odds: those may be place, tote or another market.
  const value=q?.win_price??q?.fixed_win_price??q?.fixed_win??q?.win_odds;
  const price=Number(value);
  return Number.isFinite(price)&&price>1?price:null;
}
function racingQuoteMaxAge(q) {
  // A schedule/card refresh is not a bookmaker price refresh. Require the quote's own timestamp to be recent.
  return 180;
}
function runnerQuotes(runner) {
  // Compare fixed-win only, using the quote's own refresh tier and age.
  const unique=new Map();
  for(const q of (runner.bookmakers || runner.odds || [])) {
    const price=racingWinPrice(q),key=bookmakerKey(q),age=quoteAgeSecondsServer(q);
    if(!key||price==null||q.stale===true||age==null||age>=racingQuoteMaxAge(q))continue;
    const previous=unique.get(key);
    const previousAge=previous?quoteAgeSecondsServer(previous):null;
    if(!previous||previousAge==null||age<previousAge)unique.set(key,q);
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
    const prices=quotes.map(racingWinPrice).filter(p=>p!=null);
    const fair=median(prices),spread=fair&&prices.length>1?(Math.max(...prices)-Math.min(...prices))/fair:1;
    return {runner:r,quotes,fair,spread};
  }).filter(x=>x.fair!=null).sort((a,b)=>a.fair-b.fair);
  const best=entries[0];if(!best)return null;
  const second=entries[1],gap=second?Math.max(0,(1/best.fair-1/second.fair)/(1/best.fair)):0;
  const spreadPct=best.spread*100;
  // Quote agreement is a hard quality gate: broad disagreement must never be called strong.
  const rawScore=Math.round(Math.min(40,best.quotes.length/3*40)+Math.max(0,30*(1-best.spread/0.35))+Math.min(30,gap/0.15*30));
  const previewOnly=best.quotes.length>0&&best.quotes.every(q=>q.public_demo===true);
  const signalScore=previewOnly?Math.min(20,rawScore):(spreadPct>25?Math.min(rawScore,25):spreadPct>15?Math.min(rawScore,55):rawScore);
  const signalLabel=previewOnly?"PREVIEW ONLY · UNVERIFIED":best.quotes.length>=3&&spreadPct<=10&&signalScore>=65?"STRONG SIGNAL"
    :best.quotes.length>=2&&spreadPct<=25&&signalScore>=40?"CAUTION":"NO BET · WEAK SIGNAL";
  const r=best.runner;
  return {name:r.name||r.runner_name||r.horse_name||r.greyhound_name,number:r.number??r.runner_number??null,
    price:best.fair,priceSource:previewOnly?"Sportsbet public preview snapshot":"multi-bookmaker fixed-win median",quoteCount:best.quotes.length,
    spreadPct:+spreadPct.toFixed(1),gapPct:+(gap*100).toFixed(1),signalScore,signalLabel,previewOnly};
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
 const [upcomingResults,inplayResult]=await Promise.all([
  Promise.allSettled([1,2,3].map(page=>oddsApi("/v3/events/upcoming",{sport_id:sport.id,page,skip_esports:1}))),
  oddsApi("/v3/events/inplay",{sport_id:sport.id}).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason}))
 ]);
 const errors=[];
 const upcoming=upcomingResults.flatMap((result,index)=>{
  if(result.status==="rejected"){if(index===0)errors.push("Upcoming page 1: "+result.reason.message);return [];}
  return result.value.data.results||[];
 });
 const inplay=inplayResult.status==="fulfilled"?(inplayResult.value.data.results||[]):[];
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
  if(markets.length){
    const quoteStamp=bet365.last_update||bet365.updated_at||root.last_update||root.updated_at||null;
    e.bookmakers=[{key:"bet365",name:"Bet365",last_update:quoteStamp,markets}];
   }
 });
 const result={at:Date.now(),rows:events,errors,provider:"Odds Data API / Bet365"};
 oddsDataSportCache.set(cacheKey,result);
 console.info("ODDS_DATA_SPORT",JSON.stringify({sport:sport.title,id:sport.id,events:events.length,live:events.filter(x=>x.in_play).length,priced:events.filter(x=>x.bookmakers.length).length,errors:errors.length,errorSamples:errors.slice(0,3),bulk:!!options.bulk}));
 return result;
}

app.get("/api/health", (_req,res) => res.json({ok:true, bettingEnabled:false, mode:"read-only", liveFeedConfigured:!!API_KEY, liveSportsConfigured:!!ODDS_API_TOKEN, betfairConfigured:false, betfairMode:"disabled-unverified-403", storage:DATA_DIR}));
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
  return /(?:PuntersEdge[^\n]*|Racing provider) 402/.test(String(error)) ? 6 * 60 * 60 * 1000
    : /(?:429|rate.?limit)/i.test(String(error)) ? 60 * 60 * 1000 : 60 * 1000;
}
// RapidOddsAPI is the single source of truth for Australian and NZ racing.
// Its racing endpoints return bookmaker-specific runner prices (win/place), not sports markets.
const RAPID_RACING_CODES = ["thoroughbred","harness","greyhound"];
const KROKODDS_API_KEY = process.env.KROKODDS_API_KEY || "";
const KROKODDS_BASE = "https://krokodds.com.au/api/v1";
let krokRacingCache = {at:0,races:[],meta:null,creditsRemaining:null,errors:[]};
let krokRetryAt = 0;
async function fetchKrokRacing(date, raceType, bookmaker="sportsbet") {
  if (!KROKODDS_API_KEY) throw new Error("KROKODDS_API_KEY is missing in Railway variables.");
  const url = new URL(KROKODDS_BASE + "/odds-feed/racing");
  url.searchParams.set("date",date);
  // Filter to Sportsbet before the free-tier 10-row cap is applied.
  url.searchParams.set("race_type",raceType);
  url.searchParams.set("bookmaker",bookmaker);
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
    // A request filter is not proof of the returned quote's bookmaker.
    // Require an explicit bookmaker identity on each provider bookmaker row.
    const book = bookRow.bookmaker_key || bookRow.bookmaker || bookRow.bookmaker_name || bookRow.key || bookRow.name || bookRow.site || "";
    if (!book || canonicalBookmakerKey(book) !== canonicalBookmakerKey(bookmaker)) continue;
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
        const fixedWinRaw=runner.fixed_win??runner.fixed_win_price??runner.fixed_win_odds??runner.win_price??runner.win_odds??null;
        const fixedPlaceRaw=runner.fixed_place??runner.fixed_place_price??runner.fixed_place_odds??runner.place_price??runner.place_odds??null;
        const genericWin=runner.win??runner.odds??null, genericPlace=runner.place??null;
        const rowType=String(runner.bookmaker_type??runner.price_type??runner.market_type??bookRow.bookmaker_type??bookRow.price_type??bookRow.market_type??"fixed").toLowerCase();
        const genericIsTote=/tote|totalisator|pari.?mutuel/.test(rowType);
        const fixedWin=Number(fixedWinRaw??(!genericIsTote?genericWin:null));
        const fixedPlace=Number(fixedPlaceRaw??(!genericIsTote?genericPlace:null));
        const toteWin=Number(runner.tote_win??runner.tote_win_price??runner.tote?.win??(genericIsTote?genericWin:null));
        const totePlace=Number(runner.tote_place??runner.tote_place_price??runner.tote?.place??(genericIsTote?genericPlace:null));
        const valid=(value)=>Number.isFinite(value)&&value>1?value:null;
        const eachWayTerms=runner.each_way_terms??runner.each_way??runner.ew_terms??race.each_way??null;
        if(!runner.scratched && [fixedWin,fixedPlace,toteWin,totePlace].some(value=>valid(value)!=null)) {
          const bookmakerId=canonicalBookmakerKey(book);
          const quote={bookmaker:book,name:book,key:bookmakerId,
            ...(valid(fixedWin)!=null?{win_price:valid(fixedWin),fixed_win_price:valid(fixedWin),market_type:"fixed_win"}:{}),
            ...(valid(fixedPlace)!=null?{place_price:valid(fixedPlace),fixed_place_price:valid(fixedPlace),place_market_type:"fixed_place"}:{}),
            ...(valid(toteWin)!=null?{tote_win_price:valid(toteWin)}:{}),
            ...(valid(totePlace)!=null?{tote_place_price:valid(totePlace)}:{}),
            ...(eachWayTerms!=null?{each_way_terms:eachWayTerms}:{}),
            bookmaker_type:rowType,age_seconds:runner.age_seconds??bookRow.age_seconds??null,
            // Only bookmaker update fields qualify as quote timestamps. captured_at
            // is retained separately as feed observation metadata, never promoted.
            last_update:runner.updated_at||runner.last_update||bookRow.updated_at||bookRow.last_update||null,
            observed_at:new Date().toISOString(),feed_observed_at:bookRow.captured_at||new Date().toISOString(),
            timestamp_status:(runner.updated_at||runner.last_update||bookRow.updated_at||bookRow.last_update)?"bookmaker_timestamp":"unknown",
            source:"Krok Odds licensed direct bookmaker feed",url:runner.bet_link||null};
          const prior=existing.bookmakers.findIndex(q=>bookmakerKey(q)===bookmakerId);
          if(prior<0) existing.bookmakers.push(quote);
          else {
            // One bookmaker can return separate fixed and tote rows. Merge the
            // distinct market fields instead of letting the last row erase the first.
            const previous=existing.bookmakers[prior];
            const oldStamp=Date.parse(previous.last_update||"")||0;
            const newStamp=Date.parse(quote.last_update||"")||0;
            const newer=newStamp>=oldStamp;
            const merged={...(newer?previous:quote),...(newer?quote:previous)};
            for(const field of ["win_price","fixed_win_price","place_price","fixed_place_price","tote_win_price","tote_place_price","each_way_terms"]) {
              if(quote[field]==null&&previous[field]!=null)merged[field]=previous[field];
              if(previous[field]==null&&quote[field]!=null)merged[field]=quote[field];
            }
            merged.market_types=[...new Set([...(previous.market_types||[previous.bookmaker_type||"fixed"]),...(quote.market_types||[quote.bookmaker_type||"fixed"])])];
            existing.bookmakers[prior]=merged;
          }
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
      feedSource:"Krok Odds direct Sportsbet + Bet365 racing feeds",creditsRemaining:krokRacingCache.creditsRemaining,meta:krokRacingCache.meta};
  }
  if(!krokRacingCache.at || now-krokRacingCache.at>=60000) {
    // Query each bookmaker explicitly for every Australian racing code. This
    // prevents a small default response window being filled by other books.
    // The provider's free-tier cap is respected; we do not paginate or bypass it.
    const requests=["sportsbet","bet365"].flatMap(bookmaker=>["T","G","H"].map(code=>({bookmaker,code})));
    const results=await Promise.all(requests.map(async ({bookmaker,code})=>{
      try { return {...await fetchKrokRacing(today,code,bookmaker),bookmaker,code}; }
      catch(error) { return {races:[],meta:null,creditsRemaining:null,bookmaker,code,error:bookmaker+" "+code+": "+error.message}; }
    }));
    const races=dedupeRaces(results.flatMap(x=>x.races||[]));
    const errors=results.filter(x=>x.error).map(x=>x.error);
    const quotaBlocked=errors.some(message=>/429|monthly api limit|credit limit|402|quota/i.test(message));
    krokRetryAt=quotaBlocked?now+24*60*60*1000:0;
    krokRacingCache={at:now,races,meta:results.map(x=>x.meta).filter(Boolean),
      creditsRemaining:results.map(x=>x.creditsRemaining).filter(x=>x!=null).join(", ")||null,errors};
    const quoteCount=book=>races.reduce((n,r)=>n+r.runners.reduce((m,x)=>m+x.bookmakers.filter(q=>bookmakerKey(q)===book).length,0),0);
    console.info("KROK_RACING_FEED",JSON.stringify({at:new Date(krokRacingCache.at).toISOString(),
      raceCount:races.length,categories:Object.fromEntries(["horse","greyhound","harness"].map(k=>[k,races.filter(r=>r.category===k).length])),
      sportsbetQuotes:quoteCount("sportsbet"),bet365Quotes:quoteCount("bet365"),
      bookmakerCoverage:Object.fromEntries(["sportsbet","bet365"].map(book=>[book,Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,races.filter(r=>r.category===code&&r.runners.some(x=>x.bookmakers.some(q=>bookmakerKey(q)===book))).length]))])),
      runners:races.reduce((n,r)=>n+r.runners.length,0),creditsRemaining:krokRacingCache.creditsRemaining,
      retryAt:krokRetryAt?new Date(krokRetryAt).toISOString():null,errors}));
  }
  return {races:krokRacingCache.races,scheduleFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,
    oddsFetchedAt:krokRacingCache.at?new Date(krokRacingCache.at).toISOString():null,horizonHours:24,
    feedErrors:krokRacingCache.errors.map(message=>({feed:"Krok Odds",message})),
    feedSource:"Krok Odds direct Sportsbet + Bet365 racing feeds",creditsRemaining:krokRacingCache.creditsRemaining,meta:krokRacingCache.meta};
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
      const explicitBookmaker=book.bookmaker||book.bookmaker_name||book.key||book.name||"";
      const verifiedBookmaker=canonicalBookmakerKey(explicitBookmaker);
      const win = Number(runner.win??runner.win_price??runner.fixed_win_price);
      const place = Number(runner.place??runner.place_price??runner.fixed_place_price);
      if (verifiedBookmaker && RAPID_RACING_BOOKMAKERS.some(name=>canonicalBookmakerKey(name)===verifiedBookmaker)
          && !runner.scratched && Number.isFinite(win) && win > 1) {
        target.bookmakers.push({bookmaker:explicitBookmaker,name:explicitBookmaker,key:verifiedBookmaker,win_price:win,place_price:Number.isFinite(place)&&place>1?place:null,
          age_seconds:runner.age_seconds??(book.last_update?Math.max(0,Math.floor((Date.now()-Date.parse(book.last_update))/1000)):null),
          last_update:runner.last_update||runner.updated_at||book.last_update||null,
          feed_observed_at:new Date().toISOString(),timestamp_status:(runner.last_update||runner.updated_at||book.last_update)?"bookmaker_timestamp":"unknown",
          source:"RapidOddsAPI racing feed",url:book.url||null});
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
  if(rapidRacingCache.at && Date.now()-rapidRacingCache.at<60000) return rapidRacingCache;
  const errors=[];
  const meetingsByCode=await Promise.all(RAPID_RACING_CODES.map(async code=>{
    try {
      const data=await fetchRapidRacing("/racing/meetings",{countries:"AU",code});
      return {code,meetings:data.meetings||[]};
    } catch(err) { errors.push(code+" meetings: "+err.message); return {code,meetings:[]}; }
  }));
  const meetingJobs=meetingsByCode.flatMap(({code,meetings})=>meetings.map(async meeting=>{
    try {
      const data=await fetchRapidRacing("/racing/races",{track:meeting.track,code,countries:"AU",
        bookmakers:RAPID_RACING_BOOKMAKERS.join(",")});
      return (data.races||[]).map(normalizeRapidRace);
    } catch(err) { errors.push(meeting.track+" ("+code+"): "+err.message); return []; }
  }));
  const groups=await Promise.all(meetingJobs);
  const races=groups.flat().filter(r=>r.start_time && !r.abandoned && isAustralianRace(r));
  rapidRacingCache={at:Date.now(),races,errors};
  console.info("RAPID_AUSTRALIAN_RACING",JSON.stringify({meetings:meetingsByCode.reduce((n,x)=>n+x.meetings.length,0),races:races.length,errors:errors.length}));
  return rapidRacingCache;
}
async function loadSupplementalAustralianRaces() {
  // Try the already-configured RapidOddsAPI key against its licensed Australian racing endpoints.
  // If this key lacks Racing/Pro/Elite entitlement, surface the provider HTTP error and retain
  // MoviOdds Bet365 separately. Never relabel Bet365 or a public preview as Sportsbet.
  const jobs=[
    ["PuntersEdge public racing demo",()=>demoRacingFeed()],
    // The public bookmaker preview is a separate Sportsbet-labelled source.
    // Merge it into the main race list so its horse/greyhound runner quotes
    // are actually available to the dashboard, not just background diagnostics.
    // Use the no-key public bookmaker preview only. Sportsbet's HTML pages
    // return HTTP 403 from Railway; do not repeatedly request blocked pages.
    ["Sportsbet public bookmaker preview",()=>loadSportsbetPublicRaceDemos()],
    ["RapidOddsAPI",()=>RAPID_ODDS_KEY?loadRapidRacing():Promise.reject(new Error("RAPIDODDSAPI_API_KEY is not configured in Railway."))],
    ["Krok Odds Sportsbet licensed feed",()=>KROKODDS_API_KEY?getKrokRaces():Promise.resolve({races:[],feedErrors:[]})]
  ];
  const settled=await Promise.allSettled(jobs.map(([,run])=>run()));
  const races=[],errors=[];
  settled.forEach((result,index)=>{
    const [feed]=jobs[index];
    if(result.status==="rejected"){errors.push({feed,message:result.reason?.message||"Feed request failed"});return;}
    const value=result.value||{};
    const rows=Array.isArray(value)?value:(value.races||[]);
    races.push(...rows.filter(isAustralianRace));
    for(const error of value.errors||value.feedErrors||[]) errors.push({feed,message:typeof error==="string"?error:(error.message||JSON.stringify(error))});
  });
  return {races:dedupeRaces(races),errors};
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
function isRaceLive(r){return r.in_play===true||r.inplay===true||r.is_live===true||/live|in.?play|running/i.test(String(r.status||r.market_status||r.event_status||""));}
function isAustralianRace(race) {
  const country=String(race.country||race.country_code||race.region||"").trim().toLowerCase();
  if (/^(au|aus|australia|australian)(\b|$)/.test(country)) return true;
  if (country && !/^(unknown|n\/?a|not supplied|country not supplied|unspecified)$/.test(country)) return false;
  const venue=String(race.venue||race.track||race.course||"").toLowerCase();
  return !/\b(zia park|horseshoe indiana|star pelaw|pelaw|wolverhampton|kempton|newcastle uk|chelmsford|santa anita|del mar|gulfstream|churchill downs|aqueduct|belmont park|saratoga|woodbine|monmouth park|turf paradise|tampa bay downs|fair grounds|laurel park|prairie meadows|remington park|sam houston|lone star park|keeneland|pimlico|finger lakes|mountaineer|charles town|evangeline downs|thistledown|presque isle|hawthorne|horseshoe indianapolis)\b/.test(venue);
}


let sportsbetPublicCache={at:0,races:[],refresh:null};
function sportsbetDecodeHtml(value){return String(value||"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");}
function sportsbetHtmlLines(html){
 return sportsbetDecodeHtml(String(html||"")
  .replace(/<[/](?:td|th|tr|div|p|li|section|h[1-6])[ ]*>/gi,"\n")
  .replace(/<br[ ]*[/]?[ ]*>/gi,"\n")
  .replace(/<[^>]*>/g," "))
  .split(/\r?\n/).map(x=>x.replace(/[ ]+/g," ").trim()).filter(Boolean);
}
async function sportsbetFetch(url){
 const r=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"Mozilla/5.0 (compatible; RacingFavouriteFinder/1.0)"},signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw new Error("Sportsbet public page HTTP "+r.status);
 return r.text();
}
function parseSportsbetRacePage(html,url){
 const lines=sportsbetHtmlLines(html),p=new URL(url).pathname.toLowerCase();
 const cat=p.includes("greyhound-racing")?"greyhound":p.includes("harness-racing")?"harness":"horse";
 const m=p.match(/race-([0-9]+)-([0-9]+)/i),raceNumber=m?Number(m[1]):null;
 const title=sportsbetDecodeHtml((String(html).split("<title")[1]||"").split(">")[1]?.split("</title>")[0]||"");
 const venue=title.replace(/[ ]*(?:Race|R)[ ]*[0-9]+.*$/i,"").replace(/[ ]*[|].*$/,"").trim()||p.split("/").filter(Boolean).slice(-2,-1)[0]?.replace(/-/g," ")||"Sportsbet meeting";
 const header=lines.findIndex(x=>x.toLowerCase()==="runner"),runners=[];
 if(header>=0){
  const starts=[];
  for(let i=header+1;i<lines.length;i++)if(/^[0-9]+[.][ ]+.+[(][0-9]+[)]$/.test(lines[i]))starts.push(i);
  for(let k=0;k<starts.length;k++){
   const st=starts[k],en=starts[k+1]??Math.min(lines.length,st+40),h=lines[st];
   const rm=h.match(/^([0-9]+)[.][ ]+(.+)[ ]+[(]([0-9]+)[)]$/);if(!rm)continue;
   const runnerBlock=lines.slice(st+1,en);
   if(runnerBlock.some(x=>x.toLowerCase().startsWith("scratched")))continue;
   // Current Sportsbet race cards show fluctuation prices, then Win Fixed,
   // then Place Fixed. Extract Win Fixed only; page retrieval time is not quote time.
   const trainer=runnerBlock.findIndex(x=>x.toUpperCase().startsWith("T:"));
   const speed=runnerBlock.findIndex(x=>x.toLowerCase().includes("early speed:"));
   const oddsStart=trainer>=0?trainer+1:(speed>=0?speed+1:0),oddsValues=[];
   for(const line of runnerBlock.slice(oddsStart)){
    const tokens=line.replace(/[$,]/g,"").split(/[ ]+/).filter(Boolean);
    if(!tokens.length||!tokens.every(x=>/^[0-9]+[.][0-9]{1,2}$/.test(x)))continue;
    for(const token of tokens){const n=Number(token);if(n>1&&n<1000)oddsValues.push(n);}
   }
   const price=oddsValues.length>=2?oddsValues[oddsValues.length-2]:(oddsValues[0]||null);
   if(!Number.isFinite(price)||price<=1)continue;
   runners.push({number:Number(rm[1]),name:rm[2].trim(),scratched:false,bookmakers:[{
    key:"sportsbet",bookmaker:"Sportsbet",name:"Sportsbet",win_price:price,
    last_update:null,age_seconds:null,stale:true,timestamp_status:"unknown",observed_at:new Date().toISOString(),public_demo:true,
    source:"Sportsbet public race-page snapshot (quote timestamp unavailable)",source_url:url,event_url:url
   }]});
  }
 }
 let startTime=null;
 const todayLocal=new Date(new Date().toLocaleString("en-US",{timeZone:"Australia/Brisbane"}));
 for(const line of lines){
  const relative=line.match(/^(Today|Tomorrow)[ ]+([0-9]{1,2}):([0-9]{2})$/i);
  const dated=line.match(/([0-9]{1,2})[ ]+([A-Za-z]{3})[ ]+([0-9]{1,2}):([0-9]{2})/);
  let year=todayLocal.getFullYear(),month=null,day=null,hour=null,minute=null;
  if(relative){const d=new Date(todayLocal);if(relative[1].toLowerCase()==="tomorrow")d.setDate(d.getDate()+1);year=d.getFullYear();month=d.getMonth()+1;day=d.getDate();hour=Number(relative[2]);minute=Number(relative[3]);}
  else if(dated){month=new Date(Date.parse(dated[2]+" 1 2000")).getMonth()+1;day=Number(dated[1]);hour=Number(dated[3]);minute=Number(dated[4]);}
  else continue;
  if(month){const date=String(year).padStart(4,"0")+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");startTime=date+"T"+String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0")+":00+10:00";break;}
 }
 const rid=m?m[2]:p.split("-").pop();
 return {id:"sportsbet-"+rid,race_id:"sportsbet-"+rid,category:cat,code:cat,venue,track:venue,
  race_number:raceNumber,start_time:startTime,country:"Australia",status:"scheduled",in_play:false,
  runners,sportsbet_url:url,sportsbet_public:true,updated_at:new Date().toISOString()};
}
async function loadSportsbetPublicRaces(){
 if(sportsbetPublicCache.at&&Date.now()-sportsbetPublicCache.at<45000)return sportsbetPublicCache.races;
 if(sportsbetPublicCache.refresh)return sportsbetPublicCache.refresh;
 sportsbetPublicCache.refresh=(async()=>{
  const html=await sportsbetFetch("https://www.sportsbet.com.au/next-races"),hrefs=[];
  for(const a of html.matchAll(/href=["']([^"']+)["']/gi)){
   const raw=sportsbetDecodeHtml(a[1]);
   if(raw.includes("-racing/")&&/race-[0-9]+-[0-9]+/i.test(raw))hrefs.push(new URL(raw,"https://www.sportsbet.com.au").toString());
  }
  const urls=[...new Set(hrefs)].slice(0,120),races=[];let cursor=0;
  await Promise.all(Array.from({length:16},async()=>{while(cursor<urls.length){const url=urls[cursor++];try{const page=await sportsbetFetch(url),race=parseSportsbetRacePage(page,url);if(race.race_number)races.push(race);}catch(e){}}}));
  sportsbetPublicCache={at:Date.now(),races,refresh:null};
  console.log("SPORTSBET_PUBLIC_RACING_REFRESH",JSON.stringify({racePages:urls.length,races:races.length,priced:races.filter(x=>x.runners.length).length}));
  return races;
 })().catch(e=>{sportsbetPublicCache.refresh=null;console.warn("SPORTSBET_PUBLIC_FEED_FAILED",e.message);return sportsbetPublicCache.races;});
 return sportsbetPublicCache.refresh;
}

let sportsbetRacingDemoCache={at:0,races:[],errors:[]};
function sportsbetDemoPrice(runner){
 // WIN and PLACE are deliberately parsed independently. A generic price is
 // accepted only inside an explicitly labelled WIN market row.
 const directKeys=["win_price","fixed_win_price","fixed_win","win_odds","win_fixed_odds","fixed_win_odds","fixedWinOdds","fixedWinPrice","decimal_odds","odds_decimal","winPrice"];
 const readPrice=value=>{const n=Number(value);return Number.isFinite(n)&&n>1?n:null;};
 for(const key of directKeys){const n=readPrice(runner?.[key]);if(n)return n;}
 for(const group of [runner?.fixed_odds,runner?.fixedOdds,runner?.fixed,runner?.fixed_win_odds,runner?.fixedWinOdds,runner?.odds]){
  if(group&&typeof group==="object"&&!Array.isArray(group)){
   for(const key of directKeys.concat(["win","price","decimal","odds","returnWin"])){const n=readPrice(group[key]);if(n)return n;}
  }
 }
 const rows=[...(Array.isArray(runner?.markets)?runner.markets:[]),...(Array.isArray(runner?.prices)?runner.prices:[])];
 for(const row of rows){
  const market=String(row.market||row.market_name||row.marketName||row.type||row.name||row.key||"");
  if(!/win|winner|fixed_win/i.test(market))continue;
  const outcomes=row.outcomes||row.selections||row.runners||[row];
  for(const outcome of outcomes){for(const key of ["win_price","fixed_win_price","fixed_win","win_odds","price","odds","decimal","fixedOdds"]){const n=readPrice(outcome?.[key]);if(n)return n;}}
 }
 const keyed=runner?.bookmakers||runner?.bookmaker_odds;
 const entries=Array.isArray(keyed)?keyed:Object.values(keyed||{});
 for(const entry of entries){if(canonicalBookmakerKey(entry?.key||entry?.bookmaker||entry?.name)!=="sportsbet")continue;
  for(const key of directKeys){const n=readPrice(entry?.[key]);if(n)return n;}
  const n=readPrice(entry?.win);if(n)return n;
 }
 return null;
}
function sportsbetDemoPlacePrice(runner){
 const read=value=>{const n=Number(value);return Number.isFinite(n)&&n>1?n:null;};
 const keys=["place_price","fixed_place_price","fixed_place","place_odds","place_fixed_odds","fixed_place_odds","placePrice","placeOdds"];
 for(const key of keys){const n=read(runner?.[key]);if(n)return n;}
 for(const group of [runner?.place,runner?.place_odds,runner?.fixed_place,runner?.fixedPlaceOdds,runner?.fixed_place_odds,runner?.fixedOdds,runner?.fixed_odds,runner?.odds]){
  if(group&&typeof group==="object"&&!Array.isArray(group)){
   for(const key of keys.concat(["price","odds","decimal"])){const n=read(group[key]);if(n)return n;}
  }
 }
 const rows=[...(Array.isArray(runner?.markets)?runner.markets:[]),...(Array.isArray(runner?.prices)?runner.prices:[])];
 for(const row of rows){
  const market=String(row.market||row.market_name||row.marketName||row.type||row.name||row.key||"");
  if(!/place|each.?way/i.test(market))continue;
  const rawBook=row.bookmaker_key||row.bookmakerKey||row.bookmaker||row.bookmaker_name||row.site;
  if(rawBook&&canonicalBookmakerKey(rawBook)!=="sportsbet")continue;
  const outcomes=row.outcomes||row.selections||row.runners||[row];
  for(const outcome of outcomes){
   const book=outcome.bookmaker_key||outcome.bookmakerKey||outcome.bookmaker||outcome.bookmaker_name||outcome.site;
   if(book&&canonicalBookmakerKey(book)!=="sportsbet")continue;
   for(const key of keys.concat(["price","odds","decimal"])){const n=read(outcome?.[key]);if(n)return n;}
  }
 }
 const keyed=runner?.bookmakers||runner?.bookmaker_odds,entries=Array.isArray(keyed)?keyed:Object.values(keyed||{});
 for(const entry of entries){if(canonicalBookmakerKey(entry?.key||entry?.bookmaker||entry?.name)!=="sportsbet")continue;
  for(const key of keys){const n=read(entry?.[key]);if(n)return n;}
  const n=read(entry?.place);if(n&&typeof entry.place!=="object")return n;
 }
 return null;
}
function normalizeSportsbetDemoRace(item,category,sourceUrl,updatedAt,bookmaker="sportsbet"){
 const venueRaw=item.venue||item.track_name||item.track||item.meeting_name||item.meeting||item.event_name||item.event||item.name||"Sportsbet meeting";
 const venue=typeof venueRaw==="object"?(venueRaw.name||venueRaw.venue||"Sportsbet meeting"):String(venueRaw);
 const title=String(item.race_name||item.name||item.event_name||"");
 const raceNumber=Number(item.race_number??item.raceNo??item.race??item.number??(title.match(/\bR(?:ace)?\s*([0-9]+)\b/i)||[])[1]);
 const start=item.start_time||item.commence_time||item.startTime||item.jump_time||item.race_start_time||item.startTimeUtc||null;
 let rawRunners=item.runners||item.selections||item.participants||item.horses||item.dogs||[];
 if(!Array.isArray(rawRunners)||!rawRunners.length){
  const winMarket=(item.markets||[]).find(m=>/win|winner/i.test(String(m.name||m.key||m.market_name||"")));
  if(winMarket)rawRunners=(winMarket.outcomes||winMarket.selections||[]).map(o=>({...o,name:o.name||o.selection||o.label,win_price:o.price??o.odds}));
 }
 const bookKey=canonicalBookmakerKey(bookmaker);
 const runners=(Array.isArray(rawRunners)?rawRunners:[]).map(r=>{
  const name=r.name||r.runner_name||r.horse_name||r.greyhound_name||r.dog_name||r.selection||r.participant||"";
  if(!name)return null;
  const price=sportsbetDemoPrice(r);
  const placePrice=canonicalBookmakerKey(bookmaker)==="sportsbet"?sportsbetDemoPlacePrice(r):null;
  const number=r.number??r.runner_number??r.runnerNumber??r.saddlecloth??r.box??null;
  const bookKey=canonicalBookmakerKey(bookmaker),bookName=bookKey==="bet365"?"Bet365":"Sportsbet";
  const bookmakers=(price||placePrice)? [{key:bookKey,bookmaker:bookName,name:bookName,
   ...(price?{win_price:price,market_type:"fixed_win"}:{}),...(placePrice?{place_price:placePrice,place_market_type:"fixed_place"}:{}),
   last_update:r.last_update||r.captured_at||r.timestamp||r.updated_at||null,
   age_seconds:r.age_seconds??r.quote_age_seconds??null,feed_observed_at:new Date().toISOString(),stale:r.stale===true||(r.age_seconds!=null&&Number(r.age_seconds)>=180),public_demo:true,
   source:bookName+" fixed-win/place public bookmaker preview",source_url:sourceUrl,event_url:sourceUrl}]:[];
  return {name,number,scratched:r.scratched===true||r.status==="scratched",bookmakers};
 }).filter(Boolean);
 const id=String(item.id||item.race_id||item.event_id||[bookmaker,category,venue,raceNumber,start].join("-"));
 return {id,race_id:id,category,code:category,venue,track:venue,race_number:Number.isFinite(raceNumber)&&raceNumber>0?raceNumber:null,
  start_time:start,country:"Australia",status:item.status||"scheduled",in_play:item.in_play===true||item.inPlay===true,
  runners,bookmaker_source_url:sourceUrl,sportsbet_url:bookKey==="sportsbet"?sourceUrl:null,bet365_url:bookKey==="bet365"?sourceUrl:null,public_bookmaker:bookKey,updated_at:item.updated_at||updatedAt||null};
}
async function loadSportsbetPublicRaceDemos(){
 if(sportsbetRacingDemoCache.at&&Date.now()-sportsbetRacingDemoCache.at<90000)return sportsbetRacingDemoCache.races;
 // This public preview endpoint supports Sportsbet horse and greyhound only.
 // Bet365 is sourced separately from the MoviOdds Australian racing board; the
 // preview API does not list Bet365 or harness racing as supported combinations.
 const specs=[
  ["horse","horse-racing","sportsbet"],["greyhound","greyhound-racing","sportsbet"]
 ];
 const results=await Promise.allSettled(specs.map(([category,sport,book])=>
  publicDemoRequest("/v1/demo/book-sport",{book,sport}).then(payload=>({category,sport,book,payload}))));
 const races=[],errors=[];
 for(let i=0;i<results.length;i++){
  const result=results[i],category=specs[i][0],sport=specs[i][1],book=specs[i][2];
  if(result.status!=="fulfilled"){errors.push(book+" "+sport+": "+result.reason.message);continue;}
  const payload=result.value.payload,items=publicDemoItems(payload);
  if(payload.has_data===false)errors.push(book+" "+sport+": no public bookmaker snapshot returned");
  const sourceUrl=book==="sportsbet"
   ?(category==="horse"?"https://www.sportsbet.com.au/racing-schedule/horse/today":category==="greyhound"?"https://www.sportsbet.com.au/racing-schedule/greyhound/today":"https://www.sportsbet.com.au/racing-schedule/harness/today")
   :(category==="horse"?"https://www.bet365.com.au/#/HO/":category==="greyhound"?"https://www.bet365.com.au/#/HO/": "https://www.bet365.com.au/#/HO/");
  for(const item of items){
   const race=normalizeSportsbetDemoRace(item,category,sourceUrl,null,book);
   if(race.race_number||race.runners.length)races.push(race);
  }
 }
  sportsbetRacingDemoCache={at:Date.now(),races,errors};
 console.info("PUBLIC_BOOKMAKER_RACING_DEMO",JSON.stringify({raceItems:races.length,
  sportsbet:races.filter(r=>(r.runners||[]).some(x=>x.bookmakers.some(q=>q.key==="sportsbet"))).length,
  bet365:races.filter(r=>(r.runners||[]).some(x=>x.bookmakers.some(q=>q.key==="bet365"))).length,errors}));
 return races;
}

async function getGlobalRaces() {
  const failures=[];
  // A 402 is a hard monthly quota exhaustion, not a transient error. Do not
  // keep entering the provider loader on every browser/background refresh while
  // both racing endpoints are inside their cooldown; use the free feeds below.
  const puntersEdgeQuotaPaused = API_KEY && Date.now() < providerRetryAt.schedule && Date.now() < providerRetryAt.odds;
  if (puntersEdgeQuotaPaused) {
    failures.push({feed:"PuntersEdge",message:"Monthly credits exhausted (HTTP 402); authenticated racing requests are paused until the provider cooldown expires. Continuing with available public feeds."});
  }
  // Primary licensed schedule/odds source. If its free quota is exhausted, fall
  // through to the already-configured alternate providers rather than stopping.
  if (API_KEY && !puntersEdgeQuotaPaused) { // use the already-configured key for actual Sportsbet-labelled racing quotes
    try {
      const primary=await loadPuntersEdgeRaces();
      const quotaBlocked=(primary.feedErrors||[]).some(x=>/\\b402\\b|quota|credit limit/i.test(typeof x==="string"?x:(x.message||"")));
      const oddsAge=primary.oddsFetchedAt?Date.now()-Date.parse(primary.oddsFetchedAt):Infinity;
      // A cached board must not masquerade as live after the provider has run out
      // of credits. During a 402 cooldown, keep the primary only while its odds
      // snapshot is genuinely fresh; otherwise continue to Krok/MoviOdds previews.
      if (primary.races?.length && (!quotaBlocked || oddsAge<=180000)) {
        const supplemental=await loadSupplementalAustralianRaces();
        const combined=dedupeRaces([...(primary.races||[]),...supplemental.races]);
        const byCode=Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,combined.filter(r=>categoryOf(r)===code).length]));
        console.info("AUSTRALIAN_RACE_COVERAGE_MERGE",JSON.stringify({primary:(primary.races||[]).length,supplemental:supplemental.races.length,total:combined.length,byCode,errors:supplemental.errors.length}));
        return {...primary,races:combined,feedErrors:[...(primary.feedErrors||[]),...supplemental.errors],
          feedSource:"PuntersEdge live racing + public racing teaser + MoviOdds + Krok Odds (where configured)",
          note:"Australian horse, greyhound and harness races are merged across every configured source that responds. The list is broader than any one provider; it is not a guarantee of every race in Australia. Prices are retained only with their original bookmaker/source labels; missing prices remain unavailable."};
      }
      if (quotaBlocked) {
        failures.push({feed:"PuntersEdge",message:"HTTP 402 quota exhausted; cached odds are older than 3 minutes, so using alternate public/connected feeds instead."});
      } else {
        failures.push({feed:"PuntersEdge",message:"Schedule and next-to-go endpoints returned no races."});
      }
    } catch(error) {
      console.error("PUNTERS_EDGE_PRIMARY_FAILED",error.message);
      failures.push({feed:"PuntersEdge",message:error.message});
    }
  }
  // Krok Odds is a separately configured racing provider. It is queried only
  // after the primary feed fails and is cached for 60 seconds by getKrokRaces().
  if (KROKODDS_API_KEY) {
    try {
      const alternate=await getKrokRaces();
      if (alternate.races?.length) {
        const supplemental=await loadSupplementalAustralianRaces();
        return {...alternate,races:dedupeRaces([...(alternate.races||[]),...supplemental.races]),
          feedErrors:failures.concat(alternate.feedErrors||[],supplemental.errors),
          feedSource:"PuntersEdge public racing teaser + MoviOdds + Krok Odds",
          note:"Australian horse, greyhound and harness races are merged across configured feeds that respond. Coverage is broader but not guaranteed to include every national meeting; source-specific odds are never relabelled."};
      }
      failures.push({feed:"Krok Odds",message:(alternate.feedErrors||[]).map(x=>typeof x==="string"?x:(x.message||JSON.stringify(x))).join(" · ")||"No racing markets returned."});
    } catch(error) {
      failures.push({feed:"Krok Odds",message:error.message});
    }
  }
  // Use the direct, read-only Betfair Exchange API integration before the
  // optional external proxy URL. This path was implemented but previously
  // never called by the production racing feed selector.
  if (false && BETFAIR_APP_KEY && BETFAIR_SESSION_TOKEN && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()>=betfairRetryAt) {
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
  if (false && BETFAIR_FEED_URL && process.env.PUBLIC_ONLY_FEEDS !== "true" && Date.now()>=betfairFeedRetryAt) {
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
    // Request each Australian code separately: the combined public board's
    // near=200 cap can otherwise let one busy code crowd out the others.
    // This is still the same free, no-key MoviOdds source; it only broadens
    // schedule coverage and never turns its Bet365 prices into Sportsbet prices.
    const boardResults=await Promise.all(["horse","greyhound","harness"].map(async code=>{
      const response=await fetch("https://moviodds.com/racing?code="+code+"&near=200",{
        headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
      const body=await response.text();let data;
      try{data=JSON.parse(body);}catch{throw new Error(code+" board invalid JSON (HTTP "+response.status+").");}
      if(!response.ok)throw new Error(code+" board HTTP "+response.status+": "+(data.error||"request failed"));
      const rows=Array.isArray(data.races)?data.races:(data.meetings||[]).flatMap(m=>(m.races||[]).map(r=>({
        ...r,course:r.course||m.course,venue:r.venue||m.course||m.track||m.name,country:r.country||m.country
      })));
      return {code,rows,server_time:data.server_time||null};
    }).map(p=>p.then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason}))));
    const boardErrors=boardResults.filter(x=>x.status==="rejected").map(x=>x.reason.message);
    const payload={races:boardResults.filter(x=>x.status==="fulfilled").flatMap(x=>x.value.rows),
      server_time:boardResults.find(x=>x.status==="fulfilled")?.value.server_time||null};
    if(!payload.races.length)throw new Error(boardErrors.join(" · ")||"No Australian racing cards returned.");
    if(boardErrors.length)failures.push({feed:"MoviOdds per-code boards",message:boardErrors.join(" · ")});

    const raw=payload.races;
    const sampleRunner=raw.find(r=>(r.runners||r.selections||[]).length)?.runners?.[0]||raw.find(r=>(r.selections||[]).length)?.selections?.[0]||{};
    const samplePrice=(sampleRunner.prices||[])[0]||{};
    console.info("MOVIODDS_RACING_SCHEMA",JSON.stringify({raceKeys:Object.keys(raw[0]||{}),
      runnerKeys:Object.keys(sampleRunner||{}),priceKeys:Object.keys(samplePrice||{}),
      oddsKeys:Object.keys(sampleRunner.odds||{}),identityFields:["bookmaker","bookmaker_key","bookmaker_name","bookmaker_code","site","book","bookie","sportsbook","operator","price_source","price_ts","win_odds","source","source_name","provider_name"]
        .reduce((out,key)=>{if(sampleRunner[key]!=null)out.runner[key]=sampleRunner[key];if(samplePrice[key]!=null)out.price[key]=samplePrice[key];if(sampleRunner.odds?.[key]!=null)out.odds[key]=sampleRunner.odds[key];return out;},{runner:{},price:{},odds:{}})}));
    let verifiedBet365Quotes=0,verifiedSportsbetQuotes=0,unverifiedPriceRows=0;
    const races=raw.map(r=>{
      const code=String(r.code||r.race_code||r.category||"horse").toLowerCase();
      const category=(code==="g"||/greyhound|dog/.test(code))?"greyhound":(code==="h"||/harness|trots|pacing/.test(code))?"harness":"horse";
      const rawRunners=Array.isArray(r.runners)?r.runners:(Array.isArray(r.selections)?r.selections:[]);
      const runners=rawRunners.map(x=>{
        const nested=x.odds&&typeof x.odds==="object"&&!Array.isArray(x.odds)?x.odds:{};
        const fixed=x.fixed_odds&&typeof x.fixed_odds==="object"?x.fixed_odds:{};
        const priceRows=Array.isArray(x.prices)?x.prices:[];
        // Require explicit Bet365 identity on this runner/quote. A Bet365 page,
        // race-level label, or unfiltered MoviOdds board is not quote-level proof.
        const priceRow=priceRows.find(p=>moviQuoteBookmakerKey(p)==="bet365"&&
          /^(fixed[_ -]?)?win$|winner|win[_ -]fixed/i.test(String(p.market||p.market_name||p.type||p.key||"")));
        const nestedBet365=nested.bet365??fixed.bet365??x.bet365??null;
        const runnerBook=moviQuoteBookmakerKey(x);
        const nestedBook=moviQuoteBookmakerKey(nested)||moviQuoteBookmakerKey(fixed);
        const explicitRunnerBook=runnerBook==="bet365";
        const explicitNestedBook=nestedBook==="bet365";
        const hasRunnerWinPrice=x.win_odds!=null||x.fixed_win_odds!=null||x.fixed_win!=null||x.win_price!=null||x.win_frac!=null||x.fixed_win_frac!=null;
        // /racing is documented as a Bet365-only endpoint. The runner-level
        // price_source value "pm" is a feed code, not a bookmaker identity.
        const quoteBook=priceRow?"bet365":nestedBet365!=null?"bet365":
          explicitRunnerBook||explicitNestedBook?"bet365":hasRunnerWinPrice&&!runnerBook?"bet365":
          hasRunnerWinPrice&&runnerBook==="pm"?"bet365":null;
        const quoteIsBet365=quoteBook==="bet365";
        const quoteIsSportsbet=false;
        const quoteIsSupportedBook=quoteIsBet365;
        const bet365NestedValue=nestedBet365&&typeof nestedBet365==="object"
          ?(nestedBet365.win??nestedBet365.fixed_win??nestedBet365.win_price??nestedBet365.price??nestedBet365.odds)
          :nestedBet365;
        const hasUnverifiedPrice=priceRows.some(p=>/^(fixed[_ -]?)?win$|winner|win[_ -]fixed/i.test(String(p.market||p.market_name||p.type||p.key||""))&&moviQuoteBookmakerKey(p)!=="bet365")||
          [x.win_odds,x.fixed_win_odds,x.fixed_win,x.win_price,x.win_price_decimal,x.fixed_odds_decimal,x.win,
           nested.win,nested.fixed_win,nested.win_price,fixed.win,fixed.win_price,fixed.decimal,fixed.price].some(v=>v!=null);
        if(hasUnverifiedPrice&&!quoteIsBet365)unverifiedPriceRows++;
        const rawPrice=quoteIsSupportedBook?(priceRow?.price??priceRow?.odds??priceRow?.decimal??
          bet365NestedValue??(quoteIsBet365||explicitRunnerBook||explicitNestedBook?
            (x.win_odds??x.fixed_win_odds??x.fixed_win??x.win_price??x.win_price_decimal??x.fixed_odds_decimal??x.win??
             nested.win??nested.fixed_win??nested.win_price??fixed.win??fixed.win_price??fixed.decimal??fixed.price):null)):null;
        const fractional=typeof rawPrice==="string"&&rawPrice.includes("/")?rawPrice.split("/").map(Number):null;
        const winFraction=x.win_frac??x.fixed_win_frac??x.odds_fractional??null;
        const fractionText=typeof winFraction==="string"&&winFraction.includes("/")?winFraction.split("/").map(Number):null;
        const fractionPrice=fractional&&fractional.length===2&&fractional[1]>0?fractional[0]/fractional[1]+1:
          (fractionText&&fractionText.length===2&&fractionText[1]>0?fractionText[0]/fractionText[1]+1:null);
        const price=Number(fractionPrice??rawPrice);
        // price_ts is the MoviOdds runner-level price timestamp; race.updated_at is not.
        const updated=x.win_odds_updated_at||x.price_updated_at||x.odds_updated_at||x.last_update||x.price_ts||x.price_timestamp||x.timestamp||null;
        const placeUpdated=x.place_odds_updated_at||x.place_price_updated_at||x.place_ts||updated||null;
        const rawPlace=x.place_odds??x.fixed_place_odds??x.place_price??null;
        const placeFraction=typeof x.place_frac==="string"&&x.place_frac.includes("/")?x.place_frac.split("/").map(Number):null;
        const placeFractionPrice=placeFraction&&placeFraction.length===2&&placeFraction[1]>0?placeFraction[0]/placeFraction[1]+1:null;
        const placePrice=Number(placeFractionPrice??rawPlace);
        const validPlacePrice=Number.isFinite(placePrice)&&placePrice>1?placePrice:null;
        const explicitAge=x.age_seconds??x.quote_age_seconds??null;
        const age=explicitAge!=null&&Number.isFinite(Number(explicitAge))?Math.max(0,Number(explicitAge)):
          (updated?quoteAgeSecondsServer({last_update:updated}):null);
        const placeAge=placeUpdated?quoteAgeSecondsServer({last_update:placeUpdated}):age;
        if(quoteIsBet365&&Number.isFinite(price)&&price>1&&age!=null&&age<180)verifiedBet365Quotes++;
        if(quoteIsSportsbet&&Number.isFinite(price)&&price>1&&age!=null&&age<180)verifiedSportsbetQuotes++;
        const raceId=r.id||r.race_id||"";
        return {number:x.number??x.runner_number??x.runner_no??x.box??x.saddlecloth??null,
          name:x.name||x.runner_name||x.selection_name||x.horse_name||x.dog_name||"Runner",
          jockey:x.jockey||x.driver||null,barrier:x.barrier??x.draw??x.box??null,
          scratched:x.scratched===true||/scratched/i.test(String(x.status||"")),suspended:x.suspended===true,
          bookmakers:Number.isFinite(price)&&price>1&&quoteIsSupportedBook?[{key:quoteBook,bookmaker:quoteBook==="bet365"?"Bet365":"Sportsbet",name:quoteBook==="bet365"?"Bet365":"Sportsbet",win_price:price,market_type:"fixed_win",
            ...(validPlacePrice?{place_price:validPlacePrice,place_market_type:"fixed_place",place_last_update:placeUpdated,place_age_seconds:placeAge}:{}),
            last_update:updated,updated_at:updated,age_seconds:age,feed_observed_at:new Date().toISOString(),stale:x.stale===true||(age!=null&&age>=180),
            suspended:x.suspended===true,source:"Bet365 fixed-win public quote · MoviOdds documented Bet365-only /racing endpoint",
            source_url:x.url||x.source_url||("https://moviodds.com/racing/race?id="+encodeURIComponent(raceId)),
            public_demo:true}]:[]};
      });
      // Collapse repeated selection rows so each runner appears once in rankings and cards.
      const runnerMap=new Map();
      for(const runner of runners){
        const runnerKey=String(runner.number??"").trim()+"|"+String(runner.name||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
        const previous=runnerMap.get(runnerKey);
        if(!previous){runnerMap.set(runnerKey,runner);continue;}
        if(runner.scratched)previous.scratched=true;
        if(!previous.bookmakers.length&&runner.bookmakers.length)previous.bookmakers=runner.bookmakers;
        else if(previous.bookmakers.length&&runner.bookmakers.length){
          const old=previous.bookmakers[0],next=runner.bookmakers[0];
          const oldAge=quoteAgeSecondsServer(old),nextAge=quoteAgeSecondsServer(next);
          if(nextAge!=null&&(oldAge==null||nextAge<oldAge))previous.bookmakers=[next];
        }
      }
      const uniqueRunners=[...runnerMap.values()];
      const rawStart=r.jump_utc||r.start_time||r.start_at||r.jump_time||r.commence_time||r.time||null;
      const start=typeof rawStart==="number"?(rawStart>1000000000000?new Date(rawStart).toISOString():new Date(rawStart*1000).toISOString()):rawStart;
      const venue=r.course||r.venue||r.track||r.meeting||r.name||"Track TBA";
      const status=String(r.status||"scheduled").toLowerCase();
      const live=!!r.in_play||/live|in.?play|running/.test(status);
      return {race_id:String(r.id||r.race_id||[venue,r.race_number??r.number,start].join("-")),id:String(r.id||r.race_id||[venue,r.race_number??r.number,start].join("-")),
        category,code:category==="horse"?"thoroughbred":category,venue,track:venue,race_name:r.full_name||r.name||null,
        race_number:r.race_number??r.number??null,distance_m:Number(String(r.distance||"").match(/[0-9]+/)?.[0])||null,
        each_way:r.each_way||null,updated_at:r.updated_at||null,
        start_time:start,country:r.country||"Australia",status,in_play:live,
        closed:/abandon|result|closed/.test(status),runners:uniqueRunners};
    }).filter(r=>r.start_time&&!r.closed);
    console.info("MOVIODDS_RACING_BOOKMAKER_VALIDATION",JSON.stringify({races:races.length,verifiedBet365Quotes,verifiedSportsbetQuotes,unverifiedPriceRows,
      categories:Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,races.filter(r=>r.category===code).length]))}));
    if(races.length||publicRaceRows.length) {
      const supplemental=await loadSupplementalAustralianRaces();
      const combined=dedupeRaces([...publicRaceRows,...races,...supplemental.races]);
      console.info("AUSTRALIAN_PUBLIC_COVERAGE_MERGE",JSON.stringify({moviodds:races.length,puntersDemo:publicRaceRows.length,supplemental:supplemental.races.length,total:combined.length,
        byCode:Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,combined.filter(r=>categoryOf(r)===code).length])),supplementalErrors:supplemental.errors.length}));
      return {races:combined,
        scheduleFetchedAt:payload.server_time||new Date(demoRacingCache.at||Date.now()).toISOString(),
        oddsFetchedAt:new Date().toISOString(),
        horizonHours:24,feedErrors:failures.concat(supplemental.errors),feedSource:"Bet365 fixed-win MoviOdds racing board + public multi-bookmaker previews",scope:"Australia",
        note:"Australian horse, greyhound and harness cards are merged across available public and configured feeds. Public bookmaker prices keep their original source labels. Coverage depends on each provider's returned meetings and is not a guarantee of every national race; missing prices are not estimated."};
    }
    failures.push({feed:"MoviOdds public Bet365 preview",message:"No priced Australian races returned."});
  } catch(error) {
    failures.push({feed:"MoviOdds public Bet365 preview",message:error.message});
  }
  if(publicRaceRows.length) {
    const supplemental=await loadSupplementalAustralianRaces();
    const combined=dedupeRaces([...publicRaceRows,...supplemental.races]);
    return {races:combined,scheduleFetchedAt:new Date(demoRacingCache.at).toISOString(),oddsFetchedAt:new Date(demoRacingCache.at).toISOString(),
      horizonHours:24,feedErrors:failures.concat(supplemental.errors),feedSource:"PuntersEdge public racing teaser + MoviOdds + Krok (where configured)",scope:"Australia",
      note:"Australian horse, greyhound and harness races are combined from available public and configured sources. Coverage varies by feed and is not guaranteed to include every national race; missing prices are not estimated."};
  }
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

let racingFeedHealth = {ok:false,status:"checking",fetchedAt:null,feedSource:null,byCode:{},errors:[]};
const sportsFeedHealth = {};
let liveSportsFeedHealth = {ok:false,status:"checking",fetchedAt:null,eventCount:0,errors:[]};
function feedHealthStatus(at, errors=[], ok=false) {
  if(!at)return "checking";
  const age=Math.max(0,(Date.now()-Date.parse(at))/1000);
  // Green means the combined endpoint responded recently. Provider warnings remain in errors.
  if(age<=180 && ok)return "active";
  if(age<=600 && (ok||errors.length))return "partial";
  return "offline";
}
app.get("/api/feed-status",(_req,res)=>{
  const racingAge=racingFeedHealth.fetchedAt?Math.round((Date.now()-Date.parse(racingFeedHealth.fetchedAt))/1000):null;
  const racing={...racingFeedHealth,status:feedHealthStatus(racingFeedHealth.fetchedAt,racingFeedHealth.errors||[],racingFeedHealth.ok),qualityStatus:(racingFeedHealth.errors||[]).length?"partial":"good",ageSeconds:racingAge,
    byCode:Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,{...(racingFeedHealth.byCode?.[code]||{races:0,live:0}),status:feedHealthStatus(racingFeedHealth.fetchedAt,racingFeedHealth.errors||[],racingFeedHealth.ok),ageSeconds:racingAge}]))};
  const sports=Object.fromEntries(Object.entries(sportsFeedHealth).map(([key,value])=>[key,{...value,status:value.status||feedHealthStatus(value.fetchedAt,value.errors||[],value.ok),qualityStatus:(value.errors||[]).length?"partial":"good",ageSeconds:value.fetchedAt?Math.round((Date.now()-Date.parse(value.fetchedAt))/1000):null}]));
  const liveSports={...liveSportsFeedHealth,status:feedHealthStatus(liveSportsFeedHealth.fetchedAt,liveSportsFeedHealth.errors||[],liveSportsFeedHealth.ok),qualityStatus:(liveSportsFeedHealth.errors||[]).length?"partial":"good",ageSeconds:liveSportsFeedHealth.fetchedAt?Math.round((Date.now()-Date.parse(liveSportsFeedHealth.fetchedAt))/1000):null};
  res.set("Cache-Control","no-store").json({racing,sports,liveSports,checkedAt:new Date().toISOString()});
});
app.get("/api/races", async (_req, res) => {
  try {
    const feed = await getGlobalRaces();
    // Sportsbet's own HTML blocks Railway (HTTP 403). Request only supported
    // public Sportsbet horse/greyhound snapshots; Bet365 is parsed independently
    // from the MoviOdds board above. No unsupported bookmaker alias is fabricated.
    let sportsbetDemoRaces=[];try{sportsbetDemoRaces=await loadSportsbetPublicRaceDemos();}catch(e){console.warn("SPORTSBET_PUBLIC_RACING_DEMO_FAILED",e.message);}
    const races = dedupeRaces([...(feed.races||[]),...sportsbetDemoRaces]);    const fetchedAt=new Date().toISOString();
    const byCode=Object.fromEntries(["horse","greyhound","harness"].map(code=>[code,{races:races.filter(r=>categoryOf(r)===code).length,live:races.filter(r=>categoryOf(r)===code&&isRaceLive(r)).length}]));
    const feedErrors=(feed.feedErrors||[]).map(x=>typeof x==="string"?x:(x.message||JSON.stringify(x)));
    racingFeedHealth={ok:true,status:feedErrors.length?"partial":"active",fetchedAt,feedSource:feed.feedSource||"Public racing feeds",totalRaces:races.length,byCode,errors:feedErrors,scheduleFetchedAt:feed.scheduleFetchedAt||null,oddsFetchedAt:feed.oddsFetchedAt||null};
    const sportsbetQuotes=races.flatMap(r=>(r.runners||[]).flatMap(x=>runnerQuotes(x).filter(q=>bookmakerKey(q)==="sportsbet"))).length;
    try { await recordMarketSnapshots(races, new Date().toISOString()); }
    catch (snapshotError) { console.warn("MARKET_SNAPSHOT_WRITE_FAILED", snapshotError.message); }
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
    res.json({races, feedHealth:racingFeedHealth, providerBookmakers, mode:/demo|public/i.test(String(feed.feedSource||""))?"demo":"live", feedSource:feed.feedSource || "Configured Australian racing feed", fetchedAt:new Date().toISOString(),
      scheduleFetchedAt:feed.scheduleFetchedAt, oddsFetchedAt:feed.oddsFetchedAt,
      horizonHours:feed.horizonHours, providerPlan:feed.providerPlan||feed.meta?.tier||PROVIDER_PLAN, creditsRemaining:feed.creditsRemaining ?? null, feedMeta:feed.meta || null, feedErrors:feed.feedErrors, scope:"Australia",
      note:(feed.note||"Australian racing schedule and runner prices from the connected public feeds.")+" Sportsbet exact public quotes: "+sportsbetQuotes+"; no-key Sportsbet race snapshots: "+sportsbetDemoRaces.length+". The public Sportsbet snapshot returned no full national card on the last check; the official horse, greyhound and harness schedule links remain available. No other bookmaker price is substituted."});
  } catch (err) {
    const raw=String(err.message||"");
    racingFeedHealth={ok:false,status:"offline",fetchedAt:new Date().toISOString(),feedSource:"Unavailable",totalRaces:0,byCode:{horse:{races:0,live:0},greyhound:{races:0,live:0},harness:{races:0,live:0}},errors:[raw]};
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
const RAPID_SPORT_IDS = {
  oddsdata_12:["NFL"], oddsdata_16:["MLB"], oddsdata_18:["NBA","WNBA"],
  oddsdata_19:["NRL"], oddsdata_36:["AFL"]
};
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
   liveSportsFeedHealth={ok:true,status:errors.length?"partial":"active",fetchedAt:new Date().toISOString(),eventCount:events.length,sportsChecked:sports.length,errors};
   console.info("PUBLIC_LIVE_SPORTS",JSON.stringify({events:events.length,sportsChecked:sports.length,errors:errors.length}));
  }
  res.set("Cache-Control","no-store");
  res.json({configured:true,provider:"Free public Sportsbet + Bet365 snapshots",events:bet365LiveCache.events,feedHealth:liveSportsFeedHealth,
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
  const sports=ODDS_DATA_SPORTS.filter(x=>![2,4].includes(x.id)).map(s=>{
    const h=sportsFeedHealth[s.key]||{};
    return {key:s.key,title:s.title,name:s.title,category:"Sports",event_count:h.eventCount||0,
      live_count:h.liveCount||0,priced_count:h.pricedCount||0,verified_quote_count:h.verifiedQuoteCount||0,
      feed_status:h.status||"catalogue-only",provider:h.provider||"MoviOdds public event board",active:(h.eventCount||0)>0};
  });
  res.set("Cache-Control","no-store");
  res.json({sports,fetchedAt:new Date().toISOString(),
    provider:"MoviOdds public event board + public bookmaker snapshots where available",refreshSeconds:90,liveInPlayAvailable:true,
    providerErrors:[],
    note:"The catalogue lists supported sport types only. A sport becomes active only when actual live/upcoming fixtures are returned. Fixture coverage and verified bookmaker-price coverage are reported separately."});
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
    const events=(data.rows||[]).map(e=>({...e,bookmakers:(e.bookmakers||[]).map(b=>{
      const key=canonicalBookmakerKey(b.key||b.name);
      return {...b,key,name:key==="sportsbet"?"Sportsbet":key==="bet365"?"Bet365":b.name};
    })}));
    const errors=[...(data.errors||[])];
    sportsFeedHealth[sport.key]={ok:true,status:"checking",fetchedAt:new Date().toISOString(),title:sport.title,eventCount:0,liveCount:0,pricedCount:0,verifiedQuoteCount:0,errors,provider:data.provider||"public sports feeds"};
    // Public fixture coverage can be healthy while odds coverage is empty.
    // Enrich based on priced events, not raw fixture count.
    const pricedPublicEvents=events.filter(e=>(e.bookmakers||[]).some(b=>(b.markets||[]).some(m=>
      ["h2h","head_to_head"].includes(String(m.key||"").toLowerCase())&&
      (m.outcomes||[]).some(o=>Number(o.price)>1)))).length;
    if(ODDS_API_TOKEN&&pricedPublicEvents<3){
      try{
        const fallback=await loadOddsDataSport(sport,{bulk:true});
        for(const incoming of fallback.rows||[]){
          const home=normalizeName(incoming.home_team),away=normalizeName(incoming.away_team);
          const start=String(incoming.commence_time||"").slice(0,13);
          const existing=events.find(e=>normalizeName(e.home_team)===home&&normalizeName(e.away_team)===away&&
            (!start||!e.commence_time||String(e.commence_time).slice(0,13)===start));
          if(existing){
            for(const book of incoming.bookmakers||[]){
              const key=canonicalBookmakerKey(book.key||book.name);
              const previous=(existing.bookmakers||[]).find(x=>canonicalBookmakerKey(x.key||x.name)===key);
              if(!previous)(existing.bookmakers||(existing.bookmakers=[])).push(book);
              else{
                const oldStamp=Date.parse(previous.last_update||previous.updated_at||"");
                const newStamp=Date.parse(book.last_update||book.updated_at||"");
                if(Number.isFinite(newStamp)&&(!Number.isFinite(oldStamp)||newStamp>oldStamp))Object.assign(previous,book);
              }
            }
          }else events.push(incoming);
        }
      }catch(error){errors.push("Bet365 fixture fallback: "+error.message);}
    }
    const unique=new Map();
    for(const event of events){
      const key=[normalizeName(event.home_team),normalizeName(event.away_team),String(event.commence_time||"").slice(0,10)].join("|");
      if(!unique.has(key))unique.set(key,event);
      else unique.get(key).bookmakers=[...(unique.get(key).bookmakers||[]),...(event.bookmakers||[])];
    }
    const rows=[...unique.values()].filter(e=>e.in_play===true||(Number.isFinite(Date.parse(e.commence_time||""))&&Date.parse(e.commence_time)>=Date.now()));
    const pricedCount=rows.filter(e=>(e.bookmakers||[]).some(b=>(b.markets||[]).some(m=>(m.outcomes||[]).some(o=>Number(o.price)>1)))).length;
    const verifiedQuoteCount=rows.reduce((n,e)=>n+(e.bookmakers||[]).reduce((m,b)=>m+(b.markets||[]).reduce((k,market)=>k+(market.outcomes||[]).filter(o=>{const age=quoteAgeSecondsServer(o);return age!=null&&age<180;}).length,0),0),0);
    const feedStatus=errors.length?(rows.length?"partial":"feed-unavailable"):!rows.length?"no-upcoming-fixtures":verifiedQuoteCount?"fixtures-and-verified-prices":"fixtures-only";
    sportsFeedHealth[sport.key]={...sportsFeedHealth[sport.key],ok:!errors.length||rows.length>0,status:feedStatus,
      eventCount:rows.length,liveCount:rows.filter(e=>e.in_play===true).length,pricedCount,verifiedQuoteCount,
      errors,provider:data.provider||"public sports feeds"};
    res.set("Cache-Control","no-store");
    return res.json({sport:{key:sport.key,title:sport.title},events:rows,fetchedAt:new Date().toISOString(),
      provider:data.provider+(ODDS_API_TOKEN?" · Bet365 fallback when public coverage is thin":""),providerErrors:errors,publicDemo:true,
      eventCount:rows.length,liveCount:rows.filter(e=>e.in_play===true).length,
      pricedCount,verifiedQuoteCount,feedStatus,
      note:"Upcoming and live fixtures stay visible when prices are missing. Sportsbet and Bet365 aliases are normalised. Only source-timestamped quotes younger than 180 seconds count as current; old or unknown-age prices are not live. Provider coverage varies by sport."});
  }catch(error){sportsFeedHealth[sport.key]={ok:false,status:"offline",fetchedAt:new Date().toISOString(),title:sport.title,eventCount:0,liveCount:0,pricedCount:0,errors:[error.message]};return res.status(502).json({error:error.message,publicDemo:true});}
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

app.post("/api/history/sync", async (_req,res) => {
  try {
    if (!API_KEY) return res.status(503).json({error:"Results sync needs the configured PuntersEdge results feed."});
    const history = await readHistory();
    const pending = history.picks.filter(p => p.status === "pending");
    let settled = 0, unmatched = 0, checked = 0;
    if (pending.length) {
      // Use the recent official Australian results window so public-preview race IDs
      // can still be matched safely by venue, code, race number and local date.
      const results = rowsFrom(await provider("/v1/racing/results", {
        hours_back:168, country:"AU", status:"final", limit:200
      }));
      checked = results.length;
      const matched = new Set();
      for (const result of results) {
        const pick = findMatchingPick(pending,result);
        if (!pick) continue;
        const winner = winnerFromResult(result);
        if (!winner || !winner.name) continue;
        pick.status = "final";
        pick.winnerName = winner.name;
        pick.favouriteWon = isSameRunner(pick,winner);
        pick.resultedAt = result.resulted_at || new Date().toISOString();
        matched.add(pick);
        settled++;
      }
      unmatched = pending.filter(p=>!matched.has(p)).length;
    }
    if (settled) await saveHistory(history);
    res.set("Cache-Control","no-store");
    return res.json({ok:true,settled,unmatched,checked,pending:history.picks.filter(p=>p.status==="pending").length,
      note:"Only official final results returned by the connected results provider are used. Unmatched races remain pending."});
  } catch (error) {
    return res.status(502).json({error:"Results sync failed: "+error.message});
  }
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
        horse:byCode("horse"),greyhound:byCode("greyhound"),harness:byCode("harness")}
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
      let sportsbetRaceDemo=[];try{sportsbetRaceDemo=await loadSportsbetPublicRaceDemos();}catch(error){console.warn("SPORTSBET_PUBLIC_RACING_DEMO_BACKGROUND_FAILED",error.message);}
      console.info("RACING_BACKGROUND_REFRESH", JSON.stringify({
        source: feed.feedSource || "fallback",
        races: (feed.races || []).length,
        scheduleFetchedAt: feed.scheduleFetchedAt || null,
        oddsFetchedAt: feed.oddsFetchedAt || null,
        apiKeyConfigured: !!API_KEY,
        sportsbetPublicDemoRaces:sportsbetRaceDemo.length,
        sportsbetPublicDemoQuotes:sportsbetRaceDemo.reduce((n,r)=>n+r.runners.filter(x=>x.bookmakers.some(q=>q.key==="sportsbet")).length,0),
        sportsbetQuotesInCombinedFeed:(feed.races||[]).reduce((n,r)=>n+(r.runners||[]).reduce((m,x)=>m+runnerQuotes(x).filter(q=>bookmakerKey(q)==="sportsbet").length,0),0),
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
  setInterval(refreshBackgroundRacingFeed, 5 * 60 * 1000);
});
