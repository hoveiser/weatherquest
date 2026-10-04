import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base + HashRouter (see main.tsx) makes the built bundle work at any
  // mount point — including a GitHub Pages project site (/repo/) — with no config.
  base: "./",
  build: {
    // kaboom 3000.1.17 emits its enums with the ES2021 logical-assignment operator
    // (`Qs ||= {}`). Vite's default `target: "modules"` makes esbuild *lower* `||=`,
    // and that lowering + minify drops the `let Qs` declaration, producing a
    // `ReferenceError: aD is not defined` at runtime. Targeting ES2022 keeps `||=`
    // native so the enum binding survives. All browsers that can run a WebGL game
    // support `||=` (Chrome 85 / Firefox 79 / Safari 14, all shipped in 2020).
    target: "es2022",
  },
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
