const state = { races: [], filter: "all", search: "", sort: "odds", loading: false, feedMode:"live", sports: [], allSportsLoaded: false, selectedSport: null, sportEvents: [], sportsByKey: {}, sportTrendPrices: {}, sportTrendAlerts: [], sportsMode: false };
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
function quoteAgeSeconds(q) {
 const direct=q?.age_seconds;
 if(direct!=null&&Number.isFinite(Number(direct)))return Math.max(0,Number(direct));
 const stamp=q?.last_update||q?.updated_at||q?.captured_at||q?.timestamp;
 if(stamp==null)return null;
 const numeric=Number(stamp);
 const ms=Number.isFinite(numeric)&&numeric>1000000000?(numeric>1000000000000?numeric:numeric*1000):Date.parse(stamp);
 return Number.isFinite(ms)?Math.max(0,(Date.now()-ms)/1000):null;
}
function isBetfairQuote(q) { return /betfair|exchange/i.test(String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"")); }
function fixedRunnerPrices(runner) { return runnerPrices(runner).filter(q=>!isBetfairQuote(q)); }
function runnerFixedOdds(runner) {
 const ps=fixedRunnerPrices(runner).filter(q=>{const age=quoteAgeSeconds(q);return !q.stale&&(age==null?q.public_demo===true:age<180);}).map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
 return ps.length?ps[Math.floor((ps.length-1)/2)]:null;
}
function exchangeRunnerPrice(runner) {
 const q=runnerPrices(runner).filter(isBetfairQuote).sort((a,b)=>Number(a.win_price??a.win??a.price)-Number(b.win_price??b.win??b.price))[0];
 return q?Number(q.win_price??q.win??q.price):null;
}
function normaliseBookmakerKey(value) {
 const key=String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(key.includes("sportsbet"))return "sportsbet";
 if(key.includes("bet365"))return "bet365";
 if(key.includes("tab"))return "tab";
 if(key.includes("betr"))return "betr";
 return key;
}
function bookmakerMatches(value,wantedKey) {
 const key=normaliseBookmakerKey(value),wanted=normaliseBookmakerKey(wantedKey);
 return !!key&&key===wanted;
}
function bookmakerFavourite(race, wantedKey) {
  const candidates = (race.runners || []).map(runner => {
    const quote = fixedRunnerPrices(runner).find(q => {
      const age=quoteAgeSeconds(q);
      return [q.key,q.bookmaker,q.name,q.bookmaker_name,q.site].filter(Boolean).some(value => bookmakerMatches(value,wantedKey))
        && q.stale!==true && (age==null?q.public_demo===true:age<180);
    });
    if (!quote) return null;
    return {name:runner.name || runner.runner_name || runner.horse_name || runner.greyhound_name || "Runner",
      number:runner.number ?? runner.runner_number ?? null,
      price:Number(quote.win_price ?? quote.win ?? quote.price),
      age:quoteAgeSeconds(quote), stale:false, verified:quote.public_demo!==true,
      url:quote.event_url||quote.market_url||quote.url||BOOKMAKER_URLS[wantedKey]};
  }).filter(x => x && Number.isFinite(x.price) && x.price > 1);
  return candidates.sort((a,b)=>a.price-b.price)[0] || null;
}
function raceBookmakerPanel(bookmaker, favourite, overallFavourite) {
  const key=bookmaker.toLowerCase();
  const url=favourite&&favourite.url?favourite.url:BOOKMAKER_URLS[key];
  const extra=key==="bet365"
    ? '<a class="bookmaker-market-link" href="https://extra.bet365.com.au/features/au/watch-racing-live" target="_blank" rel="noopener noreferrer">Bet365 live racing information ↗</a>'
    : '<a class="bookmaker-market-link" href="https://www.sportsbet.com.au/horse-racing/australia-nz/betting" target="_blank" rel="noopener noreferrer">Sportsbet live & next-to-jump · horses, greyhounds and harness ↗</a>';
  const runner=favourite?(favourite.number!=null?favourite.number+". ":"")+favourite.name:"";
  const details=favourite
    ? '<div class="book-fav-runner">'+esc(runner)+'</div><div class="book-fav-price">$'+Number(favourite.price).toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?"Public preview · quote age unavailable":"Quote age "+Math.round(Number(favourite.age))+"s")+' · '+(favourite.verified===false?"public preview":"latest returned quote")+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+". ":"")+overallFavourite.name)+'</b> at <b>$'+Number(overallFavourite.consensus).toFixed(2)+'</b> · not a '+esc(bookmaker)+' price.</div>'
      : '<div class="book-fav-missing">No current verified '+esc(bookmaker)+' quote returned for this race.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav,fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const prices=new Map();
 for(const b of event.bookmakers||[]){
  if(wantedBookmaker&&!bookmakerMatches(b.key||b.title||b.name,wantedBookmaker))continue;
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
let dashboardFeedsStarted=false;
window.startFullDashboardFeeds=function(){
  if(dashboardFeedsStarted){loadRaces();loadLiveSports();return;}
  dashboardFeedsStarted=true;
  loadRaces();
  loadSports().then(loadLiveSports);
  loadHistory();
  loadMarketHistory();
};
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+b365.price.toFixed(2):(f?'No Bet365 quote · overall market favourite: '+esc(f.name)+' 
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div><div class="sportsbook-links"><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet market ↗</a><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 market ↗</a></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures or verified prices were returned for this sport at this refresh. The full sports catalogue is listed above; check current markets directly at the bookmakers. No odds are estimated.</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+f.price.toFixed(2):"No Bet365 quote or overall market price returned");
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div><div class="sportsbook-links"><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet market ↗</a><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 market ↗</a></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures or verified prices were returned for this sport at this refresh. The full sports catalogue is listed above; check current markets directly at the bookmakers. No odds are estimated.</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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

/* Fresh-feed guardrails and canonical bookmaker aliases. */
function normaliseBookmakerKey(value) {
 const key=String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(key.includes("sportsbet"))return "sportsbet";
 if(key.includes("bet365")||key.includes("betthree65"))return "bet365";
 if(key.includes("tabtouch"))return "tabtouch";
 if(key.includes("tab"))return "tab";
 if(key.includes("betr"))return "betr";
 if(key.includes("betfair")||key.includes("exchange"))return "betfair";
 return key;
}
function quoteIsFresh(q) {
 const age=quoteAgeSeconds(q);
 return q?.stale!==true && age!==null && Number.isFinite(age) && age<180;
}
function bookmakerFavourite(race,wantedKey) {
 const candidates=(race.runners||[]).map(runner=>{
  const quote=fixedRunnerPrices(runner).find(q=>
   [q.key,q.bookmaker,q.name,q.bookmaker_name,q.site].filter(Boolean).some(v=>bookmakerMatches(v,wantedKey))&&quoteIsFresh(q));
  if(!quote)return null;
  return {name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",
   number:runner.number??runner.runner_number??null,price:Number(quote.win_price??quote.win??quote.price),
   age:quoteAgeSeconds(quote),stale:false,verified:quote.public_demo!==true,
   url:quote.event_url||quote.market_url||quote.url||BOOKMAKER_URLS[wantedKey]};
 }).filter(x=>x&&Number.isFinite(x.price)&&x.price>1);
 return candidates.sort((a,b)=>a.price-b.price)[0]||null;
}
function runnerFixedOdds(runner) {
 const ps=fixedRunnerPrices(runner).filter(quoteIsFresh).map(q=>Number(q.win_price??q.win??q.price))
  .filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
 return ps.length?ps[Math.floor((ps.length-1)/2)]:null;
}
function sportFavourite(event,wantedBookmaker) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) {
  if(wantedBookmaker&&!bookmakerMatches(book.key||book.title||book.name,wantedBookmaker))continue;
  for(const market of book.markets||[]) {
   if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase()))continue;
   for(const outcome of market.outcomes||[]) {
    const price=Number(outcome.price),age=quoteAgeSeconds({...outcome,...book});
    if(price>1&&Number.isFinite(price)&&book.stale!==true&&age!==null&&age<180) {
     if(!prices.has(outcome.name))prices.set(outcome.name,[]);
     prices.get(outcome.name).push(price);
    }
   }
  }
 }
 return [...prices.entries()].map(([name,values])=>{
  values.sort((a,b)=>a-b);
  return {name,price:values[Math.floor((values.length-1)/2)],books:values.length};
 }).sort((a,b)=>a.price-b.price)[0]||null;
}
function sportRankings(event) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) for(const market of book.markets||[]) {
  if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase()))continue;
  for(const outcome of market.outcomes||[]) {
   const price=Number(outcome.price),age=quoteAgeSeconds({...outcome,...book});
   if(price>1&&Number.isFinite(price)&&book.stale!==true&&age!==null&&age<180) {
    if(!prices.has(outcome.name))prices.set(outcome.name,[]);
    prices.get(outcome.name).push(price);
   }
  }
 }
 const rows=[...prices.entries()].map(([name,values])=>{
  values.sort((a,b)=>a-b);const mid=values[Math.floor((values.length-1)/2)];
  return {name,price:mid,books:values.length,spread:values.length>1?(values[values.length-1]-values[0])/mid:1};
 }).sort((a,b)=>a.price-b.price);
 if(rows.length){const gap=rows[1]?Math.max(0,(1/rows[0].price-1/rows[1].price)/(1/rows[0].price)):0;
  rows[0].score=Math.round(Math.min(40,rows[0].books/3*40)+Math.max(0,30*(1-rows[0].spread/.35))+Math.min(30,gap/.15*30));}
 return rows;
}


