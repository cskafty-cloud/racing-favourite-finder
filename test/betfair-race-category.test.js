"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { raceCategory } = require("../betfair-au-proxy/race-category");

test("classifies harness by market raceType nested under horse racing", () => {
  assert.equal(raceCategory("Horse Racing", { raceType: "HARNESS" }), "harness");
  assert.equal(raceCategory("Horse Racing", { race_type: "TROTTING" }), "harness");
  assert.equal(raceCategory("Horse Racing", {}, { raceType: "PACING" }), "harness");
  assert.equal(raceCategory("Horse Racing", { raceType: "TROT" }), "harness");
});

test("classifies greyhound and thoroughbred separately", () => {
  assert.equal(raceCategory("Greyhound Racing", {}), "greyhound");
  assert.equal(raceCategory("Horse Racing", { raceType: "FLAT" }), "horse");
});

test("uses strong harness venue aliases but does not guess shared venues", () => {
  assert.equal(raceCategory("Horse Racing", {}, { name: "Gloucester Park R1" }), "harness");
  assert.equal(raceCategory("Horse Racing", {}, { name: "Menangle Park R5" }), "harness");
  assert.equal(raceCategory("Horse Racing", {}, { name: "Albion Park R1" }), "horse");
  assert.equal(raceCategory("Horse Racing", { raceType: "FLAT" }, { name: "Bendigo R2" }), "horse");
});
