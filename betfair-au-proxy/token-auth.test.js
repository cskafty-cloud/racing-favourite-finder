"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { accessTokenMatches } = require("./token-auth");

test("accepts an exact shared token", () => {
  assert.equal(accessTokenMatches("aB09-Token_X", "aB09-Token_X"), true);
});

test("rejects hexadecimal letter-case changes", () => {
  assert.equal(accessTokenMatches("aBcD0123", "ABcD0123"), false);
  assert.equal(accessTokenMatches("aBcD0123", "abcd0123"), false);
});

test("rejects surrounding whitespace instead of trimming", () => {
  assert.equal(accessTokenMatches("token-1234567890", " token-1234567890"), false);
  assert.equal(accessTokenMatches("token-1234567890", "token-1234567890 "), false);
  assert.equal(accessTokenMatches(" token-1234567890", "token-1234567890"), false);
});

test("rejects empty, missing, and unequal-length tokens", () => {
  assert.equal(accessTokenMatches("", ""), false);
  assert.equal(accessTokenMatches("token", ""), false);
  assert.equal(accessTokenMatches("token", null), false);
  assert.equal(accessTokenMatches("token", "tokens"), false);
});