function marketFavourite(race) {
 const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
 const runners=(race.runners||[]).map(runner=>{
  const seen=new Set();
  const quotes=fixedRunnerPrices(runner).filter(q=>{
   const key=normaliseBookmakerKey(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"");
   if(!key||seen.has(key)||!quoteIsFresh(q))return false;
   seen.add(key);return true;
  });
  const prices=quotes.map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1);
  const consensus=median(prices);if(consensus==null)return null;
  const spread=prices.length>1?(Math.max(...prices)-Math.min(...prices))/consensus:1;
  return {...runner,consensus,quoteCount:quotes.length,spreadPct:+(spread*100).toFixed(1),priceSource:quotes.length>1?"multi-bookmaker median":"single-bookmaker price"};
 }).filter(Boolean).sort((a,b)=>a.consensus-b.consensus);
 const favourite=runners[0];if(!favourite)return null;
 const second=runners[1],gap=second?Math.max(0,(1/favourite.consensus-1/second.consensus)/(1/favourite.consensus)):0;
 favourite.gapPct=+(gap*100).toFixed(1);
 favourite.signalScore=Math.round(Math.min(40,favourite.quoteCount/3*40)+Math.max(0,30*(1-(favourite.spreadPct/100)/.35))+Math.min(30,gap/.15*30));
 favourite.signalLabel=favourite.quoteCount>=3&&favourite.signalScore>=65?"STRONG SIGNAL":favourite.signalScore>=45?"CAUTION":"NO BET · WEAK SIGNAL";
 return favourite;
}

