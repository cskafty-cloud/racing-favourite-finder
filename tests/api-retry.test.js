"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createRetryFetch}=require("../public/api-retry.js");

test("retries a transient 502 and returns the successful response",async()=>{
  let calls=0;const delays=[];
  const retry=createRetryFetch(async()=>({status:++calls===1?502:200,headers:{get:()=>null}}),async ms=>delays.push(ms));
  const response=await retry("/api/races");
  assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual(delays,[250]);
});

test("retries 503 and 504 with bounded exponential backoff",async()=>{
  let calls=0;const delays=[];
  const retry=createRetryFetch(async()=>({status:[503,504,200][calls++],headers:{get:()=>null}}),async ms=>delays.push(ms));
  const response=await retry("/api/betfair/sports");
  assert.equal(response.status,200);assert.equal(calls,3);assert.deepEqual(delays,[250,500]);
});

test("does not retry client errors",async()=>{
  let calls=0;
  const retry=createRetryFetch(async()=>{calls++;return {status:429,headers:{get:()=>null}};},async()=>{throw new Error("should not wait");});
  const response=await retry("/api/races");
  assert.equal(response.status,429);assert.equal(calls,1);
});

test("does not wrap external requests",async()=>{
  let calls=0;
  const retry=createRetryFetch(async(url)=>{calls++;return {status:502,url};},async()=>{});
  const response=await retry("https://example.com/data");
  assert.equal(response.status,502);assert.equal(calls,1);
});

test("retries transient network errors",async()=>{
  let calls=0;const delays=[];
  const retry=createRetryFetch(async()=>{calls++;if(calls===1)throw new TypeError("network down");return {status:200,headers:{get:()=>null}};},async ms=>delays.push(ms));
  const response=await retry("/api/health");
  assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual(delays,[250]);
});
