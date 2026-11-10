const http = require("node:http");
const APP_KEY = process.env.BETFAIR_APP_KEY || "";
const SESSION = process.env.BETFAIR_SESSION_TOKEN || "";
const PORT = Number(process.env.PORT || 8080);
const RPC = "https://api.betfair.com/exchange/betting/json-rpc/v1";
let cache = { at:0, races:[], error:null };
let pending = null;
async function call(method, params) {
  if (!APP_KEY || !SESSION) throw new Error("Betfair credentials missing");
  const response = await fetch(RPC, {
    method:"POST",
    headers:{"Content-Type":"application/json","X-Application":APP_KEY,"X-Authentication":SESSION,"Accept":"application/json"},
    body:JSON.stringify([{jsonrpc:"2.0",method:"SportsAPING/v1.0/"+method,params,id:1}]),
    signal:AbortSignal.timeout(20000)
  });
  const body=await response.text();
  let data;
  try { data=JSON.parse(body); } catch { throw new Error("Betfair HTTP "+response.status+" (non-JSON response; check regional access and credentials)"); }
  const item=Array.isArray(data)?data[0]:data;
  if(!response.ok || item?.error || item?.result==null) throw new Error("Betfair HTTP "+response.status+": "+(item?.error?.message||"API request failed"));
  return item.result;
}
function category(type,name) {
  const s=(type+" "+name).toLowerCase();
  return /greyhound/.test(s)?"greyhound":/harness|trotting|pacing/.test(s)?"harness":"horse";
}
async function refresh() {
  const eventTypes=await call("listEventTypes",{filter:{marketCountries:["AU"]}});
  const types=(eventTypes||[]).map(x=>({id:String(x.eventType.id),name:x.eventType.name}))
    .filter(x=>/horse racing|greyhound racing|harness racing/i.test(x.name));
  if(!types.length) throw new Error("No Australian racing event types returned");
  const from=new Date(),to=new Date(Date.now()+24*60*60*1000);
  const groups=await Promise.all(types.map(async type=>({type,markets:await call("listMarketCatalogue",{
    filter:{eventTypeIds:[type.id],marketCountries:["AU"],marketTypeCodes:["WIN"],marketStartTime:{from:from.toISOString(),to:to.toISOString()}},
    marketProjection:["EVENT","MARKET_START_TIME","RUNNER_DESCRIPTION"],sort:"FIRST_TO_START",maxResults:"200"
  })})));
  const all=groups.flatMap(g=>(g.markets||[]).map(m=>({...m,eventTypeName:g.type.name})));
  const books=[];
  for(let i=0;i<all.length;i+=35) books.push(...await call("listMarketBook",{
    marketIds:all.slice(i,i+35).map(m=>m.marketId),priceProjection:{priceData:["EX_BEST_OFFERS"],virtualise:true}
  }));
  const map=new Map(books.map(b=>[b.marketId,b]));
  const now=new Date().toISOString();
  const races=all.map(m=>{
    const book=map.get(m.marketId);
    if(!book||book.status!=="OPEN") return null;
    const venue=m.event?.name||"Unknown venue";
    const cat=category(m.eventTypeName,venue);
    const num=(venue+" "+(m.marketName||"")).match(/(?:race|r)\\s*(\\d+)/i);
    return {race_id:"betfair-"+m.marketId,id:"betfair-"+m.marketId,category:cat,code:cat==="horse"?"thoroughbred":cat,
      venue,track:venue,race_number:num?Number(num[1]):null,start_time:m.marketStartTime,country:"Australia",
      status:book.inplay?"in_play":"scheduled",in_play:!!book.inplay,closed:false,market_id:m.marketId,
      market_name:m.marketName||"Win",captured_at:now,runners:(m.runners||[]).map(r=>{
        const b=(book.runners||[]).find(x=>x.selectionId===r.selectionId);
        const p=b?.ex?.availableToBack?.[0]?.price;
        return {number:r.sortPriority||null,name:r.runnerName,bookmakers:p?[
          {bookmaker:"Betfair Exchange (live)",name:"Betfair Exchange (live)",key:"betfair",win_price:Number(p),
            age_seconds:null,last_update:now,source:"Betfair Exchange"}
        ]:[]};
      })};
  }).filter(Boolean);
  cache={at:Date.now(),races,error:null};
  console.info("Betfair AU feed refreshed",JSON.stringify({races:races.length,types:types.map(t=>t.name)}));
}
async function getData() {
  if(!cache.at||Date.now()-cache.at>15000) {
    if(!pending) pending=refresh().catch(e=>{cache.error=e.message;throw e;}).finally(()=>pending=null);
    await pending;
  }
  return {races:cache.races,feedSource:"Betfair Exchange",scope:"Australia",delayed:false,
    scheduleFetchedAt:new Date(cache.at).toISOString(),oddsFetchedAt:new Date(cache.at).toISOString(),
    note:"Betfair Exchange live prices. Display-only; no betting actions are available."};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");
  if(req.url==="/health") {res.writeHead(200);return res.end(JSON.stringify({ok:true,configured:!!(APP_KEY&&SESSION),region:"Australia"}));}
  if(req.url==="/api/races") {
    try {const data=await getData();res.writeHead(200);res.end(JSON.stringify(data));}
    catch(e){console.error("Betfair feed error:",e.message);res.writeHead(502);res.end(JSON.stringify({error:e.message,races:[]}));}
    return;
  }
  res.writeHead(404);res.end(JSON.stringify({error:"Not found"}));
});
server.listen(PORT,"0.0.0.0",()=>console.info("Betfair feed service listening",PORT));
