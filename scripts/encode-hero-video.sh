#!/usr/bin/env bash
# Compresses the homepage hero footage into public/video/.
#
#   FFMPEG=/path/to/ffmpeg scripts/encode-hero-video.sh <input-video> [poster-time-seconds]
#
# Produces hero.mp4 (H.264, 1920x1080, 30 fps, no audio, ~2-4 MB) and
# hero-poster.jpg (a frame of the *encoded* video, so the poster and the
# first video frame match exactly). Needs an ffmpeg with libx264; HDR
# (HLG/PQ) sources additionally need zscale/tonemap.
#
# Tuned on the first test footage: CRF 28 gave ~3 MB for 23 s. WebM/VP9
# was measured against it (SSIM) and was bigger at equal quality, so
# there's deliberately only one MP4. Override with CRF=26 etc. if a new
# clip lands outside the size range.
set -euo pipefail
cd "$(dirname "$0")/.."

INPUT="${1:?usage: scripts/encode-hero-video.sh <input-video> [poster-time-seconds]}"
POSTER_AT="${2:-0}"
FFMPEG="${FFMPEG:-ffmpeg}"
CRF="${CRF:-28}"
OUT_DIR="public/video"
mkdir -p "$OUT_DIR"

# Scale to cover 1920x1080, then centre-crop the overflow.
FIT="scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080"

# iPhone-style HDR footage (HLG/PQ) looks washed out if it's just
# squeezed into 8-bit SDR, so tone-map it first. Dropping to 30 fps
# first keeps the expensive steps cheap.
INFO="$("$FFMPEG" -hide_banner -i "$INPUT" 2>&1 || true)"
if grep -qE "arib-std-b67|smpte2084" <<<"$INFO"; then
  echo "HDR source detected: tone-mapping to SDR"
  VF="fps=30,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,$FIT"
else
  VF="fps=30,format=yuv420p,$FIT"
fi

"$FFMPEG" -hide_banner -loglevel error -y -i "$INPUT" \
  -map 0:v:0 -an -vf "$VF" \
  -c:v libx264 -preset slow -crf "$CRF" -profile:v high -level 4.0 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart \
  "$OUT_DIR/hero.mp4"

"$FFMPEG" -hide_banner -loglevel error -y -ss "$POSTER_AT" -i "$OUT_DIR/hero.mp4" \
  -frames:v 1 -q:v 3 "$OUT_DIR/hero-poster.jpg"

size() { echo "scale=2; $(stat -f%z "$1") / 1048576" | bc; }
echo "hero.mp4         $(size "$OUT_DIR/hero.mp4") MB"
echo "hero-poster.jpg  $(size "$OUT_DIR/hero-poster.jpg") MB"
if (( $(stat -f%z "$OUT_DIR/hero.mp4") > 4194304 )); then
  echo "WARNING: hero.mp4 is over 4 MB, try a higher CRF, e.g. CRF=30" >&2
fi
