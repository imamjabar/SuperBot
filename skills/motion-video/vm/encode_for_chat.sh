#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <input_video.mp4> [output_video.mp4]" >&2
    exit 1
fi

INPUT="$1"
if [ ! -f "$INPUT" ]; then
    echo "Error: file not found: $INPUT" >&2
    exit 1
fi

OUTPUT="${2:-${INPUT%.*}_chat.mp4}"
MAX_BYTES=25165824  # 24 MB cap for attach_file (limit 25 MB)

get_size() {
    stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || wc -c < "$1" | tr -d ' '
}

CURRENT_SIZE=$(get_size "$INPUT")
echo "Input size: $((CURRENT_SIZE / 1024 / 1024)) MB ($CURRENT_SIZE bytes)"

# Probe duration via ffprobe
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT" 2>/dev/null || echo "0")
DURATION_INT=$(printf "%.0f" "$DURATION" 2>/dev/null || echo "0")

if [ "$DURATION_INT" -gt 0 ]; then
    # Target 23 MB to ensure final output is comfortably within 24 MB
    TARGET_BITS=$((23 * 8 * 1024 * 1024))
    TOTAL_BITRATE=$((TARGET_BITS / DURATION_INT))
    AUDIO_BITRATE=128000
    if [ "$TOTAL_BITRATE" -gt "$AUDIO_BITRATE" ]; then
        VIDEO_BITRATE=$((TOTAL_BITRATE - AUDIO_BITRATE))
    else
        VIDEO_BITRATE=250000
        AUDIO_BITRATE=64000
    fi
    echo "Duration: ${DURATION_INT}s. Target video bitrate: $((VIDEO_BITRATE / 1000)) kbps"

    ffmpeg -y -i "$INPUT" \
        -c:v libx264 -preset medium -pix_fmt yuv420p \
        -b:v "${VIDEO_BITRATE}" -maxrate "$((VIDEO_BITRATE * 12 / 10))" -bufsize "$((VIDEO_BITRATE * 2))" \
        -c:a aac -b:a "${AUDIO_BITRATE}" \
        -movflags +faststart \
        "$OUTPUT"
else
    # Fallback CRF mode with capped maxrate
    ffmpeg -y -i "$INPUT" \
        -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p \
        -maxrate 3M -bufsize 6M \
        -c:a aac -b:a 128k \
        -movflags +faststart \
        "$OUTPUT"
fi

FINAL_SIZE=$(get_size "$OUTPUT")
echo "Encoded: $OUTPUT ($((FINAL_SIZE / 1024 / 1024)) MB, $FINAL_SIZE bytes)"

if [ "$FINAL_SIZE" -gt "$MAX_BYTES" ]; then
    echo "Warning: output exceeds 24 MB limit. Re-compressing with scale and CRF 30..."
    TMP_OUT="${OUTPUT%.*}_scaled.mp4"
    ffmpeg -y -i "$OUTPUT" \
        -vf "scale='min(1280,iw)':-2" \
        -c:v libx264 -crf 30 -preset fast -pix_fmt yuv420p \
        -c:a aac -b:a 96k -movflags +faststart \
        "$TMP_OUT"
    mv "$TMP_OUT" "$OUTPUT"
    FINAL_SIZE=$(get_size "$OUTPUT")
    echo "Final resized output: $OUTPUT ($((FINAL_SIZE / 1024 / 1024)) MB)"
fi

echo "Ready for chat attachment: $OUTPUT"
