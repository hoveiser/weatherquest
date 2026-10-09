// ============================================================================
// Frontend unit tests for the money-display layer (reviewer Task B3).
//
// Two jobs:
//   1. Pin the pure display helpers in src/lib/payout.ts: formatting must never
//      round a displayed amount UP, the per-level / per-player-cumulative / global
//      classes must produce different strings, and the native-balance proof must
//      only say "matches" when the delta equals the per-level payout exactly.
//   2. Prove the frontend tables cannot drift from the contract: LEVEL_OBJECTIVE,
//      LEVEL_BASE_GEN, CAMPAIGN_REWARD_SCALE and CAMPAIGN_CITY_TABLE are parsed
//      straight out of contracts/weatherquest.py and compared against the values
//      the UI renders, and the payout identity base * multiplier / 100 is checked
//      for every level x every multiplier step against the contract's integer math.
//
// Runs with node:test only (no new dependency): `node tests/payout.test.mjs`.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wq-payout-test-"));

async function loadTs(rel) {
  const src = readFileSync(join(here, "..", rel), "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  const out = join(tmp, rel.replace(/[\\/]/g, "_").replace(/\.ts$/, ".mjs"));
  writeFileSync(out, outputText);
  return import(pathToFileURL(out).href);
}

const payout = await loadTs("src/lib/payout.ts");
const maps = await loadTs("src/lib/maps.ts");
const fmt = await loadTs("src/lib/format.ts");
const {
  formatAtto,
  levelPayoutLabel,
  totalCreditedLabel,
  nativeDeltaLabel,
  nativeDeltaAtto,
  deltaMatchesPayout,
  payoutStatusLabel,
  payoutAttoExact,
} = payout;

const GEN = 10n ** 18n;

// --- contract source, parsed without importing Python -----------------------
const contractSrc = readFileSync(join(here, "..", "..", "contracts", "weatherquest.py"), "utf8");

function quotedTuple(name) {
  const m = contractSrc.match(new RegExp(`${name} = \\(([\\s\\S]*?)\\n\\)`));
  assert.ok(m, `${name} not found in the contract source`);
  return [...m[1].matchAll(/^\s*"((?:[^"\\]|\\.)*)",/gm)].map((q) =>
    q[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  );
}

test("frontend LEVEL_OBJECTIVE matches the contract table entry for entry", () => {
  const contractObjectives = quotedTuple("LEVEL_OBJECTIVE");
  assert.equal(maps.LEVEL_OBJECTIVE.length, contractObjectives.length, "objective table length");
  contractObjectives.forEach((c, i) => {
    assert.equal(maps.LEVEL_OBJECTIVE[i], c, `objective[${i}]`);
  });
  // Every campaign level 1-10 must have a non-empty objective (the judge needs it).
  for (let lvl = 1; lvl <= 10; lvl++) {
    assert.ok(maps.objectiveForLevel(lvl).includes("reach the magic gate"), `L${lvl} objective`);
  }
});

test("frontend base-GEN table and reward scale match the contract", () => {
  const m = contractSrc.match(/LEVEL_BASE_GEN = \(([^)]*)\)/);
  assert.ok(m, "LEVEL_BASE_GEN not found in the contract source");
  const contractBase = m[1].split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  assert.deepEqual(maps.LEVEL_BASE_GEN, contractBase, "LEVEL_BASE_GEN drift");
  const mScale = contractSrc.match(/CAMPAIGN_REWARD_SCALE = (\d+)/);
  assert.ok(mScale, "CAMPAIGN_REWARD_SCALE not found");
  assert.equal(maps.CAMPAIGN_REWARD_SCALE, Number(mScale[1]));
});

test("campaign city names shown in the UI equal the contract table", () => {
  const rows = [...contractSrc.matchAll(/^\s*(\d+): \("((?:[^"\\]|\\.)*)", (-?\d+), (-?\d+)\),?$/gm)].map(
    (m) => [
      Number(m[1]),
      m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      Number(m[3]),
      Number(m[4]),
    ],
  );
  assert.equal(rows.length, 10, `parsed ${rows.length} city rows`);
  for (const [lvl, name, latE5, lonE5] of rows) {
    assert.equal(maps.CAMPAIGN_CITIES[lvl], name, `city name drift on level ${lvl}`);
    // The UI never shows coordinates, but the city it names must be the one whose
    // fixed coordinates the contract queries.
    assert.ok(Number.isInteger(latE5) && Number.isInteger(lonE5), `L${lvl} coords must be integers`);
  }
  // Tromso carries a non-ASCII letter on both sides; pin it explicitly.
  assert.equal(maps.CAMPAIGN_CITIES[10], "Troms\u00f8");
});

