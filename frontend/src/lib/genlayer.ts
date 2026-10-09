/**
 * Thin browser wrapper around the official GenLayer JS SDK (`genlayer-js`).
 *
 * Everything here is loaded lazily: the demo build never touches the SDK, so
 * `npm run build` and offline play stay lean. The React host only calls into
 * this module after the player clicks "Connect GenLayer Wallet".
 *
 * Identity model: GenLayer accounts ARE Ethereum addresses, so we reuse an
 * injected EIP-1193 provider (MetaMask / the GenLayer wallet) as the signer.
 * The account's address is the campaign identity that `complete_level` and
 * `campaign_progress` key off of on-chain.
 *
 * Network handling: every on-chain call is guarded so the wallet is on
 * StudioNet (chain id 61999 = 0xF22F). If it isn't, we ask MetaMask to switch,
 * and if the network is unknown to the wallet we add it first. A send/read that
 * fails specifically because of a chain mismatch is retried once after
 * switching. Consensus (transaction finalization) is capped at 60s so a
 * congested StudioNet surfaces an honest "may finalize later" state instead of
 * a false "Quest Failed".
 */

import type { CampaignProgress, GenBalance } from "../types";

const CHAIN_NAME = "studionet";
const GEN_WEI = 1_000_000_000_000_000_000n;

// StudioNet is chain id 61999 → hex 0xF22F. (0xF20F would be 61967 - a different
// chain - so the hex MUST be derived from 61999, which is `0x${(61999).toString(16)}`.)
const STUDIONET_CHAIN_ID_DEC = 61999;
const STUDIONET_CHAIN_ID_HEX = `0x${STUDIONET_CHAIN_ID_DEC.toString(16)}`; // 0xf22f

/** wallet_addEthereumChain payload for players who don't have StudioNet yet. */
const STUDIONET_ADD_PARAMS = {
  chainId: STUDIONET_CHAIN_ID_HEX,
  chainName: "GenLayer StudioNet",
  rpcUrls: ["https://studio.genlayer.com/api"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: ["https://studio.genlayer.com"],
};

/** Max time to wait for validator consensus before reporting congestion. */
const CONSENSUS_TIMEOUT_MS = 60_000;

const CONSENSUS_TIMEOUT_SENTINEL = "__wg_consensus_timeout__";

/** Explorer base for full tx links (the user-facing settlement link). */
export const EXPLORER_BASE = "https://explorer-studio.genlayer.com";

/** Build a StudioNet explorer URL for a 66-char tx hash (empty for a short hash). */
export function explorerTxUrl(hash?: string): string {
  return hash && hash.length >= 64 ? `${EXPLORER_BASE}/tx/${hash}` : "";
}

interface EthProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getProvider(): EthProvider | null {
  const w = window as unknown as { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

function requireProvider(): EthProvider {
  const provider = getProvider();
  if (!provider) {
    throw new Error("No Ethereum wallet detected. Install MetaMask to play on-chain.");
  }
  return provider;
}

function providerErrorCode(err: unknown): number | undefined {
  return (err as { code?: number } | undefined)?.code;
}

function providerErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | undefined)?.message;
  return (msg ?? String(err)).toLowerCase();
}

/** Lazily construct a genlayer-js client bound to the connected wallet. */
async function makeClient(address: string) {
  const provider = requireProvider();
  const sdk = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  return sdk.createClient({
    chain: studionet,
    account: address as `0x${string}`,
    // genlayer-js expects a viem EthereumProvider; the injected object satisfies it.
    provider: provider as never,
  });
}

/** True when an SDK/provider error means "the wallet is on the wrong chain". */
export function isChainMismatchError(err: unknown): boolean {
  if (err == null) return false;
  const code = providerErrorCode(err);
  const msg = providerErrorMessage(err);
  const name = ((err as { name?: string } | undefined)?.name ?? "").toLowerCase();
  if (code === 4902) return true; // MetaMask: unrecognized chain
  if (name.includes("chainmismatch")) return true; // viem ChainMismatchError
  if (msg.includes("unrecognized chain")) return true;
  if (msg.includes("wrong chain") || msg.includes("different network")) return true;
  if (msg.includes("selected a different")) return true;
  if (msg.includes("does not match") && (msg.includes("chain") || msg.includes("network"))) return true;
  if (msg.includes("expected") && msg.includes("chain id")) return true;
  return false;
}

/**
 * Ensure the wallet is on StudioNet. Switch first; if the network isn't known
 * to the wallet (error 4902), add it and switch again.
 */
export async function ensureStudioNet(): Promise<void> {
  const provider = requireProvider();

  let current = "";
  try {
    current = String(await provider.request({ method: "eth_chainId" }));
  } catch {
    current = "";
  }
  if (current.toLowerCase() === STUDIONET_CHAIN_ID_HEX.toLowerCase()) return;

  const switchToStudioNet = () =>
    provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });

  try {
    await switchToStudioNet();
    return;
  } catch (err) {
    const code = providerErrorCode(err);
    if (code === 4902 || code === -32602) {
      // Not in the wallet yet - add it, then (try to) switch onto it.
      await provider.request({ method: "wallet_addEthereumChain", params: [STUDIONET_ADD_PARAMS] });
      try {
        await switchToStudioNet();
      } catch {
        /* adding usually selects it already; ignore the redundant switch rejection */
      }
      return;
    }
    throw err; // user rejected the switch, or another error - surface it
  }
}

