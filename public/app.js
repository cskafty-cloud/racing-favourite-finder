const state = { races: [], filter: "all", search: "", sort: "odds", loading: false, sports: [], allSportsLoaded: false, selectedSport: null, sportEvents: [], sportsByKey: {}, sportTrendPrices: {}, sportTrendAlerts: [], sportsMode: false };
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
function isBetfairQuote(q) { return /betfair|exchange/i.test(String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"")); }
function fixedRunnerPrices(runner) { return runnerPrices(runner).filter(q=>!isBetfairQuote(q)); }
function runnerFixedOdds(runner) {
 const ps=fixedRunnerPrices(runner).filter(q=>!q.stale&&(q.age_seconds==null||Number(q.age_seconds)<180)).map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
 return ps.length?ps[Math.floor((ps.length-1)/2)]:null;
}
function exchangeRunnerPrice(runner) {
 const q=runnerPrices(runner).filter(isBetfairQuote).sort((a,b)=>Number(a.win_price??a.win??a.price)-Number(b.win_price??b.win??b.price))[0];
 return q?Number(q.win_price??q.win??q.price):null;
}
function bookmakerFavourite(race, wantedKey) {
  const candidates = (race.runners || []).map(runner => {
    const quote = fixedRunnerPrices(runner).find(q => bookmakerKeyForLink(q)===wantedKey);
    if (!quote) return null;
    return {name:runner.name || runner.runner_name || runner.horse_name || runner.greyhound_name || "Runner",
      number:runner.number ?? runner.runner_number ?? null,
      price:Number(quote.win_price ?? quote.win ?? quote.price),
      age:quote.age_seconds, stale:!!quote.stale,url:BOOKMAKER_URLS[wantedKey]};
  }).filter(x => x && Number.isFinite(x.price) && x.price > 1);
  return candidates.sort((a,b)=>a.price-b.price)[0] || null;
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">$ ${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div><a class="bookmaker-market-link" href="${favourite.url}" target="_blank" rel="noopener noreferrer">Open ${label.replace(" favourite","")} ↗</a>` : `<div class="book-fav-missing">No current ${label.toLowerCase().replace(" favourite","")} quote in the connected feed. Open the bookmaker site to check its current market.</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/"};
function bookmakerKeyForLink(q){
 const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(raw.includes("sportsbet"))return "sportsbet";
 if(raw.includes("bet365"))return "bet365";
 return raw;
}
function allBookmakerFavourites(race) {
  const books=new Map();
  for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) {
    const key=bookmakerKeyForLink(q);
    const price=Number(q.win_price??q.win??q.price), age=q.age_seconds==null?null:Number(q.age_seconds);
    if(!["sportsbet","bet365"].includes(key)||!Number.isFinite(price)||price<=1||q.stale===true||(age!=null&&age>=180)) continue;
    const current=books.get(key);
    if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",
      name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||'Runner',
      number:runner.number??runner.runner_number??null,price,age,url:BOOKMAKER_URLS[key]});
  }
  return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker));
}
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+'. ':'')+f.name;
  const age=f.age==null?'Quote age unavailable':'Quote age '+Math.round(f.age)+'s';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(f.bookmaker)+'</div><div class="book-fav-runner">'+esc(runner)+'</div><div class="book-fav-price">function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=q.age_seconds==null?null:Number(q.age_seconds);
      if(!key||seen.has(key)||q.stale===true||(age!=null&&Number.isFinite(age)&&age>=180))return false;
      seen.add(key);return true;
    });
    const prices=quotes.map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1);
    const consensus=median(prices);if(consensus==null)return null;
    const spread=prices.length>1?(Math.max(...prices)-Math.min(...prices))/consensus:1;
    return {...r,consensus,quoteCount:quotes.length,spreadPct:+(spread*100).toFixed(1),priceSource:quotes.length>1?"multi-bookmaker median":"single-bookmaker price"};
  }).filter(Boolean).sort((x,y)=>x.consensus-y.consensus);
  const fav=runners[0];if(!fav)return null;
  const second=runners[1],gap=second?Math.max(0,(1/fav.consensus-1/second.consensus)/(1/fav.consensus)):0;
  fav.gapPct=+(gap*100).toFixed(1);
  fav.signalScore=Math.round(Math.min(40,fav.quoteCount/3*40)+Math.max(0,30*(1-(fav.spreadPct/100)/0.35))+Math.min(30,gap/0.15*30));
  fav.signalLabel=fav.quoteCount>=3&&fav.signalScore>=65?"STRONG SIGNAL":fav.signalScore>=45?"CAUTION":"NO BET · WEAK SIGNAL";
  return fav;
}
function categoryOf(r) {
  const c = String(r.race_type || r.raceType || r.race_code || r.code || r.category || r.sport || r.type || "").toLowerCase().trim().replace(/[ _-]+/g,"");
  if (c === "h" || c.includes("harness") || c.includes("trotting") || c.includes("pacing")) return "harness";
  if (c === "g" || c.includes("grey") || c.includes("dog")) return "greyhound";
  return "horse";
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
  const bet365Fav = bookmakerFavourite(r,"bet365");
  const bookFavourites = allBookmakerFavourites(r);
  const type = categoryOf(r);
  const venue = r.venue || r.track_name || r.venue_canonical || "Track TBA";
  const number = r.race_number ? `R${r.race_number}` : "Race";
  const country = r.country || "Country pending";
  const marketState = live ? "IN PLAY" : (r.market_status || (r.tote_only ? "TOTE ONLY" : (fav ? "ODDS AVAILABLE" : "SCHEDULED · NO ODDS YET")));
  const date = fmtDate(r.start_time);
  const time = fmtTime(r.start_time);
  const price = fav ? Number(fav.consensus).toFixed(2) : "—";
  const mins = Math.max(0,Math.ceil((new Date(r.start_time).getTime()-Date.now())/60000));
  const runnerOdds = (r.runners || []).slice().sort((a,b)=>(runnerFixedOdds(a)??999)-(runnerFixedOdds(b)??999)).map((runner,rank) => {
    const quotes = fixedRunnerPrices(runner).map(q => ({
      name:q.bookmaker||q.bookmaker_name||q.name||q.site||q.key||'Bookmaker',
      price:Number(q.win_price??q.win??q.price), age:q.age_seconds??null, stale:!!q.stale,
      url:q.source_link||q.source_url||q.url||null
    })).filter(q=>Number.isFinite(q.price)&&q.price>1)
      .sort((a,b)=>a.name.localeCompare(b.name)||a.price-b.price);
    const fresh=quotes.filter(q=>!q.stale&&(q.age==null||!Number.isFinite(Number(q.age))||Number(q.age)<180));
    const values=fresh.map(q=>q.price).sort((a,b)=>a-b);
    const mid=values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):null;
    const runnerName=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
    const exchangePrice=exchangeRunnerPrice(runner);
    const exchangeHtml=exchangePrice?'<span class="exchange-quote"><b>Betfair Exchange</b> <strong>'+exchangePrice.toFixed(2)+'</strong></span>':"";
    const estimate=mid==null
      ? '<span class="market-estimate unavailable">Estimate unavailable · no fresh live quotes</span>'
      : '<span class="market-estimate">Market estimate $'+mid.toFixed(2)+' · median of '+fresh.length+' fresh quote'+(fresh.length===1?'':'s')+'</span>';
    const quoteHtml=quotes.length?quotes.map(q=>`<span class="bookmaker-quote ${q.stale||(q.age!=null&&Number(q.age)>=180)?"stale-quote":""}"><b>${esc(q.name)}</b> <strong>${q.price.toFixed(2)}</strong><small>${q.age==null?"age n/a":Math.round(Number(q.age))+"s old"}${q.stale||(q.age!=null&&Number(q.age)>=180)?" · STALE":""}</small>${q.url && /^https?:\/\//i.test(q.url) ? ` <a class="bet-link" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">Open site ↗</a>` : ""}</span>`).join(""):'<span class="no-odds">MISSING PRICE · no bookmaker quote returned for this runner</span>';
    return `<div class="odds-runner ${quotes.length?'':'missing-runner-price'}"><span class="odds-runner-name">#${rank+1} · ${esc(runner.number ?? runner.runner_number ?? "")}${runner.number || runner.runner_number ? ". " : ""}${esc(runnerName)}</span>${estimate}<div class="bookmaker-prices">${quoteHtml}${exchangeHtml}</div></div>`;
  }).join("");
  return `<article class="race-card ${live?"live-race-card":""}">
    <div><div class="race-type">${type==="horse"?"🐎 HORSE RACING":type==="harness"?"🏇 HARNESS RACING":"🐕 GREYHOUND RACING"}</div>
      <div class="race-title">${esc(venue)} <span style="color:#728395">${number}</span></div>
      <div class="race-meta">${esc(country)} · ${date} ${r.distance_m ? "· "+r.distance_m+"m" : ""}</div>
      <div class="race-time">${time}</div></div>
    <div>${fav ? `<div class="favourite-label">★ MARKET FAVOURITE · ${esc(fav.signalLabel)}</div><div class="runner-name">${esc(fav.number ? fav.number+". " : "")}${esc(fav.name)}</div><div class="runner-sub">${fav.quoteCount} independent bookmaker quotes · ${esc(fav.priceSource)} · ${fav.signalScore}/100 signal · ${fav.spreadPct}% price spread · ${fav.gapPct}% gap to next runner</div>` : `<div class="favourite-label">★ RACE FAVOURITE · WAITING FOR ODDS</div><div class="runner-name">No current win prices</div><div class="runner-sub">Waiting for bookmaker odds</div>`}</div>
    <div class="price-wrap"><div class="price">${fav ? "$"+price : "—"}</div><div class="price-caption">${fav ? esc(fav.priceSource) : "MARKET PRICE"}</div><div class="bet365">${bookFavourites.length+" bookmaker"+(bookFavourites.length===1?"":"s")+" priced"}</div></div>
    <div class="market-tag ${live?"soon-tag":""}">${live ? "IN PLAY" : (mins===0?"STARTING NOW":`IN ${mins} MIN`)}</div>
    <div class="bookmaker-favourites">${favouritePanel("Bet365 favourite",bet365Fav)}${bookFavourites.length?bookFavourites.map(allBookFavouritePanel).join(""):'<div class="book-fav-missing">No current bookmaker win prices returned for this race. Bet365 is shown only when the connected free feed supplies its quote.</div>'}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
    <div class="all-bookmaker-odds"><div class="odds-heading">LIVE BOOKMAKER PRICES <span>Missing prices shown · estimates use fresh live quotes only</span></div>${runnerOdds || '<div class="no-odds">Waiting for current bookmaker prices.</div>'}</div>
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
function sportFavourite(event, wantedBookmaker){
 const aliases={sportsbet:["sportsbet","sportsbetau","sportsbetcomau"],bet365:["bet365","bet365au","bet365comau"]};
 const wanted=aliases[wantedBookmaker]||null, prices=new Map();
 for(const b of event.bookmakers||[]){
  const bk=String(b.key||b.title||b.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(wanted&&!wanted.includes(bk))continue;
  for(const m of b.markets||[]) if(["h2h","head_to_head"].includes(String(m.key||"").toLowerCase())) for(const o of m.outcomes||[]){const p=Number(o.price);if(p>1){if(!prices.has(o.name))prices.set(o.name,[]);prices.get(o.name).push(p);}}
 }
 return [...prices.entries()].map(([name,v])=>{v.sort((a,b)=>a-b);return {name,price:v[Math.floor((v.length-1)/2)],books:v.length};}).sort((a,b)=>a.price-b.price)[0]||null;
}
function sportRankings(event) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) for(const market of book.markets||[]) {
  if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase())) continue;
  for(const o of market.outcomes||[]) {const p=Number(o.price);if(p>1){if(!prices.has(o.name))prices.set(o.name,[]);prices.get(o.name).push(p);}}
 }
 const rows=[...prices.entries()].map(([name,values])=>{values.sort((a,b)=>a-b);const mid=values[Math.floor((values.length-1)/2)];return {name,price:mid,books:values.length,spread:values.length>1?(values[values.length-1]-values[0])/mid:1};}).sort((a,b)=>a.price-b.price);
 if(rows.length){const gap=rows[1]?Math.max(0,(1/rows[0].price-1/rows[1].price)/(1/rows[0].price)):0;rows[0].score=Math.round(Math.min(40,rows[0].books/3*40)+Math.max(0,30*(1-rows[0].spread/.35))+Math.min(30,gap/.15*30));}
 return rows;
}
function renderTopTips() {
 const el=$("bestTipsList");if(!el)return;
 const tips=[];
 for(const r of state.races||[]) {const fav=marketFavourite(r);if(!fav)continue;tips.push({kind:"RACING",category:categoryOf(r).toUpperCase(),event:(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore,source:fav.priceSource,time:r.start_time});}
 for(const e of state.sportEvents||[]) {const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0];tips.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+" @ "+(e.home_team||""),selection:f.name,odds:f.price,score:f.score||0,source:f.books+" bookmaker quotes",time:e.commence_time});}
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=tips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const ranked=(todays.length?todays:tips).sort((a,b)=>b.score-a.score||a.odds-b.odds).slice(0,8);
 el.innerHTML=ranked.length?ranked.map((t,i)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(t.kind)+' · '+esc(t.category)+'</span></div><div>'+esc(t.event)+' · '+esc(t.time?fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed bookmaker odds: <strong>$'+t.odds.toFixed(2)+'</strong> · signal score '+t.score+'/100</div><small>'+esc(t.source)+' · ranked by price agreement, market spread and favourite gap. Not a guaranteed tip.</small></article>').join(""):'<div class="empty">No fresh fixed bookmaker odds available yet for today’s shortlist.</div>';
}
function recordSportTrends(key, events){
 const now=Date.now();
 for(const e of events){
  const fav=sportFavourite(e);if(!fav)continue;
  const id=String(e.id||e.event_id||[e.home_team,e.away_team,e.commence_time].join("|"));
  const k=key+"|"+id, old=state.sportTrendPrices[k];
  if(old&&old.name===fav.name){
   const pct=(fav.price-old.price)/old.price*100;
   if(Math.abs(pct)>=5){
    state.sportTrendAlerts.unshift({sport:key,event:(e.away_team||"")+" @ "+(e.home_team||""),runner:fav.name,from:old.price,to:fav.price,pct,at:now});
    state.sportTrendAlerts=state.sportTrendAlerts.slice(0,30);
   }
  }
  state.sportTrendPrices[k]={name:fav.name,price:fav.price,at:now};
 }
 renderSportTrends();
}
function renderSportTrends(){
 const el=$("sportsTrends");if(!el)return;
 el.innerHTML=state.sportTrendAlerts.length?state.sportTrendAlerts.map(a=>'<div class="trend-alert"><span class="trend-tag">'+(a.pct<0?"SHORTENING":"DRIFTING")+'</span><div><b>'+esc(a.sport)+' · '+esc(a.event)+'</b><small>'+esc(a.runner)+' · '+a.from.toFixed(2)+' → '+a.to.toFixed(2)+' ('+(a.pct>0?"+":"")+a.pct.toFixed(1)+'%) · '+new Date(a.at).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+'</small></div></div>').join(""):'<div class="empty compact-empty">No 5%+ favourite price movements detected in the returned snapshots yet.</div>';
}

async function loadSportResults(sportId){
 const notice=$("sportResultsNotice"),list=$("sportResults");
 if(!notice||!list)return;
 notice.textContent="Loading latest Bet365 results…";
 try{
  const r=await fetch("/api/sports/results?sport_id="+encodeURIComponent(sportId||1)),d=await r.json();
  if(!r.ok)throw Error(d.error||"Results feed unavailable");
  const when=d.fetchedAt?new Date(d.fetchedAt).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"time unavailable";
  notice.textContent=(d.results||[]).length+" completed fixtures · "+d.provider+" · checked "+when;
  list.innerHTML=(d.results||[]).length?d.results.map(x=>{
   const score=x.score||"Final score unavailable";
   const scoreRows=x.scores?Object.entries(x.scores).map(([period,v])=>'<span>Period '+esc(period)+': '+esc(v.home||"—")+'-'+esc(v.away||"—")+'</span>').join(" · "):"";
   return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(x.home_team)+' v '+esc(x.away_team)+'</b><span class="sport-upcoming-label">FINISHED</span></div>'+(x.league?'<div class="sport-league">'+esc(x.league)+'</div>':"")+'<div class="sport-live-score">FINAL SCORE: <b>'+esc(score)+'</b></div>'+(scoreRows?'<div class="sport-start-info">'+scoreRows+'</div>':"")+'<small>Source: '+esc(x.provider)+' · '+esc(x.updatedAt?new Date(x.updatedAt).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"update time unavailable")+'</small></article>';
  }).join(""):'<div class="empty">No completed fixtures were returned for this sport today.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}
function renderSports(){
 $("sportsCatalogue").innerHTML=state.sports.map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=state.sportEvents.slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||(sportRankings(a)[0]?.price??999)-(sportRankings(b)[0]?.price??999)||new Date(a.commence_time||0)-new Date(b.commence_time||0));
 $("sportsEvents").innerHTML=events.length?events.map(e=>{
  const f=sportFavourite(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),t=e.commence_time||"";
  const rankedOutcomes=sportRankings(e);
  const rankedHtml=rankedOutcomes.length?'<div class="sport-favourite">ALL TEAMS / OUTCOMES · LOWEST ODDS FIRST</div><div class="sport-ranked-outcomes">'+rankedOutcomes.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+x.price.toFixed(2)+'</b> · '+x.books+' quotes</span>').join("")+'</div>':"";
  const startMs=t?new Date(t).getTime():NaN,mins=Number.isFinite(startMs)?Math.max(0,Math.floor((startMs-Date.now())/60000)):null;
  const startsIn=mins===null?"Start time unavailable":mins<1?"Starting now":mins<60?"Starts in "+mins+" min": "Starts in "+Math.floor(mins/60)+"h "+(mins%60)+"m";
  const startLabel=t?new Date(t).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true})+" AEST":"Start time TBA";
  const books=(e.bookmakers||[]).filter(b=>(b.markets||[]).some(m=>(m.outcomes||[]).some(o=>Number(o.price)>1)));
  const bookFavourites=books.map(book=>{
   const market=(book.markets||[]).find(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const best=(market?.outcomes||[]).filter(o=>Number(o.price)>1).sort((a,b)=>Number(a.price)-Number(b.price))[0];
   return best?'<span class="sport-book-fav"><b>'+esc(book.key||book.name||book.title||"Bookmaker")+'</b>: '+esc(best.name)+' <strong>$'+Number(best.price).toFixed(2)+'</strong></span>':"";
  }).filter(Boolean).join("");
  const allBooks=books.map(book=>{
   const markets=(book.markets||[]).map(m=>{
    const outcomes=(m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>'<span class="sport-outcome">'+esc(o.name)+' <strong>$'+Number(o.price).toFixed(2)+'</strong>'+(o.point!=null?' ('+esc(o.point)+')':"")+'</span>').join(" · ");
    return outcomes?'<div class="live-market"><small>'+esc(m.key||"Market")+'</small><div>'+outcomes+'</div></div>':"";
   }).join("");
   return '<div class="live-bookmaker"><b>'+esc(book.key||book.name||book.title||"Bookmaker")+'</b>'+(book.last_update?'<small>Updated '+esc(new Date(book.last_update).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"}))+' AEST</small>':"")+markets+'</div>';
  }).join("");
  const marketFav=f?'<b>'+esc(f.name)+'</b> at <strong>$'+f.price.toFixed(2)+'</strong> (best market consensus)':'Waiting for bookmaker odds';
  const sbText=sb?esc(sb.name)+' $'+sb.price.toFixed(2):"No Sportsbet quote returned";
  const b365Text=b365?esc(b365.name)+' $'+b365.price.toFixed(2):"No Bet365 quote returned";
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures with returned odds for this sport. Select another sport or refresh later.</div>';
 renderSportTrends();renderTopTips();
}
function liveScoreText(side){
 if(!side)return "—";
 const parts=Object.entries(side).filter(([k,v])=>k!=="team"&&v!=null).map(([k,v])=>k==="points"?"PTS "+v:k.charAt(0).toUpperCase()+k.slice(1)+" "+v);
 return parts.join(" · ")||"—";
}
async function loadLiveSports(){
 const notice=$("liveSportsNotice"),list=$("liveSportsEvents");
 try{
  const r=await fetch("/api/live-sports"),d=await r.json();
  if(!r.ok)throw Error(d.error||"Live sports feed unavailable");
  const fetched=d.resultsFetchedAt?new Date(d.resultsFetchedAt):null;
  const age=d.ageSeconds==null?"waiting":Math.round(d.ageSeconds/60)+"m old";
  notice.textContent=(d.events.length+" confirmed live fixtures · "+(d.bookmakers||[]).length+" bookmaker feeds requested · scores checked "+(fetched?fetched.toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"waiting")+" · "+age+". "+(d.note||""));
  list.innerHTML=d.events.length?d.events.map(e=>{
   const books=(e.bookmakerFavourites||[]).filter(x=>x.favourite);
   const favs=books.map(x=>'<span>'+esc(x.bookmaker)+': <b>'+esc(x.favourite.name)+' '+Number(x.favourite.price).toFixed(2)+'</b></span>').join("");
   const all=(e.bookmakers||[]).map(book=>{
    const markets=(book.markets||[]).map(m=>'<div class="live-market"><b>'+esc(m.key||"Market")+'</b> '+(m.outcomes||[]).map(o=>esc(o.name)+' <strong>'+Number(o.price).toFixed(2)+'</strong>').join(" · ")+'</div>').join("");
    return '<div class="live-bookmaker"><b>'+esc(book.name)+'</b><small>'+(book.lastUpdate?"Updated "+esc(new Date(book.lastUpdate).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})):"Update time unavailable")+'</small>'+markets+'</div>';
   }).join("");
   const score=e.score?'<div class="live-score"><b>'+esc(e.home)+': '+esc(liveScoreText(e.score.home))+'</b><br><b>'+esc(e.away)+': '+esc(liveScoreText(e.score.away))+'</b></div>':'<div class="live-score">Live score not supplied</div>';
   const period=(e.score?.periodState||[]).filter(x=>x&&!x.completed).map(x=>"Period "+x.period+(x.half?" · "+x.half:"")).join(" · ");
   const providerLinks='<div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div>';
    return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div>'+providerLinks+'<details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">'+esc(d.error||"No confirmed in-play fixtures are being returned by the live results feed right now.")+'</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();loadSportResults(1);if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);const resultSportId=Number(String(key).replace("oddsdata_",""));if(Number.isFinite(resultSportId)&&resultSportId>0)loadSportResults(resultSportId);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"");
 renderSports();
 }catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  for(const s of state.sports){state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/sports/"+encodeURIComponent(s.key)),d=await r.json();
   if(!r.ok)continue;const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
  }
  state.selectedSport=null;state.allSportsLoaded=true;state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();$("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming fixtures across "+Object.keys(state.sportsByKey).length+" sports. Feed updates follow provider cache timing.";
 }catch(e){$("sportsNotice").textContent=e.message;}
 finally{btn.disabled=false;}
}
function setMainView(view){
 state.sportsMode=view==="sports";document.body.classList.toggle("sports-mode",state.sportsMode);
 document.querySelectorAll(".main-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
 if(state.sportsMode)loadSports();
}
function render() {
  const rows = filteredRaces().filter(r => {
    const t = new Date(r.start_time).getTime();
    return isExplicitlyLive(r) || !Number.isFinite(t) || t >= Date.now();
  }).sort((a,b) => {
    if(state.sort==="odds") return (marketFavourite(a)?.consensus??999)-(marketFavourite(b)?.consensus??999)||Date.parse(a.start_time||0)-Date.parse(b.start_time||0);
    const ta=Date.parse(a.start_time||"");
    const tb=Date.parse(b.start_time||"");
    if(!Number.isFinite(ta)) return 1;
    if(!Number.isFinite(tb)) return -1;
    return ta-tb;
  });
  const live=rows.filter(isExplicitlyLive);
  const upcoming=rows.filter(r=>!isExplicitlyLive(r));
  $("raceCount").textContent=rows.length;
  $("horseCount").textContent=rows.filter(r=>categoryOf(r)==="horse").length;
  $("dogCount").textContent=rows.filter(r=>categoryOf(r)==="greyhound").length;
  $("harnessCount").textContent=rows.filter(r=>categoryOf(r)==="harness").length;
  const rowHtml=(r,isLive)=>{
    const type=categoryOf(r);
    const venue=r.venue||r.track_name||r.venue_canonical||"Track TBA";
    const number=r.race_number||r.race_no||r.raceNumber||"—";
    const date=r.start_time?fmtDate(r.start_time):"Date/time TBA";
    const time=r.start_time?fmtTime(r.start_time):"Jump time TBA";
    const fav=marketFavourite(r);
    const favName=fav?(fav.name||fav.runner_name||fav.horse_name||fav.greyhound_name||"Runner"):"";
    const bookFavourites=allBookmakerFavourites(r);
    const favPanel=fav
      ? '<div class="race-list-favourite"><div class="favourite-label">★ RACE FAVOURITE · SHORTEST FIXED ODDS</div><b>'+(fav.number?esc(fav.number)+'. ':"")+esc(favName)+'</b><strong>$'+Number(fav.consensus).toFixed(2)+'</strong><small>'+esc(fav.signalLabel||"Market favourite")+' · '+(fav.quoteCount||0)+' bookmaker quotes</small></div>'
      : '<div class="race-list-favourite"><div class="favourite-label">★ RACE FAVOURITE</div><b>Waiting for current bookmaker odds</b></div>';
    const runners=(r.runners||[]).slice().sort((a,b)=>(runnerFixedOdds(a)??999)-(runnerFixedOdds(b)??999));
    const runnerRows=runners.map((runner,rank)=>{
      const qs=fixedRunnerPrices(runner).map(q=>({book:q.bookmaker||q.bookmaker_name||q.name||q.site||q.key||"Bookmaker",price:Number(q.win_price??q.win??q.price),age:q.age_seconds==null?null:Number(q.age_seconds),stale:!!q.stale}))
        .filter(q=>Number.isFinite(q.price)&&q.price>1).sort((a,b)=>a.price-b.price);
      const fresh=qs.filter(q=>!q.stale&&(q.age==null||!Number.isFinite(q.age)||q.age<180));
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||(q.age!=null&&q.age>=180)?' · STALE':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bet365Fav=bookmakerFavourite(r,"bet365");
    const sportsbetFav=bookmakerFavourite(r,"sportsbet");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · live quotes only</b>'+favouritePanel("Bet365 favourite",bet365Fav)+favouritePanel("Sportsbet favourite",sportsbetFav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div></div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>';
  renderTopTips();
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
    const feedMeta=data.feedMeta||{}; const books=(data.providerBookmakers||[]).length; const cap=feedMeta.truncated?` · PROVIDER LIMIT: ${feedMeta.limit||"tier cap"} of ${feedMeta.total_matched||"more"} records returned`:""; $("feedFreshness").textContent = `Screen refresh: 60s (display only) · ${books} bookmaker feeds with prices in this response · ${data.scope||"provider coverage"} · provider tier: ${esc(data.providerPlan||"not reported")}${cap} · price freshness varies by bookmaker; check each quote age · last feed fetch ${data.oddsFetchedAt?new Date(data.oddsFetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"waiting"}`;
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
$("sportsCatalogue").addEventListener("click",e=>{const b=e.target.closest("[data-sport]");if(b)loadSportOdds(b.dataset.sport);});
$("loadAllSportsBtn").addEventListener("click",loadAllSports);
$("refreshLiveSportsBtn").addEventListener("click",loadLiveSports);
document.querySelectorAll(".main-tab").forEach(b=>b.addEventListener("click",()=>setMainView(b.dataset.view)));
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
      const price = fav ? "$"+Number(fav.price).toFixed(2)+" · "+esc(fav.priceSource)+" · "+esc(fav.signalLabel||"") : "Waiting for odds";
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
loadSports();
loadLiveSports();
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+f.price.toFixed(2)+'</div><div class="book-fav-age">'+age+' · shortest returned quote for this bookmaker</div><a class="bookmaker-market-link" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(f.bookmaker)+' market ↗</a></div>';
}
function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=q.age_seconds==null?null:Number(q.age_seconds);
      if(!key||seen.has(key)||q.stale===true||(age!=null&&Number.isFinite(age)&&age>=180))return false;
      seen.add(key);return true;
    });
    const prices=quotes.map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1);
    const consensus=median(prices);if(consensus==null)return null;
    const spread=prices.length>1?(Math.max(...prices)-Math.min(...prices))/consensus:1;
    return {...r,consensus,quoteCount:quotes.length,spreadPct:+(spread*100).toFixed(1),priceSource:quotes.length>1?"multi-bookmaker median":"single-bookmaker price"};
  }).filter(Boolean).sort((x,y)=>x.consensus-y.consensus);
  const fav=runners[0];if(!fav)return null;
  const second=runners[1],gap=second?Math.max(0,(1/fav.consensus-1/second.consensus)/(1/fav.consensus)):0;
  fav.gapPct=+(gap*100).toFixed(1);
  fav.signalScore=Math.round(Math.min(40,fav.quoteCount/3*40)+Math.max(0,30*(1-(fav.spreadPct/100)/0.35))+Math.min(30,gap/0.15*30));
  fav.signalLabel=fav.quoteCount>=3&&fav.signalScore>=65?"STRONG SIGNAL":fav.signalScore>=45?"CAUTION":"NO BET · WEAK SIGNAL";
  return fav;
}
function categoryOf(r) {
  const c = String(r.race_type || r.raceType || r.race_code || r.code || r.category || r.sport || r.type || "").toLowerCase().trim().replace(/[ _-]+/g,"");
  if (c === "h" || c.includes("harness") || c.includes("trotting") || c.includes("pacing")) return "harness";
  if (c === "g" || c.includes("grey") || c.includes("dog")) return "greyhound";
  return "horse";
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
  const bet365Fav = bookmakerFavourite(r,"bet365");
  const bookFavourites = allBookmakerFavourites(r);
  const type = categoryOf(r);
  const venue = r.venue || r.track_name || r.venue_canonical || "Track TBA";
  const number = r.race_number ? `R${r.race_number}` : "Race";
  const country = r.country || "Country pending";
  const marketState = live ? "IN PLAY" : (r.market_status || (r.tote_only ? "TOTE ONLY" : (fav ? "ODDS AVAILABLE" : "SCHEDULED · NO ODDS YET")));
  const date = fmtDate(r.start_time);
  const time = fmtTime(r.start_time);
  const price = fav ? Number(fav.consensus).toFixed(2) : "—";
  const mins = Math.max(0,Math.ceil((new Date(r.start_time).getTime()-Date.now())/60000));
  const runnerOdds = (r.runners || []).slice().sort((a,b)=>(runnerFixedOdds(a)??999)-(runnerFixedOdds(b)??999)).map((runner,rank) => {
    const quotes = fixedRunnerPrices(runner).map(q => ({
      name:q.bookmaker||q.bookmaker_name||q.name||q.site||q.key||'Bookmaker',
      price:Number(q.win_price??q.win??q.price), age:q.age_seconds??null, stale:!!q.stale,
      url:q.source_link||q.source_url||q.url||null
    })).filter(q=>Number.isFinite(q.price)&&q.price>1)
      .sort((a,b)=>a.name.localeCompare(b.name)||a.price-b.price);
    const fresh=quotes.filter(q=>!q.stale&&(q.age==null||!Number.isFinite(Number(q.age))||Number(q.age)<180));
    const values=fresh.map(q=>q.price).sort((a,b)=>a-b);
    const mid=values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):null;
    const runnerName=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
    const exchangePrice=exchangeRunnerPrice(runner);
    const exchangeHtml=exchangePrice?'<span class="exchange-quote"><b>Betfair Exchange</b> <strong>'+exchangePrice.toFixed(2)+'</strong></span>':"";
    const estimate=mid==null
      ? '<span class="market-estimate unavailable">Estimate unavailable · no fresh live quotes</span>'
      : '<span class="market-estimate">Market estimate $'+mid.toFixed(2)+' · median of '+fresh.length+' fresh quote'+(fresh.length===1?'':'s')+'</span>';
    const quoteHtml=quotes.length?quotes.map(q=>`<span class="bookmaker-quote ${q.stale||(q.age!=null&&Number(q.age)>=180)?"stale-quote":""}"><b>${esc(q.name)}</b> <strong>${q.price.toFixed(2)}</strong><small>${q.age==null?"age n/a":Math.round(Number(q.age))+"s old"}${q.stale||(q.age!=null&&Number(q.age)>=180)?" · STALE":""}</small>${q.url && /^https?:\/\//i.test(q.url) ? ` <a class="bet-link" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">Open site ↗</a>` : ""}</span>`).join(""):'<span class="no-odds">MISSING PRICE · no bookmaker quote returned for this runner</span>';
    return `<div class="odds-runner ${quotes.length?'':'missing-runner-price'}"><span class="odds-runner-name">#${rank+1} · ${esc(runner.number ?? runner.runner_number ?? "")}${runner.number || runner.runner_number ? ". " : ""}${esc(runnerName)}</span>${estimate}<div class="bookmaker-prices">${quoteHtml}${exchangeHtml}</div></div>`;
  }).join("");
  return `<article class="race-card ${live?"live-race-card":""}">
    <div><div class="race-type">${type==="horse"?"🐎 HORSE RACING":type==="harness"?"🏇 HARNESS RACING":"🐕 GREYHOUND RACING"}</div>
      <div class="race-title">${esc(venue)} <span style="color:#728395">${number}</span></div>
      <div class="race-meta">${esc(country)} · ${date} ${r.distance_m ? "· "+r.distance_m+"m" : ""}</div>
      <div class="race-time">${time}</div></div>
    <div>${fav ? `<div class="favourite-label">★ MARKET FAVOURITE · ${esc(fav.signalLabel)}</div><div class="runner-name">${esc(fav.number ? fav.number+". " : "")}${esc(fav.name)}</div><div class="runner-sub">${fav.quoteCount} independent bookmaker quotes · ${esc(fav.priceSource)} · ${fav.signalScore}/100 signal · ${fav.spreadPct}% price spread · ${fav.gapPct}% gap to next runner</div>` : `<div class="favourite-label">★ RACE FAVOURITE · WAITING FOR ODDS</div><div class="runner-name">No current win prices</div><div class="runner-sub">Waiting for bookmaker odds</div>`}</div>
    <div class="price-wrap"><div class="price">${fav ? "$"+price : "—"}</div><div class="price-caption">${fav ? esc(fav.priceSource) : "MARKET PRICE"}</div><div class="bet365">${bookFavourites.length+" bookmaker"+(bookFavourites.length===1?"":"s")+" priced"}</div></div>
    <div class="market-tag ${live?"soon-tag":""}">${live ? "IN PLAY" : (mins===0?"STARTING NOW":`IN ${mins} MIN`)}</div>
    <div class="bookmaker-favourites">${favouritePanel("Bet365 favourite",bet365Fav)}${bookFavourites.length?bookFavourites.map(allBookFavouritePanel).join(""):'<div class="book-fav-missing">No current bookmaker win prices returned for this race. Bet365 is shown only when the connected free feed supplies its quote.</div>'}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
    <div class="all-bookmaker-odds"><div class="odds-heading">LIVE BOOKMAKER PRICES <span>Missing prices shown · estimates use fresh live quotes only</span></div>${runnerOdds || '<div class="no-odds">Waiting for current bookmaker prices.</div>'}</div>
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
function sportFavourite(event, wantedBookmaker){
 const aliases={sportsbet:["sportsbet","sportsbetau","sportsbetcomau"],bet365:["bet365","bet365au","bet365comau"]};
 const wanted=aliases[wantedBookmaker]||null, prices=new Map();
 for(const b of event.bookmakers||[]){
  const bk=String(b.key||b.title||b.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(wanted&&!wanted.includes(bk))continue;
  for(const m of b.markets||[]) if(["h2h","head_to_head"].includes(String(m.key||"").toLowerCase())) for(const o of m.outcomes||[]){const p=Number(o.price);if(p>1){if(!prices.has(o.name))prices.set(o.name,[]);prices.get(o.name).push(p);}}
 }
 return [...prices.entries()].map(([name,v])=>{v.sort((a,b)=>a-b);return {name,price:v[Math.floor((v.length-1)/2)],books:v.length};}).sort((a,b)=>a.price-b.price)[0]||null;
}
function sportRankings(event) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) for(const market of book.markets||[]) {
  if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase())) continue;
  for(const o of market.outcomes||[]) {const p=Number(o.price);if(p>1){if(!prices.has(o.name))prices.set(o.name,[]);prices.get(o.name).push(p);}}
 }
 const rows=[...prices.entries()].map(([name,values])=>{values.sort((a,b)=>a-b);const mid=values[Math.floor((values.length-1)/2)];return {name,price:mid,books:values.length,spread:values.length>1?(values[values.length-1]-values[0])/mid:1};}).sort((a,b)=>a.price-b.price);
 if(rows.length){const gap=rows[1]?Math.max(0,(1/rows[0].price-1/rows[1].price)/(1/rows[0].price)):0;rows[0].score=Math.round(Math.min(40,rows[0].books/3*40)+Math.max(0,30*(1-rows[0].spread/.35))+Math.min(30,gap/.15*30));}
 return rows;
}
function renderTopTips() {
 const el=$("bestTipsList");if(!el)return;
 const tips=[];
 for(const r of state.races||[]) {const fav=marketFavourite(r);if(!fav)continue;tips.push({kind:"RACING",category:categoryOf(r).toUpperCase(),event:(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore,source:fav.priceSource,time:r.start_time});}
 for(const e of state.sportEvents||[]) {const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0];tips.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+" @ "+(e.home_team||""),selection:f.name,odds:f.price,score:f.score||0,source:f.books+" bookmaker quotes",time:e.commence_time});}
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=tips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const ranked=(todays.length?todays:tips).sort((a,b)=>b.score-a.score||a.odds-b.odds).slice(0,8);
 el.innerHTML=ranked.length?ranked.map((t,i)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(t.kind)+' · '+esc(t.category)+'</span></div><div>'+esc(t.event)+' · '+esc(t.time?fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed bookmaker odds: <strong>$'+t.odds.toFixed(2)+'</strong> · signal score '+t.score+'/100</div><small>'+esc(t.source)+' · ranked by price agreement, market spread and favourite gap. Not a guaranteed tip.</small></article>').join(""):'<div class="empty">No fresh fixed bookmaker odds available yet for today’s shortlist.</div>';
}
function recordSportTrends(key, events){
 const now=Date.now();
 for(const e of events){
  const fav=sportFavourite(e);if(!fav)continue;
  const id=String(e.id||e.event_id||[e.home_team,e.away_team,e.commence_time].join("|"));
  const k=key+"|"+id, old=state.sportTrendPrices[k];
  if(old&&old.name===fav.name){
   const pct=(fav.price-old.price)/old.price*100;
   if(Math.abs(pct)>=5){
    state.sportTrendAlerts.unshift({sport:key,event:(e.away_team||"")+" @ "+(e.home_team||""),runner:fav.name,from:old.price,to:fav.price,pct,at:now});
    state.sportTrendAlerts=state.sportTrendAlerts.slice(0,30);
   }
  }
  state.sportTrendPrices[k]={name:fav.name,price:fav.price,at:now};
 }
 renderSportTrends();
}
function renderSportTrends(){
 const el=$("sportsTrends");if(!el)return;
 el.innerHTML=state.sportTrendAlerts.length?state.sportTrendAlerts.map(a=>'<div class="trend-alert"><span class="trend-tag">'+(a.pct<0?"SHORTENING":"DRIFTING")+'</span><div><b>'+esc(a.sport)+' · '+esc(a.event)+'</b><small>'+esc(a.runner)+' · '+a.from.toFixed(2)+' → '+a.to.toFixed(2)+' ('+(a.pct>0?"+":"")+a.pct.toFixed(1)+'%) · '+new Date(a.at).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+'</small></div></div>').join(""):'<div class="empty compact-empty">No 5%+ favourite price movements detected in the returned snapshots yet.</div>';
}

async function loadSportResults(sportId){
 const notice=$("sportResultsNotice"),list=$("sportResults");
 if(!notice||!list)return;
 notice.textContent="Loading latest Bet365 results…";
 try{
  const r=await fetch("/api/sports/results?sport_id="+encodeURIComponent(sportId||1)),d=await r.json();
  if(!r.ok)throw Error(d.error||"Results feed unavailable");
  const when=d.fetchedAt?new Date(d.fetchedAt).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"time unavailable";
  notice.textContent=(d.results||[]).length+" completed fixtures · "+d.provider+" · checked "+when;
  list.innerHTML=(d.results||[]).length?d.results.map(x=>{
   const score=x.score||"Final score unavailable";
   const scoreRows=x.scores?Object.entries(x.scores).map(([period,v])=>'<span>Period '+esc(period)+': '+esc(v.home||"—")+'-'+esc(v.away||"—")+'</span>').join(" · "):"";
   return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(x.home_team)+' v '+esc(x.away_team)+'</b><span class="sport-upcoming-label">FINISHED</span></div>'+(x.league?'<div class="sport-league">'+esc(x.league)+'</div>':"")+'<div class="sport-live-score">FINAL SCORE: <b>'+esc(score)+'</b></div>'+(scoreRows?'<div class="sport-start-info">'+scoreRows+'</div>':"")+'<small>Source: '+esc(x.provider)+' · '+esc(x.updatedAt?new Date(x.updatedAt).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"update time unavailable")+'</small></article>';
  }).join(""):'<div class="empty">No completed fixtures were returned for this sport today.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}
function renderSports(){
 $("sportsCatalogue").innerHTML=state.sports.map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=state.sportEvents.slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||(sportRankings(a)[0]?.price??999)-(sportRankings(b)[0]?.price??999)||new Date(a.commence_time||0)-new Date(b.commence_time||0));
 $("sportsEvents").innerHTML=events.length?events.map(e=>{
  const f=sportFavourite(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),t=e.commence_time||"";
  const rankedOutcomes=sportRankings(e);
  const rankedHtml=rankedOutcomes.length?'<div class="sport-favourite">ALL TEAMS / OUTCOMES · LOWEST ODDS FIRST</div><div class="sport-ranked-outcomes">'+rankedOutcomes.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+x.price.toFixed(2)+'</b> · '+x.books+' quotes</span>').join("")+'</div>':"";
  const startMs=t?new Date(t).getTime():NaN,mins=Number.isFinite(startMs)?Math.max(0,Math.floor((startMs-Date.now())/60000)):null;
  const startsIn=mins===null?"Start time unavailable":mins<1?"Starting now":mins<60?"Starts in "+mins+" min": "Starts in "+Math.floor(mins/60)+"h "+(mins%60)+"m";
  const startLabel=t?new Date(t).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true})+" AEST":"Start time TBA";
  const books=(e.bookmakers||[]).filter(b=>(b.markets||[]).some(m=>(m.outcomes||[]).some(o=>Number(o.price)>1)));
  const bookFavourites=books.map(book=>{
   const market=(book.markets||[]).find(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const best=(market?.outcomes||[]).filter(o=>Number(o.price)>1).sort((a,b)=>Number(a.price)-Number(b.price))[0];
   return best?'<span class="sport-book-fav"><b>'+esc(book.key||book.name||book.title||"Bookmaker")+'</b>: '+esc(best.name)+' <strong>$'+Number(best.price).toFixed(2)+'</strong></span>':"";
  }).filter(Boolean).join("");
  const allBooks=books.map(book=>{
   const markets=(book.markets||[]).map(m=>{
    const outcomes=(m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>'<span class="sport-outcome">'+esc(o.name)+' <strong>$'+Number(o.price).toFixed(2)+'</strong>'+(o.point!=null?' ('+esc(o.point)+')':"")+'</span>').join(" · ");
    return outcomes?'<div class="live-market"><small>'+esc(m.key||"Market")+'</small><div>'+outcomes+'</div></div>':"";
   }).join("");
   return '<div class="live-bookmaker"><b>'+esc(book.key||book.name||book.title||"Bookmaker")+'</b>'+(book.last_update?'<small>Updated '+esc(new Date(book.last_update).toLocaleString("en-AU",{timeZone:"Australia/Brisbane"}))+' AEST</small>':"")+markets+'</div>';
  }).join("");
  const marketFav=f?'<b>'+esc(f.name)+'</b> at <strong>$'+f.price.toFixed(2)+'</strong> (best market consensus)':'Waiting for bookmaker odds';
  const sbText=sb?esc(sb.name)+' $'+sb.price.toFixed(2):"No Sportsbet quote returned";
  const b365Text=b365?esc(b365.name)+' $'+b365.price.toFixed(2):"No Bet365 quote returned";
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures with returned odds for this sport. Select another sport or refresh later.</div>';
 renderSportTrends();renderTopTips();
}
function liveScoreText(side){
 if(!side)return "—";
 const parts=Object.entries(side).filter(([k,v])=>k!=="team"&&v!=null).map(([k,v])=>k==="points"?"PTS "+v:k.charAt(0).toUpperCase()+k.slice(1)+" "+v);
 return parts.join(" · ")||"—";
}
async function loadLiveSports(){
 const notice=$("liveSportsNotice"),list=$("liveSportsEvents");
 try{
  const r=await fetch("/api/live-sports"),d=await r.json();
  if(!r.ok)throw Error(d.error||"Live sports feed unavailable");
  const fetched=d.resultsFetchedAt?new Date(d.resultsFetchedAt):null;
  const age=d.ageSeconds==null?"waiting":Math.round(d.ageSeconds/60)+"m old";
  notice.textContent=(d.events.length+" confirmed live fixtures · "+(d.bookmakers||[]).length+" bookmaker feeds requested · scores checked "+(fetched?fetched.toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"}):"waiting")+" · "+age+". "+(d.note||""));
  list.innerHTML=d.events.length?d.events.map(e=>{
   const books=(e.bookmakerFavourites||[]).filter(x=>x.favourite);
   const favs=books.map(x=>'<span>'+esc(x.bookmaker)+': <b>'+esc(x.favourite.name)+' '+Number(x.favourite.price).toFixed(2)+'</b></span>').join("");
   const all=(e.bookmakers||[]).map(book=>{
    const markets=(book.markets||[]).map(m=>'<div class="live-market"><b>'+esc(m.key||"Market")+'</b> '+(m.outcomes||[]).map(o=>esc(o.name)+' <strong>'+Number(o.price).toFixed(2)+'</strong>').join(" · ")+'</div>').join("");
    return '<div class="live-bookmaker"><b>'+esc(book.name)+'</b><small>'+(book.lastUpdate?"Updated "+esc(new Date(book.lastUpdate).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})):"Update time unavailable")+'</small>'+markets+'</div>';
   }).join("");
   const score=e.score?'<div class="live-score"><b>'+esc(e.home)+': '+esc(liveScoreText(e.score.home))+'</b><br><b>'+esc(e.away)+': '+esc(liveScoreText(e.score.away))+'</b></div>':'<div class="live-score">Live score not supplied</div>';
   const period=(e.score?.periodState||[]).filter(x=>x&&!x.completed).map(x=>"Period "+x.period+(x.half?" · "+x.half:"")).join(" · ");
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">'+esc(d.error||"No confirmed in-play fixtures are being returned by the live results feed right now.")+'</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();loadSportResults(1);if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);const resultSportId=Number(String(key).replace("oddsdata_",""));if(Number.isFinite(resultSportId)&&resultSportId>0)loadSportResults(resultSportId);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"");
 renderSports();
 }catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  for(const s of state.sports){state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/sports/"+encodeURIComponent(s.key)),d=await r.json();
   if(!r.ok)continue;const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
  }
  state.selectedSport=null;state.allSportsLoaded=true;state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();$("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming fixtures across "+Object.keys(state.sportsByKey).length+" sports. Feed updates follow provider cache timing.";
 }catch(e){$("sportsNotice").textContent=e.message;}
 finally{btn.disabled=false;}
}
function setMainView(view){
 state.sportsMode=view==="sports";document.body.classList.toggle("sports-mode",state.sportsMode);
 document.querySelectorAll(".main-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
 if(state.sportsMode)loadSports();
}
function render() {
  const rows = filteredRaces().filter(r => {
    const t = new Date(r.start_time).getTime();
    return isExplicitlyLive(r) || !Number.isFinite(t) || t >= Date.now();
  }).sort((a,b) => {
    if(state.sort==="odds") return (marketFavourite(a)?.consensus??999)-(marketFavourite(b)?.consensus??999)||Date.parse(a.start_time||0)-Date.parse(b.start_time||0);
    const ta=Date.parse(a.start_time||"");
    const tb=Date.parse(b.start_time||"");
    if(!Number.isFinite(ta)) return 1;
    if(!Number.isFinite(tb)) return -1;
    return ta-tb;
  });
  const live=rows.filter(isExplicitlyLive);
  const upcoming=rows.filter(r=>!isExplicitlyLive(r));
  $("raceCount").textContent=rows.length;
  $("horseCount").textContent=rows.filter(r=>categoryOf(r)==="horse").length;
  $("dogCount").textContent=rows.filter(r=>categoryOf(r)==="greyhound").length;
  $("harnessCount").textContent=rows.filter(r=>categoryOf(r)==="harness").length;
  const rowHtml=(r,isLive)=>{
    const type=categoryOf(r);
    const venue=r.venue||r.track_name||r.venue_canonical||"Track TBA";
    const number=r.race_number||r.race_no||r.raceNumber||"—";
    const date=r.start_time?fmtDate(r.start_time):"Date/time TBA";
    const time=r.start_time?fmtTime(r.start_time):"Jump time TBA";
    const fav=marketFavourite(r);
    const favName=fav?(fav.name||fav.runner_name||fav.horse_name||fav.greyhound_name||"Runner"):"";
    const bookFavourites=allBookmakerFavourites(r);
    const favPanel=fav
      ? '<div class="race-list-favourite"><div class="favourite-label">★ RACE FAVOURITE · SHORTEST FIXED ODDS</div><b>'+(fav.number?esc(fav.number)+'. ':"")+esc(favName)+'</b><strong>$'+Number(fav.consensus).toFixed(2)+'</strong><small>'+esc(fav.signalLabel||"Market favourite")+' · '+(fav.quoteCount||0)+' bookmaker quotes</small></div>'
      : '<div class="race-list-favourite"><div class="favourite-label">★ RACE FAVOURITE</div><b>Waiting for current bookmaker odds</b></div>';
    const runners=(r.runners||[]).slice().sort((a,b)=>(runnerFixedOdds(a)??999)-(runnerFixedOdds(b)??999));
    const runnerRows=runners.map((runner,rank)=>{
      const qs=fixedRunnerPrices(runner).map(q=>({book:q.bookmaker||q.bookmaker_name||q.name||q.site||q.key||"Bookmaker",price:Number(q.win_price??q.win??q.price),age:q.age_seconds==null?null:Number(q.age_seconds),stale:!!q.stale}))
        .filter(q=>Number.isFinite(q.price)&&q.price>1).sort((a,b)=>a.price-b.price);
      const fresh=qs.filter(q=>!q.stale&&(q.age==null||!Number.isFinite(q.age)||q.age<180));
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||(q.age!=null&&q.age>=180)?' · STALE':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml=bookFavourites.length?'<div class="race-bookmaker-favourites"><b>Bookmaker favourites</b>'+bookFavourites.map(x=>allBookFavouritePanel(x)).join("")+'</div>':"";
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div></div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>';
  renderTopTips();
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
    const feedMeta=data.feedMeta||{}; const books=(data.providerBookmakers||[]).length; const cap=feedMeta.truncated?` · PROVIDER LIMIT: ${feedMeta.limit||"tier cap"} of ${feedMeta.total_matched||"more"} records returned`:""; $("feedFreshness").textContent = `Screen refresh: 60s (display only) · ${books} bookmaker feeds with prices in this response · ${data.scope||"provider coverage"} · provider tier: ${esc(data.providerPlan||"not reported")}${cap} · price freshness varies by bookmaker; check each quote age · last feed fetch ${data.oddsFetchedAt?new Date(data.oddsFetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"waiting"}`;
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
$("sportsCatalogue").addEventListener("click",e=>{const b=e.target.closest("[data-sport]");if(b)loadSportOdds(b.dataset.sport);});
$("loadAllSportsBtn").addEventListener("click",loadAllSports);
$("refreshLiveSportsBtn").addEventListener("click",loadLiveSports);
document.querySelectorAll(".main-tab").forEach(b=>b.addEventListener("click",()=>setMainView(b.dataset.view)));
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
      const price = fav ? "$"+Number(fav.price).toFixed(2)+" · "+esc(fav.priceSource)+" · "+esc(fav.signalLabel||"") : "Waiting for odds";
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
loadSports();
loadLiveSports();
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
