/**
 * Money-display classification helpers (single source of truth for every GEN label).
 *
 * REVIEWER RULE: a value shown in the UI is one of exactly three classes, and the
 * label must say which:
 *   PER-LEVEL     what THIS level paid      -> contract get_level_payout(account, level)
 *   PER-PLAYER    all-time credited to the  -> contract get_credit / get_total_credit
 *                 ONE address (cumulative)
 *   GLOBAL        every player combined     -> contract get_global_stats (never shown
 *                                              inside a per-player panel)
 * The classes are not interchangeable: showing a cumulative credit next to a level
 * as if it were that level's prize is the bug this module exists to prevent, so
 * every label below names its class and takes the atto value straight from the
 * contract view (BigInt, no float rounding of the amount itself).
 *
 * A FOURTH class exists in the repo and must never be confused with the three
 * above: NOT-PAYABLE. The legacy marketplace pages (pages/CreateQuest.tsx,
 * Dashboard.tsx, MyQuests.tsx and components/QuestCard, QuestDetailModal,
 * ResultScreen) are not part of the shipped game build (main.tsx mounts App.tsx
 * alone, verified by grepping the built bundle for their strings) and the contract
 * rejects create_quest outright on this deployment. Every GEN figure inside them
 * is a local simulation with no on-chain counterpart, so it may never be described
 * as an earned or escrowed payout.
 */

export const ATTO_PER_GEN = 10n ** 18n;

export type MoneyClass =
  | "per-level"
  | "per-player-cumulative"
  | "global"
  | "wallet-native"
  | "not-payable";

/** atto -> GEN as a JS number. Only for arithmetic; NEVER for a displayed claim. */
export function attoToGen(atto: bigint): number {
  return Number(atto) / 1e18;
}

/**
 * atto -> exact decimal string (6 fractional digits max, truncated, never rounded
 * up, so a displayed amount can never exceed what the contract actually paid).
 * At least 2 fractional digits are kept so 0 shows as "0.00".
 */
export function formatAtto(atto: bigint): string {
  const a = atto < 0n ? 0n : atto;
  const whole = a / ATTO_PER_GEN;
  const frac6 = ((a % ATTO_PER_GEN) * 1_000_000n) / ATTO_PER_GEN;
  let digits = frac6.toString().padStart(6, "0").replace(/0+$/, "");
  if (digits.length < 2) digits = digits.padEnd(2, "0");
  return `${whole.toString()}.${digits}`;
}

/** Native wallet delta: after - before, floored at 0 (a payout can never be negative). */
export function nativeDeltaAtto(beforeWei?: bigint, afterWei?: bigint): bigint {
  if (beforeWei == null || afterWei == null) return 0n;
  const d = afterWei - beforeWei;
  return d > 0n ? d : 0n;
}

/**
 * True only when the observed native balance increase equals the contract's
 * per-level payout exactly. The UI uses this to say "received" instead of
 * "recorded on-chain, awaiting transfer"; a mismatch is reported honestly.
 */
export function deltaMatchesPayout(beforeWei?: bigint, afterWei?: bigint, payoutAtto?: bigint): boolean {
  if (payoutAtto == null || payoutAtto <= 0n) return false;
  return nativeDeltaAtto(beforeWei, afterWei) === payoutAtto;
}

/** PER-LEVEL label (settlement screen + level select). */
export function levelPayoutLabel(level: number, payoutAtto: bigint): string {
  return `Level ${level} payout: ${formatAtto(payoutAtto)} GEN`;
}

/** PER-PLAYER cumulative label - deliberately worded so it is never read as one level. */
export function totalCreditedLabel(totalAtto: bigint): string {
  return `Total credited to your address (all levels): ${formatAtto(totalAtto)} GEN`;
}

/** Native balance before/after proof, with the measured delta. */
export function nativeDeltaLabel(beforeAtto?: bigint, afterAtto?: bigint): string {
  if (beforeAtto == null || afterAtto == null) return "Wallet native GEN: not read";
  const delta = nativeDeltaAtto(beforeAtto, afterAtto);
  return `Wallet native GEN ${formatAtto(beforeAtto)} -> ${formatAtto(afterAtto)} (+${formatAtto(delta)})`;
}

/**
 * Payout delivery state, phrased about the PER-LEVEL amount only. `pending` and
 * `credit` must never read as "received".
 */
export function payoutStatusLabel(
  status: "none" | "credit" | "pending" | "sent" | "failed" | undefined,
  levelPayoutAtto?: bigint,
): string {
  const amt = levelPayoutAtto != null && levelPayoutAtto > 0n ? `${formatAtto(levelPayoutAtto)} GEN` : "";
  switch (status) {
    case "sent":
      return amt ? `Payout: ${amt} received in your wallet` : "Payout: received in your wallet";
    case "failed":
      return "Payout: failed (transfer tx did not settle)";
    case "pending":
      return "Payout: pending (transfer tx not finalized yet)";
    case "credit":
      return amt
        ? `Payout: ${amt} recorded on-chain (native transfer awaiting confirmation)`
        : "Payout: recorded on-chain, awaiting native transfer";
    case "none":
    default:
      return "Payout: none";
  }
}

/** What a level can pay at a given multiplier, in atto (mirrors the contract exactly). */
export function payoutAttoExact(
  baseGenUnits: number,
  scale: number,
  multiplierX100: number,
): bigint {
  const baseAtto = (BigInt(Math.round(baseGenUnits)) * ATTO_PER_GEN) / BigInt(scale);
  return (baseAtto * BigInt(Math.round(multiplierX100))) / 100n;
}

/** Classify a value for the audit trail in comments/tests (kept exported for tests). */
export const MONEY_CLASSES: Readonly<Record<string, MoneyClass>> = {
  levelPayout: "per-level",
  getCredit: "per-player-cumulative",
  getTotalCredit: "per-player-cumulative",
  getGlobalStats: "global",
  walletBalance: "wallet-native",
  // Legacy marketplace surfaces: no on-chain path can pay any of these.
  marketplaceBaseReward: "not-payable",
  marketplaceProjectedPayout: "not-payable",
  demoSessionBalance: "not-payable",
};
