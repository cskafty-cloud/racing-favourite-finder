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

// Parse provider timestamps consistently. Numeric timestamps are accepted as
// Unix seconds or milliseconds; malformed and materially future-dated stamps
// are rejected instead of being treated as fresh quotes.
function quoteAgeSeconds(timestamp, now = Date.now(), futureSkewSeconds = 60) {
  if (timestamp == null || timestamp === "") return null;
  const numeric = Number(timestamp);
  const ms = Number.isFinite(numeric) && numeric > 1000000000
    ? (numeric > 1000000000000 ? numeric : numeric * 1000)
    : Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  const delta = Number(now) - ms;
  if (!Number.isFinite(delta) || delta < -Math.max(0, Number(futureSkewSeconds) || 0) * 1000) return null;
  return Math.max(0, delta / 1000);
}

function quoteMarketAge(q, market = "win", now = Date.now()) {
  const fields = market === "place"
    ? ["place_last_update", "place_updated_at", "place_captured_at"]
    : ["last_update", "updated_at", "captured_at", "timestamp"];
  const ageField = market === "place" ? "place_age_seconds" : "age_seconds";
  const stamp = fields.map(key => q?.[key]).find(value => value != null && value !== "");
  if (stamp == null) return null;
  const stamped = quoteAgeSeconds(stamp, now);
  if (stamped == null) return null;
  const direct = q?.[ageField] != null && Number.isFinite(Number(q[ageField]))
    ? Math.max(0, Number(q[ageField])) : null;
  return direct == null ? stamped : Math.max(stamped, direct);
}

module.exports = { isEstimatedQuote, quoteAgeSeconds, quoteMarketAge };
