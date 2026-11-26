# 📈 TradeGear Watchlist

Eine Watchlist im Stil von TradingView: alle Kurse auf einen Blick, Klick auf einen Wert zeigt Chart und Auswertung.

## Funktionen

**Watchlist**
- Kurs, Veränderung absolut und in %, optional Spalten **1 Woche, 1 Monat, YTD, 1 Jahr**
- Mehrere Watchlists (anlegen, umbenennen, kopieren, löschen)
- Abschnitte (z.B. „Indizes“, „Aktien“), einklappbar
- Symbole über die Suche hinzufügen (Name oder Kürzel), entfernen (mit Rückgängig), per Drag & Drop sortieren
- Sortieren per Klick auf den Spaltenkopf (Kurs, Änd. %, YTD …)
- Eigene Anzeigenamen, in andere Listen kopieren (Rechtsklick bzw. im Bearbeiten-Modus antippen)
- Grüner Punkt = Börse gerade geöffnet; Kurse blinken bei Änderung
- Automatische Aktualisierung alle 1/2/5/10 Minuten (einstellbar), nur solange der Tab sichtbar ist
- Export/Import als JSON, um die Listen auf andere Geräte zu übertragen

**Detailansicht (Klick auf einen Wert)**
- Chart (Linie oder Kerzen) für 1T, 5T, 1M, 3M, 6M, YTD, 1J, 5J, Max, mit TradingView Lightweight Charts
- Performance: **Heute, 1 Woche, 1/3/6 Monate, seit Jahresbeginn, 1/3/5 Jahre**
- Kennzahlen: Vortag, Eröffnung, Tagesspanne, 52-Wochen-Hoch/-Tief, Abstand zum Allzeithoch
- Jahresperformance je Kalenderjahr und Monats-Heatmap

Tastatur: ↑/↓ wechselt den Wert, Entf entfernt ihn.

## Starten

Die Kurse kommen von Yahoo Finance (kostenlos, leicht verzögert). Browser dürfen Yahoo nicht direkt abfragen,
deshalb gibt es einen kleinen Server, der die Abfragen weiterleitet:

```bash
cd watchlist
node server.js          # danach http://localhost:8080 öffnen
```

Auf dem Mac geht auch ein **Doppelklick auf `start-watchlist.command`**. Voraussetzung ist [Node.js](https://nodejs.org) (Version 18 oder neuer); weitere Pakete braucht es nicht.

Der Server zeigt beim Start auch eine WLAN-Adresse an (z.B. `http://192.168.1.20:8080`). Damit öffnest du die Watchlist am Handy und legst sie über „Zum Home-Bildschirm“ wie eine App ab.

### Ohne eigenen Server (GitHub Pages)

Die App läuft auch rein statisch, z.B. unter `…github.io/<repo>/watchlist/`. Dann nimmt sie automatisch öffentliche
CORS-Proxys. Die funktionieren, sind aber manchmal langsam oder überlastet. Zuverlässiger ist ein eigener, kostenloser
Cloudflare-Worker (siehe `cloudflare-worker.js`). Dessen URL trägst du in den Einstellungen unter **Datenquelle → Eigene Proxy-URL** ein.

### Demo

`index.html?demo` zeigt die Oberfläche mit erfundenen Daten, also ohne Internet. Diese Kurse sind **nicht echt**.

## Symbole

| Was | Beispiel |
|---|---|
| Deutsche Aktie (XETRA) | `SAP.DE`, `RHM.DE`, `SIE.DE` |
| US-Aktie | `AAPL`, `NVDA`, `MSFT` |
| Index | `^GDAXI` (DAX), `^GSPC` (S&P 500), `^NDX` (Nasdaq 100), `^STOXX50E` |
| ETF | `EUNL.DE` (MSCI World), `URTH` |
| Rohstoff | `GC=F` (Gold), `BZ=F` (Brent) |
| Devisen / Krypto | `EURUSD=X`, `BTC-EUR` |

## Dateien

```
watchlist/
├── index.html               App
├── css/app.css              Design (hell/dunkel)
├── js/data.js               Datenabruf (Server / Proxy / Demo)
├── js/analytics.js          Performance-Berechnung
├── js/app.js                Oberfläche, Watchlist, Detailansicht
├── vendor/                  TradingView Lightweight Charts 4.2.3 (Apache-2.0)
├── server.js                lokaler Server + Yahoo-Weiterleitung (ohne Abhängigkeiten)
├── start-watchlist.command  Start per Doppelklick (macOS)
└── cloudflare-worker.js     optionaler Proxy für den Betrieb ohne Mac
```

Die Watchlists werden im Browser gespeichert (localStorage), nicht auf einem Server.

⚠️ Keine Anlageberatung. Kursdaten ohne Gewähr.
