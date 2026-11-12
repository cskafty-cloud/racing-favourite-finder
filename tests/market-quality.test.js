"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isEstimatedQuote } = require("../market-quality");

test("rejects explicit estimate flags", () => {
  for (const quote of [
    { estimated: true }, { is_estimate: 1 }, { indicative: "true" },
    { projected: true }, { synthetic: true }, { predicted: true }
  ]) assert.equal(isEstimatedQuote(quote), true);
});

test("rejects estimate and consensus source descriptions", () => {
  for (const source of [
    "Estimated price feed", "Indicative market", "Modelled odds",
    "Consensus price", "Fair odds projection", "Synthetic bookmaker quote"
  ]) assert.equal(isEstimatedQuote({ source }), true, source);
});

test("does not reject a genuine timestamped fixed bookmaker quote", () => {
  assert.equal(isEstimatedQuote({
    bookmaker: "Bet365",
    market_type: "fixed_win",
    source: "Bet365 fixed WIN quote",
    win_price: 2.4,
    last_update: "2026-11-12T00:00:00.000Z"
  }), false);
});

test("handles missing and non-object values safely", () => {
  assert.equal(isEstimatedQuote(null), false);
  assert.equal(isEstimatedQuote("estimate"), false);
});
