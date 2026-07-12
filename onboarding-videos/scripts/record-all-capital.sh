#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/cap-record.log

echo "[record-all-capital] Starting at $(date)" | tee -a "$LOG"

for CAP in cap-01-capital-overview cap-02-investor-pipeline cap-03-data-room cap-04-followups-engagement cap-05-reports-copilot; do
  echo "" | tee -a "$LOG"
  echo "=====================================" | tee -a "$LOG"
  echo "[$CAP] Recording at $(date)" | tee -a "$LOG"
  echo "=====================================" | tee -a "$LOG"
  node "$SCRIPT_DIR/${CAP}.cjs" 2>&1 | tee -a "$LOG"
  echo "[$CAP] Done at $(date)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "[record-all-capital] All scripts complete. Converting to MP4 …" | tee -a "$LOG"

RAW="$SCRIPT_DIR/../outputs/raw"
FINAL="$SCRIPT_DIR/../outputs/final"

for WEBM in "$RAW"/cap-*.webm; do
  NAME="$(basename "$WEBM" .webm)"
  OUT="$FINAL/${NAME}.mp4"
  echo "  ffmpeg: $NAME …" | tee -a "$LOG"
  ffmpeg -y -i "$WEBM" -c:v libx264 -preset fast -crf 23 -movflags +faststart "$OUT" 2>&1 | tail -5 | tee -a "$LOG"
  DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo "?")
  echo "  → $OUT (${DURATION}s)" | tee -a "$LOG"
done

echo "" | tee -a "$LOG"
echo "[record-all-capital] COMPLETE at $(date)" | tee -a "$LOG"
