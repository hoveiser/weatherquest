// Settlement proof links for the on-chain verdict.
//
// The contract sends GEN natively (emit_transfer) and the UI confirms it against
// the wallet's real balance delta, so the payout status is reported separately
// from the verdict and NEVER claims "reward sent" unless the GEN actually
// landed. Both hashes render as full explorer links (shortened for layout only)
// with the full hash in the href and title, plus a Copy button.
import { useState } from "react";
import { explorerTxUrl, type PayoutStatus } from "../lib/genlayer";

function shortHash(hash: string): string {
  return hash.length >= 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

interface HashLinkProps {
  hash: string;
  label?: string;
  testId: string;
}

/** Full explorer link with a shortened label, title, and a Copy button. */
export function HashLink({ hash, label, testId }: HashLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = explorerTxUrl(hash);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the href/title still carry the full hash */
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      {label ? <span className="text-slate-500">{label}</span> : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={hash}
        data-testid={testId}
        className="break-all text-secondary underline"
      >
        {shortHash(hash)}
      </a>
      <button
        type="button"
        onClick={copy}
        data-testid={`${testId}-copy`}
        aria-label="Copy full transaction hash"
        className="rounded border border-white/10 px-1 text-[10px] text-slate-400 transition-colors hover:text-white"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

/** Human-readable payout state, kept separate from the settlement verdict. */
export function payoutStatusText(status?: PayoutStatus, creditGen?: number): string {
  switch (status) {
    case "sent":
      return creditGen != null && creditGen > 0
        ? `Payout: ${creditGen.toFixed(4)} GEN received in your wallet`
        : "Payout: sent to wallet (native GEN received)";
    case "failed":
      return "Payout: failed (transfer tx did not settle)";
    case "pending":
      return "Payout: pending (transfer tx not finalized yet)";
    case "credit":
      return creditGen != null && creditGen > 0
        ? `Payout: ${creditGen.toFixed(4)} GEN recorded on-chain (native transfer awaiting confirmation)`
        : "Payout: recorded on-chain, awaiting native transfer";
    case "none":
    default:
      return "Payout: none";
  }
}
