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

test("does not infer harness from venue name without race-type metadata", () => {
  assert.equal(raceCategory("Harness Park", { raceType: "FLAT" }), "horse");
});
