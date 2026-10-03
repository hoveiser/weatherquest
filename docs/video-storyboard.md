# WeatherQuest — Demo Video Storyboard (Task 4)

Target: **60–90s**, **1920×1080**, **MP4 (H.264)**, **burn-in captions** (white text, black outline,
bottom center). Record the **browser UI**, not a terminal.

## Recording

```bash
# Option A — ffmpeg X11 grab (Linux desktop), then burn captions:
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :1.0+0,0 \
       -t 90 raw.mp4
ffmpeg -i raw.mp4 -vf "subtitles=captions.srt:force_style='FontName=Inter,FontSize=22,\
PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,\
Alignment=2,MarginV=40'" -c:v libx264 -preset slow -crf 20 weatherquest-demo.mp4

# Option B — Chrome headless video (or a tool like Screenity/LICEcap) then the same caption pass.
```

> `docs/captions.srt` next to this file already contains the timed caption track below. Adjust the
> `[mm:ss]` markers to your real recording, or record in the same beats so the timing lines up.

## Shot list (matches the submission scenario)

| # | Time | Shot | Caption |
|---|------|------|---------|
| 1 | 0:00–0:08 | Landing hero, particles cycling storm→rain→snow | WeatherQuest: AI-Verified Gaming Bounties |
| 2 | 0:08–0:16 | Scroll "How a quest resolves" 4-step cards | Real-time weather data determines risk multipliers |
| 3 | 0:16–0:26 | Dashboard — cards populate live weather + risk meters | Each bounty reads live Open-Meteo weather |
| 4 | 0:26–0:36 | Open a **London** quest (Rain, ~1.5x), read reasoning | AI judges if your action is safe for the conditions |
| 5 | 0:36–0:44 | Submit "Run" → Success → payout scales | Higher risk = Higher reward |
| 6 | 0:44–0:56 | Open **Reykjavik** (Blizzard, ~4.0x) → submit "Run" → FAIL | Reckless moves get rejected |
| 7 | 0:56–1:08 | Same quest → submit "Snowmobile" → SUCCESS huge 4x payout | Adapt to the weather, win big |
| 8 | 1:08–1:18 | Create Quest flow: type city → live preview meter | Post a bounty, escrow GEN on-chain |
| 9 | 1:18–1:26 | Outro: logo + GitHub link | Built on GenLayer — Trustless Adjudication |

Keep the pace ~1 beat per 8–10s for a ~85s cut. The demo runs in **demo mode** by default, so no
wallet/gas is needed for the recording; every multiplier shown is derived from real live weather.
