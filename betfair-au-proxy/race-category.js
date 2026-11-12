"use strict";

// Betfair can place harness events inside its Horse Racing event type.
// Only explicit race-type metadata can identify a harness event; venue names
// alone are not reliable enough to classify a market.
function raceCategory(name, description = {}, event = {}) {
  const values = [
    typeof description === "string" ? description : "",
    description?.raceType, description?.race_type, description?.type,
    event?.raceType, event?.race_type, event?.type,
    event?.eventType?.name, event?.eventTypeName
  ].filter(value => value != null && value !== "");
  const text = (String(name || "") + " " + values.join(" ")).toLowerCase();
  if (/greyhound/.test(text)) return "greyhound";
  if (/harness|trotting|pacing|\\btrot\\b/.test(text)) return "harness";
  return "horse";
}

module.exports = { raceCategory };
