import { useMemo, useState } from "react";
import { Wallet, ScrollText } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { Quest, QuestStatus } from "../types";
import QuestCard from "../components/QuestCard";
import EmptyState from "../components/EmptyState";
import QuestDetailModal from "../components/QuestDetailModal";
import Button from "../components/Button";
import clsx from "clsx";

type Tab = "All" | QuestStatus;
const TABS: Tab[] = ["All", "Active", "Completed", "Failed", "Expired"];

export default function MyQuests() {
  const { state, connect } = useApp();
  const [tab, setTab] = useState<Tab>("All");
  const [selected, setSelected] = useState<Quest | null>(null);

  const mine = useMemo(() => {
    if (!state.address) return [];
    return state.quests.filter((q) => q.creator === state.address);
  }, [state.quests, state.address]);

  const filtered = useMemo(
    () => (tab === "All" ? mine : mine.filter((q) => q.status === tab)),
    [mine, tab],
  );

  if (!state.address) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={Wallet}
          title="Connect your wallet"
          description="Sign in to see the bounties you've posted and their live outcomes."
          action={<Button onClick={connect}>Connect Wallet</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">My Quests</h1>
      <p className="mt-1 text-sm text-muted">Bounties you've created and their settlement status.</p>

      <div className="mt-6 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Filter by status">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              "chip whitespace-nowrap transition-colors",
              tab === t ? "bg-primary/20 text-primary" : "bg-white/5 text-muted hover:text-ink",
            )}
          >
            {t}
            {t !== "All" && (
              <span className="ml-1 text-xs opacity-70">
                {mine.filter((q) => q.status === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((q) => (
            <QuestCard key={q.questId} quest={q} onOpen={setSelected} />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={ScrollText}
            title={mine.length ? "Nothing here yet" : "You haven't created any quests"}
            description={
              mine.length
                ? "Switch tabs to see your other bounties."
                : "Post your first weather-risk bounty to get started."
            }
            action={
              <Button onClick={() => (window.location.hash = "#/create")}>New Quest</Button>
            }
          />
        </div>
      )}

      <QuestDetailModal quest={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
