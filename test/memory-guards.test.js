"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  MOVI_WS_FIXTURE_LIMIT,
  MOVI_WS_QUOTES_PER_FIXTURE_LIMIT,
  trimInsertionOrderedMap,
  trimMoviOddsFixtures,
  trimQuoteList
}=require("../memory-guards");

test("insertion-ordered tracking maps are reduced below their hard limit",()=>{
  const map=new Map(Array.from({length:5100},(_,i)=>["k"+i,i]));
  const remaining=trimInsertionOrderedMap(map,5000,4000);
  assert.equal(remaining,4000);
  assert.equal(map.has("k0"),false);
  assert.equal(map.has("k5099"),true);
});

test("live fixtures are retained ahead of expired fixtures",()=>{
  const now=Date.parse("2026-11-13T00:00:00Z");
  const rows=[
    {id:"old",kickoff_utc:"2026-11-12T10:00:00Z"},
    {id:"later",kickoff_utc:"2026-11-14T00:00:00Z"},
    {id:"live",in_play:true,kickoff_utc:"2026-11-12T00:00:00Z"},
    {id:"soon",kickoff_utc:"2026-11-13T01:00:00Z"}
  ];
  trimMoviOddsFixtures(rows,{now,staleMs:6*60*60*1000});
  assert.deepEqual(rows.map(x=>x.id),["live","soon","later"]);
});

test("fixture cache has a strict maximum size",()=>{
  const rows=Array.from({length:MOVI_WS_FIXTURE_LIMIT+50},(_,i)=>({
    id:String(i),kickoff_utc:new Date(Date.UTC(2026,10,14,0,i)).toISOString()
  }));
  trimMoviOddsFixtures(rows,{now:Date.parse("2026-11-13T00:00:00Z")});
  assert.equal(rows.length,MOVI_WS_FIXTURE_LIMIT);
});

test("fixture trimming preserves live-first and soonest-first order without overflow",()=>{
  const rows=[{id:"later",kickoff_utc:"2026-11-14T00:00:00Z"},{id:"soon",kickoff_utc:"2026-11-13T01:00:00Z"},{id:"live",in_play:true,kickoff_utc:"2026-11-12T00:00:00Z"}];
  trimMoviOddsFixtures(rows,{now:Date.parse("2026-11-13T00:00:00Z")});
  assert.deepEqual(rows.map(x=>x.id),["live","soon","later"]);
});

test("quote arrays are bounded while preserving the newest entries",()=>{
  const rows=Array.from({length:MOVI_WS_QUOTES_PER_FIXTURE_LIMIT+25},(_,i)=>i);
  assert.deepEqual(trimQuoteList(rows).slice(0,2),[25,26]);
  assert.equal(trimQuoteList(rows).length,MOVI_WS_QUOTES_PER_FIXTURE_LIMIT);
  assert.deepEqual(trimQuoteList([1,2,3],5),[1,2,3]);
});