function tick(){ $("clock").textContent = new Date().toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false}); }
tick(); setInterval(tick,1000);
loadRaces();
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(t.odds).toFixed(2):'Unavailable')+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market ranking only, not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("SPORTSBET RACING FAVOURITES","Verified Sportsbet prices are shown when returned. Otherwise the overall market favourite is shown as a labelled fallback, never represented as a Sportsbet quote.",sportsbetPicks,'No Sportsbet race prices were returned in this public snapshot. This is a feed coverage gap, not a missing favourite. <a href="https://www.sportsbet.com.au/horse-racing/australia-nz/betting" target="_blank" rel="noopener noreferrer">Open Sportsbet racing markets ↗</a>')
 +section("BET365 RACING FAVOURITES","Verified Bet365 prices only, including the Bet365-labelled MoviOdds feed. Where a Bet365 quote is missing, the race cards still show the overall market favourite separately; another bookmaker is never relabelled as Bet365.",bet365Picks,'No verified Bet365 racing quotes were returned in this refresh. Overall market favourites remain listed in BEST PICK IN EACH RACE. <a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 race markets ↗</a>')
 +section("BEST PICK IN EACH RACE","One current market favourite per returned Australian race, ranked using fresh fixed bookmaker quotes. Weak single-book quotes are clearly labelled.",racePicks,"No fresh priced race favourites are available.")
 +section("SPORTSBET SPORTS FAVOURITES","Sportsbet prices are matched across normalized bookmaker names. When no Sportsbet quote is returned, the overall market favourite is shown as a clearly labelled fallback, never as a Sportsbet price.",sportsbetSportPicks,"No priced sports fixtures are available in this refresh.")
 +section("SPORTS FAVOURITES","One lowest-priced head-to-head outcome per returned live or upcoming sports fixture. Sportsbet and other bookmaker prices remain separately identified.",sportPicks,"No sports fixtures with usable head-to-head prices are available.")
 +section("BEST OF THE DAY · TOP TIPS","Top 10 live/upcoming racing and sports market signals for today (Brisbane time), ranked by quote agreement, price spread and favourite separation. Single-source picks are clearly labelled; these are not guaranteed winners.",bestDay,"No fresh odds are available for a daily shortlist.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+b365.price.toFixed(2):(f?'No Bet365 quote · overall market favourite: '+esc(f.name)+' 
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div><div class="sportsbook-links"><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet market ↗</a><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 market ↗</a></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures or verified prices were returned for this sport at this refresh. The full sports catalogue is listed above; check current markets directly at the bookmakers. No odds are estimated.</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+f.price.toFixed(2):"No Bet365 quote or overall market price returned");
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?'LIVE · IN PLAY':'UPCOMING · PRE-MATCH')+'</span></div>'+(e.sport_name?'<div class="sport-league">'+esc(e.sport_name)+'</div>':"")+(e.league?'<div class="sport-league">'+esc(e.league)+'</div>':"")+(e.in_play===true&&e.score?'<div class="sport-live-score">LIVE SCORE: <b>'+esc(e.score)+'</b>'+(e.timer&&e.timer.tm!=null?' · '+esc(e.timer.tm)+'′':"")+'</div>':"")+'<div class="sport-start-info"><b>START:</b> '+esc(startLabel)+' · '+esc(startsIn)+'</div><div class="sport-favourite">★ MARKET FAVOURITE TEAM: '+marketFav+'</div>'+rankedHtml+'<div class="sport-book-favs"><span>SPORTSBET FAVOURITE TEAM: <b>'+sbText+'</b></span><span>BET365 FAVOURITE TEAM: <b>'+b365Text+'</b></span></div><div class="sportsbook-links"><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet market ↗</a><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 market ↗</a></div>'+(bookFavourites?'<details class="sport-all-favourites"><summary>Favourite team at each bookmaker ('+books.length+')</summary><div class="sport-book-favourites">'+bookFavourites+'</div></details>':"")+'<details><summary>All bookmaker prices and teams ('+books.length+' feeds)</summary><div class="live-bookmakers">'+(allBooks||"No bookmaker prices returned for this fixture.")+'</div></details></article>';
 }).join(""):'<div class="empty">No upcoming fixtures or verified prices were returned for this sport at this refresh. The full sports catalogue is listed above; check current markets directly at the bookmakers. No odds are estimated.</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · verified quotes only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"),fav)+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"),fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+favourite.price.toFixed(2)+'</div><div class="book-fav-age">'+(favourite.age==null?'Public preview · quote age not supplied':'Quote age '+Math.round(Number(favourite.age))+'s')+'</div>'
    : overallFavourite
      ? '<div class="book-fav-missing">No separate '+esc(bookmaker)+' quote was returned. Overall market favourite: <b>'+esc((overallFavourite.number!=null?overallFavourite.number+'. ':'')+overallFavourite.name)+'</b> at <b>
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 try{
  let failed=0;
  for(const s of state.sports){
   state.selectedSport=s.key;$("sportsNotice").textContent="Loading upcoming "+(s.title||s.key)+"…";
   const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all"),d=await r.json();
   if(!r.ok){failed++;continue;}
   const events=(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
   state.sportsByKey[s.key]=events;recordSportTrends(s.key,events);
   if(d.providerErrors&&d.providerErrors.length)failed++;
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
  renderSports();renderTopTips();
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" upcoming/live fixtures across "+Object.keys(state.sportsByKey).length+" of "+state.sports.length+" catalogue sports attempted. "+(failed?failed+" sports had incomplete or unavailable provider data.":"No provider errors were reported for this pass.")+" Public no-key odds cover only the sports and events each source publishes; other catalogue sports remain visible without fabricated fixtures or prices.";
 }catch(e){$("sportsNotice").textContent="The full sports catalogue is listed below, but some fixture feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
+Number(overallFavourite.consensus).toFixed(2)+'</b> · '+esc(overallFavourite.priceSource||'available market price')+'.</div>'
      : '<div class="book-fav-missing">No '+esc(bookmaker)+' quote or overall market price is available for this race yet. Check the live market link below.</div>';
  return '<div class="book-fav"><div class="book-fav-label">'+esc(bookmaker)+' favourite</div>'+details+
    '<a class="bookmaker-market-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function favouritePanel(label, favourite) {
  return `<div class="book-fav"><div class="book-fav-label">${label}</div>${favourite ? `<div class="book-fav-runner">${esc(favourite.number ? favourite.number+". " : "")}${esc(favourite.name)}</div><div class="book-fav-price">${favourite.price.toFixed(2)}</div><div class="book-fav-age">${Number.isFinite(Number(favourite.age)) ? "Quote age "+Math.round(Number(favourite.age))+"s" : "Age not supplied"}${favourite.stale || (Number.isFinite(Number(favourite.age)) && Number(favourite.age)>=180) ? " · STALE" : " · latest returned"}</div>` : `<div class="book-fav-missing">Waiting for ${label.toLowerCase().replace(" favourite","")} price from connected provider · no bookmaker favourite available yet</div>`}</div>`;
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");if(raw.includes("sportsbet"))return "sportsbet";if(raw.includes("bet365"))return "bet365";return "";}
function allBookmakerFavourites(race) { const books=new Map(); for(const runner of race.runners||[]) for(const q of fixedRunnerPrices(runner)) { const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q); if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180)) continue; const current=books.get(key); if(!current||price<current.price) books.set(key,{key,bookmaker:key==="bet365"?"Bet365":"Sportsbet",name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",number:runner.number??runner.runner_number??null,price,age,url:q.event_url||q.market_url||q.url||BOOKMAKER_URLS[key]}); } return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker)); }
function allBookFavouritePanel(f) {
  const runner=(f.number!=null?f.number+". ":"")+f.name;
  const age=f.age==null?"Quote age unavailable":"Quote age "+Math.round(f.age)+"s";
  return `<div class="book-fav"><div class="book-fav-label">${esc(f.bookmaker)}</div><div class="book-fav-runner">${esc(runner)}</div><div class="book-fav-price">$${f.price.toFixed(2)}</div><div class="book-fav-age">${esc(age)} · shortest returned quote</div><a class="bookmaker-market-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.bookmaker)} ↗</a></div>`;
}

function marketFavourite(race) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
  const runners=(race.runners||[]).map(r=>{
    const seen=new Set();
    const quotes=fixedRunnerPrices(r).filter(q=>{
      const key=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,""),age=quoteAgeSeconds(q);
      if(!key||seen.has(key)||q.stale===true||(age==null?q.public_demo!==true:age>=180))return false;
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
    <div class="bookmaker-favourites">${raceBookmakerPanel("Bet365",bet365Fav)}${raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);}).sort((a,b)=>Date.parse(a.start_time||"")-Date.parse(b.start_time||""));
 const sportsbetPicks=[],bet365Picks=[],racePicks=[],sportPicks=[],pricedRaceTips=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=bookmakerFavourite(r,"sportsbet");
  sportsbetPicks.push({kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No verified Sportsbet favourite",odds:sb?sb.price:null,time,source:sb?"Sportsbet public quote":"No current Sportsbet quote returned",score:0,quotes:sb?1:0,signal:sb?"SPORTSBET PRICE RETURNED":"SPORTSBET PRICE UNAVAILABLE"});
  const b365=bookmakerFavourite(r,"bet365");
  bet365Picks.push({kind:"RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,source:b365?"Bet365 public quote":"No current Bet365 quote returned",score:0,quotes:b365?1:0,signal:b365?"BET365 PRICE RETURNED":"BET365 PRICE UNAVAILABLE"});
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource,time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"LOW CONFIDENCE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh verified fixed-odds quotes returned for this race",time,quotes:0,signal:"AWAITING VERIFIED PRICE"};
  racePicks.push(tip);if(fav)pricedRaceTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;const f=ranks[0],books=f.books||0;
  sportPicks.push({kind:"SPORT",category:e._sport||e.sport||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s"),time:e.commence_time,quotes:books,signal:books>=2?"MULTI-QUOTE":"SINGLE-SOURCE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedRaceTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bestDay=(todays.length?todays:pricedRaceTips).slice().sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Fixed odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · '+esc(t.signal||("signal "+(t.score||0)+"/100"))+'</div><small>'+esc(t.source||"Public snapshot")+' · market information only; not a guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING","Top 10 priced favourites across all returned horse, greyhound and harness races today (Brisbane time). Ranked by bookmaker agreement, price spread and favourite separation. Only races with fresh prices qualify.",bestDay,"No fresh priced racing favourites are available for today's shortlist.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One separate Sportsbet favourite row for every returned race. If Sportsbet has not published a current quote, the row stays visible and is marked unavailable; no other bookmaker is substituted.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 FAVOURITES · EVERY RACE","One separate Bet365 favourite row for every returned race. Only a current Bet365-labelled public quote is shown; unavailable prices are never guessed or copied from another bookmaker.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES","One market-ranked tip row for every returned upcoming/live race across horse, greyhound and harness. A race without fresh prices remains listed as awaiting a verified favourite.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTS FAVOURITES","Priced favourites for returned live and upcoming sports fixtures. This section is separate from racing Best of the Day.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
 }catch(e){notice.textContent="No confirmed live sports fixtures are available from the connected feed right now. Upcoming sports and public odds widgets remain available below.";list.innerHTML='<div class="empty">Live scores are temporarily unavailable from the feed. No live score or odds are invented.</div>';}
}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>Number(b.in_play===true)-Number(a.in_play===true)||Date.parse(a.commence_time||0)-Date.parse(b.commence_time||0));
 list.innerHTML=events.length?events.map(e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(e.in_play===true?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 }).join(""):'<div class="empty">No live or upcoming sports fixtures were returned by the public feeds at this refresh. The full sports catalogue remains available above.</div>';
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
   return '<article class="sport-event"><b>'+esc(e.name||"Live event")+'</b><small><strong>LIVE</strong> · '+esc(e.sport)+' · '+esc(fmtDate(e.commenceTime))+' '+esc(fmtTime(e.commenceTime))+(period?" · "+esc(period):"")+'</small>'+score+'<div class="sport-book-favs">'+(favs||'<span>No bookmaker favourite prices returned for this fixture.</span>')+'</div><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div><details><summary>All bookmaker markets ('+(e.quoteCount||0)+' prices)</summary><div class="live-bookmakers">'+(all||"No matching bookmaker odds returned")+'</div></details></article>';
  }).join(""):'<div class="empty">No confirmed in-play fixtures are being returned by the live results feed right now. Upcoming sports and public odds widgets remain available below.</div>';
 }catch(e){notice.textContent=e.message;list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}

async function loadSports(){
 try{const r=await fetch("/api/sports"),d=await r.json();if(!r.ok)throw Error(d.error||"Sports feed unavailable");state.sports=d.sports||[];$("sportsNotice").textContent=d.note||"Upcoming fixtures and pre-match markets only. Live/in-play odds are not supplied.";renderSports();$("sportResultsNotice").textContent="Public no-key preview covers live and upcoming fixtures; final results are not included in this feed.";$("sportResults").innerHTML='<div class="empty">Use the official league and racing links for confirmed final results.</div>';if(!state.allSportsLoaded&&state.sports.length)await loadAllSports();}
 catch(e){$("sportsNotice").textContent=e.message;}
}
async function loadSportOdds(key){
 state.selectedSport=key;$("sportsNotice").textContent="Loading "+key+" fixtures…";
 try{const r=await fetch("/api/public-sports/"+encodeURIComponent(key)),d=await r.json();if(!r.ok)throw Error(d.error||"Odds unavailable");if(state.selectedSport!==key)return;
 state.sportEvents=d.events||[];state.sportsByKey[key]=state.sportEvents;recordSportTrends(key,state.sportEvents);
 $("sportsNotice").textContent=(d.note||"Pre-match markets only.")+" Bookmaker odds snapshot: "+new Date(d.fetchedAt||Date.now()).toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane"})+(d.rapidSport?" · RapidOdds "+d.rapidSport+": "+d.rapidGames+" fixtures":"")+(d.rapidError?" · RapidOdds issue: "+d.rapidError:"")+(d.providerErrors&&d.providerErrors.length?" · "+d.providerErrors.join(" · "):"");
 renderSports();
 }catch(e){$("sportsNotice").textContent="Live fixtures are temporarily unavailable from the connected feed. The public sports widgets and bookmaker market links remain on this page. "+e.message;}
}
async function loadAllSports(){
 const btn=$("loadAllSportsBtn");if(btn.disabled)return;
 btn.disabled=true;state.sportEvents=[];state.sportsByKey={};renderSports();
 let failed=0,loaded=0;
 try{
  for(let start=0;start<state.sports.length;start+=4){
   const batch=state.sports.slice(start,start+4);
   $("sportsNotice").textContent="Loading upcoming fixtures · "+Math.min(start+batch.length,state.sports.length)+" of "+state.sports.length+" sports…";
   const results=await Promise.allSettled(batch.map(async s=>{
    const r=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all");const d=await r.json();
    if(!r.ok)throw Error(d.error||"Feed unavailable");
    return {sport:s,events:(d.events||[]).filter(e=>e.in_play===true||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()),errors:d.providerErrors||[]};
   }));
   results.forEach(result=>{
    if(result.status!=="fulfilled"){failed++;return;}
    const {sport,events,errors}=result.value;state.sportsByKey[sport.key]=events;recordSportTrends(sport.key,events);loaded++;if(errors.length)failed++;
   });
   state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>new Date(a.commence_time||0)-new Date(b.commence_time||0));
   renderSports();renderTopTips();
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" live/upcoming fixtures across "+loaded+" of "+state.sports.length+" sports. "+(failed?failed+" feeds were incomplete or unavailable.":"All queried feeds responded.")+" Public sources may not publish every event or price; unavailable data is not fabricated.";
 }catch(e){$("sportsNotice").textContent="Some public sports feeds are temporarily unavailable. "+e.message;}
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
     const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
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
      const fresh=qs.filter(q=>!q.stale&&q.age!=null&&Number.isFinite(q.age)&&q.age<180);
      const prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner";
      const num=runner.number??runner.runner_number;
      const isFav=!!fav&&String(name)===String(favName);
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?' · STALE / AGE UNVERIFIED':"")+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      const priceLabel=estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2);
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+priceLabel+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Separate bookmaker favourites · fresh prices only</b>'+raceBookmakerPanel("Bet365",bookmakerFavourite(r,"bet365"))+raceBookmakerPanel("Sportsbet",bookmakerFavourite(r,"sportsbet"))+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · RANKED LOWEST FIXED ODDS FIRST</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length
    ? '<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">No races currently marked live by the feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>'
    : (state.feedMode === "public-widgets"
      ? '<div class="empty">No imported race cards are available from the connected licensed feeds at this refresh. The live public racing board is displayed above under Live racing odds & next to jump. <a href="#racingWidgets">Jump to the free live racing board ↗</a></div>'
      : (state.feedMode === "demo" ? '<div class="empty">The free public preview has no Australian race cards at this moment. This is not a website outage; check the live widgets above and refresh for the next sample.</div>' : '<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    state.feedMode = data.mode || "live";
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 60s · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    $("feedStatus").textContent = "FREE PUBLIC FEEDS";
    $("updatedAt").textContent = new Date().toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("feedFreshness").textContent = "The imported race-card API is temporarily unavailable. Free public widgets remain available on this page; no odds are estimated.";
    $("notice").textContent = "Use the free live public racing board above for current fields and prices. Imported bookmaker race cards will return when a connected provider is available.";
    $("notice").classList.remove("hidden");
    render();
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

/* Fresh-feed guardrails and canonical bookmaker aliases. */
function normaliseBookmakerKey(value) {
 const key=String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(key.includes("sportsbet"))return "sportsbet";
 if(key.includes("bet365")||key.includes("betthree65"))return "bet365";
 if(key.includes("tabtouch"))return "tabtouch";
 if(key.includes("tab"))return "tab";
 if(key.includes("betr"))return "betr";
 if(key.includes("betfair")||key.includes("exchange"))return "betfair";
 return key;
}
function quoteIsFresh(q) {
 const age=quoteAgeSeconds(q);
 return q?.stale!==true && age!==null && Number.isFinite(age) && age<180;
}
function bookmakerFavourite(race,wantedKey) {
 const candidates=(race.runners||[]).map(runner=>{
  const quote=fixedRunnerPrices(runner).find(q=>
   [q.key,q.bookmaker,q.name,q.bookmaker_name,q.site].filter(Boolean).some(v=>bookmakerMatches(v,wantedKey))&&quoteIsFresh(q));
  if(!quote)return null;
  return {name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",
   number:runner.number??runner.runner_number??null,price:Number(quote.win_price??quote.win??quote.price),
   age:quoteAgeSeconds(quote),stale:false,verified:quote.public_demo!==true,
   url:quote.event_url||quote.market_url||quote.url||BOOKMAKER_URLS[wantedKey]};
 }).filter(x=>x&&Number.isFinite(x.price)&&x.price>1);
 return candidates.sort((a,b)=>a.price-b.price)[0]||null;
}
function runnerFixedOdds(runner) {
 const ps=fixedRunnerPrices(runner).filter(quoteIsFresh).map(q=>Number(q.win_price??q.win??q.price))
  .filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
 return ps.length?ps[Math.floor((ps.length-1)/2)]:null;
}
function sportFavourite(event,wantedBookmaker) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) {
  if(wantedBookmaker&&!bookmakerMatches(book.key||book.title||book.name,wantedBookmaker))continue;
  for(const market of book.markets||[]) {
   if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase()))continue;
   for(const outcome of market.outcomes||[]) {
    const price=Number(outcome.price),age=quoteAgeSeconds({...outcome,...book});
    if(price>1&&Number.isFinite(price)&&book.stale!==true&&age!==null&&age<180) {
     if(!prices.has(outcome.name))prices.set(outcome.name,[]);
     prices.get(outcome.name).push(price);
    }
   }
  }
 }
 return [...prices.entries()].map(([name,values])=>{
  values.sort((a,b)=>a-b);
  return {name,price:values[Math.floor((values.length-1)/2)],books:values.length};
 }).sort((a,b)=>a.price-b.price)[0]||null;
}
function sportRankings(event) {
 const prices=new Map();
 for(const book of event.bookmakers||[]) for(const market of book.markets||[]) {
  if(!["h2h","head_to_head"].includes(String(market.key||"").toLowerCase()))continue;
  for(const outcome of market.outcomes||[]) {
   const price=Number(outcome.price),age=quoteAgeSeconds({...outcome,...book});
   if(price>1&&Number.isFinite(price)&&book.stale!==true&&age!==null&&age<180) {
    if(!prices.has(outcome.name))prices.set(outcome.name,[]);
    prices.get(outcome.name).push(price);
   }
  }
 }
 const rows=[...prices.entries()].map(([name,values])=>{
  values.sort((a,b)=>a-b);const mid=values[Math.floor((values.length-1)/2)];
  return {name,price:mid,books:values.length,spread:values.length>1?(values[values.length-1]-values[0])/mid:1};
 }).sort((a,b)=>a.price-b.price);
 if(rows.length){const gap=rows[1]?Math.max(0,(1/rows[0].price-1/rows[1].price)/(1/rows[0].price)):0;
  rows[0].score=Math.round(Math.min(40,rows[0].books/3*40)+Math.max(0,30*(1-rows[0].spread/.35))+Math.min(30,gap/.15*30));}
 return rows;
}


function marketFavourite(race) {
 const median=values=>{const x=values.slice().sort((a,b)=>a-b);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;};
 const runners=(race.runners||[]).map(runner=>{
  const seen=new Set();
  const quotes=fixedRunnerPrices(runner).filter(q=>{
   const key=normaliseBookmakerKey(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"");
   if(!key||seen.has(key)||!quoteIsFresh(q))return false;
   seen.add(key);return true;
  });
  const prices=quotes.map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1);
  const consensus=median(prices);if(consensus==null)return null;
  const spread=prices.length>1?(Math.max(...prices)-Math.min(...prices))/consensus:1;
  return {...runner,consensus,quoteCount:quotes.length,spreadPct:+(spread*100).toFixed(1),priceSource:quotes.length>1?"multi-bookmaker median":"single-bookmaker price"};
 }).filter(Boolean).sort((a,b)=>a.consensus-b.consensus);
 const favourite=runners[0];if(!favourite)return null;
 const second=runners[1],gap=second?Math.max(0,(1/favourite.consensus-1/second.consensus)/(1/favourite.consensus)):0;
 favourite.gapPct=+(gap*100).toFixed(1);
 favourite.signalScore=Math.round(Math.min(40,favourite.quoteCount/3*40)+Math.max(0,30*(1-(favourite.spreadPct/100)/.35))+Math.min(30,gap/.15*30));
 favourite.signalLabel=favourite.quoteCount>=3&&favourite.signalScore>=65?"STRONG SIGNAL":favourite.signalScore>=45?"CAUTION":"NO BET · WEAK SIGNAL";
 return favourite;
}

function tick(){ $("clock").textContent = new Date().toLocaleTimeString("en-AU",{timeZone:"Australia/Brisbane",hour12:false}); }
tick(); setInterval(tick,1000);
loadRaces();
loadSports().then(loadLiveSports);
loadHistory();
loadMarketHistory();
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
