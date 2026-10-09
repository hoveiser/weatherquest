import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CloudRain, BrainCircuit, Coins, Swords, ArrowRight, Snowflake, Sun, Zap } from "lucide-react";
import { useApp } from "../context/AppContext";
import { USE_ONCHAIN } from "../lib/contract";
import Button from "../components/Button";
import WeatherParticles from "../components/WeatherParticles";
import type { WeatherKind } from "../types";

const CYCLE: WeatherKind[] = ["clear", "rain", "storm", "snow"];

export default function Landing() {
  const { connect, state } = useApp();
  const [kind, setKind] = useState<WeatherKind>("storm");

  useEffect(() => {
    const id = setInterval(() => setKind((k) => CYCLE[(CYCLE.indexOf(k) + 1) % CYCLE.length]), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <WeatherParticles kind={kind} count={40} />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-secondary/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 top-40 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="chip mx-auto bg-white/5 text-muted"
          >
            <Swords size={13} className="text-primary" aria-hidden />
            {USE_ONCHAIN ? "Live on GenLayer" : "Interactive demo · GenLayer contract backend"}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-6xl"
          >
            Real weather decides <br className="hidden sm:block" />
            <span className="neon-text">your quest's fate</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg"
          >
            WeatherQuest pays GEN for surviving live weather: real forecasts set a{" "}
            <strong className="text-ink">risk multiplier</strong> and GenLayer validators judge whether your
            action is safe. Braver moves in brutal conditions pay bigger.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button onClick={() => (window.location.hash = "#/dashboard")}>
              Explore Quests <ArrowRight size={16} aria-hidden />
            </Button>
            <Button variant="ghost" onClick={connect} disabled={state.connecting}>
              {state.address ? "Connected" : "Connect Wallet"}
            </Button>
          </motion.div>

          {/* live condition ticker */}
          <div className="mt-10 inline-flex items-center gap-2 rounded-pill border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted">
            {kind === "storm" && <Zap size={16} className="text-danger" />}
            {kind === "rain" && <CloudRain size={16} className="text-primary" />}
            {kind === "snow" && <Snowflake size={16} className="text-secondary" />}
            {kind === "clear" && <Sun size={16} className="text-warning" />}
            Simulating <span className="font-semibold capitalize text-ink">{kind}</span> conditions -
            higher risk, higher reward
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <h2 className="text-center text-2xl font-extrabold text-ink sm:text-3xl">How a quest resolves</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted">
          Every step is validated by GenLayer consensus validators reading the same live data.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Swords, title: "1 \u00b7 Post a bounty", body: "Fund a quest with GEN (escrow is disabled on this deployment) or play the on-chain campaign." },
            { icon: CloudRain, title: "2 \u00b7 Weather sets risk", body: "The contract reads Open-Meteo and the AI derives a 1.0x to 5.0x multiplier." },
            { icon: BrainCircuit, title: "3 \u00b7 AI judges you", body: "Submit an action. The AI weighs it against the current risk tier." },
            { icon: Coins, title: "4 \u00b7 Payout scales", body: "Survive the elements and earn base reward \u00d7 multiplier. A rejected action pays nothing and costs nothing." },
          ].map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="card p-5"
            >
              <div className="grid h-11 w-11 place-items-center rounded-card bg-gradient-to-br from-primary/20 to-secondary/20 text-primary">
                <Icon size={22} aria-hidden />
              </div>
              <h3 className="mt-4 font-bold text-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </motion.div>
          ))}
        </div>

        <div className="card mt-10 flex flex-col items-center justify-between gap-4 p-6 text-center sm:flex-row sm:text-left">
          <div>
            <h3 className="text-lg font-bold text-ink">Ready to test the storm?</h3>
            <p className="text-sm text-muted">Jump into the demo quest board - no wallet needed.</p>
          </div>
          <Button onClick={() => (window.location.hash = "#/dashboard")}>
            Launch Quest Board <ArrowRight size={16} aria-hidden />
          </Button>
        </div>
      </section>
    </div>
  );
}
