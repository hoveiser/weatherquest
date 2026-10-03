import { NavLink } from "react-router-dom";
import { Wallet, Swords, LayoutDashboard, ScrollText, PlusCircle } from "lucide-react";
import { useApp } from "../context/AppContext";
import clsx from "clsx";

const LOGO = `${import.meta.env.BASE_URL}logo-128.png`;

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/create", label: "Create", icon: PlusCircle },
  { to: "/quests", label: "My Quests", icon: ScrollText },
];

export default function Header() {
  const { state, shortAddress, connect } = useApp();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <NavLink to="/" className="flex items-center gap-2.5" aria-label="WeatherQuest home">
          <img src={LOGO} alt="" width={34} height={34} className="rounded-[8px] shadow-glow" />
          <span className="hidden items-center gap-2 sm:flex">
            <Swords size={16} className="text-primary" aria-hidden />
            <span className="font-extrabold tracking-tight neon-text text-lg">WeatherQuest</span>
          </span>
        </NavLink>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-pill px-3.5 py-2 text-sm font-semibold transition-colors",
                  isActive ? "bg-white/10 text-ink" : "text-muted hover:text-ink hover:bg-white/5",
                )
              }
            >
              <Icon size={16} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={connect}
          disabled={state.connecting}
          className={clsx(
            "btn shrink-0",
            state.address
              ? "btn-ghost !py-2 text-sm"
              : "btn-primary",
          )}
          aria-label={state.address ? `Connected as ${shortAddress}` : "Connect wallet"}
        >
          <Wallet size={16} aria-hidden />
          <span className="hidden sm:inline">
            {state.connecting ? "Connecting…" : state.address ? shortAddress : "Connect Wallet"}
          </span>
        </button>
      </div>
    </header>
  );
}
