import type {
  ActionResult,
  CampaignProgress,
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

const RECKLESS = ["run", "fly", "swim", "cycle", "climb", "walk", "jog", "sprint", "kite", "sail"];
const CAUTIOUS = ["cover", "shelter", "snowmobile", "drive", "wait", "stay", "indoor", "equipment", "hunker"];

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
}

export async function completeLevel(input: CompleteLevelInput): Promise<LevelOutcome> {
  const city = cityForLevel(input.level, input.homeCity);
  const difficulty = difficultyBand(input.level);
  if (input.wallet.mode === "onchain" && CONTRACT) {
    return completeLevelOnChain(input.level, city, input.action, difficulty, input.wallet);
  }
  return completeLevelDemo(input.level, city, input.action, difficulty, input.wallet);
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
): Promise<LevelOutcome> {
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
      alreadyCompleted: true,
    };
  }

  const { risk } = await previewFor(city);
  await delay(1400); // simulate AI + consensus latency

  const a = action.toLowerCase();
  const reckless = RECKLESS.some((k) => a.includes(k));
  const cautious = CAUTIOUS.some((k) => a.includes(k));
  const extreme = risk.risk_tier === "Extreme";

  let success: boolean;
  let verdict: string;

  // Progressive AI strictness — mirrors the contract's difficulty_note for _judge_action.
  if (difficulty === "Hard") {
    success = cautious && !reckless;
    verdict = success
      ? `Hard level: only a clearly safe, adapted action passes. "${action}" qualified in ${risk.risk_tier.toLowerCase()} conditions.`
      : `Hard level: the AI is strict here. "${action}" was not a clearly safe response to ${risk.risk_tier.toLowerCase()} weather.`;
  } else if (difficulty === "Medium") {
    success = extreme ? cautious && !reckless : !reckless || cautious;
    verdict = success
      ? `Medium level: "${action}" was a reasonable response to ${risk.risk_tier.toLowerCase()} conditions.`
      : `Medium level: "${action}" was too reckless for ${risk.risk_tier.toLowerCase()} conditions.`;
  } else {
    // Easy — forgiving onboarding; only fails on clearly reckless actions in extreme weather.
    success = !(reckless && !cautious && extreme);
    verdict = success
      ? `Easy level: ${risk.risk_tier.toLowerCase()} weather (${risk.multiplier.toFixed(1)}x) was survivable for "${action}".`
      : `Even on an easy level, "${action}" in ${risk.risk_tier.toLowerCase()} weather was judged unsafe.`;
  }

  const base = baseRewardGen(level);
  const payoutGen = success ? base * risk.multiplier : 0;
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
    txHash: fakeTxHash(),
  };
}

async function completeLevelOnChain(
  level: number,
  city: string,
  action: string,
  difficulty: ReturnType<typeof difficultyBand>,
  wallet: WalletState,
): Promise<LevelOutcome> {
  // The UI preview is non-authoritative; the contract re-derives the real multiplier.
  const { risk } = await previewFor(city);
  const res = await gl.writeCompleteLevel(wallet.address, CONTRACT, level, city, action);
  const success = res.completed;
  const payoutGen = success ? baseRewardGen(level) * risk.multiplier : 0;
  return {
    level,
    success,
    payoutGen,
    risk,
    reasoning: success
      ? `On-chain: validators settled Level ${level} (${city}) as passed.`
      : `On-chain: the AI judgment failed Level ${level} (${city}). Try a safer action and resubmit.`,
    difficulty,
    city,
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

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