// --- payout identity for every level x every achievable multiplier ----------
test("payoutAttoExact equals base * multiplier / 100 for all levels and bands", () => {
  const multis = [100, 120, 130, 140, 150, 160, 190, 200, 220, 250, 300, 500];
  for (let lvl = 1; lvl <= 10; lvl++) {
    const baseAtto = (BigInt(maps.LEVEL_BASE_GEN[lvl]) * GEN) / BigInt(maps.CAMPAIGN_REWARD_SCALE);
    for (const x of multis) {
      // Python integer floor division, mirrored with BigInt (truncates identically
      // for non-negative values).
      const expected = (baseAtto * BigInt(x)) / 100n;
      assert.equal(payoutAttoExact(maps.LEVEL_BASE_GEN[lvl], maps.CAMPAIGN_REWARD_SCALE, x), expected, `L${lvl} x${x}`);
    }
  }
});

// --- formatting: exact, truncated, never over-claiming ----------------------
test("formatAtto prints exact decimal strings", () => {
  assert.equal(formatAtto(0n), "0.00");
  assert.equal(formatAtto(10n ** 17n), "0.10"); // L1 base at 1.0x
  assert.equal(formatAtto(16n * 10n ** 16n), "0.16");
  assert.equal(formatAtto(144n * 10n ** 15n), "0.144"); // L1 base at 1.44x
  // 0.000144 GEN has no trailing zeros to strip, so it prints in full.
  assert.equal(formatAtto(144n * 10n ** 12n), "0.000144");
  assert.equal(formatAtto(GEN), "1.00");
  assert.equal(formatAtto(5n * GEN), "5.00");
  // 1 atto must never display as a nonzero amount it did not pay.
  assert.equal(formatAtto(1n), "0.00");
  // Truncation, never rounding up: 0.9999999 GEN shows as 0.999999, not 1.0.
  assert.equal(formatAtto(9999999n * 10n ** 11n), "0.999999");
});

test("the three money classes render as three different strings", () => {
  const perLevel = 16n * 10n ** 16n; // 0.16 GEN
  const cumulative = 26n * 10n ** 16n; // 0.26 GEN (0.10 + 0.16)
  const a = levelPayoutLabel(1, perLevel);
  const b = totalCreditedLabel(cumulative);
  assert.notEqual(a, b);
  assert.match(a, /Level 1 payout: 0\.16 GEN/);
  assert.match(b, /Total credited to your address \(all levels\): 0\.26 GEN/);
  // A cumulative total must never be printable by the per-level helper.
  assert.doesNotMatch(levelPayoutLabel(1, cumulative), /Total credited/);
});

test("native delta proof only claims a match when it is exact", () => {
  const before = 20n * GEN;
  const payoutAtto = 16n * 10n ** 16n;
  assert.equal(deltaMatchesPayout(before, before + payoutAtto, payoutAtto), true);
  assert.equal(
    deltaMatchesPayout(before, before + payoutAtto * 2n, payoutAtto),
    false,
    "a two-level cumulative delta must not pass as one level",
  );
  assert.equal(deltaMatchesPayout(before, before, payoutAtto), false, "nothing landed");
  assert.equal(deltaMatchesPayout(undefined, before, payoutAtto), false, "unreadable balance");
  assert.equal(nativeDeltaAtto(before, before - payoutAtto), 0n, "negative delta floors at 0");
  assert.match(
    nativeDeltaLabel(before, before + payoutAtto),
    /Wallet native GEN 20\.00 -> 20\.16 \(\+0\.16\)/,
  );
  assert.equal(nativeDeltaLabel(undefined, undefined), "Wallet native GEN: not read");
});

