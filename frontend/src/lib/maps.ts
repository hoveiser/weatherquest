/**
 * Dynamic campaign maps + level configuration for WeatherGate.
 *
 * `generateMap(level)` produces a deterministic, progressively harder maze for
 * the Kaboom world and guarantees it is SOLVABLE and NON-TRIVIAL: a recursive-
 * backtracker maze is braided open more for easy levels and less for hard ones,
 * then a BFS check requires the shortest spawn→gate path to be at least
 * `level * 5` steps - otherwise the map is regenerated (up to a bounded number
 * of attempts, keeping the longest-path candidate). No straight-line wins.
 *
 * The grid geometry MUST match Game.tsx (COLS x ROWS, TILE = 32). Legend:
 *   "." floor  "#" wall  "~" water  "G" magic gate  "V" victory zone
 *
 * Reachability is guaranteed by construction (a perfect maze connects every
 * room, and the gate column sits on connected right-edge rooms), so the gate is
 * always solvable while the direct path is always blocked.
 */

export const GRID_COLS = 22;
export const GRID_ROWS = 14;

export const MAX_LEVEL = 10;
export const GATE_COL = 16;

// The player always spawns here (aligned with Game.tsx). It is a maze room.
export const SPAWN_CELL = { c: 1, r: 11 } as const;

// Minimum shortest-path length the complexity rule enforces, per level.
export function minPathSteps(level: number): number {
  return level * 5;
}

// Base obstacle density requested for each level (tutorial → labyrinth).
const DENSITY_BY_LEVEL: Readonly<Record<number, number>> = {
  1: 0.05,
  2: 0.15,
  3: 0.25,
  4: 0.35,
  5: 0.35,
  6: 0.35,
  7: 0.45,
  8: 0.5,
  9: 0.5,
  10: 0.55,
};

export function densityForLevel(level: number): number {
  return DENSITY_BY_LEVEL[level] ?? 0.35;
}

// Mirrors contracts/weatherquest.py LEVEL_BASE_GEN (base GEN per level).
// The table is in whole GEN for readability; CAMPAIGN_REWARD_SCALE below shrinks
// every campaign prize to 1/100 so the small testnet house lasts ~100x longer.
// The contract does the identical divide in _level_base_atto (integer atto math).
export const LEVEL_BASE_GEN: readonly number[] = [0, 10, 12, 15, 20, 25, 30, 35, 50, 75, 100];

// Mirrors contracts/weatherquest.py CAMPAIGN_REWARD_SCALE.
export const CAMPAIGN_REWARD_SCALE = 100;

// Fixed campaign city per level (mirrors CAMPAIGN_CITY_TABLE in the contract). The
// caller cannot pick a stormier city: complete_level requires this exact city for
// its level. Level 1 is Istanbul (no longer the player's IP-detected city).
export const CAMPAIGN_CITIES: Readonly<Record<number, string>> = {
  1: "Istanbul",
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
  // Scaled to match the on-chain payout: LEVEL_BASE_GEN / CAMPAIGN_REWARD_SCALE.
  return (LEVEL_BASE_GEN[level] ?? 0) / CAMPAIGN_REWARD_SCALE;
}

/**
 * Exact GEN payout preview using the SAME integer atto math as the contract:
 *   payout_atto = base_atto * multiplier_x100 / 100
 * where base_atto = LEVEL_BASE_GEN[level] * 1e18 / CAMPAIGN_REWARD_SCALE. There is
 * NO efficiency/step term (the contract reward is base * weather only). BigInt
 * division truncates toward zero exactly like Python's `//`, so the previewed GEN
 * equals the on-chain credit for the same weather tier (no float drift).
 */
export function payoutGenExact(level: number, multiplierX100: number): number {
  const baseAtto = BigInt(LEVEL_BASE_GEN[level] ?? 0) * 10n ** 18n / BigInt(CAMPAIGN_REWARD_SCALE);
  const payoutAtto = (baseAtto * BigInt(Math.round(multiplierX100))) / 100n;
  return Number(payoutAtto) / 1e18;
}

export function cityForLevel(level: number, homeCity: string): string {
  // Every level 1-10 is bound to a fixed campaign city (the contract enforces it);
  // homeCity is only a fallback if a level is somehow not in the table.
  return CAMPAIGN_CITIES[level] ?? homeCity;
}

