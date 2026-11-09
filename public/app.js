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
function runnerPrices(runner) { return (runner.bookmakers || []).filter(b => Number(b.win_price) > 1 && !b.stale); }
function marketFavourite(race) {
  const runners = (race.runners || []).map(r => {
    const quotes = runnerPrices(r);
    if (!quotes.length) return null;
    const sorted = quotes.map(q => Number(q.win_price)).sort((a,b)=>a-b);
    const median = sorted[Math.floor((sorted.length-1)/2)];
    const b365 = quotes.find(q => ["bet365","bet_365"].includes(String(q.key || q.bookmaker || "").toLowerCase()));
    return {...r, consensus: b365 ? Number(b365.win_price) : median, bet365: b365?.win_price, quoteCount: quotes.length, priceSource: b365 ? "Bet365" : "market median"};
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
  const type = categoryOf(r);
  const venue = r.venue || r.track_name || r.venue_canonical || "Track TBA";
  const number = r.race_number ? `R${r.race_number}` : "Race";
  const date = fmtDate(r.start_time);
  const time = fmtTime(r.start_time);
  const price = fav ? Number(fav.consensus).toFixed(2) : "—";
  const bet365 = fav?.bet365 ? ` · Bet365 <b>$${Number(fav.bet365).toFixed(2)}</b>` : " · Bet365 quote unavailable";
  const mins = Math.max(0,Math.ceil((new Date(r.start_time).getTime()-Date.now())/60000));
  return `<article class="race-card ${live?"live-race-card":""}">
    <div><div class="race-type">${type==="horse"?"🐎 HORSE RACING":"🐕 GREYHOUND RACING"}</div>
      <div class="race-title">${esc(venue)} <span style="color:#728395">${number}</span></div>
      <div class="race-meta">${date} ${r.distance_m ? "· "+r.distance_m+"m" : ""}</div>
      <div class="race-time">${time}</div></div>
    <div>${fav ? `<div class="favourite-label">★ MARKET FAVOURITE</div><div class="runner-name">${esc(fav.number ? fav.number+". " : "")}${esc(fav.name)}</div><div class="runner-sub">${fav.quoteCount} bookmaker quote${fav.quoteCount===1?"":"s"} · ${esc(fav.priceSource)}${fav.quoteCount===1?" · LIMITED DATA":fav.quoteCount===2?" · CHECK CONSENSUS":""}</div>` : `<div class="favourite-label">FAVOURITE UNAVAILABLE</div><div class="runner-name">No current win prices</div><div class="runner-sub">Waiting for bookmaker odds</div>`}</div>
    <div class="price-wrap"><div class="price">${fav ? "$"+price : "—"}</div><div class="price-caption">${fav ? esc(fav.priceSource) : "MARKET PRICE"}</div><div class="bet365">${fav ? bet365 : "No quote"}</div></div>
    <div class="market-tag ${live?"soon-tag":""}">${live ? (mins===0?"STARTING NOW":`IN ${mins} MIN`) : (r.stale ? "Check price freshness" : "Odds feed")}</div>
  </article>`;
}
function render() {
  const horses = state.races.filter(r=>categoryOf(r)==="horse").length;
  $("raceCount").textContent = state.races.length;
  $("horseCount").textContent = horses;
  $("dogCount").textContent = state.races.length-horses;
  const rows = filteredRaces();
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
    $("feedStatus").textContent = data.mode === "live" ? "LIVE FEED" : "FEED OFFLINE";
    $("updatedAt").textContent = new Date(data.fetchedAt).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    $("notice").textContent = data.note || "Live racing prices are indicative. Check the bookmaker's current market and scratchings before making any decision.";
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
// Poll at a conservative cadence; the data provider bills authenticated requests by credits.
setInterval(loadRaces,60000);
setInterval(syncHistory,15*60*1000);
