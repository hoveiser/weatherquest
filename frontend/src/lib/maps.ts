/**
 * Dynamic campaign maps + level configuration for WeatherGate.
 *
 * `generateMap(level)` produces a deterministic, progressively harder tile
 * layout for the Kaboom world. The grid geometry MUST match Game.tsx
 * (COLS x ROWS, TILE = 32). Legend is identical to the game layer:
 *   "." grass   "#" wall/tree   "~" river   "G" magic gate   "V" victory zone
 *
 * Reachability invariant (never violated, so the gate is always solvable):
 *   - the vertical spawn lane at columns 1-2 stays clear,
 *   - the horizontal approach corridor on the gate rows (6-8) stays clear up to
 *     the gate, so the player can always walk from spawn to the gate,
 *   - the gate column + victory zone layout is constant (the collision/trigger
 *     math in Game.tsx is tuned for this gate band and stays valid for every level).
 * Higher levels only densify obstacles *outside* those protected cells.
 */

export const GRID_COLS = 22;
export const GRID_ROWS = 14;

export const MAX_LEVEL = 10;
export const GATE_COL = 16;
export const GATE_GAP_TOP = 6; // gate occupies rows 6,7,8

// Mirrors contracts/weatherquest.py LEVEL_BASE_GEN (base GEN per level).
export const LEVEL_BASE_GEN: readonly number[] = [0, 10, 12, 15, 20, 25, 30, 35, 50, 75, 100];

// Progressively harder global cities for levels 2+ (Level 1 = the player's IP city).
export const CAMPAIGN_CITIES: Readonly<Record<number, string>> = {
  2: "Tokyo",
  3: "Sydney",
  4: "Reykjavik",
  5: "Singapore",
  6: "Cairo",
  7: "Rio de Janeiro",
  8: "Port of Spain",
  9: "Moscow",
  10: "Tromsø",
};

export type DifficultyBand = "Easy" | "Medium" | "Hard";

export function difficultyBand(level: number): DifficultyBand {
  if (level <= 3) return "Easy";
  if (level <= 7) return "Medium";
  return "Hard";
}

export function baseRewardGen(level: number): number {
  return LEVEL_BASE_GEN[level] ?? 0;
}

export function cityForLevel(level: number, homeCity: string): string {
  if (level <= 1) return homeCity;
  return CAMPAIGN_CITIES[level] ?? homeCity;
}

/** A tiny deterministic PRNG so a given level always renders the same map. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the tile map for a campaign level (1..MAX_LEVEL).
 * Level 1 is the canonical simple onboarding field; levels 2+ add walls and
 * river hazards using a level-seeded PRNG, always preserving the gate corridor.
 */
export function generateMap(level = 1): string[] {
  const R = GRID_ROWS;
  const C = GRID_COLS;
  const g: string[][] = Array.from({ length: R }, () => Array<string>(C).fill("."));

  // Border of solid wall.
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (r === 0 || c === 0 || r === R - 1 || c === C - 1) g[r][c] = "#";
    }
  }

  // Constant gate column + victory zone (kept identical across levels so the
  // gate trigger/collision tuning in Game.tsx always holds and stays reachable).
  for (let r = 1; r <= 12; r++) g[r][GATE_COL] = r >= GATE_GAP_TOP && r <= GATE_GAP_TOP + 2 ? "G" : "#";
  for (let r = GATE_GAP_TOP; r <= GATE_GAP_TOP + 2; r++) {
    for (let c = GATE_COL + 1; c <= GATE_COL + 4 && c < C - 1; c++) g[r][c] = "V";
  }

  // Cells the path-finding invariants require to stay walkable.
  const isProtected = (r: number, c: number): boolean => {
    if (r === 0 || c === 0 || r === R - 1 || c === C - 1) return true; // border handled above
    if (c >= GATE_COL) return true; // gate column + victory handled above
    if (c <= 2) return true; // vertical spawn lane
    if (r >= GATE_GAP_TOP && r <= GATE_GAP_TOP + 2) return true; // horizontal approach corridor to the gate
    if (r === 10 && c <= 8) return true; // breathing room around the spawn tile
    return false;
  };

  // Level 1: simple onboarding field (the original single lake).
  if (level <= 1) {
    for (let r = 3; r <= 5; r++) for (let c = 6; c <= 13; c++) g[r][c] = "~";
    return g.map((row) => row.join(""));
  }

  // Levels 2+: deterministic, difficulty-scaled obstacle scatter.
  const band = difficultyBand(level);
  const density = band === "Easy" ? 0.05 : band === "Medium" ? 0.11 : 0.19;
  const riverBlobs = band === "Easy" ? 1 : band === "Medium" ? 2 : 3;
  const rng = mulberry32(0x9e3779b9 ^ Math.imul(level, 0x85ebca6b));

  for (let r = 1; r < R - 1; r++) {
    for (let c = 3; c < GATE_COL; c++) {
      if (isProtected(r, c)) continue;
      if (rng() < density) g[r][c] = "#";
    }
  }

  for (let i = 0; i < riverBlobs; i++) {
    const rr = 1 + Math.floor(rng() * (R - 4));
    const rc = 4 + Math.floor(rng() * 10);
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        const r = rr + dr;
        const c = rc + dc;
        if (r <= 0 || r >= R - 1 || c <= 0 || c >= GATE_COL) continue;
        if (isProtected(r, c)) continue;
        if (g[r][c] === ".") g[r][c] = "~";
      }
    }
  }

  return g.map((row) => row.join(""));
}

/** Storm overlay metadata the host can use to theme the world at high levels. */
export function levelTheme(level: number): { band: DifficultyBand; storm: boolean; tint: [number, number, number] } {
  const band = difficultyBand(level);
  if (band === "Hard") return { band, storm: true, tint: [26, 20, 48] };
  if (band === "Medium") return { band, storm: false, tint: [16, 24, 44] };
  return { band, storm: false, tint: [10, 14, 39] };
}
