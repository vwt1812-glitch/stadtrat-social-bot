#!/usr/bin/env bash
# Neuen Code von GitHub holen und Dienst neu starten: bash pi/aktualisieren.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci
sudo systemctl restart social-bot
echo "Aktualisiert und neu gestartet. Neue Einstellungen stehen in .env.example – mit deiner .env vergleichen:"
echo "  diff <(grep -oE '^[A-Z_]+=' .env.example | sort) <(grep -oE '^[A-Z_]+=' .env | sort)"
