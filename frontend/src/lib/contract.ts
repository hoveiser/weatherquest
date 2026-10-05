import type {
  ActionResult,
  CampaignProgress,
  EfficiencyTier,
  LevelOutcome,
  Quest,
  RiskAnalysis,
  WalletState,
} from "../types";
import { getWeatherByCity, previewRisk } from "./weather";
import { genToAtto, attoToGen } from "./format";
import { baseRewardGen, cityForLevel, difficultyBand, LEVEL_BASE_GEN } from "./maps";
import * as gl from "./genlayer";

/**
 * Contract access layer.
 *
 * The app ships in DEMO MODE by default so reviewers can play the full campaign
 * without a funded wallet. Demo mode mirrors the on-chain campaign rules
 * (weather multiplier, level-scaled AI strictness, payout = base(level) × multiplier)
 * using the same Open-Meteo data the contract reads, and persists progress in
 * localStorage keyed to a stable synthetic identity.
 *
 * The "Connect GenLayer Wallet" button switches the SAME call sites over to real
 * on-chain play via the genlayer-js SDK (see lib/genlayer.ts) — complete_level /
 * campaign_progress against the deployed StudioNet contract.
 */
const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS as string) || "";
export const CONTRACT = CONTRACT_ADDRESS;
export const USE_ONCHAIN = Boolean(CONTRACT_ADDRESS) && import.meta.env.VITE_ONCHAIN === "true";

export const DEMO_ADDR = "0xWeatherQuestDemo00000000000000000000000000";

// Verbs that only become dangerous when the weather turns rough — i.e. activities
// that expose the player to the elements. Ordinary ground movement (walk / run /
// cycle / hike) is deliberately NOT here: it is a reasonable action in calm/mild
// weather and must never be auto-rejected (that was the "AI rejects everything"
// bug). Treat these as "reckless" only in High/Extreme conditions.
const RECKLESS = ["fly", "kite", "swim", "climb", "sail", "raft", "surf", "boat", "paraglide", "skydiv", "kayak"];
const CAUTIOUS = ["cover", "shelter", "snowmobile", "drive", "wait", "stay", "indoor", "equipment", "hunker", "prepare", "warm", "dry", "anchor", "bundl", "helmet", "postpone", "avoid", "detour"];

// Verbs that stay clearly dangerous even in MILD (Medium) weather — airborne or
// height moves the wind can turn on. The demo Medium tier rejects ONLY these (when
// no caution is shown), so ordinary actions like swim / sail / walk / drive pass,
// mirroring the contract's lenient "reject only clearly dangerous" Medium guidance.
const MEDIUM_DANGEROUS = ["kite", "fly", "paraglide", "skydiv", "climb", "surf"];

// --- Demo persistence -------------------------------------------------------
const DEMO_ACCOUNT_KEY = "wq:demo:account";
const DEMO_PROGRESS_KEY = "wq:campaign:demo";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage disabled (private mode) — progress just won't persist */
  }
}

/** A stable synthetic GenLayer-style address so demo progress persists per browser. */
function demoAccount(): string {
  let a = lsGet(DEMO_ACCOUNT_KEY);
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) {
    const hex = "0123456789abcdef";
    let body = "";
    for (let i = 0; i < 40; i++) body += hex[Math.floor(Math.random() * 16)];
    a = `0x${body}`;
    lsSet(DEMO_ACCOUNT_KEY, a);
  }
  return a;
}

