"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isEstimatedQuote, quoteAgeSeconds } = require("../market-quality");

test("ordinary timestamped bookmaker quote is not classified as estimated", () => {
  assert.equal(isEstimatedQuote({
    bookmaker: "Bet365",
    market_type: "fixed_win",
    win_price: 3.5,
    last_update: "2026-11-13T04:00:00Z"
  }), false);
});

test("estimated and indicative quote flags are excluded", () => {
  for (const quote of [
    { estimated: true },
    { is_estimate: 1 },
    { indicative: "true" },
    { projected: true },
    { synthetic: true },
    { simulated: true }
  ]) assert.equal(isEstimatedQuote(quote), true);
});

test("model, consensus and fair-odds provenance are excluded", () => {
  for (const source of [
    "market consensus",
    "modelled price",
    "fair odds estimate",
    "projected odds"
  ]) assert.equal(isEstimatedQuote({ source }), true);
});

test("missing quote does not throw or become an estimate", () => {
  assert.equal(isEstimatedQuote(null), false);
  assert.equal(isEstimatedQuote("not a quote"), false);
});

test("quote timestamps support ISO, Unix seconds and Unix milliseconds", () => {
  const now = Date.parse("2026-11-13T04:00:00.000Z");
  assert.equal(quoteAgeSeconds("2026-11-13T03:59:00.000Z", now), 60);
  assert.equal(quoteAgeSeconds(now / 1000 - 60, now), 60);
  assert.equal(quoteAgeSeconds(now - 60000, now), 60);
});

test("invalid and materially future-dated quote timestamps are rejected", () => {
  const now = Date.parse("2026-11-13T04:00:00.000Z");
  assert.equal(quoteAgeSeconds("not-a-date", now), null);
  assert.equal(quoteAgeSeconds("2026-11-13T04:02:00.000Z", now), null);
  assert.equal(quoteAgeSeconds(now + 120000, now), null);
  assert.equal(quoteAgeSeconds("2026-11-13T04:00:30.000Z", now), 0);
});
