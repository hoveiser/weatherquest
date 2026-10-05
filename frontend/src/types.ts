export type RiskTier = "Low" | "Medium" | "High" | "Extreme";

import type { DifficultyBand } from "./lib/maps";

export type QuestStatus = "Active" | "Completed" | "Failed" | "Expired" | "Claimed";

export interface WeatherSnapshot {
  city: string;
  temperature_2m: number;
  precipitation: number;
  wind_speed_10m: number;
  relative_humidity_2m: number;
  weather_code: number;
  is_day: number;
  condition: string;
  /** WMO code category used to pick an icon + particle effect. */
  kind: WeatherKind;
}

export type WeatherKind =
  | "clear"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export interface RiskAnalysis {
  multiplier: number; // 1.0 – 5.0
  multiplierX100: number; // 100 – 500
  risk_tier: RiskTier;
  reasoning: string;
}

export interface Quest {
  questId: string;
  city: string;
  creator: string;
  baseRewardGen: number;
  description: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  status: QuestStatus;
  submissionCount: number;
  risk?: RiskAnalysis; // latest cached analysis
}

export interface ActionResult {
  success: boolean;
  payoutGen: number;
  risk: RiskAnalysis;
  reasoning: string;
  txHash?: string;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

/** Which wallet backend is driving play. Demo needs no funded account. */
export type WalletMode = "demo" | "onchain";

export interface WalletState {
  mode: WalletMode;
  address: string;
  connecting: boolean;
}

/** Mirrors the contract's campaign_progress(account) view. */
export interface CampaignProgress {
  account: string;
  completed: number[];
  completedCount: number;
  nextLevel: number;
  maxLevel: number;
  campaignPayoutAtto: bigint;
}

/** On-chain GEN balance for the connected account. */
export interface GenBalance {
  address: string;
  wei: bigint;
  gen: number;
}

/** Navigation-efficiency tier, mirroring contracts/weatherquest.py _efficiency_multiplier. */
export type EfficiencyTier = "Perfect" | "Good" | "Wandering" | "Lost";

/** Result of attempting a campaign level (demo or on-chain settlement). */
export interface LevelOutcome {
  level: number;
  success: boolean;
  payoutGen: number;
  risk: RiskAnalysis;
  reasoning: string;
  difficulty: DifficultyBand;
  city: string;
  /** BFS shortest spawn→gate length for the rendered map. */
  optimalSteps: number;
  /** Grid-cell transitions the player actually made before reaching the gate. */
  actualSteps: number;
  /** Efficiency tier derived from the two step counts (same rule as the contract). */
  efficiency: EfficiencyTier;
  /** Efficiency multiplier in hundredths: 150 / 100 / 50 / 10. */
  efficiencyX100: number;
  /** True once the level was settled by the on-chain contract (real GEN transfer);
   *  false in demo mode (local, simulated). Drives honest settlement copy in the UI. */
  onChain?: boolean;
  alreadyCompleted?: boolean;
  /** True when an on-chain submission hit the 60s validator-consensus timeout
   *  (StudioNet congestion). This is NOT an AI failure — the UI must show a
   *  "may finalize later" notice and let the player close, never "Quest Failed". */
  timedOut?: boolean;
  txHash?: string;
}
