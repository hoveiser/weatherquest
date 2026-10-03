import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base + HashRouter (see main.tsx) makes the built bundle work at any
  // mount point — including a GitHub Pages project site (/repo/) — with no config.
  base: "./",
  server: {
    port: 5173,
    // Proxy keeps weather calls same-origin in dev (avoids CORS surprises).
    proxy: {
      "/api/open-meteo": {
        target: "https://api.open-meteo.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/open-meteo/, ""),
      },
      "/api/geocoding": {
        target: "https://geocoding-api.open-meteo.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/geocoding/, ""),
      },
    },
  },
});
