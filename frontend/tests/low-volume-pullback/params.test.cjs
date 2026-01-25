// Lightweight param normalization checks using ts-node to load TS modules
require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");

const {
  RANGE_DEFAULT_PARAMS,
  parseRangeSearchParams,
  normalizeRangeParams,
} = require("../../src/app/(main)/dashboard/strategy/low-volume-pullback/range/params");
const {
  BACKTEST_DEFAULT_PARAMS,
  parseBacktestSearchParams,
  normalizeBacktestParams,
} = require("../../src/app/(main)/dashboard/strategy/low-volume-pullback/backtest/params");
const {
  SCREENER_DEFAULT_PARAMS,
  parseScreenerSearchParams,
  normalizeScreenerParams,
} = require("../../src/app/(main)/dashboard/strategy/low-volume-pullback/screener/params");

const toParams = (query) => new URLSearchParams(query);

// range
const rangeParsed = parseRangeSearchParams(toParams("horizonBars=abc&volRatioMax=nan&minBodyPct="));
assert.equal(rangeParsed.horizonBars, RANGE_DEFAULT_PARAMS.horizonBars);
assert.equal(rangeParsed.volRatioMax, RANGE_DEFAULT_PARAMS.volRatioMax);
assert.equal(rangeParsed.minBodyPct, RANGE_DEFAULT_PARAMS.minBodyPct);
const rangeExec = parseRangeSearchParams(toParams("entryExecution=bad")).entryExecution;
assert.equal(rangeExec, "close"); // fallback when invalid

// backtest
const backtestParsed = parseBacktestSearchParams(toParams("entryExecution=foo&onlyTriggered=2"));
assert.equal(backtestParsed.entryExecution, BACKTEST_DEFAULT_PARAMS.entryExecution);
assert.equal(backtestParsed.onlyTriggered, "1");

// screener
const screenerParsed = parseScreenerSearchParams(toParams("recentBars=xx&onlyTriggered=0"));
assert.equal(screenerParsed.recentBars, SCREENER_DEFAULT_PARAMS.recentBars);
assert.equal(screenerParsed.onlyTriggered, "0");

const normalized = normalizeScreenerParams({
  timeframe: "6M_1d",
  volRatioMax: "0.8",
  minBodyPct: "0.01",
  recentBars: "5",
  onlyTriggered: "1",
});
assert.deepEqual(normalized, {
  timeframe: "6M_1d",
  volRatioMax: "0.8",
  minBodyPct: "0.01",
  recentBars: "5",
  onlyTriggered: "1",
});

console.log("✅ param normalization tests passed");