/** Tiny deterministic PRNG so a given (level, attempt) always renders the same map. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALKABLE = new Set([".", "G", "V"]);

/**
 * BFS shortest path (4-neighbor, orthogonal moves = "steps") from the spawn cell
 * to the nearest Magic Gate tile. Returns the number of steps, or null if the
 * gate is unreachable. Used only by the map complexity rule and the cosmetic step
 * display; it is NOT part of the payout (the contract reward ignores step counts).
 */
export function shortestPathToGate(map: string[]): number | null {
  const R = map.length;
  const C = map[0]?.length ?? 0;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= R || c >= C ? "#" : map[r][c]);
  if (!WALKABLE.has(at(SPAWN_CELL.r, SPAWN_CELL.c))) return null;

  const key = (r: number, c: number) => r * C + c;
  const seen = new Set<number>([key(SPAWN_CELL.r, SPAWN_CELL.c)]);
  let frontier: Array<[number, number]> = [[SPAWN_CELL.r, SPAWN_CELL.c]];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let steps = 0;
  while (frontier.length) {
    steps++;
    const next: Array<[number, number]> = [];
    for (const [r, c] of frontier) {
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
        const k = key(nr, nc);
        if (seen.has(k)) continue;
        const ch = at(nr, nc);
        if (!WALKABLE.has(ch)) continue;
        if (ch === "G") return steps; // reached the gate
        seen.add(k);
        next.push([nr, nc]);
      }
    }
    frontier = next;
  }
  return null;
}

/** Complexity report for a map (used by validateMapComplexity + the reward). */
export interface MapComplexity {
  reachable: boolean;
  steps: number;
  required: number;
  ok: boolean;
}

export function validateMapComplexity(map: string[], level: number): MapComplexity {
  const s = shortestPathToGate(map);
  const required = minPathSteps(level);
  return { reachable: s != null, steps: s ?? 0, required, ok: s != null && s >= required };
}

/** Carve a braided recursive-backtracker maze for a given level + seed. */
function buildMaze(level: number, seed: number): string[] {
  const R = GRID_ROWS;
  const C = GRID_COLS;
  const g: string[][] = Array.from({ length: R }, () => Array<string>(C).fill("#"));
  const rng = mulberry32(seed);

  // Rooms live on odd grid coordinates within the playable band (left of gate).
  const roomRows: number[] = [];
  for (let r = 1; r <= R - 3; r += 2) roomRows.push(r); // 1,3,5,7,9,11
  const roomCols: number[] = [];
  for (let c = 1; c <= GATE_COL - 1; c += 2) roomCols.push(c); // 1..15

  const roomKey = new Set<string>();
  for (const r of roomRows) for (const c of roomCols) roomKey.add(`${r},${c}`);

  const isRoom = (r: number, c: number) => roomKey.has(`${r},${c}`);

  type Dir = readonly [number, number, number, number]; // [nr, nc, wallR, wallC]

  // Iterative DFS from the spawn room.
  const startR = SPAWN_CELL.r; // 11 (odd room row)
  const startC = SPAWN_CELL.c; // 1  (odd room col)
  g[startR][startC] = ".";
  const stack: Array<[number, number]> = [[startR, startC]];
  const visited = new Set<string>([`${startR},${startC}`]);
  const step = 2;
  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  while (stack.length) {
    const [cr, cc] = stack[stack.length - 1];
    const neighbors: Dir[] = shuffle<Dir>([
      [cr - step, cc, cr - 1, cc],
      [cr + step, cc, cr + 1, cc],
      [cr, cc - step, cr, cc - 1],
      [cr, cc + step, cr, cc + 1],
    ]);
    let advanced = false;
    for (const [nr, nc, wr, wc] of neighbors) {
      if (!isRoom(nr, nc) || visited.has(`${nr},${nc}`)) continue;
      g[wr][wc] = "."; // knock the wall between rooms
      g[nr][nc] = ".";
      visited.add(`${nr},${nc}`);
      stack.push([nr, nc]);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }

  // Braid: open extra wall segments to create LOOP BACKS / shortcuts, which give
  // the maze MULTIPLE viable routes from spawn to gate instead of a single linear
  // corridor with dead-end traps. Easy levels braid heavily (many routes, short);
  // hard levels keep a floor of ~16% openings so there are always alternative
  // paths even where the main route is long. The farthest-corner gate placement
  // (below) keeps the shortest route genuinely winding despite the loops.
  const density = densityForLevel(level);
  const openProb = Math.max(0.16, 0.5 * (1 - density) - 0.1 * density);
  for (let r = 2; r <= R - 3; r++) {
    for (let c = 2; c <= GATE_COL - 2; c++) {
      if (g[r][c] !== "#") continue;
      const horiz = g[r][c - 1] === "." && g[r][c + 1] === ".";
      const vert = g[r - 1][c] === "." && g[r + 1][c] === ".";
      if ((horiz || vert) && rng() < openProb) g[r][c] = ".";
    }
  }

  // Place a SINGLE Magic Gate at the floor cell in the rightmost room column that
  // is FARHEST from spawn (by corridor distance). Because BFS reports the shortest
  // path to the *nearest* gate, one far-corner gate makes that shortest path equal
  // to the maze's longest route - the structural guarantee behind "no straight-line
  // wins". Victory pads sit just beyond it.
  const dist = Array.from({ length: R }, () => Array<number>(C).fill(-1));
  dist[startR][startC] = 0;
  const queue: Array<[number, number]> = [[startR, startC]];
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 1 || nc < 1 || nr >= R - 1 || nc >= GATE_COL) continue;
      if (g[nr][nc] !== "." || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      queue.push([nr, nc]);
    }
  }
  let gateRow = -1;
  let bestD = -1;
  for (let r = 1; r <= R - 2; r++) {
    const d = dist[r][GATE_COL - 1];
    if (g[r][GATE_COL - 1] === "." && d > bestD) {
      bestD = d;
      gateRow = r;
    }
  }
  if (gateRow < 0) gateRow = startR; // degenerate safety; a carved right room always exists
  g[gateRow][GATE_COL] = "G";
  for (let vc = GATE_COL + 1; vc <= GATE_COL + 4 && vc < C - 1; vc++) g[gateRow][vc] = "V";
  g[startR][startC] = "."; // ensure spawn is clear
  return g.map((row) => row.join(""));
}

