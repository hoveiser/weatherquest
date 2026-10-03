import type { ActionResult, Quest, RiskAnalysis } from "../types";
import { getWeatherByCity, previewRisk } from "./weather";
import { genToAtto, attoToGen } from "./format";

/**
 * Contract access layer.
 *
 * The app ships in DEMO MODE by default so reviewers can interact with the full
 * UX without a funded wallet. Demo mode mirrors the on-chain settlement rules
 * (multiplier from weather, LLM-style action judgment, payout = base × multiplier)
 * using the same Open-Meteo data the contract reads.
 *
 * To go live (Task 7), set VITE_CONTRACT_ADDRESS and VITE_NETWORK, install the
 * GenLayer JS SDK, and flip USE_ONCHAIN to true — the call signatures already
 * match contracts/weatherquest.py.
 */
const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS as string) || "";
export const USE_ONCHAIN = Boolean(CONTRACT_ADDRESS) && import.meta.env.VITE_ONCHAIN === "true";

export const DEMO_ADDR = "0xWeatherQuestDemo00000000000000000000000000";

const RECKLESS = ["run", "fly", "swim", "cycle", "climb", "walk", "jog", "sprint", "kite", "sail"];
const CAUTIOUS = ["cover", "shelter", "snowmobile", "drive", "wait", "stay", "indoor", "equipment", "hunker"];

export async function connectWallet(): Promise<string> {
  // Real mode: dynamic-import the SDK and prompt for an account here.
  await delay(400);
  return DEMO_ADDR;
}

export interface CreateQuestInput {
  city: string;
  baseRewardGen: number;
  description: string;
  expiryHours: number;
}

export async function createQuest(input: CreateQuestInput, creator: string): Promise<Quest> {
  if (USE_ONCHAIN) {
    // const gl = await import("@genlayer.io/sdk"); ... create_quest(city, atto, desc, hours)
    throw new Error("On-chain create requires a deployed contract (see README Task 7).");
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

/** Live weather + preview multiplier for a quest (used for the risk meter). */
export async function analyzeQuest(quest: Quest): Promise<{ risk: RiskAnalysis; condition: string; temp: number }> {
  const w = await getWeatherByCity(quest.city);
  const risk = previewRisk(w);
  return { risk, condition: w.condition, temp: w.temperature_2m };
}

export async function submitAction(quest: Quest, action: string): Promise<ActionResult> {
  if (USE_ONCHAIN) {
    throw new Error("On-chain submit requires a deployed contract (see README Task 7).");
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
    txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`,
  };
}

export function payoutPreview(quest: Quest, risk: RiskAnalysis): number {
  return quest.baseRewardGen * risk.multiplier;
}

// atto helpers re-exported so pages don't import format directly for money math.
export { genToAtto, attoToGen };

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
