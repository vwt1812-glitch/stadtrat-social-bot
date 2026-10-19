#!/usr/bin/env bash
# Einrichtung auf dem Raspberry Pi (Raspberry Pi OS 64-bit). Aufruf im Projektordner: bash pi/install.sh
# Whisper-Modell wählen: WHISPER_GROESSE=base bash pi/install.sh (Standard: small)
# Aufbau nach vwt1812-glitch/eu-piraten-abstimmungen (pi/install.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
VERZEICHNIS="$PWD"
BENUTZER="$(id -un)"
WHISPER_DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
WHISPER_GROESSE="${WHISPER_GROESSE:-small}"

echo "== Pakete (git, ffmpeg, Schriften, Compiler für whisper.cpp)"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates ffmpeg fonts-dejavu cmake build-essential

echo "== Node.js 22"
if ! node --version 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

echo "== Abhängigkeiten"
npm ci

echo "== Gesichtssuche (Python mit OpenCV in .venv)"
sudo apt-get install -y python3-venv
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q --disable-pip-version-check "opencv-python-headless>=4.10,<5"

echo "== whisper.cpp ($WHISPER_DIR, Modell $WHISPER_GROESSE)"
if [ ! -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
  [ -d "$WHISPER_DIR" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build"
  cmake --build "$WHISPER_DIR/build" -j"$(nproc)" --config Release
fi
MODELL="$WHISPER_DIR/models/ggml-$WHISPER_GROESSE.bin"
[ -f "$MODELL" ] || sh "$WHISPER_DIR/models/download-ggml-model.sh" "$WHISPER_GROESSE"

echo "== Zugangsdaten (.env)"
if [ ! -f .env ]; then
  sed -e "s#^WHISPER_BIN=.*#WHISPER_BIN=$WHISPER_DIR/build/bin/whisper-cli#" \
      -e "s#^WHISPER_MODELL=.*#WHISPER_MODELL=$MODELL#" \
      -e "s#^WHISPER_THREADS=.*#WHISPER_THREADS=$(nproc)#" .env.example > .env
  chmod 600 .env
  echo "Angelegt: $VERZEICHNIS/.env – bitte ausfüllen: nano .env"
else
  echo ".env existiert schon – bleibt unverändert."
fi

echo "== Dienst"
sed "s#@VERZEICHNIS@#$VERZEICHNIS#g; s#@BENUTZER@#$BENUTZER#g; s#@NODE@#$(command -v node)#g" pi/social-bot.service \
  | sudo tee /etc/systemd/system/social-bot.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable social-bot

cat <<TEXT

Fertig. Nächste Schritte:
  1. nano .env                              (Telegram, Postiz und ggf. KI eintragen)
  2. sudo systemctl start social-bot
  3. dem Bot in Telegram /status schicken
  Protokoll: journalctl -u social-bot -f
TEXT