/** Run an op; if it fails due to a chain mismatch, switch to StudioNet and retry once. */
async function withChainRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (isChainMismatchError(err)) {
      await ensureStudioNet();
      return await op();
    }
    throw err;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(CONSENSUS_TIMEOUT_SENTINEL)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Reveal + authorize the active account, then auto-switch the wallet to StudioNet. */
export async function requestAccounts(): Promise<string> {
  const provider = requireProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error("Wallet connection was rejected.");
  }
  await ensureStudioNet(); // "Connect Wallet" now lands on StudioNet automatically
  return accounts[0];
}

export function chainLabel(): string {
  return CHAIN_NAME;
}

export const STUDIONET = {
  chainIdDec: STUDIONET_CHAIN_ID_DEC,
  chainIdHex: STUDIONET_CHAIN_ID_HEX,
  addParams: STUDIONET_ADD_PARAMS,
};

/** Read the on-chain GEN balance of the connected account. */
export async function readGenBalance(address: string): Promise<GenBalance> {
  const wei = await withChainRetry(async () => {
    const client = await makeClient(address);
    return client.getBalance({ address: address as `0x${string}` }) as Promise<bigint>;
  });
  return { address, wei, gen: Number(wei) / 1e18 };
}

/**
 * campaign_progress(account) - non-consensus view, safe for the UI to trust.
 * PER-PLAYER only: the contract deliberately does NOT return the contract-wide
 * counter here (it used to, which is how a cumulative total could get shown as a
 * level prize). The all-time total for ONE address is `totalCreditAtto`; the
 * global figure lives only in readGlobalStats() and must never be rendered inside
 * a per-player panel.
 */
export async function readCampaignProgress(address: string, contract: string): Promise<CampaignProgress> {
  const raw = await withChainRetry(async () => {
    const client = await makeClient(address);
    return (await client.readContract({
      address: contract as `0x${string}`,
      functionName: "campaign_progress",
      args: [address],
    })) as Record<string, unknown>;
  });
  return {
    account: String(raw.account ?? address),
    completed: (raw.completed as number[]) ?? [],
    completedCount: Number(raw.completed_count ?? 0),
    nextLevel: Number(raw.next_level ?? 0),
    maxLevel: Number(raw.max_level ?? 10),
    totalCreditAtto: BigInt(String(raw.total_credit_atto ?? "0")),
  };
}

/**
 * get_level_payout(account, level) - the PER-LEVEL payout the contract stored when
 * that address settled that level. This is the only authoritative answer to "what
 * did this level pay me", and it never grows when another level is completed.
 */
