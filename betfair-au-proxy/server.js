const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8080);
const APP_KEY = process.env.BETFAIR_APP_KEY || "";
const SESSION_TOKEN = process.env.BETFAIR_SESSION_TOKEN || "";
const PROXY_ACCESS_TOKEN = String(process.env.BETFAIR_FEED_TOKEN || "").trim();
function accessTokenMatches(supplied) {
  const candidate = String(supplied || "").trim();
  if (!PROXY_ACCESS_TOKEN || !candidate) return false;
  // Random hexadecimal tokens are compared case-insensitively so PowerShell
  // uppercase/lowercase hex formatting cannot cause a false 401. Other tokens
  // remain case-sensitive. timingSafeEqual avoids a byte-by-byte comparison.
  const expected = /^[a-f0-9]+$/i.test(PROXY_ACCESS_TOKEN) ? PROXY_ACCESS_TOKEN.toLowerCase() : PROXY_ACCESS_TOKEN;
  const actual = /^[a-f0-9]+$/i.test(candidate) ? candidate.toLowerCase() : candidate;
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(actual, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const RPC_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1";
const CACHE_MS = 30000;
let cache = new Map();
let inflight = new Map();

async function rpc(method, params) {
  if (!APP_KEY || !SESSION_TOKEN) throw new Error("Betfair credentials are not configured on this Australian feed service.");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json", "X-Application":APP_KEY, "X-Authentication":SESSION_TOKEN, "Accept":"application/json" },
    body: JSON.stringify([{ jsonrpc:"2.0", method:"SportsAPING/v1.0/"+method, params, id:1 }]),
    signal: AbortSignal.timeout(20000)
  });
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
    throw new Error("Betfair HTTP " + response.status + ": " + detail);
  }
  return item.result;
}
function quote(level) {
  return level && Number(level.price) > 1 ? { price:Number(level.price), size:Number(level.size)||0 } : null;
}
function cached(key, loader) {
  const old=cache.get(key);
  if(old && Date.now()-old.at<CACHE_MS) return Promise.resolve(old.value);
  if(!inflight.has(key)) inflight.set(key, loader().then(value=>{cache.set(key,{at:Date.now(),value});return value;}).finally(()=>inflight.delete(key)));
  return inflight.get(key);
}
function raceCategory(name) {
  const s=String(name).toLowerCase();
  return /greyhound/.test(s)?"greyhound":/harness|trotting|pacing/.test(s)?"harness":"horse";
}
async function loadRaces() {
  const from=new Date(), to=new Date(Date.now()+48*60*60*1000);
  const eventTypes=await rpc("listEventTypes",{filter:{marketCountries:["AU"]}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:String(x.eventType.name||"")}))
    .filter(x=>/horse racing|greyhound racing|harness racing/i.test(x.name));
  const groups=await Promise.all(types.map(async type=>{
    const markets=await rpc("listMarketCatalogue",{filter:{eventTypeIds:[type.id],marketCountries:["AU"],
      marketTypeCodes:["WIN","PLACE"],marketStartTime:{from:from.toISOString(),to:to.toISOString()}},
      marketProjection:["EVENT","MARKET_START_TIME","RUNNER_DESCRIPTION","MARKET_DESCRIPTION"],
      sort:"FIRST_TO_START",maxResults:"1000"});
    return {type,markets:markets||[]};
  }));
  const all=groups.flatMap(g=>g.markets.map(m=>({...m,_type:g.type.name})));
  const books=[];
  for(let i=0;i<all.length;i+=40){
    const result=await rpc("listMarketBook",{marketIds:all.slice(i,i+40).map(m=>m.marketId),
      priceProjection:{priceData:["EX_BEST_OFFERS"],virtualise:true}});
    books.push(...(result||[]));
  }
  const byId=new Map(books.map(b=>[b.marketId,b]));
  const grouped=new Map();
  for(const market of all){
    const book=byId.get(market.marketId);
    if(!book||book.status!=="OPEN")continue;
    const key=market.event?.id+"|"+market.marketStartTime+"|"+market.event?.name;
    if(!grouped.has(key)) grouped.set(key,{race_id:"betfair-au-"+key,id:"betfair-au-"+key,
      category:raceCategory(market._type),code:raceCategory(market._type),venue:market.event?.name||"Unknown track",
      track:market.event?.name||"Unknown track",race_number:null,start_time:market.marketStartTime,
      country:"Australia",status:book.inplay?"in_play":"scheduled",in_play:!!book.inplay,
      closed:false,market_id:market.marketId,market_name:"Betfair Exchange",captured_at:new Date().toISOString(),runners:[]});
    const race=grouped.get(key);
    for(const runner of market.runners||[]){
      let target=race.runners.find(x=>x.selectionId===runner.selectionId);
      if(!target){target={selectionId:runner.selectionId,number:runner.sortPriority||null,name:runner.runnerName,
        exchange:{win:{back:null,lay:null},place:{back:null,lay:null}},bookmakers:[]};race.runners.push(target);}
      const priced=(book.runners||[]).find(x=>x.selectionId===runner.selectionId);
      if(!priced||priced.status==="REMOVED")continue;
      const kind=String(market.description?.marketType||market.marketName||"WIN").toUpperCase().includes("PLACE")?"place":"win";
      target.exchange[kind]={back:quote(priced.ex?.availableToBack?.[0]),lay:quote(priced.ex?.availableToLay?.[0])};
    }
  }
  const races=[...grouped.values()];
  return {races,feedSource:"Betfair Exchange delayed · Australian region",scope:"Australia",
    scheduleFetchedAt:new Date().toISOString(),oddsFetchedAt:new Date().toISOString(),horizonHours:48,
    exchangeOnly:true,marketTypes:["WIN","PLACE"],
    note:"Exchange BACK/LAY prices only. These are not fixed bookmaker prices and must not be included in Sportsbet or Bet365 favourite calculations."};
}
async function loadSports() {
  const from=new Date(),to=new Date(Date.now()+7*24*60*60*1000);
  const eventTypes=await rpc("listEventTypes",{filter:{marketStartTime:{from:from.toISOString(),to:to.toISOString()}}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:String(x.eventType.name||"Sport")}))
    .filter(x=>!/horse racing|greyhound racing|harness racing/i.test(x.name));
  const groups=await Promise.all(types.map(async type=>{
    try{
      const markets=await rpc("listMarketCatalogue",{filter:{eventTypeIds:[type.id],
        marketTypeCodes:["MATCH_ODDS","WINNER","TO_WIN","OUTRIGHT_WINNER"],
        marketStartTime:{from:from.toISOString(),to:to.toISOString()}},
        marketProjection:["EVENT","MARKET_START_TIME","RUNNER_DESCRIPTION","MARKET_DESCRIPTION"],
        sort:"FIRST_TO_START",maxResults:"1000"});
      return {type,markets:markets||[]};
    }catch(error){return {type,markets:[],error:error.message};}
  }));
  const all=groups.flatMap(g=>g.markets.map(m=>({...m,_sport:g.type.name})));
  const books=[];
  for(let i=0;i<all.length;i+=40){
    const result=await rpc("listMarketBook",{marketIds:all.slice(i,i+40).map(m=>m.marketId),
      priceProjection:{priceData:["EX_BEST_OFFERS"],virtualise:true}});
    books.push(...(result||[]));
  }
  const byId=new Map(books.map(b=>[b.marketId,b])),capturedAt=new Date().toISOString();
  const events=all.map(m=>{
    const book=byId.get(m.marketId);if(!book||book.status!=="OPEN")return null;
    const runners=(m.runners||[]).map(r=>{
      const p=(book.runners||[]).find(x=>x.selectionId===r.selectionId);
      if(!p||p.status==="REMOVED")return null;
      return {name:r.runnerName,selectionId:r.selectionId,
        back:quote(p.ex?.availableToBack?.[0]),lay:quote(p.ex?.availableToLay?.[0])};
    }).filter(Boolean);
    const favourite=runners.filter(r=>r.back).sort((a,b)=>a.back.price-b.back.price)[0]||null;
    return {id:"betfair-sport-"+m.marketId,marketId:m.marketId,eventId:m.event?.id||null,
      sport:m._sport,event:m.event?.name||"Event",competition:m.event?.venue||null,
      startTime:m.marketStartTime,marketName:m.marketName||"Match odds",status:book.inplay?"in_play":"upcoming",
      inPlay:!!book.inplay,capturedAt,marketPublishedAt:book.publishTime||null,
      isMarketDataDelayed:!!book.isMarketDataDelayed,source:"Betfair Exchange Delayed API",
      sourceDelayMaxSeconds:180,runners,favourite:favourite?{name:favourite.name,price:favourite.back.price,side:"BACK"}:null};
  }).filter(Boolean).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  return {events,eventTypes:types,capturedAt,from:from.toISOString(),to:to.toISOString(),
    status:events.some(e=>e.runners.some(r=>r.back||r.lay))?"connected-delayed":"configured-no-quotes",
    pricedMarkets:events.filter(e=>e.runners.some(r=>r.back||r.lay)).length,
    backOffers:events.reduce((n,e)=>n+e.runners.filter(r=>r.back).length,0),
    layOffers:events.reduce((n,e)=>n+e.runners.filter(r=>r.lay).length,0),
    errors:groups.filter(g=>g.error).map(g=>({sport:g.type.name,message:g.error})),
    provider:"Betfair Exchange Delayed API",delayMaximumSeconds:180,
    note:"Exchange BACK/LAY prices, not bookmaker fixed odds. Delayed data may be up to 180 seconds old."};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");
  const path=req.url.split("?")[0];
  if(path==="/health")return res.end(JSON.stringify({ok:true,region:"Australia",provider:"Betfair delayed read-only",
    credentialsConfigured:!!(APP_KEY&&SESSION_TOKEN),routes:["/api/races","/api/sports"]}));
  if(!PROXY_ACCESS_TOKEN){res.writeHead(503);return res.end(JSON.stringify({error:"BETFAIR_FEED_TOKEN is not configured."}));}
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if(!accessTokenMatches(bearer)){res.writeHead(401);return res.end(JSON.stringify({error:"Shared adapter token mismatch. Check Railway BETFAIR_FEED_TOKEN against the token entered when this adapter started; whitespace and hex letter case are ignored."}));}
  try{
    if(path==="/api/races")return res.end(JSON.stringify(await cached("races",loadRaces)));
    if(path==="/api/sports")return res.end(JSON.stringify(await cached("sports",loadSports)));
    res.writeHead(404);return res.end(JSON.stringify({error:"Not found"}));
  }catch(error){
    console.error("BETFAIR_AU_PROXY_FAILED",path,error.message);res.writeHead(502);
    return res.end(JSON.stringify({error:error.message,feedSource:"Betfair AU proxy",races:[],events:[]}));
  }
});
server.listen(PORT,"127.0.0.1",()=>console.info("Betfair AU read-only proxy listening on "+PORT));
