# WeatherGate - Demo Video Storyboard

Target: **~84s**, **1920×1080**, **MP4 (H.264)**, **30 fps**, **burn-in captions** (white text, black
outline, bottom center - see `captions.srt`). Record the **browser game**, not a terminal. The game's
selling point is *motion* (walking, confetti, the balance count-up, the fail shake), so a real screen
recording beats a slideshow of stills - do that first, and use `scripts/build_demo.sh` to normalize +
add captions.

## Option A - Record the live game, then caption it (recommended)

```bash
# 1) Record your screen while playing (choose ONE):
#    • ffmpeg X11 grab (Linux desktop):
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :1.0+0,0 -t 90 docs/raw.mp4
#    • or a GUI tool: OBS Studio, Screenity (Chrome ext.), LICEcap, or macOS Cmd+Shift+5 → save .mov.

# 2) Normalize to 1080p30 + burn the captions into media/demo.mp4:
#    (build_demo.sh auto-detects docs/raw.mp4)
./scripts/build_demo.sh
```

## Option B - Assemble a narrated slideshow from captured frames

Capture one PNG per storyboard shot into `docs/frames/` (`01.png`, `02.png`, … in play order), then:

```bash
FRAMES_DIR=docs/frames SHOT_SECONDS=8 ./scripts/build_demo.sh
```

Or drive exact per-shot timings with a manifest (`SECONDS  path`, one per line) at `docs/demo.manifest`.

## The 4-step manual recording guide

1. **Start the game.** `cd frontend && npm run dev`, open the printed `http://localhost:517…/` URL in a
   **foreground** browser window (the canvas + confetti freeze if the tab is backgrounded). Set the
   window to 1080p. Start your screen recorder.
2. **Walk to the gate.** Press **W/↑** to line up with the gap, then **D/→** to cross the field and bump
   into the **purple Magic Gate**. The game pauses and the modal opens. (Recording shortcut: run
   `window.__wgOpenGate()` in the DevTools console to pop the modal instantly without walking.)
3. **Show the two outcomes.**
   - **SUCCESS:** click **`🏗️ Build a Raft`** (it fills the input), **Submit**, let *"AI Validators are
     analyzing…"* show, and on **`✅ Quest Passed`** click **Claim** - capture the **confetti**, the
     **GEN Balance counting up** (top-left), the **gate turning green**, then **walk right into the ★
     Victory zone** for the second burst.
   - **FAIL:** reopen the gate and submit a reckless action (e.g. **`🏃 Swim Across`**) - the modal
     **shakes** red with *"Quest Failed"* and the gate stays locked. (A fail only triggers when the live
     risk tier top-right reads **High/Extreme**; to force one, temporarily set `const CITY` in
     `frontend/src/App.tsx` to a currently-stormy city, record the fail, then revert it to `"London"`.)
4. **Stop, caption, upload.** Stop recording → run `./scripts/build_demo.sh` to produce
   `media/demo.mp4` → upload to YouTube and paste the link into the **Demo Video** field of
   `SUBMISSION.md` (currently `[TBD]`).

## Shot list (matches `captions.srt`)

| # | Time | Shot | Caption |
|---|------|------|---------|
| 1 | 0:00-0:08 | Title + full field (grass, river, wall, purple gate, green victory zone) | WeatherGate: a 2D RPG where real weather gates your progress |
| 2 | 0:08-0:16 | Hero sliding around under WASD/arrow control | Move your hero with WASD or the arrow keys |
| 3 | 0:16-0:24 | Bumping into the river and the tree wall (they block) | A river and a wall block the path to the Magic Gate |
| 4 | 0:24-0:32 | Touch the gate → game pauses, modal scales in | Touch the gate - the game pauses and the AI challenge opens |
| 5 | 0:32-0:41 | Close-up of the modal's live weather + risk multiplier badge | Live Open-Meteo weather sets the risk multiplier |
| 6 | 0:41-0:50 | Click an Action Card → it fills the custom input | Choose an Action Card, or type your own move |
| 7 | 0:50-0:58 | Judging state: pulsing 🛰️ "AI Validators are analyzing…" | AI Validators are judging your action against the weather |
| 8 | 0:58-1:07 | PASS → confetti + balance count-up + gate turns green + reach ★ Victory | Pass - confetti, a GEN reward, and the gate swings open |
| 9 | 1:07-1:15 | FAIL → modal shakes red, gate stays locked | Reckless in bad weather? The verdict fails and the gate stays locked |
| 10 | 1:15-1:24 | Outro: logo / GitHub / StudioNet address | Built on GenLayer - trustless, weather-driven adjudication |

> The demo runs in **demo mode** by default, so no wallet/gas is needed for recording; every multiplier
> shown is derived from real live weather. Keep the pace ~1 beat per 8-9s for an ~84s cut.
