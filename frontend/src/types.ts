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
  multiplier: number; // 1.0 to 5.0
  multiplierX100: number; // 100 to 500 (integer hundredths, contract MULT_MIN..MULT_MAX)
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

/**
 * Mirrors the contract's campaign_progress(account) view. PER-PLAYER only: the
 * contract no longer returns the contract-wide payout counter here, so the only
 * total in this shape is the all-time credit for THIS address.
 */
export interface CampaignProgress {
  account: string;
  completed: number[];
  completedCount: number;
  nextLevel: number;
  maxLevel: number;
  /** PER-PLAYER cumulative credit ledger (get_credit / get_total_credit), in atto. */
  totalCreditAtto: bigint;
}

/** On-chain GEN balance for the connected account. */
export interface GenBalance {
  address: string;
  wei: bigint;
  gen: number;
}

/** Result of attempting a campaign level (demo or on-chain settlement). */
export interface LevelOutcome {
  level: number;
  success: boolean;
  payoutGen: number;
  risk: RiskAnalysis;
  reasoning: string;
  difficulty: DifficultyBand;
  city: string;
  /** True once the level was settled by the on-chain contract (real GEN transfer);
   *  false in demo mode (local, simulated). Drives honest settlement copy in the UI. */
  onChain?: boolean;
  alreadyCompleted?: boolean;
  /** True when an on-chain submission hit the 60s validator-consensus timeout
   *  (StudioNet congestion). This is NOT an AI failure - the UI must show a
   *  "may finalize later" notice and let the player close, never "Quest Failed". */
  timedOut?: boolean;
  /** Specific, human-readable failure reason when an on-chain write never settled
   *  (wallet rejection, contract revert, insufficient funds, or network error).
   *  When set, the UI shows this verbatim instead of a generic "AI said no" message,
   *  and the failure must NOT shake like an AI-judged-unsafe verdict. */
  errorMessage?: string;
  txHash?: string;
  /** Payout delivery state, reported separately from the verdict. */
  payoutStatus?: "none" | "credit" | "pending" | "sent" | "failed";
  /** Triggered transfer tx hash when the platform emits one (empty for credit path). */
  payoutTxHash?: string;
  /** PER-LEVEL payout the contract stored in get_level_payout(account, level), GEN.
   *  This is the number the settlement screen shows as "this level paid". */
  levelPayoutGen?: number;
  /** PER-LEVEL payout in atto (exact, for the balance-delta cross-check). */
  levelPayoutAtto?: bigint;
  /** PER-PLAYER cumulative credit after this run (get_total_credit), GEN. Displayed
   *  only under an explicit "total credited to your address" label. */
  totalCreditGen?: number;
  /** PER-PLAYER cumulative credit in atto. */
  totalCreditAtto?: bigint;
  /** Wallet native GEN immediately before / after the settlement (WALLET-NATIVE). */
  nativeBeforeGen?: number;
  nativeAfterGen?: number;
  /** Same values in atto, so the delta proof never goes through a float. */
  nativeBeforeAtto?: bigint;
  nativeAfterAtto?: bigint;
  /** True when the measured native delta equals levelPayoutAtto exactly. */
  nativeDeltaMatches?: boolean;
  /** The on-chain objective for this level (mirrors LEVEL_OBJECTIVE in the contract). */
  objective?: string;
}
