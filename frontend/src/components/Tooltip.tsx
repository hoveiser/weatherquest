import { useState, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

/** Accessible hover/focus tooltip (keyboard reachable via focus). */
export default function Tooltip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span tabIndex={0} className="cursor-help outline-none rounded focus-visible:ring-2 focus-visible:ring-primary">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-card bg-surface-2 px-3 py-2 text-xs text-ink shadow-card border border-white/10"
        >
          {label}
        </span>
      )}
    </span>
  );
}
