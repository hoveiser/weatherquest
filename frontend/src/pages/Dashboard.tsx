import { useMemo, useState } from "react";
import { Search, PlusCircle, Swords } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { Quest, RiskTier } from "../types";
import QuestCard from "../components/QuestCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import QuestDetailModal from "../components/QuestDetailModal";
import Button from "../components/Button";
import clsx from "clsx";

type TierFilter = "All" | RiskTier;
const TIERS: TierFilter[] = ["All", "Low", "Medium", "High", "Extreme"];

export default function Dashboard() {
  const { state } = useApp();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<TierFilter>("All");
  const [selected, setSelected] = useState<Quest | null>(null);

  const quests = useMemo(() => {
    const active = state.quests.filter((q) => q.status === "Active" && q.expiresAt > Date.now());
    return active.filter((q) => {
      const matchQuery =
        !query ||
        q.city.toLowerCase().includes(query.toLowerCase()) ||
        q.description.toLowerCase().includes(query.toLowerCase());
      const matchTier = tier === "All" || q.risk?.risk_tier === tier;
      return matchQuery && matchTier;
    });
  }, [state.quests, query, tier]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Quest Board</h1>
          <p className="mt-1 text-sm text-muted">
            Active bounties. Real weather drives the risk multiplier and the AI validates your moves.
          </p>
        </div>
        <Button onClick={() => (window.location.hash = "#/create")}>
          <PlusCircle size={16} aria-hidden /> New Quest
        </Button>
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by city or objective…"
            className="field pl-10"
            aria-label="Search quests"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter by risk tier">
          {TIERS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tier === t}
              onClick={() => setTier(t)}
              className={clsx(
                "chip whitespace-nowrap transition-colors",
                tier === t ? "bg-primary/20 text-primary" : "bg-white/5 text-muted hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {state.booting ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : quests.length ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quests.map((q) => (
            <QuestCard key={q.questId} quest={q} onOpen={setSelected} />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={Swords}
            title="No quests match"
            description="Try a different search or risk filter, or be the first to post a bounty."
            action={
              <Button variant="ghost" onClick={() => (window.location.hash = "#/create")}>
                <PlusCircle size={16} aria-hidden /> Create a quest
              </Button>
            }
          />
        </div>
      )}

      <QuestDetailModal quest={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