export async function readLevelPayout(
  address: string,
  contract: string,
  level: number,
): Promise<{ completed: boolean; payoutAtto: bigint }> {
  const raw = await withChainRetry(async () => {
    const client = await makeClient(address);
    return (await client.readContract({
      address: contract as `0x${string}`,
      functionName: "get_level_payout",
      args: [address, BigInt(level)],
    })) as Record<string, unknown>;
  });
  return {
    completed: raw.completed === true || String(raw.completed) === "True",
    payoutAtto: BigInt(String(raw.payout_atto ?? "0")),
  };
}

/** get_total_credit(account) - PER-PLAYER cumulative credit ledger, in atto. */
export async function readTotalCredit(address: string, contract: string): Promise<bigint> {
  const raw = await withChainRetry(async () => {
    const client = await makeClient(address);
    return (await client.readContract({
      address: contract as `0x${string}`,
      functionName: "get_total_credit",
      args: [address],
    })) as Record<string, unknown>;
  });
  return BigInt(String(raw.total_credit_atto ?? "0"));
}

/**
 * get_global_stats() - GLOBAL aggregates across all players. Rendered only in a
 * clearly-labelled campaign-wide spot, never inside a per-player or per-level view.
 */
export async function readGlobalStats(
  address: string,
  contract: string,
): Promise<{ levelsCompleted: number; campaignPayoutAtto: bigint; totalCreditsAtto: bigint; houseBalanceAtto: bigint }> {
  const raw = await withChainRetry(async () => {
    const client = await makeClient(address);
    return (await client.readContract({
      address: contract as `0x${string}`,
      functionName: "get_global_stats",
      args: [],
    })) as Record<string, unknown>;
  });
  return {
    levelsCompleted: Number(raw.levels_completed ?? 0),
    campaignPayoutAtto: BigInt(String(raw.campaign_payout_atto ?? "0")),
    totalCreditsAtto: BigInt(String(raw.total_credits_atto ?? "0")),
    houseBalanceAtto: BigInt(String(raw.house_balance_atto ?? "0")),
  };
}

/**
 * get_credit(account) - the on-chain payout ledger for an address, in atto.
 * The contract also sends the GEN natively (emit_transfer); this ledger is a
 * per-account mirror of CUMULATIVE payouts the UI can cross-check against. It is
 * NOT a per-level figure: never label it as one. This view is non-consensus and
 * safe for the UI to trust.
 */
export async function readGetCredit(address: string, contract: string): Promise<bigint> {
  const raw = await withChainRetry(async () => {
    const client = await makeClient(address);
    return (await client.readContract({
      address: contract as `0x${string}`,
      functionName: "get_credit",
      args: [address],
    })) as Record<string, unknown>;
  });
  return BigInt(String(raw.credit_atto ?? "0"));
}

/**
 * Map a wallet / SDK / RPC error to a specific, human-readable failure reason so
 * the UI can tell the player EXACTLY what went wrong instead of a generic
 * "Quest Failed". Order matters: a wallet rejection (code 4001 / "rejected") is
 * checked first, then contract reverts, then funding problems, else network.
 */
function classifyWriteError(err: unknown): string {
  const code = providerErrorCode(err);
  const msg = providerErrorMessage(err); // already lower-cased
  if (code === 4001 || msg.includes("rejected") || msg.includes("user denied") || msg.includes("denied transaction")) {
    return "Transaction rejected by your wallet.";
  }
  if (msg.includes("revert") || msg.includes("execution reverted")) {
    return "Action rejected by AI validators or contract logic.";
  }
  if (msg.includes("insufficient funds") || msg.includes("balance")) {
    return "Insufficient GEN balance in contract or wallet.";
  }
  return "Network error. Please try again.";
}

/** Payout delivery state, reported separately from the verdict. */
export type PayoutStatus =
  | "none" // verdict did not pay (fail judgment)
  | "credit" // payout recorded on-chain; native delivery not yet confirmed
  | "pending" // a triggered transfer tx exists and has not resolved
  | "sent" // the wallet's native GEN balance increased by the payout
  | "failed"; // the triggered transfer tx failed

