export const GEN = 1_000_000_000_000_000_000n;

/** atto (bigint) -> GEN number for display. */
export function attoToGen(atto: bigint | number): number {
  return Number(BigInt(atto)) / 1e18;
}

/** GEN number -> atto bigint. */
export function genToAtto(gen: number): bigint {
  return BigInt(Math.round(gen * 1e18));
}

export function shortAddr(addr: string, size = 4): string {
  if (!addr) return "";
  if (addr.length <= size * 2 + 2) return addr;
  return `${addr.slice(0, size + 2)}…${addr.slice(-size)}`;
}

/** Human countdown from ms remaining. */
export function countdown(msLeft: number): string {
  if (msLeft <= 0) return "Expired";
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * GEN -> display string. TRUNCATES at `digits` decimals instead of rounding, so a
 * rendered amount can never be larger than the amount actually paid (toFixed() is
 * what let a 0.1445 GEN figure print as "0.15"). Negative input floors at 0, which
 * matches formatAtto() in lib/payout.ts, and the tiny epsilon only absorbs float
 * representation noise (0.29 * 100 === 28.999999999999996) so an exact step is not
 * displayed one digit low. On-chain amounts must go through formatAtto(atto) for
 * exactness; this helper takes a JS number and is for the legacy demo surfaces.
 */
export function formatGen(gen: number, digits = 2): string {
  const value = Number.isFinite(gen) && gen > 0 ? gen : 0;
  const factor = 10 ** digits;
  const truncated = Math.trunc(value * factor + 1e-9) / factor;
  return `${truncated.toFixed(digits)} GEN`;
}

/** Map a contract error / thrown message to a friendly, user-facing string. */
export function friendlyError(raw: string): string {
  const m = (raw || "").toString();
  if (/expired/i.test(m)) return "This quest has expired. Only the creator can reclaim funds.";
  if (/already submitted/i.test(m)) return "You've already submitted an action for this quest.";
  if (/insufficient/i.test(m) && /balance/i.test(m))
    return "Contract doesn't have enough funds for this reward.";
  if (/No location found|couldn't find/i.test(m))
    return "We couldn't find weather data for this city. Please try another.";
  if (/TRANSIENT|temporarily unavailable|slow/i.test(m))
    return "Weather service is temporarily unavailable. Please try again in a few minutes.";
  if (/LLM|judgment/i.test(m))
    return "AI judgment failed. This can happen occasionally. Please retry.";
  if (/connect/i.test(m) && /wallet/i.test(m)) return "Please connect your wallet to continue.";
  return m || "Something went wrong. Please try again.";
}
