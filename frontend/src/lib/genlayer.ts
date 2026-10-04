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
 */

import type { CampaignProgress, GenBalance } from "../types";

const CHAIN_NAME = "studionet";
const GEN_WEI = 1_000_000_000_000_000_000n;

interface EthProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getProvider(): EthProvider | null {
  const w = window as unknown as { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

/** Lazily construct a genlayer-js client bound to the connected wallet. */
async function makeClient(address: string) {
  const provider = getProvider();
  if (!provider) {
    throw new Error("No Ethereum wallet detected. Install MetaMask to play on-chain.");
  }
  const sdk = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  return sdk.createClient({
    chain: studionet,
    account: address as `0x${string}`,
    // genlayer-js expects a viem EthereumProvider; the injected object satisfies it.
    provider: provider as never,
  });
}

/** Ask the wallet to reveal + authorize the active GenLayer account. */
export async function requestAccounts(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new Error("No Ethereum wallet detected. Install MetaMask to play on-chain.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error("Wallet connection was rejected.");
  }
  return accounts[0];
}

export function chainLabel(): string {
  return CHAIN_NAME;
}

/** Read the on-chain GEN balance of the connected account. */
export async function readGenBalance(address: string): Promise<GenBalance> {
  const client = await makeClient(address);
  const wei: bigint = await client.getBalance({ address: address as `0x${string}` });
  return { address, wei, gen: Number(wei) / 1e18 };
}

/** campaign_progress(account) — non-consensus view, safe for the UI to trust. */
export async function readCampaignProgress(address: string, contract: string): Promise<CampaignProgress> {
  const client = await makeClient(address);
  const raw = (await client.readContract({
    address: contract as `0x${string}`,
    functionName: "campaign_progress",
    args: [address],
  })) as Record<string, unknown>;
  return {
    account: String(raw.account ?? address),
    completed: (raw.completed as number[]) ?? [],
    completedCount: Number(raw.completed_count ?? 0),
    nextLevel: Number(raw.next_level ?? 0),
    maxLevel: Number(raw.max_level ?? 10),
    campaignPayoutAtto: BigInt(String(raw.campaign_payout_atto ?? "0")),
  };
}

/**
 * complete_level(level, city, action) — gasless on StudioNet (value 0). Waits for
 * consensus, then re-reads progress to confirm the settlement authoritatively.
 */
export async function writeCompleteLevel(
  address: string,
  contract: string,
  level: number,
  city: string,
  action: string,
): Promise<{ txHash: string; completed: boolean }> {
  const client = await makeClient(address);
  const hash = await client.writeContract({
    address: contract as `0x${string}`,
    functionName: "complete_level",
    args: [BigInt(level), city, action],
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  // Re-read progress to confirm the level flipped to completed on-chain.
  const progress = await readCampaignProgress(address, contract);
  return { txHash: String(hash ?? (receipt as { hash?: string })?.hash ?? ""), completed: progress.completed.includes(level) };
}

export const GEN_UNIT = GEN_WEI;
