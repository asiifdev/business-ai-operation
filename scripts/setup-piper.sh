#!/usr/bin/env bash
# Installs Piper (OHF-Voice/piper1-gpl) and the Indonesian and English voices for spoken replies in Telegram (D-052).
# Everything goes into ./.piper (ignored by git). Run once per machine: `pnpm tts:setup`.
set -euo pipefail

DIR="${PIPER_DIR:-.piper}"
VOICE_ID="${PIPER_VOICE_ID:-id_ID-news_tts-medium}"
VOICE_EN="${PIPER_VOICE_EN:-en_US-libritts_r-medium}"

PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PYTHON="$candidate"
    break
  fi
done
[ -n "$PYTHON" ] || { echo "Piper needs Python 3.10 or newer (macOS: brew install python@3.12)." >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || echo "Warning: ffmpeg is not installed; spoken replies need it to make Telegram voice notes." >&2

mkdir -p "$DIR/voices"
"$PYTHON" -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install --quiet --upgrade pip piper-tts
"$DIR/venv/bin/python" -m piper.download_voices "$VOICE_ID" "$VOICE_EN" --data-dir "$DIR/voices"
echo "Piper is ready in $DIR (voices $VOICE_ID and $VOICE_EN). Restart the server: voice replies turn on by themselves."
