"use strict";

const MOVI_WS_FIXTURE_LIMIT = 800;
const MOVI_WS_QUOTES_PER_FIXTURE_LIMIT = 100;

function trimInsertionOrderedMap(map, limit=5000, target=4000) {
  if (!(map instanceof Map)) throw new TypeError("Expected a Map.");
  if (!Number.isInteger(limit) || !Number.isInteger(target) || target<0 || target>limit)
    throw new RangeError("Invalid map retention limits.");
  if(map.size<=limit)return map.size;
  for(const key of map.keys()){
    map.delete(key);
    if(map.size<=target)break;
  }
  return map.size;
}

function fixtureStart(item) {
  const value=item?.kickoff_utc||item?.commence_time||item?.start_time||item?.startTime||"";
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
}

function compareFixturePriority(a,b) {
  const liveA=a?.in_play===true||a?.inPlay===true?0:1;
  const liveB=b?.in_play===true||b?.inPlay===true?0:1;
  if(liveA!==liveB)return liveA-liveB;
  return (fixtureStart(a)??Number.MAX_SAFE_INTEGER)-(fixtureStart(b)??Number.MAX_SAFE_INTEGER);
}

function trimMoviOddsFixtures(items, options={}) {
  if(!Array.isArray(items))throw new TypeError("Expected a fixture array.");
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const limit=Number.isInteger(options.limit)&&options.limit>0?options.limit:MOVI_WS_FIXTURE_LIMIT;
  const staleMs=Number.isFinite(options.staleMs)&&options.staleMs>=0?options.staleMs:6*60*60*1000;
  // Remove expired entries in place to avoid allocating a second fixture list
  // on every WebSocket message.
  for(let i=items.length-1;i>=0;i--){
    const item=items[i];
    if(item?.in_play===true||item?.inPlay===true)continue;
    const start=fixtureStart(item);
    if(start!=null&&start<now-staleMs)items.splice(i,1);
  }
  // Preserve live-first / soonest-first ordering, but sort only when an
  // incoming fixture actually makes the existing list out of order.
  let ordered=true;
  for(let i=1;i<items.length;i++){
    if(compareFixturePriority(items[i-1],items[i])>0){ordered=false;break;}
  }
  if(!ordered)items.sort(compareFixturePriority);
  if(items.length>limit)items.length=limit;
  return items;
}

function trimQuoteList(quotes, limit=MOVI_WS_QUOTES_PER_FIXTURE_LIMIT) {
  if(!Array.isArray(quotes))return [];
  if(!Number.isInteger(limit)||limit<1)throw new RangeError("Quote limit must be a positive integer.");
  return quotes.length>limit?quotes.slice(-limit):quotes;
}

module.exports = {
  MOVI_WS_FIXTURE_LIMIT,
  MOVI_WS_QUOTES_PER_FIXTURE_LIMIT,
  trimInsertionOrderedMap,
  trimMoviOddsFixtures,
  trimQuoteList
};
