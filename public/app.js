const state = { races: [], filter: "all", search: "", sort: "odds", loading: false, feedMode:"live", sports: [], allSportsLoaded: false, selectedSport: null, sportEvents: [], sportsByKey: {}, sportTrendPrices: {}, sportTrendAlerts: [], sportsMode: false, sportsbetOnly:false, feedHealth:null };
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
 const ps=fixedRunnerPrices(runner).filter(q=>{const age=quoteAgeSeconds(q);return quoteIsCurrent(q);}).map(q=>Number(q.win_price??q.win??q.price)).filter(p=>Number.isFinite(p)&&p>1).sort((a,b)=>a-b);
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
function quoteIsCurrent(q) {
  const age=quoteAgeSeconds(q);
  // A public board response is usable when its own quote timestamp is missing,
  // but the UI labels the age unknown and the ranking caps its confidence.
  return q.stale!==true && !q.suspended && (age==null ? q.public_demo===true : age<180);
}
function freshestQuotesByBook(runner) {
  const byBook=new Map();
  for(const q of fixedRunnerPrices(runner)){
    const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q);
    if(!key||!Number.isFinite(price)||price<=1||!quoteIsCurrent(q))continue;
    const previous=byBook.get(key);
    if(!previous||(age!=null&&(previous.age==null||age<previous.age)))byBook.set(key,{q,key,price,age});
  }
  return [...byBook.values()];
}
function quoteDeviation(price,peers) {
  if(!peers.length)return null;
  const sorted=peers.slice().sort((a,b)=>a-b),mid=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  return mid>1?Math.abs(price-mid)/mid*100:null;
}
function runnerConsensusSignal(race, selected) {
 const rows=(race.runners||[]).filter(r=>r.scratched!==true).map(r=>({...r,_quotes:freshestQuotesByBook(r)}));
 const books=[...new Set(rows.flatMap(r=>r._quotes.map(q=>q.key)))];
 const target=rows.find(r=>(selected.number!=null&&(r.number??r.runner_number??r.box)!=null&&String(r.number??r.runner_number??r.box)===String(selected.number))||
   (selected.number==null&&normaliseRunnerName(r.name||r.runner_name||r.horse_name||r.greyhound_name)===normaliseRunnerName(selected.name)));
 if(!target||!books.length)return {score:0,agreementPct:0,quoteCount:0,signal:"LOW DATA CONFIDENCE"};
 const stats=new Map(rows.map(r=>[r,{prob:[],votes:0,quotes:[]}]));
 for(const book of books){
  const field=rows.map(r=>({runner:r,quote:r._quotes.find(q=>q.key===book)})).filter(x=>x.quote);
  const total=field.reduce((sum,x)=>sum+1/x.quote.price,0);if(!total)continue;
  const leader=field.slice().sort((a,b)=>(1/b.quote.price)-(1/a.quote.price))[0]?.runner;
  for(const x of field){const s=stats.get(x.runner);s.prob.push((1/x.quote.price)/total);s.quotes.push(x.quote);if(x.runner===leader)s.votes++;}
 }
 const s=stats.get(target),p=s.prob;if(!p.length)return {score:0,agreementPct:0,quoteCount:0,signal:"LOW DATA CONFIDENCE"};
 const avg=p.reduce((a,b)=>a+b,0)/p.length,spread=p.length>1?Math.max(...p)-Math.min(...p):1,support=s.votes/books.length;
 const coverage=Math.min(1,s.quotes.length/Math.min(5,Math.max(2,books.length)));
 const known=s.quotes.map(q=>q.age).filter(x=>x!=null),age=known.length?known.reduce((a,b)=>a+b,0)/known.length:null;
 const freshness=age==null ? 0.35 : Math.max(0,1-age/180),consistency=Math.max(0,1-spread/Math.max(avg,.01));
 const rank=rows.filter(r=>{const v=stats.get(r).prob;return v.length&&v.reduce((a,b)=>a+b,0)/v.length<avg;}).length;
 const strength=rows.length>1?rank/(rows.length-1):1;
 let score=Math.round(35*support+25*strength+15*coverage+15*freshness+10*consistency);
 if(books.length===1)score=Math.min(score,45);else if(books.length===2)score=Math.min(score,65);
 return {score,agreementPct:Math.round(support*100),quoteCount:s.quotes.length,
  signal:books.length===1?"PROVISIONAL · SINGLE BOOKMAKER":books.length===2?"MODERATE · TWO BOOKMAKERS":score>=65?"STRONG MARKET AGREEMENT":score>=45?"MODERATE · VERIFY PRICE":"LOW DATA CONFIDENCE",
  impliedProbability:+(avg*100).toFixed(1),age};
}
function normaliseRunnerName(value){return String(value||"").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");}
function bookmakerFavourite(race,wantedKey) {
  const candidates=(race.runners||[]).map(runner=>{
    const quotes=freshestQuotesByBook(runner),match=quotes.find(x=>bookmakerMatches(x.key,wantedKey));
    if(!match)return null;
    const peers=quotes.filter(x=>x.key!==match.key).map(x=>x.price),deviation=quoteDeviation(match.price,peers),q=match.q;
    return {name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",
      number:runner.number??runner.runner_number??runner.box??null,price:match.price,age:match.age,
      stale:false,suspended:false,scratched:runner.scratched===true,deviationPct:deviation,peerCount:peers.length,
      source:q.source||q.source_name||q.feed_source||(wantedKey==="bet365"?"Bet365-labelled public quote":wantedKey+"-labelled public quote"),
      url:q.event_url||q.market_url||q.url||q.source_url||BOOKMAKER_URLS[wantedKey]};
  }).filter(x=>x&&!x.scratched&&Number.isFinite(x.price)&&x.price>1);
  return candidates.sort((a,b)=>a.price-b.price)[0]||null;
}
function raceBookmakerPanel(bookmaker, favourite, overallFavourite) {
  const key=bookmaker.toLowerCase();
  const url=favourite&&favourite.url?favourite.url:BOOKMAKER_URLS[key];
  const extra=key==="bet365"
    ? '<a class="bookmaker-market-link" href="https://moviodds.com/racing?code=all&near=200" target="_blank" rel="noopener noreferrer">View public Bet365 racing board ↗</a><a class="bookmaker-market-link" href="https://extra.bet365.com.au/features/au/watch-racing-live" target="_blank" rel="noopener noreferrer">Open Bet365 racing ↗</a>'
    : '<a class="bookmaker-market-link" href="https://www.sportsbet.com.au/racing-schedule/horse/today" target="_blank" rel="noopener noreferrer">Sportsbet horse races ↗</a><a class="bookmaker-market-link" href="https://www.sportsbet.com.au/racing-schedule/greyhound/today" target="_blank" rel="noopener noreferrer">Sportsbet greyhound races ↗</a><a class="bookmaker-market-link" href="https://www.sportsbet.com.au/racing-schedule/harness/today" target="_blank" rel="noopener noreferrer">Sportsbet harness races ↗</a>';
  const runner=favourite?(favourite.number!=null?favourite.number+". ":"")+favourite.name:"";
  const freshness=favourite
    ? (favourite.suspended?" · SUSPENDED":favourite.stale?" · STALE PUBLIC PRICE":favourite.age==null?" · quote age unavailable":" · "+Math.round(Number(favourite.age))+"s old")
    : "";
  const details=favourite
    ? '<div class="book-fav-runner">'+esc(runner)+'</div><div class="book-fav-price">$'+Number(favourite.price).toFixed(2)+'</div><div class="book-fav-age">'+esc(favourite.displaySource|| (key==="bet365"?"Bet365 public racing feed":"Sportsbet fixed-win public quote"))+freshness+'</div>'+(favourite.isFallback?'<div class="book-fav-missing">Market estimate only. This is not a Sportsbet price; no other bookmaker odds are being passed off as Sportsbet.</div>':"")
    : '<div class="book-fav-missing">Sportsbet fixed-win price unavailable from the connected public feed. No other bookmaker odds are substituted.</div>';
  const heading=favourite&&favourite.isFallback?"Sportsbet favourite · estimated market proxy":esc(bookmaker)+" fixed-win favourite";
  return '<div class="book-fav"><div class="book-fav-label">'+heading+'</div>'+details+'<a class="bookmaker-market-link" href="'+esc(url||BOOKMAKER_URLS[key])+'" target="_blank" rel="noopener noreferrer">Open '+esc(bookmaker)+' race markets ↗</a>'+extra+'</div>';
}
function overallMarketFavouritePanel(favourite) {
  const details = favourite
    ? '<div class="book-fav-runner">'+esc(favourite.number!=null?favourite.number+'. ':'')+esc(favourite.name)+'</div><div class="book-fav-price">$'+Number(favourite.consensus).toFixed(2)+'</div><div class="book-fav-age">Median of '+favourite.quoteCount+' bookmaker quote(s) · '+esc(favourite.priceSource)+' · '+favourite.signalScore+'/100 market signal</div>'
    : '<div class="book-fav-missing">No fresh multi-bookmaker market consensus is available for this race.</div>';
  return '<div class="book-fav"><div class="book-fav-label">Overall market favourite · consensus</div>'+details+'</div>';
}
const BOOKMAKER_URLS={bet365:"https://www.bet365.com.au/",sportsbet:"https://www.sportsbet.com.au/horse-racing/australia-nz/betting"};
function bookmakerKeyForLink(q){
 const raw=String(q.key||q.bookmaker||q.name||q.bookmaker_name||q.site||"").toLowerCase().replace(/[^a-z0-9]/g,"");
 if(raw.includes("bet365"))return "bet365";if(raw.includes("sportsbet"))return "sportsbet";
 if(raw.includes("tabtouch"))return "tabtouch";if(raw==="tab"||raw.startsWith("tabau"))return "tab";
 if(raw.includes("pointsbet"))return "pointsbet";if(raw.includes("betright"))return "betright";
 if(raw.includes("ladbrokes"))return "ladbrokes";if(raw.includes("unibet"))return "unibet";
 if(raw.includes("palmer"))return "palmerbet";if(raw.includes("nextbet")||raw.includes("playup"))return "nextbet";
 if(raw.includes("neds"))return "neds";if(raw.includes("betdeluxe"))return "betdeluxe";
 if(raw.includes("betfair")||raw.includes("exchange"))return "";
 return raw;
}
function bookmakerDisplayName(key,quote){
 const labels={bet365:"Bet365",sportsbet:"Sportsbet",tab:"TAB",tabtouch:"TABtouch",pointsbet:"PointsBet",betright:"BetRight",ladbrokes:"Ladbrokes",unibet:"Unibet",palmerbet:"Palmerbet",nextbet:"NextBet",neds:"Neds",betdeluxe:"BetDeluxe"};
 return labels[key]||String(quote.bookmaker||quote.bookmaker_name||quote.name||quote.site||key).replace(/[_-]/g," ");
}
function allBookmakerFavourites(race){
 const books=new Map();
 for(const runner of race.runners||[])for(const q of fixedRunnerPrices(runner)){
  const key=bookmakerKeyForLink(q),price=Number(q.win_price??q.win??q.price),age=quoteAgeSeconds(q);
  if(!key||!Number.isFinite(price)||price<=1||q.stale===true||(age==null?q.public_demo!==true:age>=180))continue;
  if(!quoteIsCurrent(q))continue;
  const current=books.get(key);
  if(!current||(age!=null&&(current.age==null||age<current.age)))books.set(key,{key,bookmaker:bookmakerDisplayName(key,q),
   name:runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner",
   number:runner.number??runner.runner_number??runner.box??null,price,age,
   url:q.event_url||q.market_url||q.url||q.source_url||BOOKMAKER_URLS[key]||null});
 }
 return [...books.values()].sort((a,b)=>a.bookmaker.localeCompare(b.bookmaker));
}
function allBookFavouritePanel(f){
 const runner=(f.number!=null?f.number+". ":"")+f.name;
 const age=f.age==null?"Quote age unavailable · public snapshot unverified":"Quote age "+Math.round(f.age)+"s";
 const link=f.url&&String(f.url).startsWith("http")?'<a class="bookmaker-market-link" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">Open '+esc(f.bookmaker)+' ↗</a>':"";
 return '<div class="book-fav"><div class="book-fav-label">'+esc(f.bookmaker)+' public favourite</div><div class="book-fav-runner">'+esc(runner)+'</div><div class="book-fav-price">$'+f.price.toFixed(2)+'</div><div class="book-fav-age">'+esc(age)+' · '+(f.age==null?"shortest returned public price · age unverified":"shortest current price returned by this bookmaker")+"</div>"+link+'</div>';
}

function marketFavourite(race) {
  const rows=(race.runners||[]).filter(r=>r.scratched!==true).map(r=>({...r,_quotes:freshestQuotesByBook(r)}));
  const books=[...new Set(rows.flatMap(r=>r._quotes.map(q=>q.key)))];
  if(!books.length)return null;
  const stats=new Map(rows.map(r=>[r,{prob:[],votes:0,quotes:[]} ]));
  for(const book of books){
    const field=rows.map(r=>({runner:r,quote:r._quotes.find(q=>q.key===book)})).filter(x=>x.quote);
    const total=field.reduce((sum,x)=>sum+1/x.quote.price,0); if(!total)continue;
    const leader=field.slice().sort((a,b)=>(1/b.quote.price)-(1/a.quote.price))[0]?.runner;
    for(const x of field){const s=stats.get(x.runner);s.prob.push((1/x.quote.price)/total);s.quotes.push(x.quote);if(x.runner===leader)s.votes++;}
  }
  const candidates=rows.map(r=>{
    const s=stats.get(r),p=s.prob;if(!p.length)return null;
    const avg=p.reduce((a,b)=>a+b,0)/p.length,sorted=p.slice().sort((a,b)=>a-b),mid=sorted[Math.floor((sorted.length-1)/2)];
    const spread=p.length>1?Math.max(...p)-Math.min(...p):1,support=s.votes/books.length;
    const coverage=Math.min(1,s.quotes.length/Math.min(5,Math.max(2,books.length)));
    const age=s.quotes.reduce((n,q)=>n+(q.age??180),0)/s.quotes.length,freshness=Math.max(0,1-age/180);
    const consistency=Math.max(0,1-spread/Math.max(mid,.01));
    const rank=rows.filter(x=>{const v=stats.get(x).prob;return v.length&&v.reduce((a,b)=>a+b,0)/v.length<avg;}).length;
    const strength=rows.length>1?rank/(rows.length-1):1;
    let score=Math.round(35*support+25*strength+15*coverage+15*freshness+10*consistency);
    if(books.length===1)score=Math.min(score,45);
    else if(books.length===2)score=Math.min(score,65);
    const prices=s.quotes.map(q=>q.price).sort((a,b)=>a-b),consensus=prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2;
    return {...r,consensus,quoteCount:s.quotes.length,agreementPct:Math.round(support*100),impliedProbability:+(avg*100).toFixed(1),meanQuoteAge:Math.round(age),
      spreadPct:+((prices.length>1?(prices[prices.length-1]-prices[0])/consensus:1)*100).toFixed(1),priceSource:prices.length>1?'fresh multi-bookmaker median':'single fresh bookmaker quote',signalScore:score};
  }).filter(Boolean).sort((a,b)=>b.signalScore-a.signalScore||b.agreementPct-a.agreementPct||b.impliedProbability-a.impliedProbability||b.quoteCount-a.quoteCount);
  const fav=candidates[0];if(!fav)return null;fav.gapPct=candidates[1]?+(fav.impliedProbability-candidates[1].impliedProbability).toFixed(1):0;
  fav.signalLabel=books.length===1?'PROVISIONAL · SINGLE BOOKMAKER':books.length===2?'MODERATE · TWO BOOKMAKERS':fav.quoteCount>=3&&fav.agreementPct>=60&&fav.spreadPct<=15&&fav.signalScore>=65?'STRONG MARKET AGREEMENT':fav.quoteCount>=2&&fav.signalScore>=45?'MODERATE · VERIFY PRICE':'LOW DATA CONFIDENCE';
  return fav;
}
// Best available display fallback for the Sportsbet panel:
// 1) exact Sportsbet quote (fresh, then stale); 2) fresh overall market median;
// 3) stale overall market median. The source is always labelled honestly.
function sportsbetDisplayFavourite(race) {
 // Prefer a genuine Sportsbet fixed-win quote whenever one exists.
 const exact=bookmakerFavourite(race,"sportsbet");
 if(exact)return {...exact,displaySource:exact.stale?"Sportsbet-labelled stale public quote":"Sportsbet fixed-win public quote",isFallback:false};
 // If Sportsbet's own price is unavailable, calculate a clearly labelled estimate
 // from the available multi-bookmaker market consensus. This is NOT a Sportsbet
 // quote and must never be presented as Sportsbet odds.
 const estimate=marketFavourite(race);
 if(!estimate)return null;
 return {...estimate,price:estimate.consensus,displaySource:"Estimated favourite from "+estimate.quoteCount+" available market quote(s) · NOT Sportsbet odds",isFallback:true};
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
    ? (marketFavourite(b)?.signalScore ?? -1) - (marketFavourite(a)?.signalScore ?? -1)
    : new Date(a.start_time||0)-new Date(b.start_time||0));
  return rows;
}
function raceCard(r, live=false) {
  const fav = marketFavourite(r);
  const bet365Fav = bookmakerFavourite(r,"bet365");
  const sportsbetFav = sportsbetDisplayFavourite(r);
  const bookFavourites = allBookmakerFavourites(r).filter(f=>f.key!=="sportsbet");
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
      price:Number(q.win_price??q.win??q.price), age:quoteAgeSeconds(q), stale:!!q.stale, publicDemo:q.public_demo===true,
      url:q.source_link||q.source_url||q.url||null
    })).filter(q=>Number.isFinite(q.price)&&q.price>1)
      .sort((a,b)=>a.name.localeCompare(b.name)||a.price-b.price);
    const fresh=quotes.filter(q=>!q.stale&&((q.age!=null&&Number.isFinite(Number(q.age))&&Number(q.age)<180)||(q.age==null&&q.publicDemo)));
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
    <div>${fav ? `<div class="favourite-label">★ TOP MARKET CONSENSUS · ${esc(fav.signalLabel)}</div><div class="runner-name">${esc(fav.number ? fav.number+". " : "")}${esc(fav.name)}</div><div class="runner-sub">${fav.quoteCount} independent bookmaker quotes · ${fav.agreementPct||0}% agree on this runner · ${fav.impliedProbability||0}% normalised implied probability · ${fav.signalScore}/100 data score · ${fav.spreadPct}% price spread</div>` : `<div class="favourite-label">★ RACE FAVOURITE · WAITING FOR ODDS</div><div class="runner-name">No current win prices</div><div class="runner-sub">Waiting for bookmaker odds</div>`}</div>
    <div class="price-wrap"><div class="price">${fav ? "$"+price : "—"}</div><div class="price-caption">${fav ? esc(fav.priceSource) : "MARKET PRICE"}</div><div class="bet365">${bookFavourites.length+" bookmaker"+(bookFavourites.length===1?"":"s")+" priced"}</div></div>
    <div class="market-tag ${live?"soon-tag":""}">${live ? "IN PLAY" : (mins===0?"STARTING NOW":`IN ${mins} MIN`)}</div>
    <div class="bookmaker-favourites">${overallMarketFavouritePanel(fav)}${bookFavourites.map(allBookFavouritePanel).join("")}${!bet365Fav?raceBookmakerPanel("Bet365",null,fav):""}${!sportsbetFav?raceBookmakerPanel("Sportsbet",null,fav):""}</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are displayed separately and are never included in bookmaker consensus or fixed-odds rankings.</span></div>
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
function sportFavourite(event,wantedBookmaker){const rows=sportRankings(event,wantedBookmaker);return rows[0]||null;}
function sportRankings(event,wantedBookmaker){
 const books=new Map();
 for(const b of event.bookmakers||[]){
  const key=normaliseBookmakerKey(b.key||b.title||b.name||'unknown');if(wantedBookmaker&&!bookmakerMatches(key,wantedBookmaker))continue;
  const stamp=b.last_update||b.updated_at||b.lastUpdate||null,parsed=stamp?Date.parse(stamp):NaN,age=Number.isFinite(parsed)?Math.max(0,(Date.now()-parsed)/1000):null;
  if(age!=null&&age>=180)continue;
  const outcomes=(b.markets||[]).filter(m=>['h2h','head_to_head'].includes(String(m.key||'').toLowerCase())).flatMap(m=>m.outcomes||[]).map(o=>({name:String(o.name||''),price:Number(o.price)})).filter(o=>o.name&&o.price>1&&Number.isFinite(o.price));
  if(!outcomes.length)continue;const old=books.get(key);if(!old||(age??999999)<(old.age??999999))books.set(key,{age,outcomes});
 }
 if(wantedBookmaker){const values=new Map();for(const b of books.values())for(const o of b.outcomes){if(!values.has(o.name))values.set(o.name,[]);values.get(o.name).push(o.price);}return [...values.entries()].map(([name,p])=>({name,price:p.reduce((a,b)=>a+b,0)/p.length,books:p.length,score:0})).sort((a,b)=>a.price-b.price);}
 const names=new Set([...books.values()].flatMap(b=>b.outcomes.map(o=>o.name))),stats=new Map([...names].map(n=>[n,{prob:[],votes:0,prices:[],ages:[]}]));
 for(const b of books.values()){const total=b.outcomes.reduce((s,o)=>s+1/o.price,0),leader=b.outcomes.slice().sort((a,z)=>(1/z.price)-(1/a.price))[0];for(const o of b.outcomes){const s=stats.get(o.name);s.prob.push((1/o.price)/total);s.prices.push(o.price);s.ages.push(b.age);if(leader&&leader.name===o.name)s.votes++;}}
 return [...stats.entries()].map(([name,s])=>{
  const avg=s.prob.reduce((a,b)=>a+b,0)/s.prob.length,sorted=s.prob.slice().sort((a,b)=>a-b),mid=sorted[Math.floor((sorted.length-1)/2)],spread=s.prob.length>1?Math.max(...s.prob)-Math.min(...s.prob):1,support=s.votes/Math.max(1,books.size);
  const coverage=Math.min(1,s.prices.length/Math.min(5,Math.max(2,books.size))),known=s.ages.filter(x=>x!=null),fresh=known.length?Math.max(0,1-known.reduce((a,b)=>a+b,0)/known.length/180):.35,consistency=Math.max(0,1-spread/Math.max(mid,.01));
  const rank=[...stats.values()].filter(x=>x.prob.reduce((a,b)=>a+b,0)/x.prob.length<avg).length,strength=stats.size>1?rank/(stats.size-1):1,score=Math.round(35*support+25*strength+15*coverage+15*fresh+10*consistency);
  const p=s.prices.slice().sort((a,b)=>a-b),price=p.length%2?p[(p.length-1)/2]:(p[p.length/2-1]+p[p.length/2])/2;
  return {name,price,books:s.prices.length,score,agreementPct:Math.round(support*100),impliedProbability:+(avg*100).toFixed(1),spread:+(spread*100).toFixed(1)};
 }).sort((a,b)=>b.score-a.score||b.agreementPct-a.agreementPct||b.impliedProbability-a.impliedProbability||b.books-a.books);
}
function renderTopTips() {
 const el=$("bestTipsList");if(!el)return;
 const raceRows=(state.races||[]).filter(r=>{const t=Date.parse(r.start_time||"");return !Number.isFinite(t)||t>=Date.now()||isExplicitlyLive(r);});
 const sportsbetPicks=[],bet365Picks=[],bet365Priced=[],racePicks=[],sportPicks=[],sportsbetSportPicks=[],pricedTips=[],sportsbetPriced=[];
 for(const r of raceRows){
  const event=(r.venue||r.track_name||"Track")+" "+(r.race_number?"R"+r.race_number:""),category=categoryOf(r).toUpperCase(),time=r.start_time;
  const sb=sportsbetDisplayFavourite(r);
  const sbPick={kind:"RACING",category,event,selection:sb?(sb.number?sb.number+". ":"")+sb.name:"No priced favourite available",odds:sb?sb.price:null,time,source:sb?sb.displaySource:"No Sportsbet-labelled public runner price returned",score:sb?(sb.quoteCount||1):0,quotes:sb?(sb.quoteCount||1):0,signal:sb?(sb.isFallback?"SPORTSBET PRICE":"SPORTSBET PRICE · "+(sb.stale?"STALE":"PUBLIC")):"PRICE UNAVAILABLE"};
  sportsbetPicks.push(sbPick);if(sb)sportsbetPriced.push(sbPick);
  const b365=bookmakerFavourite(r,"bet365");
  const b365Signal=b365?runnerConsensusSignal(r,b365):null;
  const b365Tip={kind:"BET365 RACING",category,event,selection:b365?(b365.number?b365.number+". ":"")+b365.name:"No verified Bet365 favourite",odds:b365?b365.price:null,time,
   source:b365?(b365.source||"Bet365-labelled public quote")+" · "+(b365.age==null?"quote age unavailable":Math.round(b365.age)+"s quote age")+" · "+(b365Signal?.agreementPct||0)+"% cross-book agreement":"No current Bet365 quote returned",
   score:b365Signal?.score||0,quotes:b365Signal?.quoteCount||0,signal:b365?(b365Signal?.signal||"PROVISIONAL · BET365 PRICE"):"PRICE UNAVAILABLE"};
  bet365Picks.push(b365Tip);if(b365)bet365Priced.push(b365Tip);
  const fav=marketFavourite(r);
  const tip=fav?{kind:"RACING",category,event,selection:(fav.number?fav.number+". ":"")+fav.name,odds:fav.consensus,score:fav.signalScore||0,source:fav.priceSource+" · "+(fav.agreementPct||0)+"% bookmaker agreement · "+(fav.meanQuoteAge??"n/a")+"s average quote age",time,quotes:fav.quoteCount||0,signal:fav.signalLabel||"MARKET FAVOURITE"}:{kind:"RACING",category,event,selection:"Favourite not confirmed",odds:null,score:0,source:"No fresh fixed-odds quotes returned",time,quotes:0,signal:"AWAITING PRICE"};
  racePicks.push(tip);if(fav)pricedTips.push(tip);
 }
 for(const e of state.sportEvents||[]){
  const t=e.commence_time?Date.parse(e.commence_time):NaN;if(Number.isFinite(t)&&t<Date.now()&&e.in_play!==true)continue;
  const ranks=sportRankings(e);if(!ranks.length)continue;
  const f=ranks[0],books=f.books||0;
  const tip={kind:"SPORT",category:e._sport||e.sport||e.sport_name||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:f.name,odds:f.price,score:f.score||0,source:books+" bookmaker quote"+(books===1?"":"s")+" · "+(f.agreementPct||0)+"% market agreement · "+(f.impliedProbability||0)+"% implied probability",time:e.commence_time,quotes:books,signal:"MARKET AGREEMENT"};
  sportPicks.push(tip);pricedTips.push(tip);
  const sbSport=sportFavourite(e,"sportsbet");if(sbSport)sportsbetSportPicks.push({kind:"SPORTSBET SPORT",category:e._sport||e.sport||e.sport_name||"SPORT",event:(e.away_team||"")+(e.home_team?" @ "+e.home_team:""),selection:sbSport.name,odds:sbSport.price,score:0,source:"Sportsbet-labelled public sports quote",time:e.commence_time,quotes:sbSport.books||1,signal:"SPORTSBET PUBLIC PRICE"});
 }
 const today=new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"});
 const todays=pricedTips.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const ranked=(a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds;
 const bestDay=(todays.length?todays:pricedTips).slice().sort(ranked).slice(0,10);
 const topTips=pricedTips.slice().sort(ranked).slice(0,20);
 const bet365Today=bet365Priced.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today);
 const bet365BestDay=(bet365Today.length?bet365Today:bet365Priced).slice().sort(ranked).slice(0,10);
 const bet365TopTips=bet365Priced.slice().sort(ranked).slice(0,20);
 const sportsbetBestOfDay=sportsbetPriced.filter(t=>!t.time||new Date(t.time).toLocaleDateString("en-AU",{timeZone:"Australia/Brisbane"})===today)
   .sort((a,b)=>b.score-a.score||b.quotes-a.quotes||a.odds-b.odds).slice(0,10);
 const sportsbetTopTips=sportsbetPriced.slice().sort((a,b)=>a.odds-b.odds);
 const card=(t,i,label)=>'<article class="sport-event"><div class="sport-event-heading"><b>#'+(i+1)+' · '+esc(t.selection)+'</b><span class="sport-upcoming-label">'+esc(label||t.kind||"RACING")+'</span></div><div>'+esc(t.event)+' · '+esc(t.category||"")+' · '+esc(t.time?fmtDate(t.time)+" "+fmtTime(t.time):"Time TBA")+'</div><div class="sport-favourite">Odds: <strong>'+(Number.isFinite(Number(t.odds))&&Number(t.odds)>1?'$'+Number(t.odds).toFixed(2):"Unavailable")+'</strong> · '+(t.quotes||0)+' quote'+((t.quotes||0)===1?"":"s")+' · signal '+(t.score||0)+'/100 · '+esc(t.signal||"")+'</div><small>'+esc(t.source||"Public snapshot")+' · market indicator only, not a prediction or guaranteed winner.</small></article>';
 const section=(title,description,items,empty)=>'<section class="tip-section"><h3>'+title+' <span>'+items.length+'</span></h3><p class="sub">'+description+'</p>'+(items.length?items.map((x,i)=>card(x,i,title)).join(""):'<div class="empty compact-empty">'+empty+'</div>')+'</section>';
 el.innerHTML=section("BEST OF THE DAY · RACING + SPORTS","Top 10 selections ranked by bookmaker agreement, normalised implied probability, quote coverage, freshness and price consistency — not shortest odds. Market indicator only, not a prediction.",bestDay,"No fresh priced race or sports favourites are available for today's shortlist.")
 +section("SPORTSBET BEST OF THE DAY","Only exact Sportsbet-labelled runner prices are used. Other bookmakers and overall-market prices are never substituted.",sportsbetBestOfDay,"No Sportsbet-labelled public runner prices were returned for today's races.")
 +section("SPORTSBET TOP TIPS · ALL RACES","All priced Sportsbet-labelled favourites returned by the public horse, greyhound and harness racing feeds. Other bookmaker and market prices are excluded.",sportsbetTopTips,"No Sportsbet-labelled public runner prices are available in the returned racing sample.")
 +section("SPORTSBET FAVOURITES · EVERY RACE","One entry for every returned race. The Sportsbet price is shown only when a Sportsbet-labelled public runner quote is present; otherwise the price is marked unavailable.",sportsbetPicks,"No upcoming races were returned by the racing feed.")
 +section("BET365 BEST OF THE DAY","Exact Bet365-labelled favourite prices, ranked by cross-book market support, quote coverage and freshness. Bet365 odds are never replaced with market estimates.",bet365BestDay,"No current Bet365-labelled race prices were returned.")
 +section("BET365 TOP TIPS · ALL RACES","Bet365's own favourite for each race, ranked by independent market agreement and data quality; one-bookmaker picks remain provisional.",bet365TopTips,"No Bet365-labelled public runner prices are available.")
 +section("BET365 FAVOURITES · EVERY RACE","Separate Bet365-labelled favourite for every returned upcoming/live race. Only Bet365-labelled prices are shown.",bet365Picks,"No upcoming races were returned by the racing feed.")
 +section("TOP TIPS · ALL RACES + SPORTS","Top 20 selections across all returned horse, greyhound, harness and sports events, ranked by market agreement and data quality rather than shortest odds.",topTips,"No priced favourites are available from the current public feeds.")
 +section("RACE FAVOURITES · EVERY RACE","Market favourite for each returned race, including races awaiting prices.",racePicks,"No upcoming races were returned by the racing feed.")
 +section("SPORTSBET SPORTS FAVOURITES · ALL RETURNED SPORTS","Only Sportsbet-labelled public head-to-head prices are shown here; other bookmaker prices and market estimates are not substituted.",sportsbetSportPicks,"No Sportsbet-labelled public sports prices were returned for the loaded fixtures.")
 +section("SPORTS FAVOURITES · EVERY SPORT","Priced favourites from all loaded live and upcoming sports fixtures.",sportPicks,"No sports fixtures with usable public head-to-head prices are available.");
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
function isSportEventLive(e){const s=String(e.status||e.state||e.event_status||"").toLowerCase();return e.in_play===true||e.live===true||["live","in_play","in-play","started","in progress"].includes(s);}
function renderSports(){
 const catalogue=$("sportsCatalogue"),list=$("sportsEvents");if(!catalogue||!list)return;
 catalogue.innerHTML=(state.sports||[]).map(s=>'<button class="sport-chip '+(state.selectedSport===s.key?"selected":"")+'" data-sport="'+esc(s.key)+'">'+esc(s.title||s.key)+'</button>').join("");
 const events=(state.sportEvents||[]).slice().filter(e=>isSportEventLive(e)||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now()).sort((a,b)=>{
  const al=isSportEventLive(a),bl=isSportEventLive(b);if(al!==bl)return al?-1:1;
  const ta=Date.parse(a.commence_time||""),tb=Date.parse(b.commence_time||"");
  if(!Number.isFinite(ta)&&!Number.isFinite(tb))return 0;if(!Number.isFinite(ta))return 1;if(!Number.isFinite(tb))return -1;return ta-tb;
 });
 const liveEvents=events.filter(isSportEventLive),upcomingEvents=events.filter(e=>!isSportEventLive(e));
 const renderCard=e=>{
  const ranks=sportRankings(e),sb=sportFavourite(e,"sportsbet"),b365=sportFavourite(e,"bet365"),f=ranks[0];
  const start=e.commence_time?new Date(e.commence_time).toLocaleString("en-AU",{timeZone:"Australia/Brisbane",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:true}):"Start time TBA";
  const bookText=(e.bookmakers||[]).map(b=>{
   const markets=(b.markets||[]).filter(m=>["h2h","head_to_head"].includes(String(m.key||"").toLowerCase()));
   const outs=markets.flatMap(m=>m.outcomes||[]).filter(o=>Number(o.price)>1).map(o=>esc(o.name)+" $"+Number(o.price).toFixed(2));
   return outs.length?'<div class="live-bookmaker"><b>'+esc(b.name||b.key||"Bookmaker")+'</b> · '+outs.join(" · ")+'</div>':"";
  }).join("");
  const outcomes=ranks.length?'<div class="sport-ranked-outcomes">'+ranks.map((x,i)=>'<span>'+(i+1)+'. '+esc(x.name)+' <b>$'+Number(x.price).toFixed(2)+'</b> · '+x.books+' quote'+(x.books===1?"":"s")+'</span>').join("")+'</div>':'<div class="empty compact-empty">No current head-to-head prices returned.</div>';
  const bookmakerFavourites='<div class="sport-book-favs"><span>Sportsbet: <b>'+(sb?esc(sb.name)+' $'+Number(sb.price).toFixed(2):"price unavailable")+'</b></span><span>Bet365: <b>'+(b365?esc(b365.name)+' $'+Number(b365.price).toFixed(2):"price unavailable")+'</b></span><span>Overall market: <b>'+(f?esc(f.name)+' $'+Number(f.price).toFixed(2):"not confirmed")+'</b></span></div>';
  return '<article class="sport-event"><div class="sport-event-heading"><b>'+esc(e.away_team||"Team TBA")+' @ '+esc(e.home_team||"Team TBA")+'</b><span class="sport-upcoming-label">'+(isSportEventLive(e)?"LIVE · IN PLAY":"UPCOMING")+'</span></div><div class="sport-league">'+esc(e.sport_name||e._sport||"SPORT")+(e.league?" · "+esc(e.league):"")+'</div><div class="sport-start-info">'+esc(start)+'</div>'+bookmakerFavourites+outcomes+'<details><summary>All returned bookmaker markets</summary><div class="live-bookmakers">'+(bookText||"No bookmaker market prices returned for this fixture.")+'</div></details><div class="sportsbook-links"><a href="https://www.bet365.com.au/" target="_blank" rel="noopener noreferrer">Open Bet365 markets ↗</a><a href="https://www.sportsbet.com.au/" target="_blank" rel="noopener noreferrer">Open Sportsbet markets ↗</a></div></article>';
 };
 list.innerHTML=events.length?'<section class="race-list-group"><h3>LIVE NOW <span>'+liveEvents.length+'</span></h3>'+(liveEvents.length?liveEvents.map(renderCard).join(""):'<div class="empty compact-empty">No fixtures are currently marked live by the sports feed.</div>')+'</section><section class="race-list-group"><h3>UPCOMING <span>'+upcomingEvents.length+'</span></h3>'+(upcomingEvents.length?upcomingEvents.map(renderCard).join(""):'<div class="empty compact-empty">No upcoming fixtures returned at this refresh.</div>')+'</section>':'<div class="empty">No live or upcoming fixtures were returned by the connected public sports feeds at this refresh. Sportsbet prices remain unavailable unless the public source labels a quote Sportsbet.</div>';
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
   $("sportsNotice").textContent="Loading live and upcoming fixtures · "+Math.min(start+batch.length,state.sports.length)+" of "+state.sports.length+" sports…";
   const results=await Promise.allSettled(batch.map(async s=>{
    const response=await fetch("/api/public-sports/"+encodeURIComponent(s.key)+"?mode=all");
    const data=await response.json();if(!response.ok)throw Error(data.error||"Feed unavailable");
    const events=(data.events||[]).filter(e=>isSportEventLive(e)||!e.commence_time||new Date(e.commence_time).getTime()>=Date.now());
    return {sport:s,events,errors:data.providerErrors||[]};
   }));
   for(let i=0;i<results.length;i++){
    const result=results[i];if(result.status!=="fulfilled"){failed++;continue;}
    const {sport,events,errors}=result.value;state.sportsByKey[sport.key]=events;recordSportTrends(sport.key,events);loaded++;if(errors.length)failed++;
   }
   state.sportEvents=Object.entries(state.sportsByKey).flatMap(([sport,events])=>events.map(e=>({...e,_sport:sport}))).sort((a,b)=>{const al=isSportEventLive(a),bl=isSportEventLive(b);if(al!==bl)return al?-1:1;const ta=Date.parse(a.commence_time||""),tb=Date.parse(b.commence_time||"");if(!Number.isFinite(ta)&&!Number.isFinite(tb))return 0;if(!Number.isFinite(ta))return 1;if(!Number.isFinite(tb))return -1;return ta-tb;});
   renderSports();renderTopTips();
  }
  state.selectedSport=null;state.allSportsLoaded=true;
  $("sportsNotice").textContent="Loaded "+state.sportEvents.length+" live/upcoming fixtures across "+loaded+" of "+state.sports.length+" sports. "+(failed?failed+" feeds were incomplete or unavailable.":"All queried feeds responded.")+" Public feeds only return events and prices actually published; missing prices are not guessed.";
 }catch(e){$("sportsNotice").textContent="Some public sports feeds are temporarily unavailable. "+e.message;}
 finally{btn.disabled=false;}
}
function setMainView(view){
 state.sportsMode=view==="sports";document.body.classList.toggle("sports-mode",state.sportsMode);
 document.querySelectorAll(".main-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
 if(state.sportsMode)loadSports();
}
function raceActivityScore(r) {
  const runners=Array.isArray(r.runners)?r.runners:[];
  const quotes=runners.reduce((n,x)=>n+fixedRunnerPrices(x).filter(q=>!q.stale&&(quoteAgeSeconds(q)==null?q.public_demo===true:quoteAgeSeconds(q)<180)).length,0);
  return runners.length*2+quotes*3+(marketFavourite(r)?8:0);
}
function renderFeedStatusRows(health){
 const rows=[["horse","🐎 HORSE RACING"],["greyhound","🐕 GREYHOUND RACING"],["harness","🏇 HARNESS RACING"]].map(([key,label])=>{
  const item=health?.racing?.byCode?.[key],status=health?.racing?.status||"checking";
  const dot=status==="active"?"active":status==="partial"?"partial":status==="offline"?"offline":"checking";
  const count=item?.races??0,live=item?.live??0;
  const message=status==="offline"?"FEED OFFLINE":status==="checking"?"CHECKING FEED":live+" LIVE · "+count+" RACES RETURNED";
  return '<div class="feed-status-item"><span class="feed-dot '+dot+'"></span><span><b>'+label+'</b><small>'+message+'</small></span></div>';
 }).join("");
 const liveStatus=health?.liveSports?.status||"checking";
 const sports=Object.values(health?.sports||{});
 const connectedSports=sports.filter(x=>x.status==="active"||x.status==="partial").length;
 const fullyActiveSports=sports.filter(x=>x.status==="active").length;
 const sportCount=health?.liveSports?.eventCount??0;
 const sportStatus=sports.length?(fullyActiveSports===sports.length?"active":connectedSports?"partial":"offline"):liveStatus;
 const sportsRow='<div class="feed-status-item"><span class="feed-dot '+sportStatus+'"></span><span><b>🏆 ALL SPORTS</b><small>'+(sportStatus==="offline"?"FEEDS OFFLINE":sportStatus==="checking"?"CHECKING SPORTS FEEDS":connectedSports+"/"+sports.length+" SPORTS FEEDS RESPONDING · "+sportCount+" LIVE EVENTS")+'</small></span></div>';
 for(const id of ["entryFeedStatuses","dashboardFeedStatuses"]){const el=$(id);if(el)el.innerHTML=rows+sportsRow;}
 const headerDot=document.querySelector(".top-right .live-dot");
 if(headerDot){headerDot.className="live-dot "+(health?.racing?.status==="active"?"active":health?.racing?.status==="partial"?"partial":health?.racing?.status==="offline"?"offline":"checking");}
}
async function loadFeedStatus(){
 try{const r=await fetch("/api/feed-status",{cache:"no-store"});if(!r.ok)throw Error("Feed status unavailable");
  state.feedHealth=await r.json();renderFeedStatusRows(state.feedHealth);updateEntryHorseStatus();
 }catch(e){renderFeedStatusRows(null);}
}
function updateEntryHorseStatus() {
 const el=$("entryHorseStatus");if(!el)return;
 const status=state.feedHealth?.racing?.status||"checking";
 el.classList.remove("checking","active","upcoming","partial","offline");
 el.classList.add(status==="active"?"active":status==="partial"?"partial":status==="offline"?"offline":"checking");
 const horse=state.feedHealth?.racing?.byCode?.horse||{races:0,live:0};
 el.querySelector("small").textContent=status==="offline"?"HORSE RACING FEED OFFLINE":status==="checking"?"CHECKING HORSE RACING FEED":horse.live+" LIVE NOW · "+horse.races+" RACES RETURNED · "+status.toUpperCase();
}
function render() {
  const rows = filteredRaces().filter(r => {
    const t = Date.parse(r.start_time||"");
    return isExplicitlyLive(r) || !Number.isFinite(t) || t >= Date.now();
  }).sort((a,b) => {
    const al=isExplicitlyLive(a), bl=isExplicitlyLive(b);
    if(al!==bl)return al?-1:1;
    if(al&&bl)return raceActivityScore(b)-raceActivityScore(a)||(Date.parse(a.start_time||0)-Date.parse(b.start_time||0));
    const ta=Date.parse(a.start_time||""), tb=Date.parse(b.start_time||"");
    if(!Number.isFinite(ta)&&!Number.isFinite(tb))return raceActivityScore(b)-raceActivityScore(a);
    if(!Number.isFinite(ta))return 1;
    if(!Number.isFinite(tb))return -1;
    return ta-tb||raceActivityScore(b)-raceActivityScore(a);
  });
  updateEntryHorseStatus();
  const live=rows.filter(isExplicitlyLive);
  const upcoming=rows.filter(r=>!isExplicitlyLive(r));
  $("raceCount").textContent=rows.length;
  $("horseCount").textContent=rows.filter(r=>categoryOf(r)==="horse").length;
  $("dogCount").textContent=rows.filter(r=>categoryOf(r)==="greyhound").length;
  $("harnessCount").textContent=rows.filter(r=>categoryOf(r)==="harness").length;
  const rowHtml=(r,isLive)=>{
    const type=categoryOf(r), venue=r.venue||r.track_name||r.venue_canonical||"Track TBA";
    const number=r.race_number||r.race_no||r.raceNumber||"—";
    const date=r.start_time?fmtDate(r.start_time):"Date/time TBA", time=r.start_time?fmtTime(r.start_time):"Jump time TBA";
    const publicDetails=[r.race_name||r.name,r.distance?(r.distance+"m"):null,r.grade||r.class||null,r.track_condition||r.trackCondition?("Track "+(r.track_condition||r.trackCondition)):null,r.weather?("Weather "+r.weather):null,r.prize_money?("Prize "+r.prize_money):null].filter(Boolean).map(esc).join(" · ");
    const fav=marketFavourite(r), favName=fav?(fav.name||fav.runner_name||fav.horse_name||fav.greyhound_name||"Runner"):"";
    const bookFavourites=allBookmakerFavourites(r);
    const favPanel=fav?'<div class="race-list-favourite"><div class="favourite-label">★ TOP MARKET CONSENSUS</div><b>'+(fav.number?esc(fav.number)+'. ':"")+esc(favName)+'</b><strong>$'+Number(fav.consensus).toFixed(2)+'</strong><small>'+esc(fav.signalLabel||"Market favourite")+' · '+(fav.quoteCount||0)+' bookmaker quotes</small></div>':'<div class="race-list-favourite"><div class="favourite-label">★ RACE FAVOURITE</div><b>Waiting for current bookmaker odds</b></div>';
    const runners=(r.runners||[]).slice().sort((a,b)=>(runnerFixedOdds(a)??999)-(runnerFixedOdds(b)??999));
    const runnerRows=runners.map((runner,rank)=>{
      const qs=fixedRunnerPrices(runner).map(q=>({book:q.bookmaker||q.bookmaker_name||q.name||q.site||q.key||"Bookmaker",price:Number(q.win_price??q.win??q.price),age:quoteAgeSeconds(q),stale:!!q.stale,publicDemo:q.public_demo===true})).filter(q=>Number.isFinite(q.price)&&q.price>1).sort((a,b)=>a.price-b.price);
      const fresh=qs.filter(q=>!q.stale&&((q.age!=null&&Number.isFinite(q.age)&&q.age<180)||(q.age==null&&q.publicDemo))), prices=fresh.map(q=>q.price).sort((a,b)=>a-b);
      const estimate=prices.length?(prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2):null;
      const name=runner.name||runner.runner_name||runner.horse_name||runner.greyhound_name||"Runner", num=runner.number??runner.runner_number??runner.box, isFav=!!fav&&((fav.number!=null&&num!=null&&String(fav.number)===String(num))||(fav.number==null&&normaliseRunnerName(name)===normaliseRunnerName(favName)));
      const quoteHtml=qs.length?qs.map(q=>'<span class="runner-price-chip '+(q.stale||(q.age!=null&&q.age>=180)?"stale-quote":"")+'">'+esc(q.book)+' <b>$'+q.price.toFixed(2)+'</b>'+(q.stale||q.age==null||!Number.isFinite(q.age)||q.age>=180?(q.age==null?' · AGE UNVERIFIED':' · STALE'):' · CURRENT')+'</span>').join(""):'<span class="no-odds">No fixed bookmaker price</span>';
      return '<div class="race-runner-row '+(isFav?"is-market-favourite":"")+'"><span class="race-runner-rank">#'+(rank+1)+'</span><span class="race-runner-name">'+(num!=null?esc(num)+'. ':"")+esc(name)+(isFav?' <b class="fav-tag">FAVOURITE</b>':"")+'</span><strong class="race-runner-estimate">'+(estimate==null?"—":"$"+estimate.toFixed(2))+'</strong><small>'+(estimate==null?"Odds unavailable":"Market estimate $"+estimate.toFixed(2))+'</small><div class="runner-price-chips">'+quoteHtml+'</div></div>';
    }).join("");
    const bet365RaceFav=bookmakerFavourite(r,"bet365"), sportsbetRaceFav=sportsbetDisplayFavourite(r);
    const bookFavHtml='<div class="race-bookmaker-favourites"><b>Bookmaker favourites · prices and estimates clearly source-labelled</b>'+bookFavourites.map(allBookFavouritePanel).join("")+(!bet365RaceFav?raceBookmakerPanel("Bet365",null,fav):"")+raceBookmakerPanel("Sportsbet",sportsbetRaceFav,fav)+'</div>';
    const typeLabel=type==="horse"?"🐎 HORSE RACING":type==="greyhound"?"🐕 GREYHOUND RACING":"🏇 HARNESS RACING";
    return '<article class="race-list-card '+(isLive?"is-live":"")+'"><div class="race-list-card-head"><div><div class="race-type">'+typeLabel+'</div><h3>'+esc(venue)+' · R'+esc(number)+'</h3><div class="race-meta">'+esc(date)+' · '+esc(time)+'</div>'+(publicDetails?'<div class="race-meta race-public-details">'+publicDetails+'</div>':"")+'</div><span class="race-status">'+(isLive?"LIVE NOW":"UPCOMING")+'</span></div>'+favPanel+bookFavHtml+'<div class="race-runners-ranked"><div class="race-runners-heading">ALL RUNNERS · PRICE COMPARISON (CONSENSUS PICK ABOVE)</div>'+(runnerRows||'<div class="empty compact-empty">No runners supplied by the feed yet.</div>')+'</div><div class="exchange-reference"><b>BETFAIR EXCHANGE REFERENCE</b><span>Exchange prices are separate from bookmaker fixed odds and are not used to rank this list.</span></div></article>';
  };
  $("raceList").innerHTML=rows.length?'<section class="race-list-group"><h3>LIVE NOW <span>'+live.length+'</span></h3>'+(live.length?live.map(r=>rowHtml(r,true)).join(""):'<div class="empty compact-empty">The feed has not marked any race as live at this refresh.</div>')+'</section><section class="race-list-group"><h3>UPCOMING · SOONEST FIRST <span>'+upcoming.length+'</span></h3>'+(upcoming.length?upcoming.map(r=>rowHtml(r,false)).join(""):'<div class="empty compact-empty">No upcoming races returned right now.</div>')+'</section>':(state.feedMode==="public-widgets"?'<div class="empty">No imported race cards are available from the connected feeds at this refresh. Check the free live racing board above. <a href="#racingWidgets">Open live racing board ↗</a></div>':(state.feedMode==="demo"?'<div class="empty">No races in the free public preview at this moment.</div>':'<div class="empty">No Australian races returned by the connected feed at this refresh.</div>'));
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
    if(data.feedHealth){state.feedHealth={...(state.feedHealth||{}),racing:data.feedHealth};renderFeedStatusRows(state.feedHealth);}
    state.feedMode = data.mode || "live";
    updateEntryHorseStatus();
    $("feedStatus").textContent = state.feedMode === "public-widgets" ? "PUBLIC WIDGETS" : state.feedMode === "demo" ? "FREE PUBLIC DEMO · NO KEY" : (data.feedErrors && data.feedErrors.length ? "LIVE FEED · PARTIAL" : "LIVE FEED");
    $("updatedAt").textContent = new Date(data.fetchedAt || Date.now()).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const books = (data.providerBookmakers || []).length;
    $("feedFreshness").textContent = state.feedMode === "public-widgets"
      ? "Free live racing widgets are displayed above · no sample odds are generated."
      : state.feedMode === "demo"
        ? "Free no-key public preview · " + books + " bookmaker feeds returned · limited race sample, not the full Australian card. Quote age is shown only when supplied."
        : "Screen refresh: 5 min · " + books + " bookmaker feeds with prices in this response · " + (data.scope || "provider coverage") + " · quote freshness varies by bookmaker.";
    $("notice").textContent = data.note || "Racing cards and prices appear only when a connected provider returns them. Free public feeds remain available below.";
    $("notice").classList.remove("hidden");
    render();
  } catch (err) {
    state.feedMode = "public-widgets";
    state.races = [];
    updateEntryHorseStatus();
    $("feedStatus").textContent = "FEED UNAVAILABLE";
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
$("allSportsViewBtn").addEventListener("click",()=>{state.sportsbetOnly=false;$("allSportsViewBtn").classList.add("active");$("sportsbetSportsOnlyBtn").classList.remove("active");renderSports();});
$("sportsbetSportsOnlyBtn").addEventListener("click",()=>{state.sportsbetOnly=true;$("sportsbetSportsOnlyBtn").classList.add("active");$("allSportsViewBtn").classList.remove("active");if(!state.allSportsLoaded)loadAllSports();else renderSports();});
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
    if ($("harnessRecord")) $("harnessRecord").textContent = codeText(s.harness || {races:0,wins:0,strikeRate:null});
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
  if(dashboardFeedsStarted){loadRaces();loadLiveSports();loadFeedStatus();return;}
  dashboardFeedsStarted=true;
  loadRaces();
  loadFeedStatus();
  loadSports().then(loadLiveSports);
  loadHistory();
  loadMarketHistory();
};
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60*1000);
setInterval(loadFeedStatus,15000);
setInterval(()=>{if(state.sportsMode&&state.selectedSport)loadSportOdds(state.selectedSport);},15000);
setInterval(()=>{if(state.sportsMode)loadLiveSports();},10000);
setInterval(loadMarketHistory,30000);
setInterval(syncHistory,15*60*1000);
// Start background checks before the welcome screen is dismissed so its activity dots are real.
if(document.readyState==="complete")window.startFullDashboardFeeds();
else window.addEventListener("load",()=>window.startFullDashboardFeeds(),{once:true});
