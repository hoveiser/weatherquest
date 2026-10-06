// ============================================================================
// DemoModeNotice - a one-time modal that explains Demo Mode vs On-chain play.
//
// Shows automatically on first load while the app is in Demo Mode (no wallet
// connected), so users are never confused about why they can play without
// connecting. Dismissal is remembered in localStorage so it only interrupts
// once. It re-appears if the user resets storage or clears site data.
// ============================================================================
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const DISMISS_KEY = 'wq:demo:notice:v1';

interface Props {
  /** Current wallet mode - the notice only matters in "demo". */
  mode: 'demo' | 'onchain';
}

export default function DemoModeNotice({ mode }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'demo') return;
    try {
      if (!localStorage.getItem(DISMISS_KEY)) setOpen(true);
    } catch {
      // localStorage unavailable (private mode) - still show it, just don't persist.
      setOpen(true);
    }
  }, [mode]);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 16, opacity: 0 }}
            transition={{ type: 'spring', damping: 18, stiffness: 240 }}
            className="w-full max-w-md rounded-modal border border-white/10 bg-bg/95 p-6 shadow-glow-purple"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-notice-title"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex animate-pulse items-center rounded-pill bg-gradient-to-r from-warning to-primary px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-black">
                🎮 Demo Mode
              </span>
              <h2 id="demo-notice-title" className="text-lg font-black text-ink">
                You can play right now
              </h2>
            </div>

            <p className="text-sm leading-relaxed text-muted">
              Progress is being <span className="text-ink font-semibold">saved locally</span> in your
              browser - no wallet, no gas, no login needed. Great for trying the game and the AI
              weather gate.
            </p>

            <ul className="mt-3 space-y-1.5 text-sm text-ink">
              <li className="flex gap-2">
                <span>🖥️</span>
                <span>
                  <b>Demo Mode:</b> rewards &amp; levels are simulated on your device.
                </span>
              </li>
              <li className="flex gap-2">
                <span>⛓</span>
                <span>
                  <b>On-chain:</b> connect a GenLayer wallet to settle every reward against the
                  real smart contract with AI consensus.
                </span>
              </li>
            </ul>

            <p className="mt-3 text-xs text-muted">
              Tip: the pulsing <span className="text-ink">Demo Mode</span> badge in the corner always
              tells you which mode you&apos;re in - click Connect to switch to on-chain play.
            </p>

            <div className="mt-5 flex justify-end">
              <button
                onClick={dismiss}
                className="rounded-pill bg-gradient-to-r from-primary to-secondary px-5 py-2 text-sm font-bold text-white hover:opacity-90"
              >
                Got it - let me play
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
