import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import MobileNav from "./components/MobileNav";
import Toasts from "./components/Toasts";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import CreateQuest from "./pages/CreateQuest";
import MyQuests from "./pages/MyQuests";

export default function App() {
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-pill focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1 pb-20 md:pb-0">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/create" element={<CreateQuest />} />
          <Route path="/quests" element={<MyQuests />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-muted">
        WeatherQuest · AI-Verified Gaming Bounties on GenLayer. Weather data by Open-Meteo.
      </footer>
      <MobileNav />
      <Toasts />
    </div>
  );
}
