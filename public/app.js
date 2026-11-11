/* Racing Favourite Finder — free-source dashboard renderer.
   Verified prices and unverified prices are intentionally kept in separate groups. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtTime=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("en-AU",{timeZone:"Australia/Brisbane"}):"Time unavailable";};
const fmtAge=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)))+"s old":"age unknown";
let races=[],filter="all",sort="time",started=false,lastSportsAt=0;
const statusBadge=(status)=>status==="verified"?'<span class="price-status verified">VERIFIED</span>':'<span class="price-status unverified">UNVERIFIED</span>';
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
 .rf-empty{padding:14px;color:var(--muted,#9aa8b9);border:1px dashed var(--line,#293342);border-radius:10px}
 .rf-sports-row{padding:10px;border-bottom:1px solid var(--line,#293342);font-size:13px}
 .rf-sports-row b{display:block}.rf-sports-quotes{color:var(--muted,#9aa8b9);font-size:12px;margin-top:4px}
 `;document.head.appendChild(style);
}
function auditRows(r){return Array.isArray(r.bookmakerPriceAudit)?r.bookmakerPriceAudit:[];}
function renderRunnerMarkets(r){
 const rows=auditRows(r);if(!rows.length)return "";
 const books=[...new Set(rows.map(x=>x.bookmaker_key||x.bookmaker))];
 return books.map(book=>{
  const name=rows.find(x=>(x.bookmaker_key||x.bookmaker)===book)?.bookmaker||book;
  const selected=rows.filter(x=>(x.bookmaker_key||x.bookmaker)===book);
  const line=(market,status)=>selected.filter(x=>x.market===market&&x.status===status).map(x=>{
   const detail=status==="verified"?"Captured "+fmtTime(x.captured_at)+" · "+fmtAge(x.age_seconds):
    (x.reasons||["Not verified"]).join(", ")+(x.age_seconds!=null?" · "+fmtAge(x.age_seconds):"");
   return '<div class="rf-price-line"><span>'+market+' · $'+Number(x.price).toFixed(2)+' '+statusBadge(status)+'<div class="rf-muted">'+esc(detail)+'</div></span><span class="rf-muted">'+esc(x.source||"Feed")+'</span></div>';
  }).join("");
  const winVerified=line("WIN","verified"),winUnverified=line("WIN","unverified");
  const placeVerified=line("PLACE","verified"),placeUnverified=line("PLACE","unverified");
  return '<div class="rf-price-box"><h4>'+esc(name)+'</h4>'+
   '<div class="rf-market-section"><div class="rf-market-title">Fixed WIN</div>'+(winVerified||'<div class="rf-muted">No verified WIN quote</div>')+winUnverified+'</div>'+
   '<div class="rf-market-section"><div class="rf-market-title">Fixed PLACE</div>'+(placeVerified||'<div class="rf-muted">No verified PLACE quote</div>')+placeUnverified+'</div></div>';
 }).join("");
}
function renderRace(r){
 const fav=r.favourite||{status:"unpriced",label:"FAVOURITE NOT IDENTIFIED · UNPRICED"};
 const runners=(r.runners||[]).filter(x=>!x.scratched&&!x.suspended&&!/scratched|removed|suspended/i.test(String(x.status||"")));
 const marketHtml=runners.map(x=>renderRunnerMarkets(x)).filter(Boolean).join("");
 const favPrice=fav.price!=null?" · $"+Number(fav.price).toFixed(2):"";
 const favSource=fav.priceSource?" · "+esc(fav.priceSource):"";
 const favName=fav.name?esc(fav.name)+(fav.number!=null?" (#"+esc(fav.number)+")":""):"No named favourite supplied by feed";
 const favClass=fav.status==="verified"?"verified":fav.status==="unverified"?"unverified":"";
 return '<article class="rf-race"><div class="rf-race-head"><div><div class="rf-race-title">'+esc(r.venue||r.track||"Race meeting")+' · R'+esc(r.race_number??"?")+'</div><div class="rf-muted">'+esc(String(r.category||r.code||"Racing").toUpperCase())+' · '+esc(fmtTime(r.start_time||r.commence_time))+' · '+esc(r.status||"Scheduled")+'</div></div><span class="rf-muted">'+runners.length+' active runners</span></div>'+
  '<div class="rf-fav"><strong class="'+favClass+'">'+esc(fav.label||"FAVOURITE")+'</strong>'+favName+favPrice+favSource+
  (fav.status==="unverified"?'<div class="rf-muted">Candidate only — excluded from verified tips and rankings.</div>':fav.status==="unpriced"?'<div class="rf-muted">No verified fixed WIN quote is available for this favourite.</div>':'<div class="rf-muted">Selected from fresh fixed WIN quotes only.</div>')+'</div>'+
  (marketHtml?'<div class="rf-price-groups">'+marketHtml+'</div>':'<div class="rf-empty">No fixed WIN or PLACE prices returned for active runners. The race remains listed as unpriced.</div>')+
  '</article>';
}
function setHeaderConnection(state){
 const label=$("feedStatus"),dot=document.querySelector(".top-right .live-dot");
 if(label)label.textContent=state;
 if(dot)dot.className="live-dot "+(state==="CONNECTED"?"connected":state==="PARTIAL"?"checking":"offline");
}
function updateBrisbaneClock(){
 const clock=$("clock");
 if(clock)clock.textContent=new Date().toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false});
}
function renderRaces(data){
 races=data.races||[];
 const errors=[...(data.feedHealth?.errors||[]),...(data.feedErrors||[])];
 setHeaderConnection(errors.length?"PARTIAL":races.length?"CONNECTED":"CONNECTED · NO RACES");
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
 if($("feedFreshness"))$("feedFreshness").textContent=(data.note||"Race and quote availability depends on free provider coverage.")+(data.quotaRecheckAt?" Free quota recheck scheduled: "+fmtTime(data.quotaRecheckAt):"");
 if($("dashboardFeedStatuses"))$("dashboardFeedStatuses").innerHTML='<div class="feed-status-item"><span class="feed-dot '+(data.feedHealth?.errors?.length?"checking":"")+'"></span><span><b>RACING FEEDS · '+(data.feedHealth?.errors?.length?"PARTIAL":"CHECKED")+'</b><small>'+esc(data.feedSource||"Public feeds")+' · '+active.length+' race cards</small></span></div>';
 window.dispatchEvent(new CustomEvent("racing-data-updated",{detail:data}));
 renderBestTips(active);
}
function renderBestTips(list){
 const verified=list.map(r=>({race:r,fav:r.favourite})).filter(x=>x.fav?.status==="verified"&&Number(x.fav.signalScore||0)>=40)
  .sort((a,b)=>(b.fav.signalScore||0)-(a.fav.signalScore||0)).slice(0,10);
 if($("bestTipsList"))$("bestTipsList").innerHTML=verified.length?verified.map(x=>'<div class="rf-sports-row"><b>'+esc(x.race.venue||"Race")+' R'+esc(x.race.race_number??"?")+' · '+esc(x.fav.name)+'</b><span>$'+Number(x.fav.price).toFixed(2)+' · '+esc(x.fav.signalLabel||"Verified")+' · score '+esc(x.fav.signalScore)+'</span></div>').join(""):'<div class="rf-empty">No verified top tips right now. Races remain listed above, including unpriced and unverified favourites, but they are not promoted as verified tips.</div>';
}
async function loadRaces(){
 try{
  const response=await fetch("/api/races",{cache:"no-store",signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error("Race feed HTTP "+response.status);
  const data=await response.json();renderRaces(data);
 }catch(error){
  setHeaderConnection("OFFLINE");
  if($("raceList"))$("raceList").innerHTML='<div class="rf-empty">Race feed temporarily unavailable: '+esc(error.message)+'</div>';
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
async function loadSportsFixtures(){
 if(Date.now()-lastSportsAt<10*60*1000)return;lastSportsAt=Date.now();
 try{
  const res=await fetch("/api/sports",{cache:"no-store"});if(!res.ok)return;const data=await res.json();
  const active=(data.sports||[]).filter(x=>x.active).slice(0,8);
  const results=await Promise.all(active.map(async sport=>{
   try{const r=await fetch("/api/public-sports/"+encodeURIComponent(sport.key),{cache:"no-store"});return r.ok?{sport,data:await r.json()}:null;}catch{return null;}
  }));
  const events=results.filter(Boolean).flatMap(x=>(x.data.events||x.data.rows||[]).map(e=>({...e,_sportTitle:x.sport.title})));
  if($("sportsNotice"))$("sportsNotice").textContent=events.length?events.length+" public sports fixtures returned · provider coverage varies.":"No upcoming fixtures returned by currently available free public sports sources.";
  if($("sportsCatalogue"))$("sportsCatalogue").innerHTML=events.length?events.slice(0,80).map(e=>'<div class="rf-sports-row"><b>'+esc(e.home_team||e.home||"TBA")+' v '+esc(e.away_team||e.away||"TBA")+' · '+esc(e._sportTitle||e.sport_name||"Sport")+'</b><span>'+esc(fmtTime(e.commence_time||e.start_time))+' · '+esc(e.status||"Scheduled")+'</span></div>').join(""):'<div class="rf-empty">Fixture schedule unavailable from free sources at this check.</div>';
 }catch(error){if($("sportsNotice"))$("sportsNotice").textContent="Public sports fixtures unavailable: "+error.message;}
}
function start(){
 if(started)return;started=true;addStyles();loadRaces();loadLucasFox();loadSportsFixtures();
 setInterval(loadRaces,60000);setInterval(loadLucasFox,15*60*1000);setInterval(loadSportsFixtures,10*60*1000);
}
window.startFullDashboardFeeds=start;
document.addEventListener("DOMContentLoaded",()=>{
 addStyles();
 updateBrisbaneClock();setInterval(updateBrisbaneClock,1000);
 const enter=$("enterWebsiteBtn");
 if(enter){enter.addEventListener("click",()=>start(),{once:true});}
 const refresh=$("refreshBtn");if(refresh)refresh.addEventListener("click",()=>loadRaces());
 document.querySelectorAll(".tab[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;document.querySelectorAll(".tab[data-filter]").forEach(b=>b.classList.toggle("active",b===button));renderRaces({races,fetchedAt:new Date().toISOString()});
 }));
 if($("sort"))$("sort").addEventListener("change",event=>{sort=event.target.value;renderRaces({races,fetchedAt:new Date().toISOString()});});
 if($("search"))$("search").addEventListener("input",event=>{
  const q=event.target.value.toLowerCase();document.querySelectorAll(".rf-race").forEach(card=>card.style.display=card.textContent.toLowerCase().includes(q)?"":"none");
 });
 if(document.body.classList.contains("site-entered"))start();
});
})();