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

// StudioNet is chain id 61999 → hex 0xF22F. (0xF20F would be 61967 — a different
// chain — so the hex MUST be derived from 61999, which is `0x${(61999).toString(16)}`.)
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
      // Not in the wallet yet — add it, then (try to) switch onto it.
      await provider.request({ method: "wallet_addEthereumChain", params: [STUDIONET_ADD_PARAMS] });
      try {
        await switchToStudioNet();
      } catch {
        /* adding usually selects it already; ignore the redundant switch rejection */
      }
      return;
    }
    throw err; // user rejected the switch, or another error — surface it
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

/** campaign_progress(account) — non-consensus view, safe for the UI to trust. */
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
    campaignPayoutAtto: BigInt(String(raw.campaign_payout_atto ?? "0")),
  };
}

export interface CompleteLevelResult {
  txHash: string;
  /** True when the level settled as PASSED (payout marked complete). */
  completed: boolean;
  /** True when consensus did NOT finalize within {@link CONSENSUS_TIMEOUT_MS}. */
  timedOut: boolean;
}

/**
 * complete_level(level, city, action, optimal_steps, actual_steps) — gasless on
 * StudioNet (value 0). The two step counts drive the on-chain efficiency
 * multiplier. Waits for consensus (capped at 60s) and then re-reads progress to
 * confirm settlement. On a chain-mismatch send error, switches to StudioNet and
 * retries once. A consensus timeout is reported via `timedOut` (NOT as a fail).
 */
export async function writeCompleteLevel(
  address: string,
  contract: string,
  level: number,
  city: string,
  action: string,
  optimalSteps: number,
  actualSteps: number,
): Promise<CompleteLevelResult> {
  const submit = async () => {
    const client = await makeClient(address);
    const hash = await client.writeContract({
      address: contract as `0x${string}`,
      functionName: "complete_level",
      args: [BigInt(level), city, action, BigInt(Math.max(1, optimalSteps)), BigInt(Math.max(1, actualSteps))],
      value: 0n,
    });
    return { client, hash };
  };

  // Issue 5: auto-retry after switching network if the send hit a chain mismatch.
  const { client, hash } = await withChainRetry(submit);

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
      throw err; // a genuine revert / send error — let the caller surface it
    }
  }

  // StudioNet applies the payout on FINALIZED, which can lag the receipt by a few
  // seconds. Poll briefly so a settled win isn't falsely reported as failed.
  let completed = false;
  if (finalized) {
    for (let i = 0; i < 6 && !completed; i++) {
      const progress = await readCampaignProgress(address, contract);
      completed = progress.completed.includes(level);
      if (!completed) await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return { txHash: String(hash), completed, timedOut };
}

export const GEN_UNIT = GEN_WEI;
