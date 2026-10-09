// LEGACY MARKETPLACE SCREEN (class: not-payable). This component is not part of the
// shipped game build (main.tsx mounts App.tsx only, verified against the built
// bundle), and its result can only come from lib/contract.submitAction, which runs
// a local heuristic and throws in on-chain mode. Nothing shown here was ever settled
// by validators, so the amount is labelled as a simulation, never as a payout.
import { motion } from "framer-motion";
import { Trophy, Skull, Coins, ExternalLink, Sparkles } from "lucide-react";
import type { ActionResult } from "../types";
import { formatGen } from "../lib/format";
import RiskMeter from "./RiskMeter";
import Button from "./Button";
import clsx from "clsx";

interface Props {
  result: ActionResult;
  onClose: () => void;
}

export default function ResultScreen({ result, onClose }: Props) {
  const { success, payoutGen, risk, reasoning, txHash } = result;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col items-center text-center">
        <div
          className={clsx(
            "grid h-16 w-16 place-items-center rounded-full",
            success ? "bg-success/15 text-success shadow-glow-green" : "bg-danger/15 text-danger shadow-glow-red",
          )}
        >
          {success ? <Trophy size={32} aria-hidden /> : <Skull size={32} aria-hidden />}
        </div>
        <h3 className="mt-3 text-2xl font-extrabold text-ink">
          {success ? "Quest Complete" : "Quest Failed"}
        </h3>
        <p className="text-sm text-muted">
          {success ? "The AI validated your action against live weather." : "The AI judged your action unsafe."}
        </p>
      </div>

      <div className="card space-y-3 bg-surface-2/40 p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-muted">
            <Sparkles size={15} className="text-primary" aria-hidden /> Risk at resolve
          </span>
          <span className="text-sm font-semibold text-ink">{risk.risk_tier}</span>
        </div>
        <RiskMeter multiplier={risk.multiplier} tier={risk.risk_tier} compact />
        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-2 text-sm text-muted">
            <Coins size={15} className="text-warning" aria-hidden /> Simulated reward
          </span>
          <span
            className={clsx("text-lg font-extrabold", success ? "text-success" : "text-muted")}
            data-testid="demo-payout"
            title="Local demo heuristic only. No validator settled this and no GEN was transferred."
          >
            {formatGen(payoutGen)}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-muted">
          Demo heuristic, not an on-chain payout. The campaign levels are what settle on
          StudioNet.
        </p>
      </div>

      <div className="rounded-card border border-white/10 bg-white/5 p-4">
        <p className="text-xs uppercase tracking-wider text-muted">AI Reasoning</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{reasoning}</p>
      </div>

      {txHash && (
        <a
          href={`https://studio.genlayer.com/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-muted hover:text-primary"
        >
          View transaction <ExternalLink size={13} aria-hidden />
        </a>
      )}

      <Button variant="ghost" onClick={onClose} className="w-full">
        Close
      </Button>
    </motion.div>
  );
}