export interface CompleteLevelResult {
  txHash: string;
  /** True when the level settled as PASSED (payout marked complete). */
  completed: boolean;
  /** True when consensus did NOT finalize within {@link CONSENSUS_TIMEOUT_MS}. */
  timedOut: boolean;
  /** Specific, human-readable failure reason when the write never settled (wallet
   *  rejection, contract revert, insufficient funds, or network error). Undefined
   *  on success and on a plain congestion timeout. */
  errorMessage?: string;
  /** Delivery state of the payout, separate from the verdict. */
  payoutStatus: PayoutStatus;
  /** Triggered transfer tx hash when the platform emits one (empty for the credit
   *  ledger path). */
  payoutTxHash?: string;
  /** PER-LEVEL payout from get_level_payout(account, level), in atto. Undefined when
   *  the read failed; the caller must then fall back and label it approximate. */
  levelPayoutWei?: bigint;
  /** PER-PLAYER cumulative credit ledger after this run (get_total_credit), in atto.
   *  NEVER display this as the payout of a single level. */
  totalCreditWei?: bigint;
  /** Wallet native GEN before / after the settlement, in wei (WALLET-NATIVE class). */
  balanceBeforeWei?: bigint;
  balanceAfterWei?: bigint;
}

/**
 * complete_level(level, city, action) - gasless on StudioNet (value 0). The payout
 * is base(level) * the consensus weather multiplier only; there is NO caller-
 * supplied step/efficiency term. Waits for consensus (capped at 60s) and then
 * re-reads progress to confirm settlement. On a chain-mismatch send error, switches
 * to StudioNet and retries once. Failures never throw: a wallet rejection, contract
 * revert, insufficient funds, or network error is mapped to a specific
 * `errorMessage`, while a 60s consensus timeout is reported via `timedOut` (NOT as
 * a fail).
 */