/** Level 1 is an intentionally open tutorial field (single lake), not a maze. */
function buildTutorial(): string[] {
  const R = GRID_ROWS;
  const C = GRID_COLS;
  const g: string[][] = Array.from({ length: R }, () => Array<string>(C).fill("."));
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (r === 0 || c === 0 || r === R - 1 || c === C - 1) g[r][c] = "#";
    }
  }
  for (let r = 3; r <= 5; r++) for (let c = 6; c <= 13; c++) g[r][c] = "~";
  for (const rr of [7, 8, 9]) {
    g[rr][GATE_COL] = "G";
    for (let vc = GATE_COL + 1; vc <= GATE_COL + 4 && vc < C - 1; vc++) g[rr][vc] = "V";
  }
  g[SPAWN_CELL.r][SPAWN_CELL.c] = ".";
  return g.map((row) => row.join(""));
}

/**
 * Build the tile map for a campaign level (1..MAX_LEVEL), regenerating until the
 * BFS shortest-path complexity rule is satisfied. Deterministic for a given
 * so `generateMap(level)` and `computeOptimalSteps(level)` always agree and the
 * cosmetic step display matches the map actually rendered.
 */
export function generateMap(level = 1): string[] {
  if (level <= 1) return buildTutorial();

  const required = minPathSteps(level);
  let best: string[] | null = null;
  let bestSteps = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = (0x9e3779b9 ^ Math.imul(level, 0x85ebca6b) ^ Math.imul(attempt + 1, 0xc2b2ae35)) >>> 0;
    const m = buildMaze(level, seed);
    const s = shortestPathToGate(m);
    if (s == null) continue;
    if (s > bestSteps) {
      bestSteps = s;
      best = m;
    }
    if (s >= required) return m;
  }
  // Fall back to the longest solvable maze we found (maze is always reachable).
  return best ?? buildMaze(level, (0x9e3779b9 ^ Math.imul(level, 0x85ebca6b)) >>> 0);
}

/** The optimal-step count for a level (cosmetic display only; matches the map). */
export function computeOptimalSteps(level: number): number {
  return shortestPathToGate(generateMap(level)) ?? minPathSteps(level);
}

/** Storm overlay metadata the host can use to theme the world at high levels. */
export function levelTheme(level: number): { band: DifficultyBand; storm: boolean; tint: [number, number, number] } {
  const band = difficultyBand(level);
  if (band === "Hard") return { band, storm: true, tint: [26, 20, 48] };
  if (band === "Medium") return { band, storm: false, tint: [16, 24, 44] };
  return { band, storm: false, tint: [10, 14, 39] };
}
