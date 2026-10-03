import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { ActionResult, Quest, Toast } from "../types";
import * as contract from "../lib/contract";
import { shortAddr } from "../lib/format";

interface State {
  address: string | null;
  connecting: boolean;
  quests: Quest[];
  toasts: Toast[];
  booting: boolean;
}

type Action =
  | { type: "boot"; quests: Quest[] }
  | { type: "connect:start" }
  | { type: "connect:done"; address: string }
  | { type: "disconnect" }
  | { type: "quest:add"; quest: Quest }
  | { type: "quest:update"; quest: Quest }
  | { type: "toast:push"; toast: Toast }
  | { type: "toast:dismiss"; id: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "boot":
      return { ...state, quests: action.quests, booting: false };
    case "connect:start":
      return { ...state, connecting: true };
    case "connect:done":
      return { ...state, connecting: false, address: action.address };
    case "disconnect":
      return { ...state, address: null };
    case "quest:add":
      return { ...state, quests: [action.quest, ...state.quests] };
    case "quest:update":
      return {
        ...state,
        quests: state.quests.map((q) => (q.questId === action.quest.questId ? action.quest : q)),
      };
    case "toast:push":
      return { ...state, toasts: [...state.toasts, action.toast] };
    case "toast:dismiss":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

const initialState: State = {
  address: null,
  connecting: false,
  quests: [],
  toasts: [],
  booting: true,
};

interface AppValue {
  state: State;
  shortAddress: string;
  toast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
  connect: () => Promise<void>;
  createQuest: (input: contract.CreateQuestInput) => Promise<Quest | null>;
  submitAction: (quest: Quest, action: string) => Promise<ActionResult | null>;
}

const AppContext = createContext<AppValue | null>(null);

/** Demo seed quests so reviewers see a populated dashboard immediately. */
const SEED: Array<Omit<Quest, "createdAt" | "expiresAt">> = [
  {
    questId: "Q-REYKJ",
    city: "Reykjavik",
    creator: contract.DEMO_ADDR,
    baseRewardGen: 25,
    description: "Reach the Hallgrimensker church steps and photograph the aurora forecast.",
    status: "Active",
    submissionCount: 3,
  },
  {
    questId: "Q-TOKYO",
    city: "Tokyo",
    creator: contract.DEMO_ADDR,
    baseRewardGen: 50,
    description: "Deliver a package across Shibuya crossing during peak downpour.",
    status: "Active",
    submissionCount: 7,
  },
  {
    questId: "Q-DUBAI",
    city: "Dubai",
    creator: contract.DEMO_ADDR,
    baseRewardGen: 15,
    description: "Complete a desert ridge run before the heat index spikes.",
    status: "Active",
    submissionCount: 1,
  },
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const toastId = useRef(0);

  // Seed demo quests on first load.
  useEffect(() => {
    const now = Date.now();
    const quests: Quest[] = SEED.map((s, i) => ({
      ...s,
      createdAt: now - (i + 1) * 3600_000,
      expiresAt: now + (12 + i * 6) * 3600_000,
    }));
    const t = setTimeout(() => dispatch({ type: "boot", quests }), 350);
    return () => clearTimeout(t);
  }, []);

  const toast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId.current;
    dispatch({ type: "toast:push", toast: { id, kind, message } });
    setTimeout(() => dispatch({ type: "toast:dismiss", id }), 4800);
  }, []);

  const dismissToast = useCallback((id: number) => dispatch({ type: "toast:dismiss", id }), []);

  const connect = useCallback(async () => {
    dispatch({ type: "connect:start" });
    try {
      const address = await contract.connectWallet();
      dispatch({ type: "connect:done", address });
      toast(`Connected ${shortAddr(address)}`, "success");
    } catch {
      toast("Could not connect wallet.", "error");
    }
  }, [toast]);

  const createQuest = useCallback<AppValue["createQuest"]>(
    async (input) => {
      if (!state.address) {
        toast("Please connect your wallet first.", "error");
        return null;
      }
      try {
        const quest = await contract.createQuest(input, state.address);
        dispatch({ type: "quest:add", quest });
        toast(`Quest ${quest.questId} created in ${quest.city}`, "success");
        return quest;
      } catch (e: any) {
        toast(e?.message || "Failed to create quest.", "error");
        return null;
      }
    },
    [state.address, toast],
  );

  const submitAction = useCallback<AppValue["submitAction"]>(
    async (quest, action) => {
      try {
        const result = await contract.submitAction(quest, action);
        const updated: Quest = {
          ...quest,
          status: result.success ? "Completed" : "Failed",
          submissionCount: quest.submissionCount + 1,
          risk: result.risk,
        };
        dispatch({ type: "quest:update", quest: updated });
        return result;
      } catch (e: any) {
        toast(e?.message || "Submission failed.", "error");
        return null;
      }
    },
    [toast],
  );

  const value = useMemo<AppValue>(
    () => ({
      state,
      shortAddress: state.address ? shortAddr(state.address) : "",
      toast,
      dismissToast,
      connect,
      createQuest,
      submitAction,
    }),
    [state, toast, dismissToast, connect, createQuest, submitAction],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
