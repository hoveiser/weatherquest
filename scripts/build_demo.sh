#!/usr/bin/env bash
#
# Build the WeatherGate demo video -> media/demo.mp4 (1920x1080, 30fps, burned-in captions).
#
# Two input modes (auto-detected):
#   A) RAW SCREEN RECORDING (recommended for a motion game):
#      drop a recording at docs/raw.mp4 (or set MEDIA_IN=path), and this script normalizes it to
#      1080p30 and burns docs/captions.srt.
#   B) STILL-FRAME SLIDESHOW:
#      put ordered PNGs in docs/frames/ (01.png, 02.png, ...) OR list "SECONDS  path" lines in
#      docs/demo.manifest. Each shot is scaled/padded to 1080p30, concatenated, then captioned.
#
# Usage:
#   ./scripts/build_demo.sh
#   MEDIA_IN=docs/raw.mp4 ./scripts/build_demo.sh
#   FRAMES_DIR=docs/frames SHOT_SECONDS=8 ./scripts/build_demo.sh
#
# Env overrides: MEDIA_IN, FRAMES_DIR, MANIFEST, CAPTIONS, OUT, SIZE, FPS, SHOT_SECONDS
# Requires: ffmpeg (with libass for subtitles) + ffprobe.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FRAMES_DIR="${FRAMES_DIR:-docs/frames}"
MANIFEST="${MANIFEST:-docs/demo.manifest}"
CAPTIONS="${CAPTIONS:-docs/captions.srt}"
MEDIA_IN="${MEDIA_IN:-docs/raw.mp4}"
OUT="${OUT:-media/demo.mp4}"
SIZE="${SIZE:-1920x1080}"
FPS="${FPS:-30}"
SHOT_SECONDS="${SHOT_SECONDS:-8}"

command -v ffmpeg >/dev/null 2>&1 || { echo "ERROR: ffmpeg not found. Install it first (e.g. sudo apt install ffmpeg)." >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"

W="${SIZE%x*}"; H="${SIZE#*x}"
CAP_STYLE="FontName=Inter,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=40"
SCALE_PAD="scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0A0E27,format=yuv420p"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Resolve an absolute path for the subtitle filter (it resolves relative to ffmpeg's CWD).
sub_abs=""
if [[ -f "$CAPTIONS" ]]; then sub_abs="$ROOT/$CAPTIONS"; fi

burn_captions() {
  # $1 = input video, $2 = output video
  local in="$1" out="$2"
  if [[ -n "$sub_abs" ]]; then
    ffmpeg -y -loglevel error -i "$in" \
      -vf "subtitles=${sub_abs}:force_style='${CAP_STYLE}'" \
      -c:v libx264 -preset slow -crf 20 -r "$FPS" -pix_fmt yuv420p -movflags +faststart "$out"
  else
    echo "WARN: captions file '$CAPTIONS' not found - writing '$out' WITHOUT burned-in captions." >&2
    ffmpeg -y -loglevel error -i "$in" -c copy "$out"
  fi
}

# ---------------------------------------------------------------------------
# Mode A - raw screen recording
# ---------------------------------------------------------------------------
if [[ -f "$MEDIA_IN" ]]; then
  echo "==> Using screen recording: $MEDIA_IN"
  norm="$TMP/normalized.mp4"
  ffmpeg -y -loglevel error -i "$MEDIA_IN" \
    -vf "$SCALE_PAD,fps=${FPS}" -an \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "$norm"
  burn_captions "$norm" "$OUT"
  echo "Wrote $OUT"
else
  # -------------------------------------------------------------------------
  # Mode B - still-frame slideshow
  # -------------------------------------------------------------------------
  pairs=()
  if [[ -f "$MANIFEST" ]]; then
    echo "==> Using manifest: $MANIFEST"
    while read -r dur path _; do
      [[ -z "$dur" || "$dur" == \#* ]] && continue
      [[ -f "$path" ]] || { echo "ERROR: manifest path missing: $path" >&2; exit 1; }
      pairs+=("$dur $path")
    done < "$MANIFEST"
  else
    shopt -s nullglob
    files=( "$FRAMES_DIR"/*.png "$FRAMES_DIR"/*.jpg "$FRAMES_DIR"/*.jpeg )
    shopt -u nullglob
    if [[ ${#files[@]} -eq 0 ]]; then
      echo "ERROR: no '$MEDIA_IN' recording found and no frames in '$FRAMES_DIR' (and no '$MANIFEST')." >&2
      echo "       Record the game (see docs/video-storyboard.md) or drop PNGs into $FRAMES_DIR/." >&2
      exit 1
    fi
    echo "==> Using ${#files[@]} frames from $FRAMES_DIR (${SHOT_SECONDS}s each)"
    for f in "${files[@]}"; do pairs+=("$SHOT_SECONDS $f"); done
  fi

  list="$TMP/concat.txt"; : > "$list"
  i=0
  for p in "${pairs[@]}"; do
    dur="${p%% *}"; img="${p#* }"
    seg="$TMP/seg$(printf '%03d' "$i").mp4"
    ffmpeg -y -loglevel error -loop 1 -framerate "$FPS" -t "$dur" -i "$img" \
      -vf "$SCALE_PAD" -c:v libx264 -preset medium -crf 20 -r "$FPS" -pix_fmt yuv420p "$seg"
    echo "file '$seg'" >> "$list"
    i=$((i+1))
  done

  merged="$TMP/merged.mp4"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy "$merged"
  burn_captions "$merged" "$OUT"
  echo "Wrote $OUT"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if command -v ffprobe >/dev/null 2>&1; then
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,r_frame_rate,nb_frames -show_entries format=duration \
    -of default=noprint_wrappers=1 "$OUT" || true
fi
echo "Done. Upload '$OUT' to YouTube and paste the link into the 'Demo Video' field of SUBMISSION.md."
