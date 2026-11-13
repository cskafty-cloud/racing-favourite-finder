"use strict";

const crypto = require("node:crypto");

// Shared feed credentials are opaque secrets: compare the exact UTF-8 bytes.
// Do not trim, lowercase, or otherwise normalise either value.
function accessTokenMatches(expectedToken, suppliedToken) {
  if (typeof expectedToken !== "string" || typeof suppliedToken !== "string") return false;
  if (expectedToken.length === 0 || suppliedToken.length === 0) return false;
  const expected = Buffer.from(expectedToken, "utf8");
  const supplied = Buffer.from(suppliedToken, "utf8");
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

module.exports = { accessTokenMatches };
