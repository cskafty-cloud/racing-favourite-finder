const http = require("node:http");
const crypto = require("node:crypto");
const { raceCategory } = require("./race-category");

const PORT = Number(process.env.PORT || 8080);
const APP_KEY = process.env.BETFAIR_APP_KEY || "";
const SESSION_TOKEN = process.env.BETFAIR_SESSION_TOKEN || "";
const PROXY_ACCESS_TOKEN = String(process.env.BETFAIR_FEED_TOKEN || "");

// Exact byte-for-byte shared-secret comparison. Never trim or case-normalise.
function accessTokenMatches(suppliedToken) {
  const expectedToken = PROXY_ACCESS_TOKEN;
  if (typeof expectedToken !== "string" || typeof suppliedToken !== "string") return false;
  if (expectedToken.length === 0 || suppliedToken.length === 0) return false;
  const expected = Buffer.from(expectedToken, "utf8");
  const supplied = Buffer.from(suppliedToken, "utf8");
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}
const RPC_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1";
const CACHE_MS = 30000;
let cache = new Map();
let inflight = new Map();

let lastBetfairApiCheck = { status:"not-tested", at:null, method:null, error:null };
async function rpc(method, params) {
  try {
    if (!APP_KEY || !SESSION_TOKEN) throw new Error("Betfair credentials are not configured on this Australian feed service.");
    const requestBody = JSON.stringify([{ jsonrpc:"2.0", method:"SportsAPING/v1.0/"+method, params, id:1 }]);
    let response = null;
    let networkFailure = null;
    // Betfair can occasionally stall a connection from residential Australian
    // networks. Allow a longer response window and retry transient network /
    // gateway failures, but never retry an explicit authentication rejection.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type":"application/json", "X-Application":APP_KEY, "X-Authentication":SESSION_TOKEN, "Accept":"application/json", "Connection":"keep-alive" },
          body: requestBody,
          signal: AbortSignal.timeout(45000)
        });
        if (![502,503,504].includes(response.status) || attempt === 3) break;
        await response.arrayBuffer().catch(()=>{});
        response = null;
      } catch (fetchError) {
        networkFailure = fetchError;
        if (attempt === 3) break;
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
    if (!response) {
      const cause = networkFailure?.cause?.code || networkFailure?.cause?.message || networkFailure?.code || networkFailure?.message || "unknown network error";
      throw new Error("Betfair API connection failed after 3 attempts (45-second timeout each): " + String(cause).slice(0,120));
    }
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch {
      const lower = body.toLowerCase();
      if (response.status === 403 && (lower.includes("cloudflare") || lower.includes("attention required") || lower.includes("unable to access api.betfair.com")))
        throw new Error("Betfair Cloudflare denied this host (HTTP 403). This service must run from a permitted Australian egress IP; credentials are not confirmed invalid.");
      throw new Error("Betfair returned non-JSON HTTP " + response.status + ".");
    }
    const item = Array.isArray(data) ? data[0] : data;
    if (!response.ok || item?.error || item?.result == null) {
      const detail = item?.error?.data?.APINGException?.errorCode || item?.error?.message || "request failed";
      if (String(detail).toUpperCase().includes("INVALID_SESSION_INFORMATION")) {
        throw new Error("Betfair session token rejected (INVALID_SESSION_INFORMATION). Betfair explicitly rejected the session token. Obtain a fresh session token through Betfair's official authorised login/API process, then restart the Windows launcher and choose Y at the fresh-session prompt to replace the saved session token. The saved app key and shared feed token are retained. A timeout or network error is not proof of an expired session. Keep the app key and Railway shared token separate; do not send either secret in chat.");
      }
      throw new Error("Betfair HTTP " + response.status + ": " + detail);
    }
    lastBetfairApiCheck = { status:"accepted", at:new Date().toISOString(), method, error:null };
    return item.result;
  } catch (error) {
    lastBetfairApiCheck = { status:"failed", at:new Date().toISOString(), method, error:String(error.message||error).slice(0,180) };
    throw error;
  }
}
// listMarketBook has no general quote-publication timestamp. Timestamp the
// successful retrieval instead; never misrepresent retrieval time as Betfair
// publication time. "fresh" means recently observed by this adapter, not proof
// that delayed exchange data is live at the source.
function quote(level,observedAt=null,isMarketDataDelayed=null) {
  if(!level||!(Number(level.price)>1))return null;
  const observedMs=observedAt?Date.parse(observedAt):NaN;
  const ageSeconds=Number.isFinite(observedMs)?Math.max(0,(Date.now()-observedMs)/1000):null;
  return {price:Number(level.price),size:Number(level.size)||0,
    publishedAt:null,sourceTimestampAvailable:false,
    observedAt:observedAt||null,ageSeconds,
    fresh:ageSeconds!=null&&ageSeconds<=180,
    freshnessBasis:"adapter_retrieval_time",
    isMarketDataDelayed:typeof isMarketDataDelayed==="boolean"?isMarketDataDelayed:null,
    delayMaximumSeconds:180};
}
const SPORTS_CACHE_MS = 90 * 1000;
const CACHE_RETENTION_MS = 6 * 60 * 60 * 1000;
function cached(key, loader, ttlMs=CACHE_MS, staleWhileRevalidate=false) {
  const now=Date.now();
  for(const [cacheKey,entry] of cache)if(now-entry.at>CACHE_RETENTION_MS)cache.delete(cacheKey);
  const old=cache.get(key);
  if(old && now-old.at<ttlMs) return Promise.resolve(old.value);
  // Sports catalogue discovery is intentionally broad (all supported sports,
  // seven days plus in-play). Never make a dashboard request wait for that
  // full crawl when a previously verified cache is available. Return the
  // timestamped stale snapshot and refresh it in the background; quote-age
  // checks downstream still prevent stale prices being presented as live.
  if(old && staleWhileRevalidate) {
    if(!inflight.has(key)) {
      const refresh=loader().then(value=>{
        cache.set(key,{at:Date.now(),value});
        console.info("BETFAIR_ADAPTER_CACHE_REFRESHED",JSON.stringify({key,rows:key==="sports"?(value.events||[]).length:(value.races||[]).length}));
      }).catch(error=>{
        console.warn("BETFAIR_ADAPTER_CACHE_REFRESH_FAILED",JSON.stringify({key,error:String(error.message||error).slice(0,180)}));
      }).finally(()=>inflight.delete(key));
      inflight.set(key,refresh);
    }
    return Promise.resolve(old.value);
  }
  if(!inflight.has(key)) inflight.set(key, loader().then(value=>{
    cache.set(key,{at:Date.now(),value});
    if(cache.size>200)for(const cacheKey of cache.keys()){cache.delete(cacheKey);if(cache.size<=150)break;}
    return value;
  }).finally(()=>inflight.delete(key)));
  return inflight.get(key);
}

