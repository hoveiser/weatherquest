// ============================================================================
// Frontend unit tests for the exact risk + payout port (PRIORITY 4).
//
// These run the SAME boundary table the Python direct-mode contract tests pin
// (CALM -> Low/100, WINDY -> Medium/160, STORM -> clamped 500/Extreme, plus each
// integer band edge of wind / precip / temp / weather-code) against the pure
// client port in src/lib/risk.ts, and check the GEN payout formula in
// src/lib/maps.ts against the contract identity payout = base * mult * eff / 10000.
//
// No test framework is added: the two pure TS modules are transpiled with the
// already-installed TypeScript compiler, imported as ESM, and asserted with
// node:test. Run: `node tests/risk.test.mjs` (from the frontend dir), or
// `npm test`. CI runs it in the frontend job.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wq-risk-test-"));

// Transpile a pure TS module (type-only imports are erased) and import it as ESM.
async function loadTs(rel) {
  const src = readFileSync(join(here, "..", rel), "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  const out = join(tmp, rel.replace(/[\\/]/g, "_").replace(/\.ts$/, ".mjs"));
  writeFileSync(out, outputText);
  return import(pathToFileURL(out).href);
}

const risk = await loadTs("src/lib/risk.ts");
const maps = await loadTs("src/lib/maps.ts");
const { riskFromSnapshot, snapFromWeather, codeClass, tierFor, tierFromScore } = risk;
const { payoutGenExact, LEVEL_BASE_GEN } = maps;

// Build the integer snapshot the way the UI does, from raw float weather.
function snap({ t = 14, p = 0, w = 7, code = 3 }) {
  return snapFromWeather({
    temperature_2m: t,
    precipitation: p, // mm; snapFromWeather scales to tenths
    wind_speed_10m: w,
    relative_humidity_2m: 60,
    weather_code: code,
  });
}
function riskOf(opts) {
  return riskFromSnapshot(snap(opts));
}

// --- Python-pinned presets (tests/direct/conftest.py CALM/WINDY/STORM) ------
test("CALM matches Python test_get_weather_multiplier_calm_is_low_100", () => {
  const [tier, x100] = riskOf({ t: 14.1, p: 0.0, w: 6.8, code: 3 });
  assert.equal(x100, 100);
  assert.equal(tier, "Low");
});
test("WINDY matches Python test_get_weather_multiplier_windy_is_medium_160", () => {
  const [tier, x100] = riskOf({ t: 14.0, p: 0.0, w: 35.0, code: 3 });
  assert.equal(x100, 160);
  assert.equal(tier, "Medium");
});
test("STORM matches Python test_get_weather_multiplier_storm_clamps_to_500", () => {
  const [tier, x100] = riskOf({ t: 38.0, p: 30.0, w: 70.0, code: 96 });
  assert.equal(x100, 500);
  assert.equal(tier, "Extreme");
});

// --- Wind bands: 100 + {<20:0, <30:30, <40:60, <50:100, <60:150, else:200} --
test("wind band edges", () => {
  const cases = [
    [19, 100, "Low"], [20, 130, "Low"], [29, 130, "Low"], [30, 160, "Medium"],
    [39, 160, "Medium"], [40, 200, "Medium"], [49, 200, "Medium"], [50, 250, "High"],
    [59, 250, "High"], [60, 300, "High"], [120, 300, "High"],
  ];
  for (const [w, exp, tier] of cases) {
    const [t, x] = riskOf({ w });
    assert.equal(x, exp, `wind ${w}`);
    assert.equal(t, tier, `wind ${w} tier`);
  }
});

// --- Precip bands (tenths of mm): <=0:0, <10:20, <50:50, <200:100, else:150 --
test("precip band edges", () => {
  // p is mm here; snap multiplies by 10 and rounds.
  const cases = [
    [0.0, 100, "Low"], [0.1, 120, "Low"], [0.9, 120, "Low"], [1.0, 150, "Medium"],
    [4.9, 150, "Medium"], [5.0, 200, "Medium"], [19.9, 200, "Medium"], [20.0, 250, "High"],
  ];
  for (const [p, exp, tier] of cases) {
    const [t, x] = riskOf({ p });
    assert.equal(x, exp, `precip ${p}mm`);
    assert.equal(t, tier, `precip ${p}mm tier`);
  }
});

// --- Temp bands: 5..25:0, -5..<5 & 25..<30:20, -15..<5 & 30..<35:50, else:100
test("temp band edges", () => {
  const cases = [
    [14, 100], [5, 100], [25, 100], [4, 120], [-5, 120], [-6, 150], [-15, 150],
    [-16, 200], [26, 120], [30, 120], [31, 150], [35, 150], [36, 200],
  ];
  for (const [t, exp] of cases) {
    const [, x] = riskOf({ t });
    assert.equal(x, exp, `temp ${t}`);
  }
});

// --- code_class buckets and their weather-code contribution -----------------
test("codeClass buckets match _code_class", () => {
  assert.deepEqual([0, 1, 2, 3, 45, 48].map(codeClass), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([51, 55, 57].map(codeClass), [1, 1, 1]);
  assert.deepEqual([61, 63, 67].map(codeClass), [2, 2, 2]);
  assert.deepEqual([71, 73, 77].map(codeClass), [3, 3, 3]);
  assert.deepEqual([80, 81, 82, 85, 86].map(codeClass), [4, 4, 4, 4, 4]);
  assert.deepEqual([95, 96, 99].map(codeClass), [5, 5, 5]);
  // Out-of-range code (snap forces -1) => bucket 6, matching the contract's else.
  assert.equal(codeClass(-1), 6);
});
test("weather-code contribution (hc) flows into the score", () => {
  const cases = [
    [0, 100], [51, 130], [61, 160], [71, 190], [80, 220], [95, 300],
  ];
  for (const [code, exp] of cases) {
    const [, x] = riskOf({ code });
    assert.equal(x, exp, `code ${code}`);
  }
});

// --- Tier thresholds (contract score bands) ---------------------------------
test("tierFromScore / tierFor thresholds match the contract", () => {
  assert.equal(tierFromScore(149), "Low");
  assert.equal(tierFromScore(150), "Medium");
  assert.equal(tierFromScore(249), "Medium");
  assert.equal(tierFromScore(250), "High");
  assert.equal(tierFromScore(399), "High");
  assert.equal(tierFromScore(400), "Extreme");
  assert.equal(tierFor(1.4), "Low");
  assert.equal(tierFor(1.5), "Medium");
  assert.equal(tierFor(2.4), "Medium");
  assert.equal(tierFor(2.5), "High");
  assert.equal(tierFor(3.9), "High");
  assert.equal(tierFor(4.0), "Extreme");
});

// --- GEN payout identity: base * mult * eff / 10000 (Perfect 1.20x) ---------
test("payoutGenExact matches the contract integer identity for key rows", () => {
  // base_gen per level = LEVEL_BASE_GEN[lvl]/100; payout = base * (x100/100) * (eff/100).
  const baseGen = (lvl) => LEVEL_BASE_GEN[lvl] / 100;
  const rows = [
    [1, 100, 120], // the real P1 Istanbul run: 0.1 * 1.0 * 1.2 = 0.12 GEN
    [1, 160, 100], // 0.1 * 1.6 = 0.16
    [1, 100, 100], // 0.1
    [5, 100, 120], // 0.25 * 1.2 = 0.30
    [2, 120, 120], // 0.12 * 1.2 * 1.2 = 0.1728
    [10, 500, 120], // 1.0 * 5.0 * 1.2 = 6.0 (max payout)
  ];
  for (const [lvl, mult, eff] of rows) {
    const expected = baseGen(lvl) * (mult / 100) * (eff / 100);
    const got = payoutGenExact(lvl, mult, eff);
    assert.ok(Math.abs(got - expected) < 1e-9, `L${lvl} x${mult} eff${eff}: ${got} vs ${expected}`);
  }
  assert.equal(payoutGenExact(1, 100, 120), 0.12);
  assert.equal(payoutGenExact(10, 500, 120), 6);
});
