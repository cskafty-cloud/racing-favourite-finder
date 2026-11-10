const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);
const APP_KEY = process.env.BETFAIR_APP_KEY || "";
const SESSION_TOKEN = process.env.BETFAIR_SESSION_TOKEN || "";
const RPC_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1";
let cache = { at: 0, payload: null };
let inflight = null;

async function rpc(method, params) {
  if (!APP_KEY || !SESSION_TOKEN) throw new Error("Betfair credentials are not configured on the Australian feed service.");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Application": APP_KEY,
      "X-Authentication": SESSION_TOKEN,
      "Accept": "application/json"
    },
    body: JSON.stringify([{ jsonrpc: "2.0", method: "SportsAPING/v1.0/" + method, params, id: 1 }]),
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error("Betfair API returned non-JSON HTTP " + response.status + " from the Australian region."); }
  const item = Array.isArray(data) ? data[0] : data;
  if (!response.ok || item?.error || item?.result == null) {
    const detail = item?.error?.data?.APINGException?.errorCode || item?.error?.message || "request failed";
    throw new Error("Betfair HTTP " + response.status + ": " + detail);
  }
  return item.result;
}

function category(eventType, eventName) {
  const value = (eventType + " " + eventName).toLowerCase();
  if (/greyhound/.test(value)) return "greyhound";
  if (/harness|trotting|pacing/.test(value)) return "harness";
  return "horse";
}

async function fetchRaces() {
  const eventTypes = await rpc("listEventTypes", { filter: { marketCountries: ["AU"] } });
  const types = (eventTypes || []).map(x => ({ id: String(x.eventType.id), name: x.eventType.name }));
  const racingTypes = types.filter(x => /horse racing|greyhound racing|harness racing/i.test(x.name));
  if (!racingTypes.length) throw new Error("Betfair returned no Australian racing event types.");

  const from = new Date();
  const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const groups = await Promise.all(racingTypes.map(async type => {
    const markets = await rpc("listMarketCatalogue", {
      filter: {
        eventTypeIds: [type.id], marketCountries: ["AU"], marketTypeCodes: ["WIN"],
        marketStartTime: { from: from.toISOString(), to: to.toISOString() }
      },
      marketProjection: ["EVENT", "MARKET_START_TIME", "RUNNER_DESCRIPTION", "MARKET_DESCRIPTION"],
      sort: "FIRST_TO_START", maxResults: "200"
    });
    return { type, markets: markets || [] };
  }));

  const all = groups.flatMap(group => group.markets.map(m => ({ ...m, _eventTypeName: group.type.name })));
  const books = [];
  for (let i = 0; i < all.length; i += 40) {
    const batch = all.slice(i, i + 40);
    const result = await rpc("listMarketBook", {
      marketIds: batch.map(m => m.marketId),
      priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true }
    });
    books.push(...(result || []));
  }
  const byId = new Map(books.map(b => [b.marketId, b]));
  const capturedAt = new Date().toISOString();
  const races = all.map(m => {
    const book = byId.get(m.marketId);
    if (!book || book.status !== "OPEN") return null;
    const venue = m.event?.name || "Unknown track";
    const raceType = category(m._eventTypeName, venue);
    const match = (venue + " " + (m.marketName || "")).match(/(?:race|r)\s*(\d+)/i);
    const runners = (m.runners || []).map(r => {
      const priced = (book.runners || []).find(x => x.selectionId === r.selectionId);
      const back = priced?.ex?.availableToBack || [];
      const lay = priced?.ex?.availableToLay || [];
      const price = back[0]?.price || lay[0]?.price || null;
      const quotes = price && Number(price) > 1 && priced?.status !== "REMOVED"
        ? [{ bookmaker: "Betfair Exchange (delayed)", name: "Betfair Exchange (delayed)", key: "betfair", win_price: Number(price), age_seconds: null, last_update: capturedAt, source: "Betfair Exchange" }]
        : [];
      return { number: r.sortPriority || null, name: r.runnerName, bookmakers: quotes };
    });
    return {
      race_id: "betfair-au-" + m.marketId, id: "betfair-au-" + m.marketId,
      category: raceType, code: raceType === "horse" ? "thoroughbred" : raceType,
      venue, track: venue, race_number: match ? Number(match[1]) : null,
      start_time: m.marketStartTime, country: "Australia",
      status: book.inplay ? "in_play" : "scheduled", in_play: !!book.inplay,
      closed: false, captured_at: capturedAt, market_id: m.marketId,
      market_name: m.marketName || "Win", runners
    };
  }).filter(Boolean);

  return {
    races, feedSource: "Betfair Exchange delayed · Australian region",
    scheduleFetchedAt: capturedAt, oddsFetchedAt: capturedAt, horizonHours: 24,
    scope: "Australia",
    note: "Australian horse, greyhound and harness markets from Betfair's delayed read-only API. Exchange prices may be delayed and are not bookmaker odds. No betting actions are available."
  };
}

async function getRaces() {
  if (cache.payload && Date.now() - cache.at < 30000) return cache.payload;
  if (!inflight) {
    inflight = fetchRaces().then(payload => {
      cache = { at: Date.now(), payload };
      return payload;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, region: "Australia", provider: "Betfair delayed read-only", credentialsConfigured: !!(APP_KEY && SESSION_TOKEN) }));
  }
  if (req.url !== "/api/races") {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  try {
    const payload = await getRaces();
    res.writeHead(200);
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error("BETFAIR_AU_PROXY_FAILED", error.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: error.message, feedSource: "Betfair AU proxy", races: [] }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.info("Betfair Australian read-only proxy listening on " + PORT);
});
