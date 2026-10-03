import { NavLink } from "react-router-dom";
import { LayoutDashboard, PlusCircle, ScrollText } from "lucide-react";
import clsx from "clsx";

const NAV = [
  { to: "/dashboard", label: "Explore", icon: LayoutDashboard },
  { to: "/create", label: "Create", icon: PlusCircle },
  { to: "/quests", label: "Mine", icon: ScrollText },
];

/** Fixed bottom navigation shown only on small screens. */
export default function MobileNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-bg/85 backdrop-blur-xl md:hidden"
      aria-label="Mobile"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors",
                isActive ? "text-primary" : "text-muted",
              )
            }
          >
            <Icon size={20} aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
