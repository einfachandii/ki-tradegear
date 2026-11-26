#!/bin/bash
# Doppelklick (macOS): startet die Watchlist und öffnet sie im Browser
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt – bitte von https://nodejs.org installieren (LTS)."
  read -r -p "Enter zum Schließen"
  exit 1
fi
PORT="${PORT:-8080}"
(sleep 1 && open "http://localhost:$PORT") &
PORT="$PORT" node server.js
