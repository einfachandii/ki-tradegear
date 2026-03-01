#!/bin/bash
# Auto-Update Script für Musterdepot GitHub Pages
# Läuft stündlich während Börsenzeiten via launchd

set -e

REPO_DIR="/Users/andreashergett/Desktop/musterdepot-ki-agent"
LOG_FILE="/Users/andreashergett/.dorabot/workspace/logs/portfolio-update.log"

# Logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Prüfe Börsenzeiten (8-22 Uhr, Mo-Fr)
hour=$(date +%H)
day=$(date +%u)  # 1=Monday, 7=Sunday

if [ "$day" -gt 5 ]; then
    log "Wochenende - kein Update"
    exit 0
fi

if [ "$hour" -lt 8 ] || [ "$hour" -ge 22 ]; then
    log "Außerhalb Börsenzeiten (8-22 Uhr) - kein Update"
    exit 0
fi

log "Update gestartet (Börsenzeiten aktiv)"

cd "$REPO_DIR" || exit 1

# TODO: Hier wird später das Python Trading-Bot Script aufgerufen
# python3 trading_bot.py  # Generiert data/portfolio.json

# Prüfe ob Änderungen vorhanden
if ! git diff --quiet data/portfolio.json; then
    log "Änderungen erkannt - pushe zu GitHub"

    git add data/portfolio.json

    git commit -m "Update portfolio $(date '+%Y-%m-%d %H:%M')

Auto-Update vom Trading-Bot
Aktualisiert: Portfolio-Daten

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

    git push origin main

    log "✅ Update erfolgreich gepusht"
else
    log "Keine Änderungen - kein Push erforderlich"
fi
