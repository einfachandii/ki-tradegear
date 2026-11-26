#!/usr/bin/env node
/**
 * TradeGear Watchlist – kleiner lokaler Server (ohne Abhängigkeiten, Node 18+)
 *
 *  - liefert die Web-App aus (dieser Ordner)
 *  - leitet Kursabfragen an Yahoo Finance weiter (Browser dürfen Yahoo wegen CORS
 *    nicht direkt abfragen) und cached die Antworten kurz
 *
 * Start:  node server.js            → http://localhost:8080
 *         PORT=3000 node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---- Cache ---------------------------------------------------------------
const cache = new Map(); // key -> { expires, status, body }
function ttlFor(range, interval) {
  if (range === 'max' || range === '10y' || range === '5y') return 15 * 60e3;
  if (interval && /m$/.test(interval)) return 45e3; // Intraday
  return 60e3;
}
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit;
  if (hit) cache.delete(key);
  return null;
}
function cacheSet(key, status, body, ttl) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { expires: Date.now() + ttl, status, body });
}

// ---- Yahoo ---------------------------------------------------------------
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
async function yahoo(pathAndQuery) {
  let lastErr;
  for (const h of HOSTS) {
    try {
      const res = await fetch(`https://${h}${pathAndQuery}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      return { status: res.status, body };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Yahoo nicht erreichbar');
}

const SAFE_SYMBOL = /^[A-Za-z0-9.^=\-_]{1,20}$/;
const SAFE_RANGE = /^(1d|5d|1mo|3mo|6mo|ytd|1y|2y|5y|10y|max)$/;
const SAFE_INTERVAL = /^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/;

async function handleApi(req, res, url) {
  try {
    if (url.pathname === '/api/ping') return send(res, 200, '{"ok":true,"server":"tradegear"}', 'application/json');

    if (url.pathname === '/api/chart') {
      const symbol = url.searchParams.get('symbol') || '';
      const range = url.searchParams.get('range') || '1y';
      const interval = url.searchParams.get('interval') || '1d';
      if (!SAFE_SYMBOL.test(symbol) || !SAFE_RANGE.test(range) || !SAFE_INTERVAL.test(interval)) {
        return send(res, 400, '{"error":"ungültige Parameter"}', 'application/json');
      }
      const key = `chart:${symbol}:${range}:${interval}`;
      let hit = cacheGet(key);
      if (!hit) {
        const q = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
        const r = await yahoo(q);
        cacheSet(key, r.status, r.body, r.status === 200 ? ttlFor(range, interval) : 30e3);
        hit = cacheGet(key) || r;
      }
      return send(res, hit.status, hit.body, 'application/json');
    }

    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').slice(0, 60);
      if (!q.trim()) return send(res, 200, '{"quotes":[]}', 'application/json');
      const key = `search:${q.toLowerCase()}`;
      let hit = cacheGet(key);
      if (!hit) {
        const r = await yahoo(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&lang=de-DE&region=DE`);
        cacheSet(key, r.status, r.body, 10 * 60e3);
        hit = cacheGet(key) || r;
      }
      return send(res, hit.status, hit.body, 'application/json');
    }

    send(res, 404, '{"error":"unbekannter Endpunkt"}', 'application/json');
  } catch (e) {
    send(res, 502, JSON.stringify({ error: String(e && e.message || e) }), 'application/json');
  }
}

// ---- Static files ----------------------------------------------------------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 403, 'Forbidden');
  if (path.basename(file).startsWith('.')) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(req, res, url);
}).listen(PORT, HOST, () => {
  console.log(`\n  📈 TradeGear Watchlist läuft:\n`);
  console.log(`     Lokal:     http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`     Im WLAN:   http://${a.address}:${PORT}   (z.B. am Handy)`);
    }
  }
  console.log(`\n  Beenden mit Strg+C\n`);
});
