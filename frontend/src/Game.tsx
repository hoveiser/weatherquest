import { useEffect, useRef } from "react";
import kaboom, { type KaboomCtx } from "kaboom";
import { generateMap, levelTheme, SPAWN_CELL } from "./lib/maps";

/**
 * WeatherGate - a 2D top-down mini RPG built on Kaboom.js.
 *
 * This file is the GAME LAYER only. It renders a tile field (grass / river / a
 * Magic Gate doorway / a victory zone), drives the player with WASD or the
 * arrow keys, and resolves collisions with a small, deterministic AABB check
 * against the solid tiles. Everything that needs AI consensus (the gate modal,
 * rewards, HUD) is delegated to the React host through props/callbacks so the
 * untouched GenLayer contract + tests keep owning the authoritative logic.
 */

// --- World geometry (fixed logical resolution; CSS scales it responsively) ---
const TILE = 32;
const COLS = 22;
const ROWS = 14;
const WORLD_W = COLS * TILE; // 704
const WORLD_H = ROWS * TILE; // 448
const PLAYER_HALF = 11;
const SPEED = 190; // px / second

// Gate trigger box. A closed gate tile is centred on a grid cell, and the player is
// physically stopped PLAYER_HALF + TILE/2 = 27px from that centre. The old trigger used
// a 0.7*TILE (22px) radius, which sat *inside* that 27px standoff - so it could never
// fire. Widen X just past the contact point so touching the gate opens the challenge,
// and keep Y tight to a gate row so the solid wall directly above/below the gate stays
// non-triggering. (The gate remains solid while closed, so Victory can't be bypassed.)
const GATE_TRIGGER_X = TILE * 1.05; // ~33.6px - comfortably past the 27px contact point
const GATE_TRIGGER_Y = TILE * 0.85; // ~27.2px - must be aligned to a gate row (rows 6-8)

// Cell legend: "." grass  "#" tree/wall  "~" river  "G" gate  "V" victory zone
// Layouts are generated per difficulty level in lib/maps.ts (see generateMap).

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Cell {
  cx: number;
  cy: number;
}

// Solid rectangles for a given gate-open state.
function blockersFor(map: string[], gateOpen: boolean): Rect[] {
  const rects: Rect[] = [];
  map.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === "#" || ch === "~" || (ch === "G" && !gateOpen)) {
        rects.push({ x: c * TILE, y: r * TILE, w: TILE, h: TILE });
      }
    });
  });
  return rects;
}
function cellsOf(map: string[], sym: string): Cell[] {
  const out: Cell[] = [];
  map.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === sym) out.push({ cx: c * TILE + TILE / 2, cy: r * TILE + TILE / 2 });
    }),
  );
  return out;
}

export interface GameProps {
  /** Campaign level (1..10). Selects the generated map + storm theme. */
  level?: number;
  /** When true the Magic Gate is unlocked: it stops blocking and recolors. */
  gateOpen?: boolean;
  /** Freeze player input (e.g. while the AI gate modal is open). */
  paused?: boolean;
  /** Fires once per approach when the player touches a *closed* gate, with the
   *  number of grid cells entered so far (a cosmetic step counter). */
  onGateReached?: (steps: number) => void;
  /** Fires once when the player walks into the victory zone (gate already open). */
  onVictoryReached?: () => void;
  /** Fires on every cell transition so the host can show a live step counter. */
  onStepsChanged?: (steps: number) => void;
}

