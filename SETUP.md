# Setup-Anleitung: GitHub Pages Hosting

## ✅ Bereits erledigt

- Dashboard-Code erstellt (HTML/CSS/JS)
- Beispiel-Portfolio-Daten erstellt
- Git Repository initialisiert (lokales Commit vorhanden)
- Auto-Update Script erstellt (`update-portfolio.sh`)
- launchd Service konfiguriert (stündliche Updates)

## 🔧 Nächste Schritte (manuell)

### 1. GitHub Repository erstellen

**Option A: Via GitHub Web-Interface**

1. Gehe zu: https://github.com/new
2. Repository-Name: **`musterdepot-ki-agent`** (exakt so, wichtig!)
3. Description: "🤖 Autonomes Trading-System mit KI | Live-Dashboard"
4. Visibility: **Public** (damit GitHub Pages kostenlos ist)
5. **NICHT** initialisieren mit README/LICENSE/.gitignore (das haben wir schon lokal)
6. Klick auf "Create repository"

**Option B: Via GitHub CLI (falls installiert)**

```bash
cd /Users/andreashergett/Desktop/musterdepot-ki-agent
gh repo create musterdepot-ki-agent --public --source=. --remote=origin --push
```

---

### 2. Remote hinzufügen & pushen (falls Option A)

```bash
cd /Users/andreashergett/Desktop/musterdepot-ki-agent

# Remote hinzufügen (ersetze USERNAME mit deinem GitHub-Username)
git remote add origin https://github.com/USERNAME/musterdepot-ki-agent.git

# Pushen
git branch -M main
git push -u origin main
```

**WICHTIG:** Ersetze `USERNAME` mit deinem GitHub-Username!

Beispiel: Wenn dein GitHub-Account "andreashergett" ist:
```bash
git remote add origin https://github.com/andreashergett/musterdepot-ki-agent.git
```

---

### 3. GitHub Pages aktivieren

1. Gehe zu deinem Repo: `https://github.com/USERNAME/musterdepot-ki-agent`
2. Klick auf **Settings** (oben rechts)
3. Linke Sidebar → **Pages**
4. Source:
   - Branch: **main**
   - Folder: **/ (root)**
5. Klick auf **Save**

**⏱️ Warten:** GitHub Pages braucht 2-5 Minuten zum Deployment

---

### 4. Dashboard aufrufen

Nach erfolgreicher Aktivierung (grüne Meldung in Settings → Pages):

**URL:** `https://USERNAME.github.io/musterdepot-ki-agent/`

Beispiel: `https://andreashergett.github.io/musterdepot-ki-agent/`

---

### 5. Auto-Update aktivieren (stündlich)

```bash
# launchd Service laden
launchctl load ~/Library/LaunchAgents/de.dorabot.portfolio-update.plist

# Status prüfen
launchctl list | grep portfolio-update
```

**Funktionsweise:**
- Script läuft stündlich (StartInterval 3600)
- Prüft ob Börsenzeiten (Mo-Fr, 8-22 Uhr)
- Falls Änderungen in `data/portfolio.json` → Git Push
- Logs: `~/.dorabot/workspace/logs/portfolio-update.log`

**Manueller Test:**
```bash
/Users/andreashergett/Desktop/musterdepot-ki-agent/update-portfolio.sh
```

---

## 🔐 GitHub Authentifizierung

**Falls Git Push fehlschlägt** (Passwort-Prompt oder 403 Error):

### Option 1: Personal Access Token (empfohlen)

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token (classic)
3. Name: "Musterdepot Auto-Update"
4. Scopes: **repo** (Full control)
5. Generate token → **KOPIEREN** (wird nur 1x angezeigt!)
6. Beim Git Push als Passwort verwenden:
   ```
   Username: andreashergett
   Password: ghp_xxxxxxxxxxxxxxxxxxxx (Token)
   ```

### Option 2: SSH Key

```bash
# SSH Key generieren (falls nicht vorhanden)
ssh-keygen -t ed25519 -C "deine@email.de"

# Public Key anzeigen
cat ~/.ssh/id_ed25519.pub

# Auf GitHub hinzufügen:
# Settings → SSH and GPG keys → New SSH key
# Paste public key

# Remote auf SSH umstellen
git remote set-url origin git@github.com:USERNAME/musterdepot-ki-agent.git
```

---

## ✅ Erfolgs-Checks

- [ ] GitHub Repo erstellt und öffentlich
- [ ] Lokales Repo gepusht (`git push -u origin main`)
- [ ] GitHub Pages aktiviert (Settings → Pages)
- [ ] Dashboard erreichbar unter `https://USERNAME.github.io/musterdepot-ki-agent/`
- [ ] launchd Service geladen (`launchctl list | grep portfolio-update`)
- [ ] Auto-Update getestet (manueller Script-Run erfolgreich)

---

## 🎯 Finale URL

Nach erfolgreicher Einrichtung:

**Dein Live-Dashboard:** `https://USERNAME.github.io/musterdepot-ki-agent/`

Shareable Link für WhatsApp/Telegram:
```
🤖 Schau dir mein KI-gesteuertes Musterdepot an:
https://andreashergett.github.io/musterdepot-ki-agent/

Die KI tradet autonom Aktien. Startkapital: 3000€ 🚀
```

---

## 📞 Support

Falls Probleme auftreten:
- GitHub Pages Guide: https://pages.github.com/
- GitHub Token Guide: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token
- launchd Debugging: `tail -f ~/.dorabot/workspace/logs/portfolio-update.log`

---

🤖 Viel Erfolg! Bei Fragen einfach melden.
