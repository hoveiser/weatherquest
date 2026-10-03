import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { Toast } from "../types";
import clsx from "clsx";

const CONFIG: Record<Toast["kind"], { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "border-white/10 text-ink" },
  success: { icon: CheckCircle2, className: "border-success/30 text-success" },
  error: { icon: AlertTriangle, className: "border-danger/30 text-danger" },
};

export default function Toasts() {
  const { state, dismissToast } = useApp();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence>
        {state.toasts.map((t) => {
          const { icon: Icon, className } = CONFIG[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={clsx(
                "glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border px-4 py-3 shadow-card",
                className,
              )}
              role="status"
              aria-live="polite"
            >
              <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p className="flex-1 text-sm text-ink">{t.message}</p>
              <button
                onClick={() => dismissToast(t.id)}
                className="rounded p-0.5 text-muted hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X size={16} aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