export default function Game({
  level = 1,
  gateOpen = false,
  paused = false,
  onGateReached,
  onVictoryReached,
  onStepsChanged,
}: GameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<KaboomCtx | null>(null);

  // Mutable mirrors so the running loop reads the latest props without re-init.
  const gateOpenRef = useRef(gateOpen);
  const pausedRef = useRef(paused);
  const blockersRef = useRef<Rect[]>([]);
  const promptArmed = useRef(true); // re-arm the gate prompt after leaving
  const victoryFired = useRef(false);
  const cbsRef = useRef({ onGateReached, onVictoryReached, onStepsChanged });
  cbsRef.current = { onGateReached, onVictoryReached, onStepsChanged };

  // One-time Kaboom boot. Re-running only happens on a real unmount/remount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const k = kaboom({
      global: false, // keep the React app's window clean
      root,
      width: WORLD_W,
      height: WORLD_H,
      background: levelTheme(level).tint,
      pixelDensity: 1,
      crisp: true,
      debug: false,
      focus: true,
      loadingScreen: false,
    });
    ctxRef.current = k;

    // Scale the canvas to its container for responsiveness.
    const canvas = k.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.maxWidth = `${WORLD_W}px`;
    canvas.style.aspectRatio = `${WORLD_W} / ${WORLD_H}`;
    canvas.style.imageRendering = "pixelated";
    canvas.style.borderRadius = "12px";

    const MAP = generateMap(level);
    const gateCells = cellsOf(MAP, "G");
    const victoryCells = cellsOf(MAP, "V");
    blockersRef.current = blockersFor(MAP, gateOpenRef.current);

    // NOTE: addLevel's tile callback receives pos in TILE UNITS, not pixels.
    const checker = (p: { x: number; y: number }): [number, number, number] =>
      (Math.round(p.x) + Math.round(p.y)) % 2 === 0 ? [38, 116, 64] : [33, 104, 58];

    k.scene("world", () => {
      k.addLevel(MAP, {
        tileWidth: TILE,
        tileHeight: TILE,
        tiles: {
          // Grass floor (non-solid), subtle two-tone checker for a tiled feel.
          ".": (p) => [k.rect(TILE, TILE), k.color(...checker(p))],
          // Trees / rock wall - solid.
          "#": () => [k.rect(TILE, TILE), k.color(16, 42, 32), k.outline(2, k.rgb(9, 22, 18))],
          // River - solid, cool blue.
          "~": () => [k.rect(TILE, TILE), k.color(45, 110, 230), k.outline(1, k.rgb(120, 180, 255))],
          // Magic Gate - solid until opened, neon frame.
          "G": () => [k.rect(TILE, TILE), k.color(107, 70, 193), k.outline(3, k.rgb(255, 107, 53)), "gate"],
          // Victory zone - glowing green pad.
          "V": () => [k.rect(TILE, TILE), k.color(72, 187, 120), k.outline(2, k.rgb(150, 240, 190)), "victory"],
        },
      });

      // Gate + victory glyphs (decorative labels).
      gateCells.forEach((gc) =>
        k.add([k.pos(gc.cx, gc.cy - 6), k.text("⛩", { size: 22 }), k.anchor("center"), k.color(255, 107, 53), "deco"]),
      );
      victoryCells
        .filter((_, i) => i === 0)
        .forEach((vc) =>
          k.add([k.pos(vc.cx + 18, vc.cy), k.text("★", { size: 30 }), k.anchor("center"), k.color(220, 255, 230), "deco"]),
        );

      // The player: a rounded neon rectangle. Spawn is aligned to maps.ts SPAWN_CELL
      // (a guaranteed-carved maze room) so the BFS optimal-path length the host shows
      // in the cosmetic step counter matches where the player actually starts.
      const player = k.add([
        k.rect(PLAYER_HALF * 2, PLAYER_HALF * 2, { radius: 6 }),
        k.color(255, 159, 64),
        k.outline(3, k.rgb(255, 255, 255)),
        k.pos(SPAWN_CELL.c * TILE + TILE / 2, SPAWN_CELL.r * TILE + TILE / 2),
        k.anchor("center"),
        k.z(10),
        "player",
      ]);

      // Cosmetic step counter. `steps` counts every grid-cell transition (including
      // revisits). It is shown for flavor only, is never sent to the contract, and
      // never affects the payout, which is base * weather multiplier only.
      let steps = 0;
      let lastCellC: number = SPAWN_CELL.c;
      let lastCellR: number = SPAWN_CELL.r;

      const overlaps = (px: number, py: number): boolean =>
        blockersRef.current.some(
          (rc) =>
            Math.abs(px - (rc.x + rc.w / 2)) < PLAYER_HALF + rc.w / 2 &&
            Math.abs(py - (rc.y + rc.h / 2)) < PLAYER_HALF + rc.h / 2,
        );

      k.onUpdate(() => {
        if (pausedRef.current) return;
        const dt = k.dt();

        // Read movement intent (WASD + arrows).
        let vx = 0;
        let vy = 0;
        if (k.isKeyDown("left") || k.isKeyDown("a")) vx -= 1;
        else if (k.isKeyDown("right") || k.isKeyDown("d")) vx += 1;
        if (k.isKeyDown("up") || k.isKeyDown("w")) vy -= 1;
        else if (k.isKeyDown("down") || k.isKeyDown("s")) vy += 1;

        if (vx !== 0 || vy !== 0) {
          const mag = Math.hypot(vx, vy) || 1;
          const step = (SPEED * dt) / mag;
          // Axis-separated resolution so the player slides along walls.
          const nx = Math.min(WORLD_W - PLAYER_HALF, Math.max(PLAYER_HALF, player.pos.x + vx * step));
          if (!overlaps(nx, player.pos.y)) player.pos.x = nx;
          const ny = Math.min(WORLD_H - PLAYER_HALF, Math.max(PLAYER_HALF, player.pos.y + vy * step));
          if (!overlaps(player.pos.x, ny)) player.pos.y = ny;
        }

        const px = player.pos.x;
        const py = player.pos.y;

        // Count a step whenever the player's centre enters a new grid cell.
        const cellC = Math.floor(px / TILE);
        const cellR = Math.floor(py / TILE);
        if (cellC !== lastCellC || cellR !== lastCellR) {
          lastCellC = cellC;
          lastCellR = cellR;
          steps += 1;
          cbsRef.current.onStepsChanged?.(steps);
        }

        // Gate trigger: touching a *closed* gate opens the AI check (once).
        if (!gateOpenRef.current) {
          const atGate = gateCells.some(
            (gc) => Math.abs(px - gc.cx) < GATE_TRIGGER_X && Math.abs(py - gc.cy) < GATE_TRIGGER_Y,
          );
          if (atGate && promptArmed.current) {
            promptArmed.current = false;
            cbsRef.current.onGateReached?.(steps);
          } else if (!atGate) {
            promptArmed.current = true;
          }
        }

        // Victory: only reachable once the gate is open.
        if (gateOpenRef.current && !victoryFired.current) {
          const onPad = victoryCells.some(
            (vc) => Math.abs(px - vc.cx) < TILE * 0.7 && Math.abs(py - vc.cy) < TILE * 0.7,
          );
          if (onPad) {
            victoryFired.current = true;
            cbsRef.current.onVictoryReached?.();
          }
        }
      });
    });

    k.go("world");

    return () => {
      k.quit();
      root.innerHTML = "";
      ctxRef.current = null;
    };
  }, []);

  // Keep the live loop in sync with host state (gate unlock + input freeze).
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    gateOpenRef.current = gateOpen;
    const k = ctxRef.current;
    const MAP = generateMap(level);
    blockersRef.current = blockersFor(MAP, gateOpen);
    if (k) {
      // Recolor the gate green when it opens.
      for (const o of k.get("gate")) {
        (o as unknown as { color: unknown }).color = gateOpen
          ? k.rgb(72, 187, 120)
          : k.rgb(107, 70, 193);
      }
    }
  }, [gateOpen]);

  return (
    <div className="relative w-full max-w-3xl">
      <div ref={rootRef} className="relative z-10 w-full overflow-hidden rounded-modal shadow-glow-purple" />
    </div>
  );
}
