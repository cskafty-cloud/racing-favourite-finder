const state = { races: [], filter: "all", search: "", sort: "time", loading: false };
const $ = id => document.getElementById(id);
const fmtTime = value => {
  if (!value) return "Time TBA";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",hour12:true,timeZone:"Australia/Brisbane"});
};
const fmtDate = value => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short",timeZone:"Australia/Brisbane"});
};
function runnerPrices(runner) { return (runner.bookmakers || runner.odds || []).filter(b => Number(b.win_price ?? b.win ?? b.price) > 1); }
function bookmakerFavourite(race, wantedKey) {
  const aliases = { sportsbet:["sportsbet","sportsbetau","sportsbetcomau"], bet365:["bet365","bet365au","bet365comau"] };
  const accepted = aliases[wantedKey] || [wantedKey];
  const candidates = (race.runners || []).map(runner => {
    const quote = runnerPrices(runner).find(q => [q.key,q.bookmaker,q.name,q.bookmaker_name,q.site].filter(Boolean).some(value => accepted.includes(String(value).toLowerCase().replace(/[^a-z0-9]/g,""))));
    if (!quote) return null;
    return {name:runner.name || runner.runner_name || runner.horse_name || runner.greyhound_name || "Runner",
      number:runner.number ?? runner.runner_number ?? null,
      price:Number(quote.win_price ?? quote.win ?? quote.price),
      age:quote.age_seconds, stale:!!quote.stale};
  }).filter(x => x && Number.isFinite(x.price) && x.price > 1);
  return candidates.sort((a,b)=>a.price-b.price)[0] || null;
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
function marketFavourite(race) {
  const runners = (race.runners || []).map(r => {
    const quotes = runnerPrices(r);
    if (!quotes.length) return null;
    const prices = quotes.map(q => Number(q.win_price ?? q.win ?? q.price)).filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
    if (!prices.length) return null;
    const median = prices[Math.floor((prices.length-1)/2)];
    const b365 = quotes.find(q => String(q.key || q.bookmaker || q.name || "").toLowerCase().replace(/[^a-z0-9]/g,"") === "bet365");
    const b365Price = b365 ? Number(b365.win_price ?? b365.win ?? b365.price) : null;
    return {...r, consensus: b365Price || median, bet365: b365Price, quoteCount: quotes.length, priceSource: b365Price ? "Bet365" : "market median"};
  }).filter(Boolean);
  return runners.sort((a,b)=>a.consensus-b.consensus)[0] || null;
}
function categoryOf(r) {
  const c = String(r.category || r.code || r.race_type || "").toLowerCase();
  return c.includes("grey") || c.includes("dog") ? "greyhound" : "horse";
}
function filteredRaces() {
  let rows = state.races.filter(r => state.filter === "all" || categoryOf(r) === state.filter);
  const q = state.search.toLowerCase();
  if (q) rows = rows.filter(r => `${r.venue||r.track_name||""} ${(r.runners||[]).map(x=>x.name).join(" ")}`.toLowerCase().includes(q));
  rows.sort((a,b) => state.sort === "odds"
    ? (marketFavourite(a)?.consensus ?? 999) - (marketFavourite(b)?.consensus ?? 999)
    : new Date(a.start_time||0)-new Date(b.start_time||0));
  return rows;
}
function raceCard(r, live=false) {
  const fav = marketFavourite(r);
  const sportsbetFav = bookmakerFavourite(r,"sportsbet");
  const bet365Fav = bookmakerFavourite(r,"bet365");
  const type = categoryOf(r);
  const venue = r.venue || r.track_name || r.venue_canonical || "Track TBA";
  const number = r.race_number ? `R${r.race_number}` : "Race";
  const country = r.country || "Country pending";
  const marketState = r.inplay ? "IN PLAY" : (r.market_status || (r.tote_only ? "TOTE ONLY" : (fav ? "ODDS AVAILABLE" : "SCHEDULED · NO ODDS YET")));
  const date = fmtDate(r.start_time);
  const time = fmtTime(r.start_time);
  const price = fav ? Number(fav.consensus).toFixed(2) : "—";
  const bet365 = fav?.bet365 ? ` · Bet365 <b>$${Number(fav.bet365).toFixed(2)}</b>` : " · Bet365 quote unavailable";
  const mins = Math.max(0,Math.ceil((new Date(r.start_time).getTime()-Date.now())/60000));
  const runnerOdds = (r.runners || []).map(runner => {
    const quotes = runnerPrices(runner).map(q => ({
      name: q.bookmaker || q.bookmaker_name || q.name || q.site || q.key || "Bookmaker",
      price: Number(q.win_price ?? q.win ?? q.price), url: q.source_link || q.source_url || null
    })).filter(q => Number.isFinite(q.price) && q.price > 1)
      .sort((a,b)=>a.price-b.price);
    if (!quotes.length) return "";
    return `<div class="odds-runner"><span class="odds-runner-name">${esc(runner.number ?? runner.runner_number ?? "")}${runner.number || runner.runner_number ? ". " : ""}${esc(runner.name || runner.runner_name || runner.horse_name || runner.greyhound_name || "Runner")}</span><div class="bookmaker-prices">${quotes.map(q=>`<span class="bookmaker-quote"><b>${esc(q.name)}</b> <strong>${q.price.toFixed(2)}</strong>${q.url && /^https?:\/\//i.test(q.url) ? ` <a class="bet-link" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">Open book ↗</a>` : ""}</span>`).join("")}</div></div>`;
  }).filter(Boolean).join("");
  return `<article class="race-card ${live?"live-race-card":""}">
    <div><div class="race-type">${type==="horse"?"🐎 HORSE RACING":"🐕 GREYHOUND RACING"}</div>
      <div class="race-title">${esc(venue)} <span style="color:#728395">${number}</span></div>
      <div class="race-meta">${esc(country)} · ${date} ${r.distance_m ? "· "+r.distance_m+"m" : ""}</div>
      <div class="race-time">${time}</div></div>
    <div>${fav ? `<div class="favourite-label">★ RACE FAVOURITE · HIGHLIGHTED</div><div class="runner-name">${esc(fav.number ? fav.number+". " : "")}${esc(fav.name)}</div><div class="runner-sub">${fav.quoteCount} bookmaker quote${fav.quoteCount===1?"":"s"} · ${esc(fav.priceSource)}${fav.quoteCount===1?" · LIMITED DATA":fav.quoteCount===2?" · CHECK CONSENSUS":""}</div>` : `<div class="favourite-label">★ RACE FAVOURITE · WAITING FOR ODDS</div><div class="runner-name">No current win prices</div><div class="runner-sub">Waiting for bookmaker odds</div>`}</div>
    <div class="price-wrap"><div class="price">${fav ? "$"+price : "—"}</div><div class="price-caption">${fav ? esc(fav.priceSource) : "MARKET PRICE"}</div><div class="bet365">${fav ? bet365 : "No quote"}</div></div>
    <div class="market-tag ${live?"soon-tag":""}">${live ? (mins===0?"STARTING NOW":`IN ${mins} MIN`) : esc(marketState)}</div>
    <div class="bookmaker-favourites">${favouritePanel("SPORTSBET FAVOURITE",sportsbetFav)}${favouritePanel("BET365 FAVOURITE",bet365Fav)}</div>
    <div class="all-bookmaker-odds"><div class="odds-heading">LIVE BOOKMAKER PRICES <span>${runnerOdds ? "All available runners and sites" : "No bookmaker quotes available"}</span></div>${runnerOdds || '<div class="no-odds">Waiting for current bookmaker prices.</div>'}</div>
  </article>`;
}

function possibleRaceGaps(rows) {
  const groups = new Map();
  for (const r of rows) {
    const n = Number(r.race_number ?? r.race_no ?? r.raceNumber ?? r.number);
    if (!Number.isInteger(n) || n < 1) continue;
    const key = [categoryOf(r), normalizeText(r.venue || r.track_name || r.venue_canonical || "Unknown track"), fmtDate(r.start_time)].join("|");
    if (!groups.has(key)) groups.set(key,{category:categoryOf(r),venue:r.venue || r.track_name || r.venue_canonical || "Unknown track",date:fmtDate(r.start_time),numbers:new Set()});
    groups.get(key).numbers.add(n);
  }
  const gaps=[];
  for (const g of groups.values()) {
    const ns=[...g.numbers].sort((a,b)=>a-b);
    for(let n=ns[0];n<ns[ns.length-1];n++) if(!g.numbers.has(n)) gaps.push({...g,missing:n});
  }
  return gaps;
}
function normalizeText(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function renderCoverage(rows) {
  const allRows = state.races;
  const catalogue = new Map();
  for (const race of allRows) for (const runner of race.runners || []) {
    for (const q of rawRunnerQuotes(runner)) {
      const key = normalizeText(q.key || q.name);
      if (key && !catalogue.has(key)) catalogue.set(key, q.name);
    }
  }
  const bookmakerKeys = [...catalogue.keys()];
  const missing=[];
  let sportsbetMissing=0,bet365Missing=0,bothMissing=0,missingSitePairs=0;
  for(const r of rows){
    const sb=bookmakerFavourite(r,"sportsbet"), b365=bookmakerFavourite(r,"bet365");
    const present=new Set();
    for (const runner of r.runners || []) for (const q of rawRunnerQuotes(runner)) present.add(normalizeText(q.key || q.name));
    const absent=bookmakerKeys.filter(k=>!present.has(k));
    missingSitePairs += absent.length;
    if(!sb)sportsbetMissing++;
    if(!b365)bet365Missing++;
    if(!sb&&!b365)bothMissing++;
    if(absent.length || !sb || !b365) missing.push({race:r,sb,b365,absent});
  }
  const gaps=possibleRaceGaps(rows);
  $("coverageStats").innerHTML = `<div><b>${sportsbetMissing}</b><span>Missing Sportsbet</span></div><div><b>${bet365Missing}</b><span>Missing bet365</span></div><div><b>${bothMissing}</b><span>Missing both</span></div><div><b>${missingSitePairs}</b><span>Missing bookmaker/race pairs</span></div>`;
  const quoteRows=missing.map(x=>{
    const r=x.race, venue=r.venue||r.track_name||r.venue_canonical||"Unknown track";
    const no=r.race_number ? "R"+r.race_number : "Race";
    const details=x.absent.length ? x.absent.map(k=>catalogue.get(k)).join(", ") : "None of the discovered provider sites missing";
    return `<div class="coverage-row"><span><b>${esc(venue)} ${esc(no)}</b><small>${esc(categoryOf(r))} · ${esc(fmtDate(r.start_time))} · ${esc(fmtTime(r.start_time))}</small></span><strong>${esc(details)}${x.absent.length?" missing":" · Sportsbet/bet365 checked"}</strong></div>`;
  }).join("");
  const gapRows=gaps.map(g=>`<div class="coverage-row"><span><b>${esc(g.venue)} R${g.missing}</b><small>${esc(g.category)} · ${esc(g.date)}</small></span><strong>Not returned by feed</strong></div>`).join("");
  $("coverageList").innerHTML=(quoteRows||'<div class="coverage-empty">Every discovered provider bookmaker has quotes in each matching race.</div>')+
    (gapRows ? '<div class="coverage-subheading">Possible missing race numbers</div>'+gapRows : '<div class="coverage-empty">No race-number gaps detected among returned races.</div>');
}

function rawRunnerQuotes(runner) {
  return (runner.bookmakers || runner.odds || []).map(q => ({
    name:q.bookmaker || q.name || q.key || "Bookmaker",
    key:q.key || q.bookmaker || q.name || "Bookmaker",
    price:Number(q.win_price ?? q.win ?? q.price),
    age:q.age_seconds ?? null,
    stale:!!q.stale,
    url:q.source_link || q.source_url || null
  })).filter(q=>Number.isFinite(q.price)&&q.price>1);
}
function isExplicitlyLive(r) {
  const status=String(r.status || r.market_status || r.race_status || r.event_status || "").toLowerCase();
  return r.inplay===true || r.in_play===true || r.is_live===true || /(^|[^a-z])(in[ -]?play|live|running)([^a-z]|$)/.test(status);
}
function renderLiveNow(rows) {
  const live=rows.filter(isExplicitlyLive).sort((a,b)=>new Date(a.start_time||0)-new Date(b.start_time||0));
  $("liveNowCount").textContent=live.length;
  $("liveNowList").innerHTML=live.length ? live.map(r=>raceCard(r,true)).join("") :
    '<div class="empty compact-empty">The provider has not explicitly marked any returned race as live/in-play at this refresh. Upcoming races are listed separately below.</div>';
}
function renderFullCoverage(rows) {
  const catalog=new Map(); let racesWithQuotes=0, racesWithoutQuotes=0, runners=0, quotes=0;
  for(const race of rows) {
    let raceQuotes=0;
    for(const runner of race.runners||[]) {
      runners++;
      for(const q of rawRunnerQuotes(runner)) {
        quotes++; raceQuotes++;
        const key=normalizeText(q.name);
        if(key&&!catalog.has(key)) catalog.set(key,q.name);
      }
    }
    if(raceQuotes) racesWithQuotes++; else racesWithoutQuotes++;
  }
  $("bookmakerUniverse").innerHTML = '<div class="bookmaker-universe-title">BOOKMAKERS FOUND IN THIS FEED ('+catalog.size+')</div>'+
    (catalog.size ? [...catalog.values()].sort((a,b)=>a.localeCompare(b)).map(x=>'<span class="bookmaker-chip">'+esc(x)+'</span>').join("") :
      '<span class="coverage-empty">No bookmaker names returned yet.</span>');
  $("fullCoverageStats").innerHTML =
    '<div><b>'+rows.length+'</b><span>Races returned</span></div>'+
    '<div><b>'+runners+'</b><span>Runner rows</span></div>'+
    '<div><b>'+quotes+'</b><span>Available quote rows</span></div>'+
    '<div><b>'+racesWithoutQuotes+'</b><span>Races with no prices</span></div>';
  $("fullCoverageList").innerHTML=rows.length ? rows.map(r=>{
    const venue=r.venue||r.track_name||r.venue_canonical||"Unknown track";
    const number=r.race_number||r.race_no||r.raceNumber||"—";
    const all=(r.runners||[]).map(runner=>{
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const qs=rawRunnerQuotes(runner).sort((a,b)=>a.name.localeCompare(b.name));
      const quoteHtml=qs.map(q=>{
        const age=q.age==null?"age n/a":Math.round(Number(q.age))+"s old";
        const stale=q.stale || (q.age!=null && Number(q.age)>=180);
        const link=q.url && /^https?:\/\//i.test(q.url) ? ' · <a class="bet-link" href="'+esc(q.url)+'" target="_blank" rel="noopener noreferrer">Open site</a>' : "";
        return '<span class="bookmaker-quote '+(stale?"stale-quote":"")+'"><b>'+esc(q.name)+'</b><strong>'+q.price.toFixed(2)+'</strong><small>'+age+(stale?" · STALE":" · returned")+'</small>'+link+'</span>';
      }).join("");
      return '<div class="full-runner"><div class="full-runner-name">'+esc((runner.number??runner.runner_number) ? (runner.number??runner.runner_number)+". " : "")+esc(name)+'</div><div class="bookmaker-prices">'+(quoteHtml||'<span class="no-odds">No bookmaker prices returned for this runner.</span>')+'</div></div>';
    }).join("");
    const raceQuoteCount=(r.runners||[]).reduce((n,x)=>n+rawRunnerQuotes(x).length,0);
    const live=isExplicitlyLive(r);
    return '<details class="full-race-row" '+(live?"open":"")+'><summary><span><b>'+esc(venue)+' R'+esc(number)+'</b><small>'+esc(categoryOf(r))+' · '+esc(r.country||"Country n/a")+' · '+esc(fmtDate(r.start_time))+' '+esc(fmtTime(r.start_time))+(live?' · LIVE NOW':'')+'</small></span><strong>'+raceQuoteCount+' quotes · '+(r.runners||[]).length+' runners</strong><span class="detail-chevron">⌄</span></summary><div class="full-race-runners">'+(all||'<div class="no-odds">No runners supplied by the provider for this race yet.</div>')+'</div></details>';
  }).join("") : '<div class="empty">No races returned by the provider.</div>';
}
function render() {
  const horses = state.races.filter(r=>categoryOf(r)==="horse").length;
  $("raceCount").textContent = state.races.length;
  $("horseCount").textContent = horses;
  $("dogCount").textContent = state.races.length-horses;
  const rows = filteredRaces();
  renderCoverage(rows);
  renderLiveNow(rows);
  renderFullCoverage(rows);
  const now = Date.now(), cutoff = now + 30*60*1000;
  const live = rows.filter(r => {
    const t = new Date(r.start_time).getTime();
    return Number.isFinite(t) && t >= now && t <= cutoff;
  });
  const later = rows.filter(r => !live.includes(r));
  $("nextRaceCount").textContent = live.length;
  $("nextRaceList").innerHTML = live.length ? live.map(r=>raceCard(r,true)).join("") : '<div class="empty compact-empty">No horse or greyhound races scheduled to start in the next 30 minutes. This section refreshes automatically.</div>';
  $("raceList").innerHTML = later.length ? later.map(r=>raceCard(r,false)).join("") : (rows.length ? '<div class="empty">All matching races are shown in the next 30 minutes section above.</div>' : `<div class="empty">${state.races.length ? "No races match your search." : "No races returned. Refresh or connect your racing data API key."}</div>`);
}
function esc(v) { return String(v??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function loadRaces() {
  if (state.loading) return;
  state.loading = true; $("refreshBtn").disabled = true;
  try {
    const res = await fetch("/api/races");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Feed request failed");
    state.races = data.races || [];
    $("feedStatus").textContent = data.mode === "live" ? (data.feedErrors?.length ? "LIVE FEED · PARTIAL" : "LIVE FEED") : "FEED OFFLINE";
    $("updatedAt").textContent = new Date(data.fetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = `Screen refresh: 5s (display only) · bookmaker price updates vary by feed; check quote age · provider schedule: ${data.horizonHours || 24}h (${esc(data.providerPlan || "free")} plan) · last odds fetch ${data.oddsFetchedAt ? new Date(data.oddsFetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "waiting"} · schedule fetch ${data.scheduleFetchedAt ? new Date(data.scheduleFetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "waiting"}`;
    $("notice").textContent = (data.note || "Live racing prices are indicative. Check the bookmaker's current market and scratchings before making any decision.") + (data.feedErrors?.length ? " Feed warning: " + data.feedErrors.map(x => x.feed + ": " + x.message).join(" · ") : "");
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    $("feedStatus").textContent = "FEED ERROR";
    $("notice").textContent = `${err.message}. If using live mode, check your server .env API key and provider access.`;
    $("notice").classList.remove("hidden");
    if (!state.races.length) $("raceList").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  } finally { state.loading = false; $("refreshBtn").disabled = false; }
}
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); state.filter=btn.dataset.filter; render();
}));
$("search").addEventListener("input",e=>{state.search=e.target.value;render();});
$("sort").addEventListener("change",e=>{state.sort=e.target.value;render();});
$("refreshBtn").addEventListener("click",loadRaces);
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "History unavailable");
    const s = data.summary;
    $("histRaces").textContent = s.races;
    $("histWins").textContent = s.wins;
    $("histRate").textContent = s.strikeRate == null ? "—" : s.strikeRate + "%";
    $("histPending").textContent = s.pending;
    const codeText = x => x.races ? `${x.wins}/${x.races} wins · ${x.strikeRate}%` : "No settled races yet";
    $("horseRecord").textContent = codeText(s.horse);
    $("dogRecord").textContent = codeText(s.greyhound);
    const rows = (data.picks || []).slice(0,12);
    $("historyRows").innerHTML = rows.length ? rows.map(p => {
      const status = p.status === "final" ? (p.favouriteWon ? '<span class="won">WON</span>' : '<span class="lost">LOST</span>') : '<span class="pending">PENDING</span>';
      return `<div class="history-row"><div><b>${esc(p.venue)}</b><div class="muted">${p.category==="horse"?"Horse":"Greyhound"} ${p.raceNumber ? "R"+p.raceNumber : ""}</div></div><div>${esc(p.runnerName)}<div class="muted">$ ${Number(p.selectedOdds).toFixed(2)} · ${esc(p.priceSource)} · ${p.quoteCount == null ? "quote count unavailable (older record)" : Number(p.quoteCount)+" quote"+(Number(p.quoteCount)===1?"":"s")}</div></div><div>${p.winnerName ? "Winner: "+esc(p.winnerName) : "Awaiting result"}</div><div>${status}</div></div>`;
    }).join("") : '<div class="empty">No saved picks yet. Keep the live dashboard running to record upcoming favourites.</div>';
  } catch (e) { $("historyRows").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function loadMarketHistory() {
  try {
    const res = await fetch("/api/market-history");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Market history unavailable");
    $("marketRaces").textContent = data.racesTracked ?? 0;
    $("marketSnapshots").textContent = data.total ?? 0;
    $("marketCaptured").textContent = data.capturedAt ? new Date(data.capturedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "Waiting";
    const rows = (data.snapshots || []).slice(0,15);
    $("marketHistoryRows").innerHTML = rows.length ? rows.map(x => {
      const fav = x.favourite;
      const when = new Date(x.capturedAt).toLocaleString("en-AU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Australia/Brisbane"});
      const price = fav ? "$"+Number(fav.price).toFixed(2)+" · "+esc(fav.priceSource) : "Waiting for odds";
      const runners = (x.runners || []).length;
      return `<div class="history-row"><div><b>${esc(x.venue)} ${x.raceNumber ? "R"+esc(x.raceNumber) : ""}</b><div class="muted">${x.category==="horse"?"Horse":"Greyhound"} · ${esc(when)}</div></div><div>${fav ? esc(fav.name) : "No favourite yet"}<div class="muted">${price}</div></div><div>${x.quoteCount} bookmaker quotes<div class="muted">${runners} runners recorded</div></div><div><span class="pending">${x.status==="priced"?"SNAPSHOT":"WAITING"}</span></div></div>`;
    }).join("") : '<div class="empty">No market changes captured yet. The archive fills as the live feed updates.</div>';
  } catch (e) { $("marketHistoryRows").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function syncHistory() {
  const btn = $("syncHistoryBtn"); btn.disabled = true; btn.textContent = "Updating…";
  try {
    const res = await fetch("/api/history/sync",{method:"POST"});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not update results");
    await loadHistory();
    btn.textContent = `Updated · ${data.settled} settled · ${data.unmatched} unmatched`;
  } catch (e) { btn.textContent = "Update failed"; $("notice").textContent = e.message; $("notice").classList.remove("hidden"); }
  setTimeout(()=>{btn.disabled=false;btn.textContent="↻ Update results";},3500);
}
$("syncHistoryBtn").addEventListener("click",syncHistory);
function tick(){ $("clock").textContent = new Date().toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false}); }
tick(); setInterval(tick,1000);
loadRaces();
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,5000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
