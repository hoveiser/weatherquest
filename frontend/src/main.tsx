import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// The shipped experience is the WeatherGate 2D game. It manages its own state,
// so it mounts directly - no router and no legacy quest-app context provider are
// needed (the old dashboard modules under src/pages & src/components remain in
// the repo but are not wired into the game build).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
