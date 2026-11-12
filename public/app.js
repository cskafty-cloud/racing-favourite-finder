/* Racing Favourite Finder — free-source dashboard renderer.
   Verified prices and unverified prices are intentionally kept in separate groups. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtTime=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("en-AU",{timeZone:"Australia/Brisbane"}):"Time unavailable";};
const fmtAge=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)))+"s old":"age unknown";
let races=[],filter="all",sort="time",started=false,lastSportsAt=0,betfairSportsEvents=[],lastServerCheckAt=0,healthCheckInFlight=null;
const statusBadge=(status,label)=>status==="verified"?'<span class="price-status verified">VERIFIED</span>':'<span class="price-status unverified">'+esc(label||"UNVERIFIED")+'</span>';
function addStyles(){
 if(document.getElementById("rf-extra-styles"))return;
 const style=document.createElement("style");style.id="rf-extra-styles";style.textContent=`
 .rf-race{border:1px solid var(--line,#293342);background:var(--panel,#151c26);border-radius:15px;padding:16px;margin:12px 0}
 .rf-race-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}
 .rf-race-title{font-size:17px;font-weight:800}.rf-muted{color:var(--muted,#9aa8b9);font-size:12px}
 .rf-fav{margin:12px 0;padding:10px 12px;border-radius:10px;background:rgba(90,140,190,.09);border:1px solid var(--line,#293342)}
 .rf-fav strong{display:block;margin-bottom:3px}.rf-price-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin-top:12px}
 .rf-price-box{border:1px solid var(--line,#293342);border-radius:10px;padding:10px}
 .rf-price-box h4{margin:0 0 8px;font-size:13px}.rf-price-line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid rgba(130,145,165,.16);font-size:12px}
 .price-status{font-size:10px;font-weight:800;letter-spacing:.04em}.verified{color:#42c98a}.unverified{color:#e7ad55}
 .rf-market-section{margin-top:10px}.rf-market-title{font-size:11px;font-weight:800;color:var(--muted,#9aa8b9);text-transform:uppercase;margin:7px 0 3px}
 .rf-b337-crosscheck{margin-top:12px;padding:10px 12px;border:1px dashed var(--line,#536174);border-radius:9px}.rf-b337-crosscheck>b{font-size:11px;letter-spacing:.06em;display:block;margin-bottom:4px}.rf-b337-crosscheck a{display:inline-block;margin-top:6px;font-size:12px;color:var(--accent,#83b7ff);text-decoration:underline;text-underline-offset:2px}
 .rf-book-label{font-size:9px;letter-spacing:.08em;color:var(--muted,#9aa8b9);font-weight:700;margin-left:5px}.rf-source-meta{font-size:11px;color:var(--muted,#9aa8b9);margin:3px 0 8px}.rf-source-meta>span:first-child{font-size:9px;letter-spacing:.08em;font-weight:800;margin-right:5px}.rf-source-link{color:var(--accent,#83b7ff);text-decoration:underline;text-underline-offset:2px}.rf-source-detail{opacity:.8}
  .rf-empty{padding:14px;color:var(--muted,#9aa8b9);border:1px dashed var(--line,#293342);border-radius:10px}
 .rf-sports-row{padding:10px;border-bottom:1px solid var(--line,#293342);font-size:13px}
 .rf-sports-row b{display:block}.rf-sports-quotes{color:var(--muted,#9aa8b9);font-size:12px;margin-top:4px}
 `;document.head.appendChild(style);
}
function auditRows(r){return Array.isArray(r.bookmakerPriceAudit)?r.bookmakerPriceAudit:[];}
function sourceDetails(q){
  const source=String(q.source||"Connected public feed"),lower=source.toLowerCase();
  let url=String(q.source_url||"");
  if(!/^https?:\/\//i.test(url)){
   if(/movi.?odds/.test(lower))url="https://moviodds.com/racing";
   else if(/punters.?edge/.test(lower))url="https://puntersedge.online/";
   else if(/sportsbet/.test(lower))url="https://www.sportsbet.com.au/";
   else if(/bet365/.test(lower))url="https://www.bet365.com.au/";
   else if(/b337/.test(lower))url="https://www.b337.bet/pricing";
    else if(/betfair/.test(lower))url="https://www.betfair.com/exchange/plus/";
  }
  const safeUrl=/^https?:\/\//i.test(url)?url:"";let host=source;
  if(safeUrl){try{host=new URL(safeUrl).hostname.replace(/^www\./,"")}catch{}}
  return {source,host,url:safeUrl};
 }
 function exchangeEstimate(rows,market){
 const qs=rows.filter(q=>q.exchange===true&&q.market===market&&Number(q.price)>1);
 const back=qs.find(q=>String(q.price_side||'').toUpperCase()==='BACK');
 const lay=qs.find(q=>String(q.price_side||'').toUpperCase()==='LAY');
 const b=Number(back?.price),l=Number(lay?.price),reference=b>1&&l>1?(b+l)/2:b>1?b:null;
 if(!(reference>1))return null;
 const stamp=back?.captured_at||lay?.captured_at||back?.observed_at||lay?.observed_at||null;
 const age=stamp?Math.max(0,(Date.now()-Date.parse(stamp))/1000):null;
 if(age!=null&&(!Number.isFinite(age)||age>180))return null;
 return {price:reference/1.05,low:reference/1.08,high:reference/1.03,stamp,age};
}
function renderRunnerMarkets(r){
  const rows=auditRows(r);if(!rows.length)return "";
  // Same bookmaker from different providers remains a separate, attributable quote group.
  const groups=new Map();
  for(const row of rows){
   const book=row.bookmaker_key||row.bookmaker||"unknown",src=sourceDetails(row),key=[book,src.source,src.url].join("|");
   if(!groups.has(key))groups.set(key,{name:row.bookmaker||book,source:src.source,host:src.host,url:src.url,rows:[]});
   groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group=>{
   const selected=group.rows,isExchange=selected.some(x=>x.exchange||x.bookmaker_key==="betfair");
   const line=(market,status)=>selected.filter(x=>x.market===market&&x.status===status).map(x=>{
    const observed=x.observed_at?"Feed observed "+fmtTime(x.observed_at)+" · "+fmtAge(x.observed_age_seconds):"Feed observation time unavailable";
    const exchangeDetail=isExchange?(x.price_side||"EXCHANGE SIDE")+" · available size "+(x.available_size==null?"not supplied":Number(x.available_size).toFixed(2))+" · delayed feed (up to "+(x.source_delay_max_seconds||180)+"s)":"";
    const explanation=isExchange?exchangeDetail+" · "+observed:(status==="verified"?"Source quote captured "+fmtTime(x.captured_at)+" · "+fmtAge(x.age_seconds):(x.public_demo?"PUBLIC REFERENCE ONLY · ":"")+(x.reasons||["Not verified"]).join(", ")+(x.public_demo?" · "+observed:""));
    return '<div class="rf-price-line"><span>'+(isExchange?(x.price_side||"EXCHANGE"):"")+' '+market+' · $'+Number(x.price).toFixed(2)+' '+statusBadge(status,x.verification_label)+'<div class="rf-muted">'+esc(explanation)+'</div></span><span class="rf-muted">'+esc(group.host)+'</span></div>';
   }).join("");
   const sourceLink=group.url?'<a class="rf-source-link" href="'+esc(group.url)+'" target="_blank" rel="noopener noreferrer">'+esc(group.host)+' ↗</a>':esc(group.host);
   return '<div class="rf-price-box"><h4>'+esc(group.name)+' <span class="rf-book-label">'+(isExchange?"EXCHANGE":"BOOKMAKER")+'</span></h4>'+
    '<div class="rf-source-meta"><span>DATA SOURCE</span> '+sourceLink+' <span class="rf-source-detail">('+esc(group.source)+')</span></div>'+
    '<div class="rf-market-section"><div class="rf-market-title">'+(isExchange?"Exchange WIN · BACK / LAY":"Fixed WIN")+'</div>'+(line("WIN","verified")||'<div class="rf-muted">No verified WIN quote from this source</div>')+line("WIN","unverified")+'</div>'+
    '<div class="rf-market-section"><div class="rf-market-title">'+(isExchange?"Exchange PLACE · BACK / LAY":"Fixed PLACE")+'</div>'+(line("PLACE","verified")||'<div class="rf-muted">No verified PLACE quote from this source</div>')+line("PLACE","unverified")+'</div></div>';
  }).join("")+
  ["WIN","PLACE"].map(m=>{
   const q=exchangeEstimate(rows,m);if(!q)return "";
   return '<div class="rf-price-box"><h4>'+m+' estimated bookmaker-equivalent · $' +q.price.toFixed(2)+' <b>ESTIMATE</b></h4><div class="rf-muted">Range $' +q.low.toFixed(2)+'–$' +q.high.toFixed(2)+' · assumed 5% margin · Betfair Exchange delayed source · '+esc(fmtTime(q.stamp))+' · '+esc(fmtAge(q.age))+' · NOT Sportsbet/Bet365 odds</div></div>';
  }).join("");
 }
function renderRace(r){
 const originalFav=r.favourite||{status:"unpriced",label:"FAVOURITE NOT IDENTIFIED · UNPRICED"};
 const runners=(r.runners||[]).filter(x=>!x.scratched&&!x.suspended&&!/scratched|removed|suspended/i.test(String(x.status||"")));
 const estimatedFav=runners.map(runner=>({runner,q:exchangeEstimate(auditRows(runner),"WIN")})).filter(x=>x.q).sort((a,b)=>a.q.price-b.q.price)[0]||null;
 const fav=originalFav.status==="unpriced"&&estimatedFav?{status:"unverified",label:"ESTIMATED EXCHANGE FAVOURITE",name:estimatedFav.runner.name||"Runner",number:estimatedFav.runner.number??null,price:estimatedFav.q.price,priceSource:"Betfair Exchange-derived estimate",estimateRange:[estimatedFav.q.low,estimatedFav.q.high],estimateCapturedAt:estimatedFav.q.stamp}:originalFav;
 const marketHtml=runners.map(x=>renderRunnerMarkets(x)).filter(Boolean).join("");
 const favPrice=fav.price!=null?" · $"+Number(fav.price).toFixed(2):"";
 const favSource=fav.priceSource?" · "+esc(fav.priceSource):"";
 const favName=fav.name?esc(fav.name)+(fav.number!=null?" (#"+esc(fav.number)+")":""):"No named favourite supplied by feed";
 const favClass=fav.status==="verified"?"verified":fav.status==="unverified"?"unverified":"";
 return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(r.venue||r.track||"Race meeting")+' · R'+esc(r.race_number??"?")+'</div><div class="rf-muted">'+esc(String(r.category||r.code||"Racing").toUpperCase())+' · '+esc(fmtTime(r.start_time||r.commence_time))+' · '+esc(r.status||"Scheduled")+'</div></div><span class="rf-muted">'+runners.length+' active runners</span></div>'+
  '<div class="rf-fav"><strong class="'+favClass+'">'+esc(fav.label||"FAVOURITE")+'</strong>'+favName+favPrice+favSource+
  (fav.status==="unverified"?(fav.estimateRange?'<div class="rf-muted">Estimated from Betfair Exchange · range $'+fav.estimateRange[0].toFixed(2)+'–$'+fav.estimateRange[1].toFixed(2)+' · '+esc(fmtTime(fav.estimateCapturedAt))+' · NOT Sportsbet/Bet365 odds.</div>':'<div class="rf-muted">Candidate only — excluded from verified bookmaker rankings.</div>'):fav.status==="unpriced"?'<div class="rf-muted">No verified fixed WIN quote is available for this favourite.</div>':'<div class="rf-muted">Selected from fresh fixed WIN quotes only.</div>')+'</div>'+
  (marketHtml?'<div class="rf-price-groups">'+marketHtml+'</div>':'<div class="rf-empty">No fixed WIN or PLACE prices returned for active runners. The race remains listed as unpriced.</div>')+
  '<div class="rf-b337-crosscheck"><b>B337 · FREE PUBLIC REFERENCE</b><div class="rf-muted">Use B337 as a separate reference for publicly accessible racing information. Compare Sportsbet and TAB prices manually where B337 displays them. B337 prices are imported only if an authorised machine-readable public source becomes available. No login bypass or protected-data scraping is used.</div><a href="https://www.b337.bet/pricing" target="_blank" rel="noopener noreferrer">Open B337 free account / pricing information ↗</a></div>'+
  '</article>';
}
function setHeaderConnection(state){
 const label=$("feedStatus"),dot=document.querySelector(".top-right .live-dot");
 if(label)label.textContent=state;
 const connected=String(state).startsWith("CONNECTED");
 const limited=/LIMITED|PARTIAL|CHECKING|DELAYED|LOADING/i.test(String(state));
 if(dot)dot.className="live-dot "+(connected?(limited?"checking":"connected"):state==="CHECKING"?"checking":"offline");
}
function updateBrisbaneClock(){
 const clock=$("clock");
 if(clock)clock.textContent=new Date().toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false});
}
function renderRaces(data){
 races=data.races||[];
 const errors=[...(data.feedHealth?.errors||[]),...(data.feedErrors||[])].map(x=>typeof x==="string"?x:x?.message||JSON.stringify(x));
 // Keep website/API connectivity separate from provider coverage. The dashboard
 // may be online while some upstream feeds are unavailable or quota-limited.
 const limited=errors.length>0||data.coverageState==="limited";
 // Connection status is driven only by a successful, timestamped server health response.
 const active=races.filter(r=>!r.abandoned&&!/abandon|cancel/i.test(String(r.status||"")));
 let shown=active.filter(r=>filter==="all"||String(r.category||r.code||"").toLowerCase().includes(filter));
 shown.sort((a,b)=>{
  if(sort==="odds"){const ap=a.favourite?.status==="verified"?Number(a.favourite.price):Infinity;const bp=b.favourite?.status==="verified"?Number(b.favourite.price):Infinity;return ap-bp||new Date(a.start_time||a.commence_time||0)-new Date(b.start_time||b.commence_time||0);}
  return new Date(a.start_time||a.commence_time||0)-new Date(b.start_time||b.commence_time||0);
 });
 if($("raceList"))$("raceList").innerHTML=shown.length?shown.map(renderRace).join(""):'<div class="rf-empty">No race cards returned by the current free feeds. Check again later; no sample prices are displayed.</div>';
 const count=id=>{if($(id))$(id).textContent=String(active.filter(r=>String(r.category||r.code||"").toLowerCase().includes(id==="horseCount"?"horse":id==="dogCount"?"greyhound":"harness")).length);};
 if($("raceCount"))$("raceCount").textContent=String(active.length);
 count("horseCount");count("dogCount");count("harnessCount");
 if($("updatedAt"))$("updatedAt").textContent=fmtTime(data.fetchedAt);
 if($("feedFreshness"))$("feedFreshness").textContent=(data.note||"Race and quote availability depends on free provider coverage.")+" Dashboard polls every 2 minutes; actual quote freshness depends on each provider's timestamp and free-feed limits. Combined-feed totals count returned/deduplicated cards only; they do not guarantee that every Australian meeting is included."+(limited?" Some upstream sources are unavailable or quota-limited; connected fallback feeds continue to supply the cards shown.":"")+(data.quotaRecheckAt?" Free quota recheck scheduled: "+fmtTime(data.quotaRecheckAt):"");
 if($("dashboardFeedStatuses")){
  const audits=active.flatMap(r=>(r.runners||[]).flatMap(x=>x.bookmakerPriceAudit||[]));
  const count=(book,market,status)=>audits.filter(q=>q.bookmaker_key===book&&q.market===market&&(!status||q.status===status)).length;
  const sbWin=count("sportsbet","WIN","verified"),sbPlace=count("sportsbet","PLACE","verified");
  const sbPreviewWin=count("sportsbet","WIN","unverified"),sbPreviewPlace=count("sportsbet","PLACE","unverified");
  const sbStale=Number(data.sportsbetStalePreviewQuotes||0);
  const b365Win=count("bet365","WIN","verified"),b365Place=count("bet365","PLACE","verified");
   const exchangeWin=count("betfair","WIN"),exchangePlace=count("betfair","PLACE");
   const betfairState=String(data.betfairStatus||"unknown");
   const betfairLabel=betfairState==="connected-delayed"?"CONNECTED · DELAYED":betfairState==="configured-no-quotes"?"CONFIGURED · NO QUOTES":betfairState==="configured-but-unavailable"?"CONFIGURED · UNAVAILABLE":betfairState==="credentials-missing"?"CREDENTIALS MISSING":"CHECKING";
  const warningText=errors.length?errors.slice(0,3).join(" · "):"No upstream provider warnings reported.";
  $("dashboardFeedStatuses").innerHTML=
   '<div class="feed-status-item"><span class="feed-dot connected"></span><span><b>DASHBOARD CONNECTION · CONNECTED</b><small>/api/races responded successfully · '+active.length+' race cards loaded</small></span></div>'+
   '<div class="feed-status-item"><span class="feed-dot '+(errors.length?"checking":"connected")+'"></span><span><b>UPSTREAM FEED COVERAGE · '+(errors.length?"LIMITED · FALLBACK FEEDS ACTIVE":"HEALTHY")+'</b><small>'+esc(data.feedSource||"Public feeds")+' · '+(errors.length?esc(warningText):"No reported feed errors")+'</small></span></div>'+
   '<div class="feed-status-item"><span class="feed-dot '+(sbWin||sbPlace?"connected":"checking")+'"></span><span><b>SPORTSBET FIXED WIN / PLACE</b><small>Verified WIN '+sbWin+' · verified PLACE '+sbPlace+' · public preview WIN '+sbPreviewWin+' (unverified) · public preview PLACE '+sbPreviewPlace+' (unverified) · stale preview rows '+sbStale+'. Timestamp-missing or stale Sportsbet-attributed quotes stay visible as reference only; they are never treated as live prices.</small></span></div>'+
   '<div class="feed-status-item"><span class="feed-dot '+(b365Win||b365Place?"connected":"checking")+'"></span><span><b>BET365 FIXED WIN / PLACE</b><small>Verified WIN '+b365Win+' · verified PLACE '+b365Place+'</small></span></div>'+
    '<div class="feed-status-item"><span class="feed-dot '+(betfairState==="connected-delayed"?"connected":"checking")+'"></span><span><b>BETFAIR EXCHANGE · '+betfairLabel+'</b><small>Exchange WIN quotes '+exchangeWin+' · exchange PLACE quotes '+exchangePlace+'. BACK and LAY are shown separately with available size. Delayed exchange prices are never counted as Sportsbet, Bet365 or TAB fixed odds. '+(betfairState==="credentials-missing"?"Add a valid Betfair app key and session token in Railway to enable this feed.":"")+'</small></span></div>'+
   '<div class="feed-status-item"><span class="feed-dot checking"></span><span><b>B337 PUBLIC REFERENCE · MANUAL COMPARISON</b><small><a href="https://www.b337.bet/pricing" target="_blank" rel="noopener noreferrer">B337 free account</a> may show limited live Sportsbet and TAB racing information with price history. It remains a separate reference: no B337 prices are imported or counted as verified quotes. Automatic import is allowed only from an authorised public machine-readable source.</small></span></div>';
 }
 window.dispatchEvent(new CustomEvent("racing-data-updated",{detail:data}));
 renderBestTips(active);
}
function renderBestTips(list){
 // Ranked shortlist of fresh, verified fixed-WIN bookmaker favourites.
 // Single-bookmaker picks are visible but explicitly marked as limited confirmation.
 const ranked=list.map(r=>({race:r,fav:r.favourite}))
  .filter(x=>x.fav?.status==="verified"&&!x.fav.previewOnly&&Number(x.fav.signalScore||0)>=28)
  .sort((a,b)=>(b.fav.signalScore||0)-(a.fav.signalScore||0)||Number(a.fav.price)-Number(b.fav.price)).slice(0,10);
 const raceHtml=ranked.map((x,i)=>'<div class="rf-sports-row"><b>#'+(i+1)+' · '+esc(x.race.venue||"Race")+' R'+esc(x.race.race_number??"?")+' · '+esc(x.fav.name)+'</b><span>

async function checkDashboardConnection(){
 if(healthCheckInFlight)return healthCheckInFlight;
 healthCheckInFlight=(async()=>{
  try{
   const response=await fetch("/api/health",{cache:"no-store",headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw new Error("Health check HTTP "+response.status);
   const health=await response.json();
   const serverMs=Date.parse(health?.serverTime||"");
   const ageMs=Date.now()-serverMs;
   if(health?.ok!==true||!Number.isFinite(serverMs)||ageMs < -60000||ageMs>120000)
    throw new Error("Server did not return a recent, timestamped health response");
   lastServerCheckAt=Date.now();
   const serverClock=new Date(serverMs).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false});
   setHeaderConnection("CONNECTED · SERVER "+serverClock);
   if($("feedStatus"))$("feedStatus").title="Server health confirmed at "+new Date(serverMs).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"})+" · uptime "+Number(health.uptimeSeconds||0)+" seconds";
   return true;
  }catch(error){
   if(!lastServerCheckAt)setHeaderConnection("OFFLINE · SERVER NOT REACHABLE");
   else if(Date.now()-lastServerCheckAt>75000)setHeaderConnection("CONNECTION STALE");
   return false;
  }finally{healthCheckInFlight=null;}
 })();
 return healthCheckInFlight;
}
async function loadRaces(){
 // The health heartbeat is independent of the slower upstream race-feed request.
 void checkDashboardConnection();
 try{
  const response=await fetch("/api/races",{cache:"no-store",signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error("Race feed HTTP "+response.status);
  const data=await response.json();renderRaces(data);
 }catch(error){
  if($("raceList"))$("raceList").innerHTML='<div class="rf-empty">The server connection is monitored separately. Racing feed response delayed or unavailable: '+esc(error.message)+'</div>';
 }
}
async function loadLucasFox(){
 try{
  const response=await fetch("/api/lucasfox/sports",{cache:"no-store",signal:AbortSignal.timeout(18000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"LucasFox unavailable");
  const events=data.events||[],quotes=events.flatMap(e=>(e.bookmakers||[]).flatMap(b=>(b.markets||[]).flatMap(m=>(m.outcomes||[]).map(o=>({e,b,m,o})))));
  const fresh=quotes.filter(x=>Number(x.o.age_seconds)<900);
  if($("lucasFoxSportsState"))$("lucasFoxSportsState").textContent=quotes.length?"SPORTSBET QUOTES FOUND":"NO QUOTES RETURNED";
  if($("lucasFoxSportsStats"))$("lucasFoxSportsStats").innerHTML=[[events.length,"Sports fixtures"],[quotes.length,"Sportsbet quotes"],[fresh.length,"Fresh under 15m"],[data.dailyLimit||100,"Free requests/day"]].map(x=>'<div class="stat"><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join("");
  if($("lucasFoxSportsMarkets"))$("lucasFoxSportsMarkets").innerHTML=quotes.length?quotes.slice(0,60).map(x=>'<div class="rf-sports-row"><b>'+esc(x.e.home_team)+' v '+esc(x.e.away_team)+' · '+esc(x.m.name||x.m.key)+'</b>'+esc(x.o.name)+' · $'+Number(x.o.price).toFixed(2)+' · '+(Number(x.o.age_seconds)<900?'FRESH':'STALE / NOT RANKED')+'<div class="rf-muted">Sportsbet · captured '+esc(fmtTime(x.o.captured_at||x.o.last_update))+' · '+esc(fmtAge(x.o.age_seconds))+'</div></div>').join(""):'<div class="rf-empty">No current LucasFox Sportsbet sports quotes were returned. Racing WIN/PLACE is not covered by this feed.</div>';
  if($("lucasFoxSportsDetail"))$("lucasFoxSportsDetail").textContent=data.note||"LucasFox sports markets only; not horse-racing odds.";
 }catch(error){
  if($("lucasFoxSportsState"))$("lucasFoxSportsState").textContent="FEED UNAVAILABLE";
  if($("lucasFoxSportsMarkets"))$("lucasFoxSportsMarkets").innerHTML='<div class="rf-empty">'+esc(error.message)+' · LucasFox is sports-only.</div>';
 }
}
async function loadBetfairSports(){
 const state=$("betfairSportsNotice"),list=$("betfairSportsEvents");
 try{
  if(state)state.textContent="Refreshing authorised Betfair delayed Exchange markets…";
  const response=await fetch("/api/betfair/sports",{cache:"no-store",signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Betfair sports feed HTTP "+response.status);
  betfairSportsEvents=Array.isArray(data.events)?data.events:[];
  const events=betfairSportsEvents,live=events.filter(e=>e.inPlay),priced=events.filter(e=>(e.runners||[]).some(r=>r.back||r.lay));
  const soccerMarketCount=Number(data.soccerMarketCount??events.filter(e=>/soccer|football/i.test(String(e.sport||e.sport_name||""))&&(e.marketId||e.market_id||e.marketName||e.market_name||Array.isArray(e.runners))).length);
  const soccerPricedMarkets=Number(data.soccerPricedMarkets??events.filter(e=>/soccer|football/i.test(String(e.sport||e.sport_name||""))&&(e.runners||[]).some(r=>r.back||r.lay)).length);
  if($("betfairSportsStats"))$("betfairSportsStats").innerHTML=[[events.length,"Exchange markets"],[new Set(events.map(e=>e.sport||e.sport_name).filter(Boolean)).size,"Sports"],[live.length,"In-play"],[priced.length,"Priced markets"],[soccerMarketCount,"Soccer markets"],[soccerPricedMarkets,"Priced soccer"]].map(x=>'<div class="stat"><b>'+esc(x[0])+'</b><span>'+esc(x[1])+'</span></div>').join("");
  const status=String(data.status||"unknown");
  if(state)state.textContent=(status==="connected-delayed"?"CONNECTED · DELAYED EXCHANGE":status==="configured-no-quotes"?"CONNECTED · NO CURRENT MARKETS":status.toUpperCase().replaceAll("-"," "))+ " · SOCCER "+soccerMarketCount+" MARKETS / "+soccerPricedMarkets+" PRICED"+(data.error?" · "+data.error:"");
  if(list)list.innerHTML=events.length?events.slice(0,120).map(e=>{
   const runners=(e.runners||[]).filter(r=>r.back||r.lay),favourite=e.favourite;
   const runnerRows=runners.map(r=>{
    const back=r.back?"$"+Number(r.back.price).toFixed(2)+" · size "+(r.back.availableSize==null?"—":Number(r.back.availableSize).toFixed(2)):"—";
    const lay=r.lay?"$"+Number(r.lay.price).toFixed(2)+" · size "+(r.lay.availableSize==null?"—":Number(r.lay.availableSize).toFixed(2)):"—";
    const b=Number(r.back?.price),l=Number(r.lay?.price),ref=b>1?(l>1?(b+l)/2:b):null;
    const est=ref&&Number.isFinite(ref)?' · EST. $' +(ref/1.05).toFixed(2)+' (range $' +(ref/1.08).toFixed(2)+'–$' +(ref/1.03).toFixed(2)+')':"";
    return '<div class="rf-price-line"><span>'+esc(r.name)+(favourite&&favourite.name===r.name?" · MARKET FAVOURITE":"")+'</span><span>BACK '+back+' &nbsp; LAY '+lay+est+'</span></div>';
   }).join("");
   const favHtml=favourite?'<div class="rf-fav"><strong>EXCHANGE MARKET FAVOURITE · BACK</strong>'+esc(favourite.name)+' · $'+Number(favourite.price).toFixed(2)+'<div class="rf-muted">Lowest available BACK price in this market; not a prediction or guaranteed winner.</div></div>':'<div class="rf-muted">No available BACK offer; no favourite calculated.</div>';
   const pricesHtml=runnerRows?'<div class="rf-market-section">'+runnerRows+'</div>':'<div class="rf-empty">No available BACK/LAY offers returned for this market.</div>';
   return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(e.event||"Sports event")+' · '+esc(e.sport||"Sport")+'</div><div class="rf-muted">'+esc(e.competition||"")+' · '+esc(e.marketName||"Market")+' · '+esc(fmtTime(e.startTime))+' · '+(e.inPlay?"IN-PLAY":"UPCOMING")+'</div></div><span class="rf-muted">Betfair Exchange</span></div>'+favHtml+pricesHtml+'<div class="rf-muted">Betfair Exchange · delayed up to '+esc(data.delayMaximumSeconds||180)+'s · observed '+esc(fmtTime(e.marketPublishedAt||e.capturedAt||data.fetchedAt))+' · source '+esc(e.source||data.provider||"Betfair Exchange")+'</div></article>';
  }).join(""):'<div class="rf-empty">No upcoming or in-play sports markets returned by the authorised Betfair delayed feed. No odds are estimated.</div>';
  if($("betfairSportsDetail"))$("betfairSportsDetail").textContent=(data.note||"Delayed Betfair Exchange data.")+" Last API refresh: "+fmtTime(data.fetchedAt)+". "+(data.errors||[]).map(x=>x.sport+": "+x.message).join(" · ");
  renderBestTips(races.filter(r=>!r.abandoned));
 }catch(error){
  betfairSportsEvents=[];
  if(state)state.textContent="FEED UNAVAILABLE · "+error.message;
  if(list)list.innerHTML='<div class="rf-empty">'+esc(error.message)+' · No Betfair sports prices are being estimated.</div>';
  if($("betfairSportsDetail"))$("betfairSportsDetail").textContent=error.message+" The application will not show estimated prices or label unavailable data as connected.";
 }
}
function sportQuoteAge(quote,book) {
  const direct=quote?.age_seconds??quote?.freshness_seconds??book?.age_seconds;
  const directAge=direct!=null&&Number.isFinite(Number(direct))?Math.max(0,Number(direct)):null;
  const stamp=quote?.last_update||quote?.updated_at||quote?.timestamp||book?.last_update||book?.updated_at||null;
  const numeric=Number(stamp);
  const ms=stamp==null?NaN:(Number.isFinite(numeric)&&numeric>1000000000?(numeric>1000000000000?numeric:numeric*1000):Date.parse(stamp));
  const stampedAge=Number.isFinite(ms)?Math.max(0,(Date.now()-ms)/1000):null;
  if(directAge!=null&&stampedAge!=null)return Math.max(directAge,stampedAge);
  return directAge??stampedAge;
}
function renderSportsBookmaker(event,book) {
  const bookmaker=String(book.name||book.title||book.key||"Bookmaker");
  const markets=(book.markets||[]).filter(m=>(m.outcomes||[]).some(o=>Number(o.price)>1));
  if(!markets.length)return "";
  const main=markets.find(m=>["h2h","head_to_head","moneyline","match_winner","winner"].includes(String(m.key||m.name||"").toLowerCase().replace(/[\s-]+/g,"_")))||markets[0];
  const outcomes=(main.outcomes||[]).filter(o=>Number(o.price)>1&&!o.suspended&&!o.removed);
  // Only call a sports selection the current favourite when its source quote
  // has a known age under 180 seconds. Unknown/stale prices remain visible,
  // but cannot win the live-favourite label.
  const freshOutcomes=outcomes.filter(o=>{
    const age=sportQuoteAge(o,book);
    return age!=null&&age>=0&&age<180&&o.stale!==true&&book.stale!==true;
  });
  const favourite=[...freshOutcomes].sort((a,b)=>Number(a.price)-Number(b.price))[0]||null;
  const age=favourite?sportQuoteAge(favourite,book):null;
  const freshness=age==null?"QUOTE AGE UNKNOWN · NOT VERIFIED":age<180?"SOURCE QUOTE "+Math.round(age)+"s OLD":"STALE SOURCE QUOTE · "+Math.round(age)+"s";
  const lines=markets.map(m=>{
    const rows=(m.outcomes||[]).filter(o=>Number(o.price)>1&&!o.suspended&&!o.removed);
    if(!rows.length)return "";
    return '<div class="rf-market-title">'+esc(m.name||m.key||"Market")+'</div>'+rows.map(o=>{
      const a=sportQuoteAge(o,book);
      return '<div class="rf-price-line"><span>'+esc(o.name||o.label||"Selection")+(favourite&&m===main&&o===favourite?' · FAVOURITE':'')+'</span><b>$'+Number(o.price).toFixed(2)+'</b><span class="rf-muted">'+(a==null?'AGE UNKNOWN':Math.round(a)+'s old')+'</span></div>';
    }).join("");
  }).join("");
  const source=String(book.source||book.provider||event._provider||"Source not supplied");
  const sourceUrl=String(book.source_url||book.url||"");
  const link=/^https?:\/\//i.test(sourceUrl)?'<a class="rf-source-link" href="'+esc(sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(new URL(sourceUrl).hostname.replace(/^www\./,""))+' ↗</a>':"";
  return '<div class="rf-price-box"><h4>'+esc(bookmaker)+' <span class="rf-book-label">BOOKMAKER QUOTE</span></h4>'+
    '<div class="rf-source-meta">DATA SOURCE · '+esc(source)+' '+link+'</div>'+
    (favourite?'<div class="rf-fav"><strong>'+esc(bookmaker)+' MARKET FAVOURITE</strong>'+esc(favourite.name)+' · $'+Number(favourite.price).toFixed(2)+'<div class="rf-muted">'+esc(freshness)+' · shortest price in '+esc(main.name||main.key||"market")+'</div></div>':'')+lines+'</div>';
}
async function loadSportsFixtures(){
 if(Date.now()-lastSportsAt<10*60*1000)return;
 lastSportsAt=Date.now();
 try{
  const res=await fetch("/api/sports",{cache:"no-store"});
  if(!res.ok)throw new Error("Sports catalogue HTTP "+res.status);
  const data=await res.json(),allSports=data.sports||[];
  const results=[];
  // Fetch every catalogue sport in small batches to avoid a burst of provider requests.
  for(let i=0;i<allSports.length;i+=4){
   const batch=allSports.slice(i,i+4);
   const settled=await Promise.all(batch.map(async sport=>{
    try{
     const response=await fetch("/api/public-sports/"+encodeURIComponent(sport.key),{cache:"no-store"});
     if(!response.ok)return {sport,data:null,error:"HTTP "+response.status};
     return {sport,data:await response.json(),error:null};
    }catch(error){return {sport,data:null,error:error.message};}
   }));
   results.push(...settled);
  }
  const byEvent=new Map();
  for(const result of results)for(const event of (result.data?.events||result.data?.rows||[])){
   const key=[String(event.home_team||event.home||"").toLowerCase().replace(/[^a-z0-9]/g,""),
     String(event.away_team||event.away||"").toLowerCase().replace(/[^a-z0-9]/g,""),
     String(event.commence_time||event.start_time||"").slice(0,10)].join("|");
   if(!byEvent.has(key))byEvent.set(key,{...event,_sportTitle:result.sport.title,_provider:result.data.provider||"Public sports source"});
   else{
    const old=byEvent.get(key);
    old.bookmakers=[...(old.bookmakers||[]),...(event.bookmakers||[])];
   }
  }
  const events=[...byEvent.values()].sort((a,b)=>Number(!!b.in_play)-Number(!!a.in_play)||
    Date.parse(a.commence_time||a.start_time||0)-Date.parse(b.commence_time||b.start_time||0));
  const pricedEvents=events.filter(e=>(e.bookmakers||[]).some(b=>(b.markets||[]).some(m=>(m.outcomes||[]).some(o=>Number(o.price)>1))));
  const quoteCount=events.reduce((n,e)=>n+(e.bookmakers||[]).reduce((m,b)=>m+(b.markets||[]).reduce((k,market)=>k+(market.outcomes||[]).filter(o=>Number(o.price)>1).length,0),0),0);
  const eventHtml=events.map(e=>{
   const books=(e.bookmakers||[]).map(b=>renderSportsBookmaker(e,b)).filter(Boolean).join("");
   return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(e.home_team||e.home||e.event||"Fixture")+' v '+esc(e.away_team||e.away||"")+'</div><div class="rf-muted">'+esc(e._sportTitle||e.sport_name||e.sport||"Sport")+' · '+esc(e.league||e.competition||"")+' · '+esc(fmtTime(e.commence_time||e.start_time))+' · '+(e.in_play===true?"IN-PLAY":"UPCOMING")+'</div></div></div>'+
    (books?'<div class="rf-price-groups">'+books+'</div>':'<div class="rf-empty">Fixture returned; no bookmaker prices supplied by the connected public feeds.</div>')+'</article>';
  }).join("");
  const sportRows=allSports.map(s=>{
   const count=events.filter(e=>String(e._sportTitle||e.sport_name||"")===String(s.title)).length;
   return count?'<div class="rf-muted">'+esc(s.title)+' · '+count+' fixture(s)</div>':'<div class="rf-muted">'+esc(s.title)+' · no fixture returned by available feeds</div>';
  }).join("");
  if($("sportsNotice"))$("sportsNotice").textContent=events.length?
   events.length+" fixtures across "+allSports.length+" catalogue sports · "+pricedEvents.length+" priced fixtures · "+quoteCount+" source quotes · only provider-supplied prices shown.":
   "No fixtures returned by the available public feeds across "+allSports.length+" catalogue sports. Sports are still listed below.";
  if($("sportsCatalogue"))$("sportsCatalogue").innerHTML=(eventHtml||'<div class="rf-empty">No upcoming or in-play fixtures returned by available sources.</div>')+
   '<div class="rf-price-box"><h4>SPORTS COVERAGE · ALL CATALOGUE SPORTS</h4>'+sportRows+'</div>';
 }catch(error){
  if($("sportsNotice"))$("sportsNotice").textContent="Public sports fixtures unavailable: "+error.message;
  if($("sportsCatalogue"))$("sportsCatalogue").innerHTML='<div class="rf-empty">'+esc(error.message)+'</div>';
 }
}

function start(){
 if(started)return;started=true;addStyles();
 setHeaderConnection("CHECKING · VERIFYING SERVER");
 void checkDashboardConnection();
 setInterval(checkDashboardConnection,30000);
 setInterval(()=>{if(lastServerCheckAt&&Date.now()-lastServerCheckAt>75000)setHeaderConnection("CONNECTION STALE");},10000);
 loadRaces();loadLucasFox();loadSportsFixtures();
 setInterval(loadRaces,2*60*1000);setInterval(loadLucasFox,15*60*1000);setInterval(loadSportsFixtures,10*60*1000);loadBetfairSports();setInterval(loadBetfairSports,60*1000);
}
window.startFullDashboardFeeds=start;
document.addEventListener("DOMContentLoaded",()=>{
 addStyles();
 updateBrisbaneClock();setInterval(updateBrisbaneClock,1000);
 const enter=$("enterWebsiteBtn");
 if(enter){enter.addEventListener("click",()=>start(),{once:true});}
 const refresh=$("refreshBtn");if(refresh)refresh.addEventListener("click",()=>loadRaces());
 const refreshBetfairSports=$("refreshBetfairSportsBtn");if(refreshBetfairSports)refreshBetfairSports.addEventListener("click",()=>loadBetfairSports());
 const loadAllSportsButton=$("loadAllSportsBtn");if(loadAllSportsButton)loadAllSportsButton.addEventListener("click",()=>{lastSportsAt=0;loadSportsFixtures();});
 const refreshLiveSportsButton=$("refreshLiveSportsBtn");if(refreshLiveSportsButton)refreshLiveSportsButton.addEventListener("click",()=>{loadLucasFox();loadBetfairSports();lastSportsAt=0;loadSportsFixtures();});
 document.querySelectorAll(".tab[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;document.querySelectorAll(".tab[data-filter]").forEach(b=>b.classList.toggle("active",b===button));renderRaces({races,fetchedAt:new Date().toISOString()});
 }));
 if($("sort"))$("sort").addEventListener("change",event=>{sort=event.target.value;renderRaces({races,fetchedAt:new Date().toISOString()});});
 if($("search"))$("search").addEventListener("input",event=>{
  const q=event.target.value.toLowerCase();document.querySelectorAll(".rf-race").forEach(card=>card.style.display=card.textContent.toLowerCase().includes(q)?"":"none");
 });
 // Start the server heartbeat immediately, including while the entry screen is visible.
 start();
});
})();+Number(x.fav.price).toFixed(2)+' · '+esc(x.fav.signalLabel||"Verified")+' · confidence '+esc(x.fav.signalScore)+'/100</span><div class="rf-muted">'+esc(String(x.race.category||x.race.code||"Racing").toUpperCase())+' · '+esc(x.fav.priceSource||"Verified fixed WIN")+' · '+Number(x.fav.quoteCount||0)+' independent bookmaker source(s) · '+(Number(x.fav.quoteCount||0)>1?Number(x.fav.spreadPct||0).toFixed(1)+'% price spread':'no cross-book spread available')+' · '+esc(fmtTime(x.race.start_time||x.race.commence_time))+'</div></div>').join("");
 if($("bestTipsList"))$("bestTipsList").innerHTML='<div class="rf-muted">FRESH FIXED-WIN SHORTLIST · Only timestamped verified bookmaker prices qualify. Single-bookmaker picks are marked limited confirmation; exchange, estimates and Sportsbet public previews are excluded. Confidence is a market-data quality score, not a probability of winning.</div>'+(raceHtml||'<div class="rf-empty">No fresh verified bookmaker favourites currently qualify. No estimated or exchange prices are substituted.</div>');
}

async function checkDashboardConnection(){
 if(healthCheckInFlight)return healthCheckInFlight;
 healthCheckInFlight=(async()=>{
  try{
   const response=await fetch("/api/health",{cache:"no-store",headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw new Error("Health check HTTP "+response.status);
   const health=await response.json();
   const serverMs=Date.parse(health?.serverTime||"");
   const ageMs=Date.now()-serverMs;
   if(health?.ok!==true||!Number.isFinite(serverMs)||ageMs < -60000||ageMs>120000)
    throw new Error("Server did not return a recent, timestamped health response");
   lastServerCheckAt=Date.now();
   const serverClock=new Date(serverMs).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false});
   setHeaderConnection("CONNECTED · SERVER "+serverClock);
   if($("feedStatus"))$("feedStatus").title="Server health confirmed at "+new Date(serverMs).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"})+" · uptime "+Number(health.uptimeSeconds||0)+" seconds";
   return true;
  }catch(error){
   if(!lastServerCheckAt)setHeaderConnection("OFFLINE · SERVER NOT REACHABLE");
   else if(Date.now()-lastServerCheckAt>75000)setHeaderConnection("CONNECTION STALE");
   return false;
  }finally{healthCheckInFlight=null;}
 })();
 return healthCheckInFlight;
}
async function loadRaces(){
 // The health heartbeat is independent of the slower upstream race-feed request.
 void checkDashboardConnection();
 try{
  const response=await fetch("/api/races",{cache:"no-store",signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error("Race feed HTTP "+response.status);
  const data=await response.json();renderRaces(data);
 }catch(error){
  if($("raceList"))$("raceList").innerHTML='<div class="rf-empty">The server connection is monitored separately. Racing feed response delayed or unavailable: '+esc(error.message)+'</div>';
 }
}
async function loadLucasFox(){
 try{
  const response=await fetch("/api/lucasfox/sports",{cache:"no-store",signal:AbortSignal.timeout(18000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"LucasFox unavailable");
  const events=data.events||[],quotes=events.flatMap(e=>(e.bookmakers||[]).flatMap(b=>(b.markets||[]).flatMap(m=>(m.outcomes||[]).map(o=>({e,b,m,o})))));
  const fresh=quotes.filter(x=>Number(x.o.age_seconds)<900);
  if($("lucasFoxSportsState"))$("lucasFoxSportsState").textContent=quotes.length?"SPORTSBET QUOTES FOUND":"NO QUOTES RETURNED";
  if($("lucasFoxSportsStats"))$("lucasFoxSportsStats").innerHTML=[[events.length,"Sports fixtures"],[quotes.length,"Sportsbet quotes"],[fresh.length,"Fresh under 15m"],[data.dailyLimit||100,"Free requests/day"]].map(x=>'<div class="stat"><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join("");
  if($("lucasFoxSportsMarkets"))$("lucasFoxSportsMarkets").innerHTML=quotes.length?quotes.slice(0,60).map(x=>'<div class="rf-sports-row"><b>'+esc(x.e.home_team)+' v '+esc(x.e.away_team)+' · '+esc(x.m.name||x.m.key)+'</b>'+esc(x.o.name)+' · $'+Number(x.o.price).toFixed(2)+' · '+(Number(x.o.age_seconds)<900?'FRESH':'STALE / NOT RANKED')+'<div class="rf-muted">Sportsbet · captured '+esc(fmtTime(x.o.captured_at||x.o.last_update))+' · '+esc(fmtAge(x.o.age_seconds))+'</div></div>').join(""):'<div class="rf-empty">No current LucasFox Sportsbet sports quotes were returned. Racing WIN/PLACE is not covered by this feed.</div>';
  if($("lucasFoxSportsDetail"))$("lucasFoxSportsDetail").textContent=data.note||"LucasFox sports markets only; not horse-racing odds.";
 }catch(error){
  if($("lucasFoxSportsState"))$("lucasFoxSportsState").textContent="FEED UNAVAILABLE";
  if($("lucasFoxSportsMarkets"))$("lucasFoxSportsMarkets").innerHTML='<div class="rf-empty">'+esc(error.message)+' · LucasFox is sports-only.</div>';
 }
}
async function loadBetfairSports(){
 const state=$("betfairSportsNotice"),list=$("betfairSportsEvents");
 try{
  if(state)state.textContent="Refreshing authorised Betfair delayed Exchange markets…";
  const response=await fetch("/api/betfair/sports",{cache:"no-store",signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Betfair sports feed HTTP "+response.status);
  betfairSportsEvents=Array.isArray(data.events)?data.events:[];
  const events=betfairSportsEvents,live=events.filter(e=>e.inPlay),priced=events.filter(e=>(e.runners||[]).some(r=>r.back||r.lay));
  const soccerMarketCount=Number(data.soccerMarketCount??events.filter(e=>/soccer|football/i.test(String(e.sport||e.sport_name||""))&&(e.marketId||e.market_id||e.marketName||e.market_name||Array.isArray(e.runners))).length);
  const soccerPricedMarkets=Number(data.soccerPricedMarkets??events.filter(e=>/soccer|football/i.test(String(e.sport||e.sport_name||""))&&(e.runners||[]).some(r=>r.back||r.lay)).length);
  if($("betfairSportsStats"))$("betfairSportsStats").innerHTML=[[events.length,"Exchange markets"],[new Set(events.map(e=>e.sport||e.sport_name).filter(Boolean)).size,"Sports"],[live.length,"In-play"],[priced.length,"Priced markets"],[soccerMarketCount,"Soccer markets"],[soccerPricedMarkets,"Priced soccer"]].map(x=>'<div class="stat"><b>'+esc(x[0])+'</b><span>'+esc(x[1])+'</span></div>').join("");
  const status=String(data.status||"unknown");
  if(state)state.textContent=(status==="connected-delayed"?"CONNECTED · DELAYED EXCHANGE":status==="configured-no-quotes"?"CONNECTED · NO CURRENT MARKETS":status.toUpperCase().replaceAll("-"," "))+ " · SOCCER "+soccerMarketCount+" MARKETS / "+soccerPricedMarkets+" PRICED"+(data.error?" · "+data.error:"");
  if(list)list.innerHTML=events.length?events.slice(0,120).map(e=>{
   const runners=(e.runners||[]).filter(r=>r.back||r.lay),favourite=e.favourite;
   const runnerRows=runners.map(r=>{
    const back=r.back?"$"+Number(r.back.price).toFixed(2)+" · size "+(r.back.availableSize==null?"—":Number(r.back.availableSize).toFixed(2)):"—";
    const lay=r.lay?"$"+Number(r.lay.price).toFixed(2)+" · size "+(r.lay.availableSize==null?"—":Number(r.lay.availableSize).toFixed(2)):"—";
    const b=Number(r.back?.price),l=Number(r.lay?.price),ref=b>1?(l>1?(b+l)/2:b):null;
    const est=ref&&Number.isFinite(ref)?' · EST. $' +(ref/1.05).toFixed(2)+' (range $' +(ref/1.08).toFixed(2)+'–$' +(ref/1.03).toFixed(2)+')':"";
    return '<div class="rf-price-line"><span>'+esc(r.name)+(favourite&&favourite.name===r.name?" · MARKET FAVOURITE":"")+'</span><span>BACK '+back+' &nbsp; LAY '+lay+est+'</span></div>';
   }).join("");
   const favHtml=favourite?'<div class="rf-fav"><strong>EXCHANGE MARKET FAVOURITE · BACK</strong>'+esc(favourite.name)+' · $'+Number(favourite.price).toFixed(2)+'<div class="rf-muted">Lowest available BACK price in this market; not a prediction or guaranteed winner.</div></div>':'<div class="rf-muted">No available BACK offer; no favourite calculated.</div>';
   const pricesHtml=runnerRows?'<div class="rf-market-section">'+runnerRows+'</div>':'<div class="rf-empty">No available BACK/LAY offers returned for this market.</div>';
   return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(e.event||"Sports event")+' · '+esc(e.sport||"Sport")+'</div><div class="rf-muted">'+esc(e.competition||"")+' · '+esc(e.marketName||"Market")+' · '+esc(fmtTime(e.startTime))+' · '+(e.inPlay?"IN-PLAY":"UPCOMING")+'</div></div><span class="rf-muted">Betfair Exchange</span></div>'+favHtml+pricesHtml+'<div class="rf-muted">Betfair Exchange · delayed up to '+esc(data.delayMaximumSeconds||180)+'s · observed '+esc(fmtTime(e.marketPublishedAt||e.capturedAt||data.fetchedAt))+' · source '+esc(e.source||data.provider||"Betfair Exchange")+'</div></article>';
  }).join(""):'<div class="rf-empty">No upcoming or in-play sports markets returned by the authorised Betfair delayed feed. No odds are estimated.</div>';
  if($("betfairSportsDetail"))$("betfairSportsDetail").textContent=(data.note||"Delayed Betfair Exchange data.")+" Last API refresh: "+fmtTime(data.fetchedAt)+". "+(data.errors||[]).map(x=>x.sport+": "+x.message).join(" · ");
  renderBestTips(races.filter(r=>!r.abandoned));
 }catch(error){
  betfairSportsEvents=[];
  if(state)state.textContent="FEED UNAVAILABLE · "+error.message;
  if(list)list.innerHTML='<div class="rf-empty">'+esc(error.message)+' · No Betfair sports prices are being estimated.</div>';
  if($("betfairSportsDetail"))$("betfairSportsDetail").textContent=error.message+" The application will not show estimated prices or label unavailable data as connected.";
 }
}
function sportQuoteAge(quote,book) {
  const direct=quote?.age_seconds??quote?.freshness_seconds??book?.age_seconds;
  const directAge=direct!=null&&Number.isFinite(Number(direct))?Math.max(0,Number(direct)):null;
  const stamp=quote?.last_update||quote?.updated_at||quote?.timestamp||book?.last_update||book?.updated_at||null;
  const numeric=Number(stamp);
  const ms=stamp==null?NaN:(Number.isFinite(numeric)&&numeric>1000000000?(numeric>1000000000000?numeric:numeric*1000):Date.parse(stamp));
  const stampedAge=Number.isFinite(ms)?Math.max(0,(Date.now()-ms)/1000):null;
  if(directAge!=null&&stampedAge!=null)return Math.max(directAge,stampedAge);
  return directAge??stampedAge;
}
function renderSportsBookmaker(event,book) {
  const bookmaker=String(book.name||book.title||book.key||"Bookmaker");
  const markets=(book.markets||[]).filter(m=>(m.outcomes||[]).some(o=>Number(o.price)>1));
  if(!markets.length)return "";
  const main=markets.find(m=>["h2h","head_to_head","moneyline","match_winner","winner"].includes(String(m.key||m.name||"").toLowerCase().replace(/[\s-]+/g,"_")))||markets[0];
  const outcomes=(main.outcomes||[]).filter(o=>Number(o.price)>1&&!o.suspended&&!o.removed);
  // Only call a sports selection the current favourite when its source quote
  // has a known age under 180 seconds. Unknown/stale prices remain visible,
  // but cannot win the live-favourite label.
  const freshOutcomes=outcomes.filter(o=>{
    const age=sportQuoteAge(o,book);
    return age!=null&&age>=0&&age<180&&o.stale!==true&&book.stale!==true;
  });
  const favourite=[...freshOutcomes].sort((a,b)=>Number(a.price)-Number(b.price))[0]||null;
  const age=favourite?sportQuoteAge(favourite,book):null;
  const freshness=age==null?"QUOTE AGE UNKNOWN · NOT VERIFIED":age<180?"SOURCE QUOTE "+Math.round(age)+"s OLD":"STALE SOURCE QUOTE · "+Math.round(age)+"s";
  const lines=markets.map(m=>{
    const rows=(m.outcomes||[]).filter(o=>Number(o.price)>1&&!o.suspended&&!o.removed);
    if(!rows.length)return "";
    return '<div class="rf-market-title">'+esc(m.name||m.key||"Market")+'</div>'+rows.map(o=>{
      const a=sportQuoteAge(o,book);
      return '<div class="rf-price-line"><span>'+esc(o.name||o.label||"Selection")+(favourite&&m===main&&o===favourite?' · FAVOURITE':'')+'</span><b>$'+Number(o.price).toFixed(2)+'</b><span class="rf-muted">'+(a==null?'AGE UNKNOWN':Math.round(a)+'s old')+'</span></div>';
    }).join("");
  }).join("");
  const source=String(book.source||book.provider||event._provider||"Source not supplied");
  const sourceUrl=String(book.source_url||book.url||"");
  const link=/^https?:\/\//i.test(sourceUrl)?'<a class="rf-source-link" href="'+esc(sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(new URL(sourceUrl).hostname.replace(/^www\./,""))+' ↗</a>':"";
  return '<div class="rf-price-box"><h4>'+esc(bookmaker)+' <span class="rf-book-label">BOOKMAKER QUOTE</span></h4>'+
    '<div class="rf-source-meta">DATA SOURCE · '+esc(source)+' '+link+'</div>'+
    (favourite?'<div class="rf-fav"><strong>'+esc(bookmaker)+' MARKET FAVOURITE</strong>'+esc(favourite.name)+' · $'+Number(favourite.price).toFixed(2)+'<div class="rf-muted">'+esc(freshness)+' · shortest price in '+esc(main.name||main.key||"market")+'</div></div>':'')+lines+'</div>';
}
async function loadSportsFixtures(){
 if(Date.now()-lastSportsAt<10*60*1000)return;
 lastSportsAt=Date.now();
 try{
  const res=await fetch("/api/sports",{cache:"no-store"});
  if(!res.ok)throw new Error("Sports catalogue HTTP "+res.status);
  const data=await res.json(),allSports=data.sports||[];
  const results=[];
  // Fetch every catalogue sport in small batches to avoid a burst of provider requests.
  for(let i=0;i<allSports.length;i+=4){
   const batch=allSports.slice(i,i+4);
   const settled=await Promise.all(batch.map(async sport=>{
    try{
     const response=await fetch("/api/public-sports/"+encodeURIComponent(sport.key),{cache:"no-store"});
     if(!response.ok)return {sport,data:null,error:"HTTP "+response.status};
     return {sport,data:await response.json(),error:null};
    }catch(error){return {sport,data:null,error:error.message};}
   }));
   results.push(...settled);
  }
  const byEvent=new Map();
  for(const result of results)for(const event of (result.data?.events||result.data?.rows||[])){
   const key=[String(event.home_team||event.home||"").toLowerCase().replace(/[^a-z0-9]/g,""),
     String(event.away_team||event.away||"").toLowerCase().replace(/[^a-z0-9]/g,""),
     String(event.commence_time||event.start_time||"").slice(0,10)].join("|");
   if(!byEvent.has(key))byEvent.set(key,{...event,_sportTitle:result.sport.title,_provider:result.data.provider||"Public sports source"});
   else{
    const old=byEvent.get(key);
    old.bookmakers=[...(old.bookmakers||[]),...(event.bookmakers||[])];
   }
  }
  const events=[...byEvent.values()].sort((a,b)=>Number(!!b.in_play)-Number(!!a.in_play)||
    Date.parse(a.commence_time||a.start_time||0)-Date.parse(b.commence_time||b.start_time||0));
  const pricedEvents=events.filter(e=>(e.bookmakers||[]).some(b=>(b.markets||[]).some(m=>(m.outcomes||[]).some(o=>Number(o.price)>1))));
  const quoteCount=events.reduce((n,e)=>n+(e.bookmakers||[]).reduce((m,b)=>m+(b.markets||[]).reduce((k,market)=>k+(market.outcomes||[]).filter(o=>Number(o.price)>1).length,0),0),0);
  const eventHtml=events.map(e=>{
   const books=(e.bookmakers||[]).map(b=>renderSportsBookmaker(e,b)).filter(Boolean).join("");
   return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(e.home_team||e.home||e.event||"Fixture")+' v '+esc(e.away_team||e.away||"")+'</div><div class="rf-muted">'+esc(e._sportTitle||e.sport_name||e.sport||"Sport")+' · '+esc(e.league||e.competition||"")+' · '+esc(fmtTime(e.commence_time||e.start_time))+' · '+(e.in_play===true?"IN-PLAY":"UPCOMING")+'</div></div></div>'+
    (books?'<div class="rf-price-groups">'+books+'</div>':'<div class="rf-empty">Fixture returned; no bookmaker prices supplied by the connected public feeds.</div>')+'</article>';
  }).join("");
  const sportRows=allSports.map(s=>{
   const count=events.filter(e=>String(e._sportTitle||e.sport_name||"")===String(s.title)).length;
   return count?'<div class="rf-muted">'+esc(s.title)+' · '+count+' fixture(s)</div>':'<div class="rf-muted">'+esc(s.title)+' · no fixture returned by available feeds</div>';
  }).join("");
  if($("sportsNotice"))$("sportsNotice").textContent=events.length?
   events.length+" fixtures across "+allSports.length+" catalogue sports · "+pricedEvents.length+" priced fixtures · "+quoteCount+" source quotes · only provider-supplied prices shown.":
   "No fixtures returned by the available public feeds across "+allSports.length+" catalogue sports. Sports are still listed below.";
  if($("sportsCatalogue"))$("sportsCatalogue").innerHTML=(eventHtml||'<div class="rf-empty">No upcoming or in-play fixtures returned by available sources.</div>')+
   '<div class="rf-price-box"><h4>SPORTS COVERAGE · ALL CATALOGUE SPORTS</h4>'+sportRows+'</div>';
 }catch(error){
  if($("sportsNotice"))$("sportsNotice").textContent="Public sports fixtures unavailable: "+error.message;
  if($("sportsCatalogue"))$("sportsCatalogue").innerHTML='<div class="rf-empty">'+esc(error.message)+'</div>';
 }
}

function start(){
 if(started)return;started=true;addStyles();
 setHeaderConnection("CHECKING · VERIFYING SERVER");
 void checkDashboardConnection();
 setInterval(checkDashboardConnection,30000);
 setInterval(()=>{if(lastServerCheckAt&&Date.now()-lastServerCheckAt>75000)setHeaderConnection("CONNECTION STALE");},10000);
 loadRaces();loadLucasFox();loadSportsFixtures();
 setInterval(loadRaces,2*60*1000);setInterval(loadLucasFox,15*60*1000);setInterval(loadSportsFixtures,10*60*1000);loadBetfairSports();setInterval(loadBetfairSports,60*1000);
}
window.startFullDashboardFeeds=start;
document.addEventListener("DOMContentLoaded",()=>{
 addStyles();
 updateBrisbaneClock();setInterval(updateBrisbaneClock,1000);
 const enter=$("enterWebsiteBtn");
 if(enter){enter.addEventListener("click",()=>start(),{once:true});}
 const refresh=$("refreshBtn");if(refresh)refresh.addEventListener("click",()=>loadRaces());
 const refreshBetfairSports=$("refreshBetfairSportsBtn");if(refreshBetfairSports)refreshBetfairSports.addEventListener("click",()=>loadBetfairSports());
 const loadAllSportsButton=$("loadAllSportsBtn");if(loadAllSportsButton)loadAllSportsButton.addEventListener("click",()=>{lastSportsAt=0;loadSportsFixtures();});
 const refreshLiveSportsButton=$("refreshLiveSportsBtn");if(refreshLiveSportsButton)refreshLiveSportsButton.addEventListener("click",()=>{loadLucasFox();loadBetfairSports();lastSportsAt=0;loadSportsFixtures();});
 document.querySelectorAll(".tab[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;document.querySelectorAll(".tab[data-filter]").forEach(b=>b.classList.toggle("active",b===button));renderRaces({races,fetchedAt:new Date().toISOString()});
 }));
 if($("sort"))$("sort").addEventListener("change",event=>{sort=event.target.value;renderRaces({races,fetchedAt:new Date().toISOString()});});
 if($("search"))$("search").addEventListener("input",event=>{
  const q=event.target.value.toLowerCase();document.querySelectorAll(".rf-race").forEach(card=>card.style.display=card.textContent.toLowerCase().includes(q)?"":"none");
 });
 // Start the server heartbeat immediately, including while the entry screen is visible.
 start();
});
})();