async function fetchRaceCatalogue(type,from,to,inPlayOnly=false,marketTypeCodes=['WIN','PLACE']){
 const filter={eventTypeIds:[type.id],marketCountries:['AU'],marketTypeCodes};
 if(inPlayOnly)filter.inPlayOnly=true;
 else filter.marketStartTime={from:from.toISOString(),to:to.toISOString()};
 try{
  const markets=await rpc('listMarketCatalogue',{filter,marketProjection:['EVENT','MARKET_START_TIME','RUNNER_DESCRIPTION','MARKET_DESCRIPTION'],sort:'FIRST_TO_START',maxResults:'1000'});
  return {markets:markets||[],errors:[]};
 }catch(error){
  if(!/TOO_MUCH_DATA/i.test(error.message))return {markets:[],errors:[error.message]};
  // Split WIN and PLACE independently for dense in-play catalogues.
  if(marketTypeCodes.length>1){
   const middle=Math.ceil(marketTypeCodes.length/2);
   const left=await fetchRaceCatalogue(type,from,to,inPlayOnly,marketTypeCodes.slice(0,middle));
   const right=await fetchRaceCatalogue(type,from,to,inPlayOnly,marketTypeCodes.slice(middle));
   const unique=new Map([...left.markets,...right.markets].map(m=>[String(m.marketId),m]));
   return {markets:[...unique.values()],errors:[...left.errors,...right.errors]};
  }
  if(inPlayOnly)return {markets:[],errors:['In-play racing catalogue remained oversized for '+marketTypeCodes[0]+': '+error.message]};
  const span=to.getTime()-from.getTime();
  if(span<=30*60*1000)return {markets:[],errors:['Racing catalogue remained oversized at 30-minute resolution: '+error.message]};
  const mid=new Date(from.getTime()+Math.floor(span/2));
  const left=await fetchRaceCatalogue(type,from,mid,false,marketTypeCodes),right=await fetchRaceCatalogue(type,mid,to,false,marketTypeCodes);
  const unique=new Map([...left.markets,...right.markets].map(m=>[String(m.marketId),m]));
  return {markets:[...unique.values()],errors:[...left.errors,...right.errors]};
 }
}
async function loadRaces() {
  const from=new Date(), to=new Date(Date.now()+7*24*60*60*1000);
  // listEventTypes is a tiny global catalogue. Some Betfair regions return
  // TOO_MUCH_DATA when country filters are applied at this stage; country
  // scoping is applied safely to each subsequent market-catalogue request.
  const eventTypes=await rpc("listEventTypes",{filter:{}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:String(x.eventType.name||"")}))
    .filter(x=>/horse racing|thoroughbred|greyhound|harness|trotting|trot|pacing/i.test(x.name));
  const groups=await Promise.all(types.map(async type=>{
    const [upcoming,inPlay]=await Promise.all([
      fetchRaceCatalogue(type,from,to,false),
      fetchRaceCatalogue(type,from,to,true)
    ]);
    const unique=new Map([...upcoming.markets,...inPlay.markets].map(m=>[String(m.marketId),m]));
    return {type,markets:[...unique.values()],upcomingCount:upcoming.markets.length,
      inPlayCount:inPlay.markets.length,errors:[...upcoming.errors,...inPlay.errors]};
  }));
  const all=groups.flatMap(g=>g.markets.map(m=>({...m,_type:g.type.name})));
  console.info("BETFAIR_AU_RACING_EVENT_TYPES",JSON.stringify({
    discovered:(eventTypes||[]).map(x=>String(x.eventType?.name||"")).filter(Boolean),
    selected:types.map(x=>x.name),
    catalogueMarkets:all.length,
    upcomingCatalogueMarkets:groups.reduce((n,g)=>n+g.upcomingCount,0),
    inPlayCatalogueMarkets:groups.reduce((n,g)=>n+g.inPlayCount,0),
    marketsByType:Object.fromEntries(groups.map(g=>[g.type.name,{total:g.markets.length,upcoming:g.upcomingCount,inPlay:g.inPlayCount}])),
    marketsByRaceType:Object.fromEntries([...new Set(all.map(m=>String(m.description?.raceType||"not-supplied")))]
      .map(raceType=>[raceType,all.filter(m=>String(m.description?.raceType||"not-supplied")===raceType).length]))
  }));
  // Betfair can return HTTP 200 with TOO_MUCH_DATA for a batch of
  // market books. Split oversized batches recursively so one dense race
  // does not discard every other Australian market in the refresh.
  async function fetchRaceBooks(marketIds) {
    try {
      const result=await rpc("listMarketBook",{
        marketIds,
        priceProjection:{priceData:["EX_BEST_OFFERS"],exBestOffersOverrides:{bestPricesDepth:3},virtualise:true}
      });
      const observedAt=new Date().toISOString();
      return {books:(result||[]).map(book=>({...book,_adapterObservedAt:observedAt})),errors:[]};
    } catch(error) {
      if(/TOO_MUCH_DATA/i.test(error.message)&&marketIds.length>1) {
        const middle=Math.ceil(marketIds.length/2);
        const left=await fetchRaceBooks(marketIds.slice(0,middle));
        const right=await fetchRaceBooks(marketIds.slice(middle));
        return {books:[...left.books,...right.books],errors:[...left.errors,...right.errors]};
      }
      if(/TOO_MUCH_DATA/i.test(error.message)&&marketIds.length===1) {
        try {
          const retry=await rpc("listMarketBook",{
            marketIds,
            priceProjection:{priceData:["EX_BEST_OFFERS"],exBestOffersOverrides:{bestPricesDepth:1},virtualise:false}
          });
          const observedAt=new Date().toISOString();
          return {books:(retry||[]).map(book=>({...book,_adapterObservedAt:observedAt})),errors:[]};
        } catch(retryError) {
          return {books:[],errors:["Market "+marketIds[0]+" remained oversized at depth 1: "+retryError.message]};
        }
      }
      return {books:[],errors:["Market batch ("+marketIds.length+"): "+error.message]};
    }
  }
  const books=[],bookErrors=[];
  for(let i=0;i<all.length;i+=40) {
    const result=await fetchRaceBooks(all.slice(i,i+40).map(m=>m.marketId));
    books.push(...result.books);
    bookErrors.push(...result.errors);
  }
  const byId=new Map(books.map(b=>[b.marketId,b]));
  const capturedAt=new Date().toISOString();
  const grouped=new Map();
  for(const market of all){
    const book=byId.get(market.marketId);
    if(!book||book.status!=="OPEN")continue;
    const eventName=String(market.event?.name||"Unknown track");
    const raceNumberMatch=eventName.match(/(?:^|\\b)R(?:ace)?\\s*(\\d+)\\b/i);
    const key=market.event?.id+"|"+market.marketStartTime+"|"+eventName;
    if(!grouped.has(key)) grouped.set(key,{race_id:"betfair-au-"+key,id:"betfair-au-"+key,
      category:raceCategory(market._type,market.description,market.event),code:raceCategory(market._type,market.description,market.event),
      raceType:market.description?.raceType||market.description?.race_type||market.event?.raceType||market.event?.race_type||null,venue:eventName,
      track:eventName,race_number:raceNumberMatch?Number(raceNumberMatch[1]):null,start_time:market.marketStartTime,
      country:"Australia",status:book.inplay?"in_play":"scheduled",in_play:!!book.inplay,
      closed:false,market_id:market.marketId,market_name:"Betfair Exchange",captured_at:capturedAt,
      marketDataDelayed:typeof book.isMarketDataDelayed==="boolean"?book.isMarketDataDelayed:null,
      sourceTimestampAvailable:false,freshnessBasis:"adapter_retrieval_time",runners:[]});
    const race=grouped.get(key);
    for(const runner of market.runners||[]){
      let target=race.runners.find(x=>x.selectionId===runner.selectionId);
      if(!target){target={selectionId:runner.selectionId,number:runner.sortPriority||null,name:runner.runnerName,
        exchange:{win:{back:null,lay:null},place:{back:null,lay:null}},bookmakers:[]};race.runners.push(target);}
      const priced=(book.runners||[]).find(x=>x.selectionId===runner.selectionId);
      if(!priced||priced.status==="REMOVED")continue;
      const kind=String(market.description?.marketType||market.marketName||"WIN").toUpperCase().includes("PLACE")?"place":"win";
      target.exchange[kind]={back:quote(priced.ex?.availableToBack?.[0],book._adapterObservedAt,book.isMarketDataDelayed),lay:quote(priced.ex?.availableToLay?.[0],book._adapterObservedAt,book.isMarketDataDelayed)};
    }
  }
  const races=[...grouped.values()].map(race=>{
    const winFavourite=race.runners.filter(r=>r.exchange?.win?.back?.fresh===true&&Number(r.exchange.win.back.price)>1)
      .sort((a,b)=>a.exchange.win.back.price-b.exchange.win.back.price)[0]||null;
    const placeFavourite=race.runners.filter(r=>r.exchange?.place?.back?.fresh===true&&Number(r.exchange.place.back.price)>1)
      .sort((a,b)=>a.exchange.place.back.price-b.exchange.place.back.price)[0]||null;
    return {...race,
      exchangeFavourite:winFavourite?{name:winFavourite.name,selectionId:winFavourite.selectionId,
        price:winFavourite.exchange.win.back.price,side:"BACK",market:"WIN",
        source:"Betfair Exchange Delayed API",capturedAt:null,
        observedAt:winFavourite.exchange.win.back.observedAt,sourceTimestampAvailable:false,
        freshnessBasis:"adapter_retrieval_time",isMarketDataDelayed:winFavourite.exchange.win.back.isMarketDataDelayed,
        delayMaximumSeconds:180}:null,
      exchangePlaceFavourite:placeFavourite?{name:placeFavourite.name,selectionId:placeFavourite.selectionId,
        price:placeFavourite.exchange.place.back.price,side:"BACK",market:"PLACE",
        source:"Betfair Exchange Delayed API",capturedAt:null,
        observedAt:placeFavourite.exchange.place.back.observedAt,sourceTimestampAvailable:false,
        freshnessBasis:"adapter_retrieval_time",isMarketDataDelayed:placeFavourite.exchange.place.back.isMarketDataDelayed,
        delayMaximumSeconds:180}:null
    };
  });
  const quoteCounts={
    winBack:races.reduce((n,r)=>n+r.runners.filter(x=>x.exchange?.win?.back?.fresh===true).length,0),
    winLay:races.reduce((n,r)=>n+r.runners.filter(x=>x.exchange?.win?.lay?.fresh===true).length,0),
    placeBack:races.reduce((n,r)=>n+r.runners.filter(x=>x.exchange?.place?.back?.fresh===true).length,0),
    placeLay:races.reduce((n,r)=>n+r.runners.filter(x=>x.exchange?.place?.lay?.fresh===true).length,0)
  };
  const favouriteCount=races.filter(r=>r.exchangeFavourite).length;
  const inPlayRaceCount=races.filter(r=>r.in_play).length;
  console.info("BETFAIR_AU_RACING_MARKET_QUALITY",JSON.stringify({
    raceCards:races.length,inPlayRaceCards:inPlayRaceCount,upcomingRaceCards:races.length-inPlayRaceCount,
    quoteCounts,winFavourites:favouriteCount,placeFavourites:races.filter(r=>r.exchangePlaceFavourite).length,
    pricedRaces:races.filter(r=>r.runners.some(x=>x.exchange?.win?.back?.fresh===true)).length
  }));
  return {races,feedSource:"Betfair Exchange delayed · Australian region",scope:"Australia",
    scheduleFetchedAt:capturedAt,oddsFetchedAt:capturedAt,horizonHours:168,quoteCounts,
    inPlayRaceCount,upcomingRaceCount:races.length-inPlayRaceCount,
    winFavouriteCount:favouriteCount,placeFavouriteCount:races.filter(r=>r.exchangePlaceFavourite).length,
    feedErrors:[...groups.flatMap(g=>g.errors.map(message=>({sport:g.type.name,message}))),
      ...bookErrors.map(message=>({sport:"Australian racing",message}))],
    exchangeOnly:true,marketTypes:["WIN","PLACE"],
    note:"Exchange BACK/LAY prices only. Exchange favourites use the lowest available WIN or PLACE BACK price respectively, based on adapter retrieval time rather than a source publication timestamp. Betfair delayed data may be up to 180 seconds old. These are not fixed bookmaker prices and must not be included in Sportsbet or Bet365 favourite calculations."};
}
const SPORT_MARKET_TYPES = ["MATCH_ODDS","H2H","MONEYLINE","WINNER","TO_WIN","OUTRIGHT_WINNER","TOTAL_GOALS","BOTH_TEAMS_TO_SCORE","CORRECT_SCORE","ASIAN_HANDICAP","OVER_UNDER_25"];
async function fetchSportCatalogue(type, from, to, marketTypeCodes=SPORT_MARKET_TYPES, inPlayOnly=false) {
  const filter={eventTypeIds:[type.id],marketTypeCodes};
  if(inPlayOnly)filter.inPlayOnly=true;else filter.marketStartTime={from:from.toISOString(),to:to.toISOString()};
  try{
    const markets=await rpc("listMarketCatalogue",{filter,marketProjection:["EVENT","MARKET_START_TIME","RUNNER_DESCRIPTION","MARKET_DESCRIPTION"],sort:"FIRST_TO_START",maxResults:"100"});
    return {markets:markets||[],errors:[]};
  }catch(error){
    if(!/TOO_MUCH_DATA/i.test(error.message))return {markets:[],errors:[error.message]};
    if(marketTypeCodes.length>1){
      const middle=Math.ceil(marketTypeCodes.length/2);
      const left=await fetchSportCatalogue(type,from,to,marketTypeCodes.slice(0,middle),inPlayOnly);
      const right=await fetchSportCatalogue(type,from,to,marketTypeCodes.slice(middle),inPlayOnly);
      const unique=new Map([...left.markets,...right.markets].map(m=>[String(m.marketId),m]));
      return {markets:[...unique.values()],errors:[...left.errors,...right.errors]};
    }
    if(inPlayOnly)return {markets:[],errors:["In-play catalogue remained oversized ("+marketTypeCodes[0]+"): "+error.message]};
    const span=to.getTime()-from.getTime();
    if(span<=5*60*1000)return {markets:[],errors:["Sport catalogue remained oversized at five-minute resolution ("+marketTypeCodes[0]+"): "+error.message]};
    const midpoint=new Date(from.getTime()+Math.floor(span/2));
    const left=await fetchSportCatalogue(type,from,midpoint,marketTypeCodes,false);
    const right=await fetchSportCatalogue(type,midpoint,to,marketTypeCodes,false);
    const unique=new Map([...left.markets,...right.markets].map(m=>[String(m.marketId),m]));
    return {markets:[...unique.values()],errors:[...left.errors,...right.errors]};
  }
}
async function fetchSportBooks(marketIds) {
  const request = (ids, depth, virtualise) => rpc("listMarketBook",{
    marketIds:ids,
    priceProjection:{
      priceData:["EX_BEST_OFFERS"],
      exBestOffersOverrides:{bestPricesDepth:depth},
      virtualise
    }
  });
  try {
    const result=await request(marketIds,3,true);
    const observedAt=new Date().toISOString();
    return {books:(result||[]).map(book=>({...book,_adapterObservedAt:observedAt})),errors:[]};
  } catch (error) {
    if (/TOO_MUCH_DATA/i.test(error.message) && marketIds.length > 1) {
      const middle = Math.ceil(marketIds.length / 2);
      const left = await fetchSportBooks(marketIds.slice(0,middle));
      const right = await fetchSportBooks(marketIds.slice(middle));
      return {books:[...left.books,...right.books],errors:[...left.errors,...right.errors]};
    }
    // A single dense Soccer market can exceed the response limit on the
    // default best-offers depth. Retry that one market with only the top
    // price level and without virtual prices before reporting it as failed.
    if (/TOO_MUCH_DATA/i.test(error.message) && marketIds.length === 1) {
      try {
        const result=await request(marketIds,1,false);
        const observedAt=new Date().toISOString();
        return {books:(result||[]).map(book=>({...book,_adapterObservedAt:observedAt})),errors:[]};
      } catch (retryError) {
        return {books:[],errors:["Market "+marketIds[0]+" failed at bestPricesDepth=1: "+retryError.message]};
      }
    }
    return {books:[],errors:["Market batch ("+marketIds.length+"): "+error.message]};
  }
}
async function loadSports() {
  const from=new Date(),to=new Date(Date.now()+7*24*60*60*1000);
  const eventTypes=await rpc("listEventTypes",{filter:{}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:String(x.eventType.name||"Sport")}))
    .filter(x=>!/horse racing|greyhound racing|harness racing/i.test(x.name));
  const groups=types.map(type=>({type,markets:[],errors:[]}));
  const groupById=new Map(groups.map(group=>[group.type.id,group]));
  // Daily catalogue slices avoid the 200-market cap hiding later fixtures.
  for(let day=0;day<7;day++){
    const windowFrom=new Date(from.getTime()+day*24*60*60*1000);
    const windowTo=new Date(Math.min(to.getTime(),windowFrom.getTime()+24*60*60*1000));
    for(let i=0;i<types.length;i+=5){
      const batch=await Promise.all(types.slice(i,i+5).map(async type=>({type,result:await fetchSportCatalogue(type,windowFrom,windowTo)})));
      for(const item of batch){const group=groupById.get(item.type.id);group.markets.push(...item.result.markets);group.errors.push(...item.result.errors);}
    }
  }
  // In-play markets have already-started market times, so query them separately.
  for(let i=0;i<types.length;i+=5){
    const batch=await Promise.all(types.slice(i,i+5).map(async type=>({type,result:await fetchSportCatalogue(type,from,to,SPORT_MARKET_TYPES,true)})));
    for(const item of batch){const group=groupById.get(item.type.id);group.markets.push(...item.result.markets);group.errors.push(...item.result.errors);}
  }
  for(const group of groups){
    group.markets=[...new Map(group.markets.map(m=>[String(m.marketId),m])).values()]
      .sort((left,right)=>Number(!!right.inPlay)-Number(!!left.inPlay)||Date.parse(left.marketStartTime)-Date.parse(right.marketStartTime))
      .slice(0,100);
    group.error=group.errors.length?[...new Set(group.errors)].join("; "):null;
  }
  const all=groups.flatMap(g=>g.markets.map(m=>({...m,_sport:g.type.name})));
  const books=[],bookErrors=[];
  for(let i=0;i<all.length;i+=40){
    const batch=all.slice(i,i+40),result=await fetchSportBooks(batch.map(m=>m.marketId));
    books.push(...result.books);
    if(result.errors.length)bookErrors.push({sports:[...new Set(batch.map(m=>m._sport))],message:result.errors.join("; ")});
  }
  const byId=new Map(books.map(b=>[b.marketId,b])),capturedAt=new Date().toISOString();
  const events=all.map(m=>{
    const book=byId.get(m.marketId);if(!book||book.status!=="OPEN")return null;
    const runners=(m.runners||[]).map(r=>{
      const p=(book.runners||[]).find(x=>x.selectionId===r.selectionId);
      if(!p||p.status==="REMOVED")return null;
      return {name:r.runnerName,selectionId:r.selectionId,
        back:quote(p.ex?.availableToBack?.[0],book._adapterObservedAt,book.isMarketDataDelayed),lay:quote(p.ex?.availableToLay?.[0],book._adapterObservedAt,book.isMarketDataDelayed)};
    }).filter(Boolean);
    const favourite=runners.filter(r=>r.back?.fresh===true).sort((a,b)=>a.back.price-b.back.price)[0]||null;
    return {id:"betfair-sport-"+m.marketId,marketId:m.marketId,eventId:m.event?.id||null,
      sport:m._sport,event:m.event?.name||"Event",competition:m.event?.venue||null,
      startTime:m.marketStartTime,marketName:m.marketName||"Match odds",status:book.inplay?"in_play":"upcoming",
      inPlay:!!book.inplay,capturedAt,marketPublishedAt:null,sourceTimestampAvailable:false,
      isMarketDataDelayed:!!book.isMarketDataDelayed,source:"Betfair Exchange Delayed API",
      sourceDelayMaxSeconds:180,runners,favourite:favourite?{name:favourite.name,price:favourite.back.price,side:"BACK"}:null};
  }).filter(Boolean).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  const errors=[
    ...groups.filter(g=>g.error).map(g=>({sport:g.type.name,message:g.error})),
    ...bookErrors.map(e=>({sport:e.sports.join(", "),message:"Market-book batch: "+e.message}))
  ];
  const pricedMarkets=events.filter(e=>e.runners.some(r=>r.back||r.lay)).length;
  const marketCountsBySport=types.map(type=>({
    sport:type.name,catalogueMarkets:groups.find(g=>g.type.id===type.id)?.markets.length||0,
    openMarkets:events.filter(e=>e.sport===type.name).length,
    pricedMarkets:events.filter(e=>e.sport===type.name&&e.runners.some(r=>r.back||r.lay)).length,
    error:groups.find(g=>g.type.id===type.id)?.error||null
  }));
  const soccer=marketCountsBySport.find(x=>/soccer|football/i.test(x.sport))||{catalogueMarkets:0,openMarkets:0,pricedMarkets:0,error:"Soccer event type was not returned by Betfair."};
  return {events,eventTypes:types,capturedAt,from:from.toISOString(),to:to.toISOString(),
    status:pricedMarkets?"connected-delayed":errors.length?"partial":"configured-no-quotes",
    marketCount:events.length,marketCountsBySport,
    soccerMarketCount:soccer.openMarkets,soccerPricedMarkets:soccer.pricedMarkets,
    pricedMarkets,
    backOffers:events.reduce((n,e)=>n+e.runners.filter(r=>r.back).length,0),
    layOffers:events.reduce((n,e)=>n+e.runners.filter(r=>r.lay).length,0),
    errors,provider:"Betfair Exchange Delayed API",delayMaximumSeconds:180,
    note:"Exchange BACK/LAY prices only. Freshness measures time since this adapter retrieved the market book; Betfair does not expose a general quote-publication timestamp in listMarketBook. The API may return delayed data (up to 180 seconds). These are not live bookmaker prices."};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");
  const path=req.url.split("?")[0];
  if(path==="/health"){
    // A health response now verifies the authenticated Betfair API itself,
    // not merely the presence of saved credentials. Cache the probe for 60s.
    const checkedAt=Date.parse(lastBetfairApiCheck.at||"");
    if(!Number.isFinite(checkedAt)||Date.now()-checkedAt>60000){
      try{await rpc("listEventTypes",{filter:{}});}catch{}
    }
    return res.end(JSON.stringify({ok:true,ready:lastBetfairApiCheck.status==="accepted",
      status:lastBetfairApiCheck.status==="accepted"?"authenticated":"authentication-required",
      region:"Australia",provider:"Betfair delayed read-only",
      credentialsConfigured:!!(APP_KEY&&SESSION_TOKEN),
      betfairApiAuthenticated:lastBetfairApiCheck.status==="accepted",
      authentication:lastBetfairApiCheck.status,
      reauthenticationRequired:String(lastBetfairApiCheck.error||"").includes("INVALID_SESSION_INFORMATION"),
      authenticationMessage:String(lastBetfairApiCheck.error||"").includes("INVALID_SESSION_INFORMATION")
        ? "Betfair explicitly rejected the saved session token. Refresh it through Betfair's official authorised login/API process, then replace it in the Windows launcher."
        : lastBetfairApiCheck.error,
      lastBetfairApiCheck,
      racingCacheAt:cache.get("races")?.at?new Date(cache.get("races").at).toISOString():null,
      racingCacheLoaded:cache.has("races"),
      racingCacheStatus:!cache.has("races")?"not-loaded":(cache.get("races")?.value?.races?.length?"loaded-with-markets":"loaded-empty"),
      racingMarketRows:cache.get("races")?.value?.races?.length??null,
      sportsCacheAt:cache.get("sports")?.at?new Date(cache.get("sports").at).toISOString():null,
      sportsCacheLoaded:cache.has("sports"),
      sportsCacheStatus:!cache.has("sports")?"not-loaded":(cache.get("sports")?.value?.events?.length?"loaded-with-markets":"loaded-empty"),
      sportsMarketRows:cache.get("sports")?.value?.events?.length??null,
      routes:["/api/races","/api/sports"]}));
  }
  if(!PROXY_ACCESS_TOKEN){res.writeHead(503);return res.end(JSON.stringify({error:"BETFAIR_FEED_TOKEN is not configured."}));}
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : "";
  if(!accessTokenMatches(bearer)){res.writeHead(401);return res.end(JSON.stringify({error:"Shared adapter token mismatch. Tokens must match exactly, including letter case; whitespace is not removed."}));}
  try{
    if(path==="/api/status"){
      const kind=new URL(req.url,"http://127.0.0.1").searchParams.get("kind");
      if(kind!=="racing"&&kind!=="sports"){res.writeHead(400);return res.end(JSON.stringify({error:"kind must be racing or sports"}));}
      const key=kind==="racing"?"races":"sports",entry=cache.get(key),value=entry?.value;
      const rows=kind==="racing"?(value?.races||[]):(value?.events||[]);
      const priced=kind==="racing"
        ? rows.filter(r=>(r.runners||[]).some(x=>x.exchange?.win?.back||x.exchange?.win?.lay||x.exchange?.place?.back||x.exchange?.place?.lay)).length
        : Number(value?.pricedMarkets)||rows.filter(e=>(e.runners||[]).some(r=>r.back||r.lay)).length;
      const summary=kind==="racing"
        ? {loaded:!!entry,raceCards:rows.length,pricedRaceCards:priced,
            winFavourites:Number(value?.winFavouriteCount)||rows.filter(r=>!!r.exchangeFavourite).length,
            placeFavourites:Number(value?.placeFavouriteCount)||rows.filter(r=>!!r.exchangePlaceFavourite).length,
            quoteCounts:value?.quoteCounts||null,
            capturedAt:value?.capturedAt||value?.scheduleFetchedAt||null,
            cacheAgeSeconds:entry?Math.max(0,Math.round((Date.now()-entry.at)/1000)):null}
        : {loaded:!!entry,marketCount:rows.length,pricedMarkets:priced,
            capturedAt:value?.capturedAt||value?.fetchedAt||null,
            cacheAgeSeconds:entry?Math.max(0,Math.round((Date.now()-entry.at)/1000)):null};
      return res.end(JSON.stringify({ok:true,kind,[kind]:summary}));
    }
    if(path==="/api/races")return res.end(JSON.stringify(await cached("races",loadRaces)));
    if(path==="/api/sports")return res.end(JSON.stringify(await cached("sports",loadSports,SPORTS_CACHE_MS,true)));
    res.writeHead(404);return res.end(JSON.stringify({error:"Not found"}));
  }catch(error){
    const message=String(error?.message||error||"Unknown Betfair adapter error");
    const invalidSession=/INVALID_SESSION_INFORMATION|NO_SESSION|session token rejected/i.test(message);
    const status=invalidSession?401:(/connection failed|timeout|network|fetch failed|HTTP 5\\d\\d/i.test(message)?503:502);
    console.error(invalidSession?"BETFAIR_AU_REAUTH_REQUIRED":"BETFAIR_AU_PROXY_FAILED",path,message);
    res.writeHead(status);
    return res.end(JSON.stringify({
      ok:false,error:message,feedSource:"Betfair AU proxy",
      authentication:invalidSession?"rejected":"not-confirmed",
      reauthenticationRequired:invalidSession,
      retryable:!invalidSession,
      races:[],events:[]
    }));
  }
});
server.listen(PORT,"127.0.0.1",()=>{
  console.info("Betfair AU read-only proxy listening on "+PORT);
  // Populate both feed caches after startup. The health probe alone only
  // authenticates listEventTypes; it does not fetch race or sports markets.
  // Run sequentially to avoid flooding the Australian API connection.
  setTimeout(async()=>{
    try{
      const races=await cached("races",loadRaces);
      console.info("BETFAIR_AU_STARTUP_RACING_CACHE",JSON.stringify({markets:races.races.length,
        upcoming:races.upcomingRaceCount??null,inPlay:races.inPlayRaceCount??null,
        quoteCounts:races.quoteCounts||null,errors:races.feedErrors.length}));
    }catch(error){console.warn("BETFAIR_AU_STARTUP_RACING_CACHE_FAILED",error.message);}
    try{
      const sports=await cached("sports",loadSports);
      console.info("BETFAIR_AU_STARTUP_SPORTS_CACHE",JSON.stringify({markets:sports.events.length,pricedMarkets:sports.pricedMarkets,errors:sports.errors.length}));
    }catch(error){console.warn("BETFAIR_AU_STARTUP_SPORTS_CACHE_FAILED",error.message);}
  },3000);
});