export async function writeCompleteLevel(
  address: string,
  contract: string,
  level: number,
  city: string,
  action: string,
): Promise<CompleteLevelResult> {
  const submit = async () => {
    const client = await makeClient(address);
    const hash = await client.writeContract({
      address: contract as `0x${string}`,
      functionName: "complete_level",
      args: [BigInt(level), city, action],
      value: 0n,
    });
    return { client, hash };
  };

  let txHash = "";
  // Snapshot the wallet's native GEN balance before the write so the UI can PROVE
  // the payout actually landed (balance delta), instead of trusting a triggered
  // transfer whose StudioNet consensus is only cosmetic.
  let balanceBeforeWei: bigint | undefined;
  try {
    balanceBeforeWei = (await readGenBalance(address)).wei;
  } catch {
    balanceBeforeWei = undefined;
  }
  try {
    // Issue 5: auto-retry after switching network if the send hit a chain mismatch.
    // A wallet rejection (code 4001) here is caught below and mapped to a message.
    const { client, hash } = await withChainRetry(submit);
    txHash = String(hash);

    // Issue 3: cap validator-consensus waiting at 60s; congestion ≠ failure.
    let timedOut = false;
    let finalized = false;
    try {
      await withTimeout(client.waitForTransactionReceipt({ hash }), CONSENSUS_TIMEOUT_MS);
      finalized = true;
    } catch (err) {
      if (err instanceof Error && err.message === CONSENSUS_TIMEOUT_SENTINEL) {
        timedOut = true;
      } else {
        throw err; // a genuine revert / execution error - mapped by the outer catch
      }
    }

    if (timedOut) {
      return { txHash, completed: false, timedOut: true, payoutStatus: "none" };
    }

    // StudioNet applies the payout on FINALIZED, which can lag the receipt by a few
    // seconds. Poll briefly so a settled win isn't falsely reported as failed.
    let completed = false;
    if (finalized) {
      try {
        for (let i = 0; i < 6 && !completed; i++) {
          const progress = await readCampaignProgress(address, contract);
          completed = progress.completed.includes(level);
          if (!completed) await new Promise((r) => setTimeout(r, 5000));
        }
      } catch {
        /* progress read failed after finalize - treat as unsettled, not a hard error */
      }
    }

    if (!completed) {
      // Failed judgment: nothing was paid.
      return { txHash, completed: false, timedOut: false, payoutStatus: "none" };
    }

    // The verdict settled as PASSED. The contract sends GEN natively via
    // emit_transfer AND records the payout in the credit ledger. Read the PER-LEVEL
    // payout (get_level_payout) and the PER-PLAYER total (get_total_credit) as the
    // two distinct classes they are, then confirm delivery against the wallet's
    // real native balance delta so the UI never claims "sent" unless GEN actually
    // landed and never shows a cumulative total as this level's prize.
    let levelPayoutWei: bigint | undefined;
    try {
      levelPayoutWei = (await readLevelPayout(address, contract, level)).payoutAtto;
    } catch {
      levelPayoutWei = undefined;
    }
    let totalCreditWei: bigint | undefined;
    try {
      totalCreditWei = await readTotalCredit(address, contract);
    } catch {
      totalCreditWei = undefined;
    }

    let payoutStatus: PayoutStatus = "credit";
    let payoutTxHash: string | undefined;
    try {
      const client = await makeClient(address);
      const ids = (await client.getTriggeredTransactionIds({ hash: txHash as never })) as string[];
      if (ids && ids.length > 0) {
        payoutTxHash = String(ids[0]);
        payoutStatus = await resolveTriggeredStatus(client, payoutTxHash);
      }
    } catch {
      // triggered lookup unsupported: fall back to the credit-ledger state
      payoutStatus = "credit";
    }

    // Prove native delivery: poll the wallet balance briefly and mark "sent" only
    // when it actually increased by the per-level payout. A delta that does not
    // match the contract's per-level figure is reported as pending/credit, never
    // as a successful delivery of an amount we cannot show.
    let balanceAfterWei: bigint | undefined = balanceBeforeWei;
    if (balanceBeforeWei != null) {
      let after = balanceBeforeWei;
      for (let i = 0; i < 6; i++) {
        try {
          after = (await readGenBalance(address)).wei;
          balanceAfterWei = after;
        } catch {
          /* balance read failed; keep last known */
        }
        if (after > balanceBeforeWei) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      const delta = after - balanceBeforeWei;
      if (levelPayoutWei != null && delta === levelPayoutWei) {
        payoutStatus = "sent";
      } else if (delta > 0n && levelPayoutWei == null) {
        // Payout landed but the per-level view was unreadable: still delivered.
        payoutStatus = "sent";
      } else if (payoutStatus === "sent") {
        payoutStatus = "pending";
      }
    }

    return {
      txHash,
      completed,
      timedOut: false,
      payoutStatus,
      payoutTxHash,
      levelPayoutWei,
      totalCreditWei,
      balanceBeforeWei,
      balanceAfterWei,
    };
  } catch (err) {
    // Wallet rejection / revert / insufficient funds / network - never a silent throw.
    return { txHash, completed: false, timedOut: false, errorMessage: classifyWriteError(err), payoutStatus: "none" };
  }
}

/**
 * Poll a triggered transfer tx up to the 5 minute cap and map its lifecycle to a
 * payout status. sent = finalized with SUCCESS execution; failed = a terminal
 * non-success; pending = still unresolved after the cap.
 */
async function resolveTriggeredStatus(client: Awaited<ReturnType<typeof makeClient>>, hash: string): Promise<PayoutStatus> {
  const cap = 300_000;
  const t0 = Date.now();
  while (Date.now() - t0 < cap) {
    let tx: Record<string, unknown>;
    try {
      tx = (await client.getTransaction({ hash: hash as never })) as unknown as Record<string, unknown>;
    } catch {
      return "pending";
    }
    const status = String(tx.statusName ?? tx.status ?? "");
    const exec = String(tx.txExecutionResultName ?? "");
    if (status === "FINALIZED" || status === "UNDETERMINED") {
      if (status === "UNDETERMINED" || exec === "ERROR") return "failed";
      return "sent";
    }
    if (status === "VALIDATORS_TIMEOUT" || status === "LEADER_TIMEOUT" || status === "CANCELED") {
      return "failed";
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return "pending";
}

export const GEN_UNIT = GEN_WEI;