function loadDemoProgress(): number[] {
  try {
    const raw = lsGet(DEMO_PROGRESS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}
function saveDemoProgress(levels: number[]): void {
  lsSet(DEMO_PROGRESS_KEY, JSON.stringify([...new Set(levels)].sort((a, b) => a - b)));
}

// --- Wallet -----------------------------------------------------------------
export async function connectWallet(): Promise<WalletState> {
  await delay(350);
  return { mode: "demo", address: demoAccount(), connecting: false };
}

export async function connectOnChainWallet(): Promise<WalletState> {
  const address = await gl.requestAccounts();
  return { mode: "onchain", address, connecting: false };
}

/** Live GEN balance. Demo returns the local session balance (managed by App). */
export async function fetchGenBalance(wallet: WalletState): Promise<number | null> {
  if (wallet.mode === "onchain") {
    try {
      const b = await gl.readGenBalance(wallet.address);
      return b.gen;
    } catch {
      return null;
    }
  }
  return null;
}

// --- Campaign reads ---------------------------------------------------------
export async function fetchCompletedLevels(wallet: WalletState): Promise<number[]> {
  if (wallet.mode === "onchain" && CONTRACT) {
    try {
      const p = await gl.readCampaignProgress(wallet.address, CONTRACT);
      return p.completed;
    } catch {
      return [];
    }
  }
  return loadDemoProgress();
}

export async function fetchCampaignProgress(wallet: WalletState): Promise<CampaignProgress> {
  if (wallet.mode === "onchain" && CONTRACT) {
    try {
      return await gl.readCampaignProgress(wallet.address, CONTRACT);
    } catch {
      /* fall through to a local view */
    }
  }
  const completed = loadDemoProgress();
  const next = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((l) => !completed.includes(l)) ?? 0;
  return {
    account: wallet.address,
    completed,
    completedCount: completed.length,
    nextLevel: next,
    maxLevel: 10,
    campaignPayoutAtto: 0n,
  };
}

// --- Level settlement -------------------------------------------------------
export interface CompleteLevelInput {
  level: number;
  homeCity: string;
  action: string;
  wallet: WalletState;
  /** BFS shortest spawn→gate length for the rendered map (>= 1). */
  optimalSteps: number;
  /** Grid-cell transitions the player made before reaching the gate (>= 1). */
  actualSteps: number;
}

/**
 * Demo mirror of the contract's _efficiency_multiplier: identical integer tiers so
 * the offline preview and the on-chain settlement always agree. Returns the tier
 * and its hundredths multiplier (120 / 100 / 50 / 10).
 */
export function efficiencyTier(optimalSteps: number, actualSteps: number): { tier: EfficiencyTier; x100: number } {
  const opt = Math.max(1, Math.trunc(optimalSteps) || 1);
  const act = Math.max(1, Math.trunc(actualSteps) || 1);
  if (act <= opt + 2) return { tier: "Perfect", x100: 120 };
  if (act * 2 <= opt * 3) return { tier: "Good", x100: 100 }; // act <= optimal * 1.5, no floats
  if (act <= opt * 3) return { tier: "Wandering", x100: 50 };
  return { tier: "Lost", x100: 10 };
}

export async function completeLevel(input: CompleteLevelInput): Promise<LevelOutcome> {
  const city = cityForLevel(input.level, input.homeCity);
  const difficulty = difficultyBand(input.level);
  const optimal = Math.max(1, Math.trunc(input.optimalSteps) || 1);
  const actual = Math.max(1, Math.trunc(input.actualSteps) || 1);
  if (input.wallet.mode === "onchain" && CONTRACT) {
    return completeLevelOnChain(input.level, city, input.action, difficulty, input.wallet, optimal, actual);
  }
  return completeLevelDemo(input.level, city, input.action, difficulty, input.wallet, optimal, actual);
}

/** Live weather + preview multiplier for a city (never throws; returns calm fallback). */
async function previewFor(city: string): Promise<{ risk: RiskAnalysis; condition: string }> {
  try {
    const w = await getWeatherByCity(city);
    return { risk: previewRisk(w), condition: w.condition };
  } catch {
    const calm: RiskAnalysis = {
      multiplier: 1,
      multiplierX100: 100,
      risk_tier: "Low",
      reasoning: `Weather feed unavailable for ${city}; assuming calm conditions.`,
    };
    return { risk: calm, condition: "Unavailable" };
  }
}

async function completeLevelDemo(
  level: number,
  city: string,
  action: string,
  difficulty: ReturnType<typeof difficultyBand>,
  _wallet: WalletState,
  optimal: number,
  actual: number,
): Promise<LevelOutcome> {
  const eff = efficiencyTier(optimal, actual);
  const done = loadDemoProgress();
  if (done.includes(level)) {
    const { risk } = await previewFor(city);
    return {
      level,
      success: true,
      payoutGen: 0,
      risk,
      reasoning: `Level ${level} (${city}) is already conquered — the gate stands open. Walk on through.`,
      difficulty,
      city,
      optimalSteps: optimal,
      actualSteps: actual,
      efficiency: eff.tier,
      efficiencyX100: eff.x100,
      alreadyCompleted: true,
      onChain: false,
    };
  }

  const { risk } = await previewFor(city);
  await delay(1400); // simulate AI + consensus latency

  const a = action.toLowerCase();
  const reckless = RECKLESS.some((k) => a.includes(k));
  const cautious = CAUTIOUS.some((k) => a.includes(k));

  let success: boolean;
  let verdict: string;

  // Strictness is keyed on the LIVE WEATHER RISK TIER (not the level), mirroring the
  // contract's _judge_action: Low accepts anything reasonable, Medium rejects only
  // clearly dangerous actions, High/Extreme are strict.
  const mult = risk.multiplier.toFixed(1);
  if (risk.risk_tier === "Low") {
    success = true;
    verdict = `Low risk (${mult}x): calm conditions — "${action}" is an easy call.`;
  } else if (risk.risk_tier === "Medium") {
    // Forgiving: only clearly dangerous airborne/height moves that ignore caution
    // are rejected — swimming, sailing, walking or driving all pass in mild weather.
    const clearlyDangerous = MEDIUM_DANGEROUS.some((k) => a.includes(k)) && !cautious;
    success = !clearlyDangerous;
    verdict = success
      ? `Medium risk (${mult}x): "${action}" is a reasonable response to mild conditions.`
      : `Medium risk (${mult}x): "${action}" is clearly dangerous right now — pick a safer approach.`;
  } else if (risk.risk_tier === "High") {
    success = cautious || !reckless;
    verdict = success
      ? `High risk (${mult}x): "${action}" adapts appropriately to the conditions.`
      : `High risk (${mult}x): "${action}" was too exposed for these conditions.`;
  } else {
    success = cautious && !reckless;
    verdict = success
      ? `Extreme risk (${mult}x): "${action}" is the right cautious call in severe weather.`
      : `Extreme risk (${mult}x): "${action}" exposes you to dangerous weather. Take shelter instead.`;
  }

  const base = baseRewardGen(level);
  // Final = base * weather-multiplier * efficiency-multiplier (integer-hundredths tier).
  const payoutGen = success ? round4(base * risk.multiplier * (eff.x100 / 100)) : 0;
  if (success) {
    done.push(level);
    saveDemoProgress(done);
  }

  return {
    level,
    success,
    payoutGen,
    risk,
    reasoning: verdict,
    difficulty,
    city,
    optimalSteps: optimal,
    actualSteps: actual,
    efficiency: eff.tier,
    efficiencyX100: eff.x100,
    onChain: false,
    txHash: fakeTxHash(),
  };
}

async function completeLevelOnChain(
  level: number,
  city: string,
  action: string,
  difficulty: ReturnType<typeof difficultyBand>,
  wallet: WalletState,
  optimal: number,
  actual: number,
): Promise<LevelOutcome> {
  // The UI preview is non-authoritative; the contract re-derives the real multiplier
  // and applies the identical efficiency tier on-chain.
  const { risk } = await previewFor(city);
  const eff = efficiencyTier(optimal, actual);
  const res = await gl.writeCompleteLevel(wallet.address, CONTRACT, level, city, action, optimal, actual);
  // A 60s consensus timeout is StudioNet congestion ("may finalize later"), NOT an AI fail.
  const timedOut = res.timedOut;
  // A specific failure (wallet rejection / contract revert / insufficient funds / network
  // error) is surfaced verbatim so the UI never shows a misleading generic AI verdict.
  const errorMessage = res.errorMessage;
  const success = !timedOut && !errorMessage && res.completed;
  const base = baseRewardGen(level);
  const payoutGen = success ? round4(base * risk.multiplier * (eff.x100 / 100)) : 0;
  return {
    level,
    success,
    timedOut,
    errorMessage,
    payoutGen,
    risk,
    reasoning: timedOut
      ? `⏳ StudioNet validators are congested. Transaction may finalize later — nothing was charged and ${city} was not marked conquered. Try again shortly, or keep playing in demo mode.`
      : errorMessage
        ? `${errorMessage} Nothing was charged and ${city} was not marked conquered.`
        : success
          ? `On-chain: validators settled Level ${level} (${city}) as passed.`
          : `On-chain: the AI judgment failed Level ${level} (${city}). Try a safer action and resubmit.`,
    difficulty,
    city,
    optimalSteps: optimal,
    actualSteps: actual,
    efficiency: eff.tier,
    efficiencyX100: eff.x100,
    onChain: true,
    txHash: res.txHash,
  };
}

export const MAX_LEVEL = LEVEL_BASE_GEN.length - 1;

// ============================================================================
// Marketplace quest API (UNCHANGED) — the original single-quest demo flow.
// Kept intact so the existing dashboard modules and the untouched
// submit_action contract path continue to work exactly as before.
// ============================================================================

export async function createQuest(input: CreateQuestInput, creator: string): Promise<Quest> {
  if (USE_ONCHAIN) {
    throw new Error("On-chain create requires a funded wallet (see README).");
  }
  await delay(700);
  const now = Date.now();
  return {
    questId: `Q${Math.floor(Math.random() * 1e6).toString(36)}`,
    city: input.city.trim(),
    creator,
    baseRewardGen: input.baseRewardGen,
    description: input.description,
    createdAt: now,
    expiresAt: now + input.expiryHours * 3600_000,
    status: "Active",
    submissionCount: 0,
  };
}

export interface CreateQuestInput {
  city: string;
  baseRewardGen: number;
  description: string;
  expiryHours: number;
}

/** Live weather + preview multiplier for a quest (used for the risk meter). */
export async function analyzeQuest(quest: Quest): Promise<{ risk: RiskAnalysis; condition: string; temp: number }> {
  const w = await getWeatherByCity(quest.city);
  const risk = previewRisk(w);
  return { risk, condition: w.condition, temp: w.temperature_2m };
}

export async function submitAction(quest: Quest, action: string): Promise<ActionResult> {
  if (USE_ONCHAIN) {
    throw new Error("On-chain submit requires a funded wallet (see README).");
  }
  const w = await getWeatherByCity(quest.city);
  const risk = previewRisk(w);
  await delay(1400); // simulate AI + consensus latency

  const a = action.toLowerCase();
  const reckless = RECKLESS.some((k) => a.includes(k));
  const cautious = CAUTIOUS.some((k) => a.includes(k));

  // Heuristic judgment that mirrors the contract's LLM prompt intent.
  let success: boolean;
  let reasoning: string;
  if (risk.risk_tier === "Extreme") {
    success = cautious && !reckless;
    reasoning = success
      ? `You chose "${action}" in ${w.condition.toLowerCase()} (${risk.multiplier}x). A well-adapted action for extreme conditions — the AI judged it survivable.`
      : `You chose "${action}" in ${w.condition.toLowerCase()} (${risk.multiplier}x). This is extremely dangerous and the AI judged it likely to fail.`;
  } else if (risk.risk_tier === "High") {
    success = !reckless || cautious;
    reasoning = success
      ? `Risky, but "${action}" was a reasonable response to ${w.condition.toLowerCase()}. Success.`
      : `"${action}" was too reckless for ${w.condition.toLowerCase()}. The AI judged it a failure.`;
  } else {
    success = true;
    reasoning = `Conditions (${w.condition.toLowerCase()}, ${risk.multiplier}x) were safe enough for "${action}". Success!`;
  }

  const payoutGen = success ? quest.baseRewardGen * risk.multiplier : 0;
  return {
    success,
    payoutGen,
    risk,
    reasoning,
    txHash: fakeTxHash(),
  };
}

export function payoutPreview(quest: Quest, risk: RiskAnalysis): number {
  return quest.baseRewardGen * risk.multiplier;
}

// atto helpers re-exported so pages don't import format directly for money math.
export { genToAtto, attoToGen };

function fakeTxHash(): string {
  return `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;
}

/** Round to 4 decimals (GEN display precision) without float drift artifacts. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