test("payoutStatusLabel phrases each delivery state about the per-level amount", () => {
  const amt = 16n * 10n ** 16n;
  assert.equal(payoutStatusLabel("sent", amt), "Payout: 0.16 GEN received in your wallet");
  assert.match(payoutStatusLabel("credit", amt), /recorded on-chain \(native transfer awaiting confirmation\)/);
  assert.match(payoutStatusLabel("pending", amt), /pending/);
  assert.equal(payoutStatusLabel("failed", amt), "Payout: failed (transfer tx did not settle)");
  assert.equal(payoutStatusLabel("none", amt), "Payout: none");
  assert.equal(payoutStatusLabel(undefined, amt), "Payout: none");
  // A failed/none verdict must never print an amount at all.
  assert.doesNotMatch(payoutStatusLabel("none", 0n), /0\.16/);
});

test("formatGen truncates and can never round a displayed amount up", () => {
  // (0.146).toFixed(2) is "0.15", which would over-state a 0.146 GEN payout.
  assert.equal(fmt.formatGen(0.146), "0.14 GEN");
  assert.equal(fmt.formatGen(0.1445), "0.14 GEN");
  // Float representation must not shave a full step: 0.29 * 100 === 28.999999999999996.
  assert.equal(fmt.formatGen(0.29), "0.29 GEN");
  assert.equal(fmt.formatGen(1.005, 1), "1.0 GEN");
  assert.equal(fmt.formatGen(0), "0.00 GEN");
  assert.equal(fmt.formatGen(-3), "0.00 GEN", "a GEN amount display never goes negative");
  assert.equal(fmt.formatGen(Number.NaN), "0.00 GEN");
});

test("no page promises an escrow or refund the contract rejects", () => {
  // create_quest raises [EXPECTED] on this deployment, so no UI string may claim that
  // GEN is escrowed on-chain or returned on failure. This guards the wording that
  // used to sit in the legacy marketplace pages.
  const files = [
    "src/pages/CreateQuest.tsx",
    "src/pages/Landing.tsx",
    "src/pages/Dashboard.tsx",
    "src/components/ResultScreen.tsx",
    "src/components/QuestDetailModal.tsx",
    "src/components/QuestCard.tsx",
    "src/lib/contract.ts",
  ];
  // Only the surfaces that host a submit/create form may not imply the chain settles
  // them. Landing is campaign marketing and legitimately mentions validator judging.
  const submitPaths = files.filter((f) => !f.endsWith("Landing.tsx"));
  for (const rel of files) {
    const src = readFileSync(join(here, "..", rel), "utf8");
    assert.doesNotMatch(src, /escrowed on-chain/i, `${rel} promises on-chain escrow`);
    assert.doesNotMatch(src, /funds return/i, `${rel} promises a refund`);
    assert.doesNotMatch(src, /rewards are escrowed/i, `${rel} promises escrow`);
    if (submitPaths.includes(rel)) {
      // These run a local heuristic, so they may not claim the chain judges the action.
      assert.doesNotMatch(src, /on-chain AI (reviews|judges)/i, `${rel} claims on-chain judging`);
      assert.doesNotMatch(src, /AI validates your moves/i, `${rel} claims validation`);
    }
  }
});

// --- the action input gate the UI mirrors (contract Layer 1 bounds) ---------
test("UI preset actions satisfy the contract pre-filter bounds", () => {
  // Mirrors _prefilter_action: 12..200 chars and >= 3 words containing letters.
  const modal = readFileSync(join(here, "..", "src", "GateModal.tsx"), "utf8");
  const block = modal.slice(modal.indexOf("const ICONS"), modal.indexOf("const TIER_BADGE"));
  const presets = [...block.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
  assert.ok(presets.length >= 3, `found ${presets.length} presets`);
  // The blocked set is read from the contract constant itself, so this test can
  // never drift from what the on-chain pre-filter really rejects. In particular
  // SPACE is not blocked (a preset like "Build a raft" has four of them).
  const lit = contractSrc.match(/ACTION_BLOCKED_CHARS = '([^']*)'/);
  assert.ok(lit, "ACTION_BLOCKED_CHARS not found in the contract source");
  const blockedChars = lit[1].replace(/\\\\/g, "\\");
  assert.equal(blockedChars, "<>[]{}|\\`\"");
  assert.ok(!blockedChars.includes(" "), "space must stay allowed");
  for (const p of presets) {
    const words = p.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
    assert.ok(p.length >= 12 && p.length <= 200, `${p} length ${p.length}`);
    assert.ok(words >= 3, `${p} has ${words} words`);
    const hit = [...p].find((ch) => blockedChars.includes(ch));
    assert.equal(hit, undefined, `${p} contains a blocked character ${JSON.stringify(hit)}`);
  }
});
