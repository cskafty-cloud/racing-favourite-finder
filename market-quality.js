"use strict";

// A price may be displayed as a source reference, but estimates must never
// enter verified bookmaker favourites, rankings, or top-tip calculations.
function isEstimatedQuote(q) {
  if (!q || typeof q !== "object") return false;
  const flags = [
    "estimated", "estimate", "is_estimate", "isEstimate",
    "indicative", "is_indicative", "isIndicative",
    "projected", "is_projected", "isProjected",
    "synthetic", "is_synthetic", "isSynthetic",
    "simulated", "predicted"
  ];
  if (flags.some(key =>
    q[key] === true || q[key] === 1 ||
    String(q[key] || "").trim().toLowerCase() === "true"
  )) return true;

  const descriptors = [
    q.market_type, q.place_market_type, q.price_type, q.bookmaker_type,
    q.quote_type, q.type, q.method, q.source, q.provider, q.feed,
    q.price_source, q.provenance, q.bookmaker, q.bookmaker_name,
    q.name, q.key
  ].filter(value => value != null).join(" ").toLowerCase();

  return /\b(estimate|estimated|indicative|projection|projected|modelled|modeled|consensus|synthetic|simulated|predicted)\b|fair[ _-]?(odds|price)/i.test(descriptors);
}

module.exports = { isEstimatedQuote };
