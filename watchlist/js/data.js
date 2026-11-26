/* TradeGear Watchlist – Datenschicht (Yahoo Finance über eigenen Server / Proxy / Demo) */
(function () {
  'use strict';

  const YAHOO = 'https://query1.finance.yahoo.com';
  const PUBLIC_PROXIES = [
    'https://corsproxy.io/?url={url}',
    'https://api.allorigins.win/raw?url={url}',
    'https://api.codetabs.com/v1/proxy?quest={url}',
  ];

  let settings = { source: 'auto', proxyUrl: '' };
  let resolvedSource = null; // 'server' | 'proxy:<template>' | 'custom' | 'demo'
  let serverChecked = null;

  function configure(s) {
    const changed = s.source !== settings.source || s.proxyUrl !== settings.proxyUrl;
    settings = { source: s.source || 'auto', proxyUrl: s.proxyUrl || '' };
    if (changed) { resolvedSource = null; serverChecked = null; }
  }

  async function fetchJson(url, timeout = 12000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-store' });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) { /* ignore */ }
      const detail = body && (body.error && (body.error.description || body.error) || body.chart && body.chart.error && body.chart.error.description);
      const err = new Error(detail && typeof detail === 'string' ? `${detail} (HTTP ${res.status})` : `HTTP ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }
    return res.json();
  }

  async function hasServer() {
    if (serverChecked !== null) return serverChecked;
    if (location.protocol === 'file:') return (serverChecked = false);
    try {
      const j = await fetchJson('api/ping', 4000);
      serverChecked = !!(j && j.server === 'tradegear');
    } catch (_) { serverChecked = false; }
    return serverChecked;
  }

  function withProxy(tpl, url) { return tpl.replace('{url}', encodeURIComponent(url)); }

  // Führt eine Yahoo-Abfrage aus – über die passende Quelle
  async function yahooGet(apiPath, yahooPath) {
    const mode = settings.source;

    if (mode === 'server' || (mode === 'auto' && await hasServer())) {
      resolvedSource = 'server';
      return fetchJson(apiPath);
    }
    if (mode === 'custom') {
      if (!settings.proxyUrl) throw new Error('Keine Proxy-URL hinterlegt (Einstellungen)');
      resolvedSource = 'custom';
      const tpl = settings.proxyUrl.includes('{url}') ? settings.proxyUrl : settings.proxyUrl + (settings.proxyUrl.includes('?') ? '&' : '?') + 'url={url}';
      return fetchJson(withProxy(tpl, YAHOO + yahooPath));
    }
    // auto / proxy: öffentliche CORS-Proxys der Reihe nach
    const order = resolvedSource && resolvedSource.startsWith('proxy:')
      ? [resolvedSource.slice(6), ...PUBLIC_PROXIES.filter(p => 'proxy:' + p !== resolvedSource)]
      : PUBLIC_PROXIES;
    let lastErr;
    for (const tpl of order) {
      try {
        const j = await fetchJson(withProxy(tpl, YAHOO + yahooPath));
        resolvedSource = 'proxy:' + tpl;
        return j;
      } catch (e) {
        lastErr = e;
        if (e.status === 404 && e.body && e.body.chart) throw e; // Symbol existiert nicht
      }
    }
    throw lastErr || new Error('Keine Datenquelle erreichbar');
  }

  // ---- Normalisierung ------------------------------------------------------
  function normalizeChart(json, symbol) {
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    if (!r) {
      const msg = json && json.chart && json.chart.error && json.chart.error.description;
      throw new Error(msg || `Keine Daten für ${symbol}`);
    }
    const m = r.meta || {};
    const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const ts = r.timestamp || [];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close && q.close[i];
      if (c == null || !isFinite(c)) continue;
      bars.push({
        t: ts[i],
        o: q.open && q.open[i] != null ? q.open[i] : c,
        h: q.high && q.high[i] != null ? q.high[i] : c,
        l: q.low && q.low[i] != null ? q.low[i] : c,
        c,
        v: (q.volume && q.volume[i]) || 0,
      });
    }
    const tp = m.currentTradingPeriod && m.currentTradingPeriod.regular;
    return {
      symbol: m.symbol || symbol,
      name: m.longName || m.shortName || m.symbol || symbol,
      shortName: m.shortName || m.longName || symbol,
      currency: m.currency || '',
      exchange: m.fullExchangeName || m.exchangeName || '',
      type: m.instrumentType || '',
      price: m.regularMarketPrice != null ? m.regularMarketPrice : (bars.length ? bars[bars.length - 1].c : null),
      time: m.regularMarketTime || (bars.length ? bars[bars.length - 1].t : null),
      dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow,
      volume: m.regularMarketVolume,
      w52High: m.fiftyTwoWeekHigh, w52Low: m.fiftyTwoWeekLow,
      chartPrevClose: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose,
      gmtoffset: m.gmtoffset || 0,
      tz: m.exchangeTimezoneName || '',
      tradingStart: tp && tp.start, tradingEnd: tp && tp.end,
      bars,
    };
  }

  // Lokales Datum (Börsenzeitzone) als 'YYYY-MM-DD'
  function dayKey(t, off) { return new Date((t + (off || 0)) * 1000).toISOString().slice(0, 10); }

  // Vortagesschluss aus Tagesbalken bestimmen
  function prevCloseFrom(d) {
    const bars = d.bars;
    if (!bars.length) return d.chartPrevClose;
    const today = dayKey(d.time || bars[bars.length - 1].t, d.gmtoffset);
    for (let i = bars.length - 1; i >= 0; i--) {
      if (dayKey(bars[i].t, d.gmtoffset) < today) return bars[i].c;
    }
    return d.chartPrevClose;
  }

  // ---- Öffentliche API -----------------------------------------------------
  async function chart(symbol, range, interval) {
    if (settings.source === 'demo') { resolvedSource = 'demo'; return Demo.chart(symbol, range, interval); }
    const qs = `range=${range}&interval=${interval}`;
    const json = await yahooGet(
      `api/chart?symbol=${encodeURIComponent(symbol)}&${qs}`,
      `/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}&includePrePost=false&events=div%2Csplit`
    );
    return normalizeChart(json, symbol);
  }

  // Kurs + Vortag (leichtgewichtig)
  async function quote(symbol) {
    const d = await chart(symbol, '5d', '1d');
    const prev = prevCloseFrom(d);
    return {
      symbol: d.symbol, name: d.name, shortName: d.shortName, currency: d.currency, exchange: d.exchange,
      type: d.type, price: d.price, prevClose: prev, time: d.time,
      change: d.price != null && prev ? d.price - prev : null,
      changePct: d.price != null && prev ? (d.price / prev - 1) * 100 : null,
      dayHigh: d.dayHigh, dayLow: d.dayLow, volume: d.volume, w52High: d.w52High, w52Low: d.w52Low,
      tradingStart: d.tradingStart, tradingEnd: d.tradingEnd, gmtoffset: d.gmtoffset,
    };
  }

  async function search(q) {
    if (settings.source === 'demo') return Demo.search(q);
    const qs = `q=${encodeURIComponent(q)}`;
    const j = await yahooGet(`api/search?${qs}`, `/v1/finance/search?${qs}&quotesCount=10&newsCount=0&listsCount=0&lang=de-DE&region=DE`);
    return (j.quotes || []).filter(x => x.symbol).map(x => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
    }));
  }

  function sourceLabel() {
    if (!resolvedSource) return '–';
    if (resolvedSource === 'server') return 'Eigener Server';
    if (resolvedSource === 'custom') return 'Eigener Proxy';
    if (resolvedSource === 'demo') return 'Demo-Daten';
    try { return 'Öffentl. Proxy (' + new URL(resolvedSource.slice(6).replace('{url}', '')).host + ')'; } catch (_) { return 'Öffentl. Proxy'; }
  }

  // ---- Demo-Daten (offline, deterministisch) -------------------------------
  const Demo = (function () {
    const CATALOG = [
      ['^GDAXI', 'DAX', 19500, 'EUR', 'XETRA', 'INDEX'], ['^GSPC', 'S&P 500', 6000, 'USD', 'SNP', 'INDEX'],
      ['^NDX', 'NASDAQ 100', 21000, 'USD', 'NASDAQ', 'INDEX'], ['^DJI', 'Dow Jones Industrial Average', 44000, 'USD', 'DJI', 'INDEX'],
      ['^STOXX50E', 'EURO STOXX 50', 5000, 'EUR', 'STOXX', 'INDEX'], ['^MDAXI', 'MDAX', 27000, 'EUR', 'XETRA', 'INDEX'],
      ['URTH', 'iShares MSCI World ETF', 160, 'USD', 'NYSEArca', 'ETF'], ['^N225', 'Nikkei 225', 39000, 'JPY', 'Osaka', 'INDEX'],
      ['GC=F', 'Gold', 2700, 'USD', 'COMEX', 'FUTURE'], ['BZ=F', 'Brent Rohöl', 75, 'USD', 'NYMEX', 'FUTURE'],
      ['EURUSD=X', 'EUR/USD', 1.08, 'USD', 'CCY', 'CURRENCY'], ['BTC-EUR', 'Bitcoin EUR', 90000, 'EUR', 'CCC', 'CRYPTOCURRENCY'],
      ['AAPL', 'Apple Inc.', 230, 'USD', 'NASDAQ', 'EQUITY'], ['MSFT', 'Microsoft Corporation', 420, 'USD', 'NASDAQ', 'EQUITY'],
      ['NVDA', 'NVIDIA Corporation', 140, 'USD', 'NASDAQ', 'EQUITY'], ['AMZN', 'Amazon.com, Inc.', 200, 'USD', 'NASDAQ', 'EQUITY'],
      ['SAP.DE', 'SAP SE', 240, 'EUR', 'XETRA', 'EQUITY'], ['SIE.DE', 'Siemens AG', 190, 'EUR', 'XETRA', 'EQUITY'],
      ['RHM.DE', 'Rheinmetall AG', 1500, 'EUR', 'XETRA', 'EQUITY'], ['ALV.DE', 'Allianz SE', 300, 'EUR', 'XETRA', 'EQUITY'],
      ['TSLA', 'Tesla, Inc.', 330, 'USD', 'NASDAQ', 'EQUITY'], ['MBG.DE', 'Mercedes-Benz Group AG', 60, 'EUR', 'XETRA', 'EQUITY'],
    ];
    const bySym = Object.fromEntries(CATALOG.map(c => [c[0], c]));
    function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
    function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function info(sym) {
      const c = bySym[sym];
      if (c) return { name: c[1], base: c[2], cur: c[3], ex: c[4], type: c[5] };
      return { name: sym, base: 20 + hash(sym) % 400, cur: /\.DE$/.test(sym) ? 'EUR' : 'USD', ex: 'DEMO', type: 'EQUITY' };
    }
    // Tagesreihe über 12 Jahre, endet heute bei "base"
    const cacheDaily = {};
    function daily(sym) {
      if (cacheDaily[sym]) return cacheDaily[sym];
      const inf = info(sym), r = rng(hash(sym));
      const now = new Date(); now.setUTCHours(0, 0, 0, 0);
      const days = [];
      for (let d = new Date(now.getTime() - 12 * 365 * 864e5); d <= now; d = new Date(d.getTime() + 864e5)) {
        const wd = d.getUTCDay();
        if (inf.type !== 'CRYPTOCURRENCY' && (wd === 0 || wd === 6)) continue;
        days.push(d.getTime() / 1000);
      }
      const drift = 0.0003 + (r() - 0.4) * 0.0006, vol = inf.type === 'CURRENCY' ? 0.004 : inf.type === 'CRYPTOCURRENCY' ? 0.03 : 0.013;
      let p = 1; const closes = [];
      for (let i = 0; i < days.length; i++) { p *= Math.exp(drift + vol * (r() + r() + r() - 1.5) * 1.4); closes.push(p); }
      const k = inf.base / closes[closes.length - 1];
      const bars = days.map((t, i) => {
        const c = closes[i] * k, o = (i ? closes[i - 1] * k : c) * (1 + (r() - 0.5) * vol * 0.4);
        return { t: t + 15 * 3600, o, h: Math.max(o, c) * (1 + r() * vol * 0.6), l: Math.min(o, c) * (1 - r() * vol * 0.6), c, v: Math.round(1e6 * (0.5 + r())) };
      });
      // leichte Live-Bewegung je Aufruf
      return (cacheDaily[sym] = bars);
    }
    function live(sym, bars) {
      const last = bars[bars.length - 1];
      const wiggle = 1 + Math.sin(Date.now() / 60000 + hash(sym)) * 0.002;
      return { ...last, c: last.c * wiggle, h: Math.max(last.h, last.c * wiggle), l: Math.min(last.l, last.c * wiggle) };
    }
    function aggregate(bars, keyFn) {
      const out = []; let cur = null, ck = null;
      for (const b of bars) {
        const k = keyFn(b.t);
        if (k !== ck) { if (cur) out.push(cur); cur = { ...b }; ck = k; }
        else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
      }
      if (cur) out.push(cur);
      return out;
    }
    async function chart(sym, range, interval) {
      await new Promise(r => setTimeout(r, 80 + Math.random() * 150));
      if (/[^A-Z0-9.^=\-]/i.test(sym) || sym === 'XXXX') throw new Error(`Symbol ${sym} nicht gefunden`);
      const inf = info(sym);
      let bars = daily(sym).slice();
      bars[bars.length - 1] = live(sym, bars);
      const lastT = bars[bars.length - 1].t;
      const back = { '1d': 1, '5d': 7, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653, 'max': 1e6 }[range] || 366;
      if (/m$/.test(interval)) {
        // Intraday synthetisch aus Tagesbalken
        const step = parseInt(interval, 10) * 60, r = rng(hash(sym + interval));
        const n = range === '1d' ? 1 : 5, src = bars.slice(-n), out = [];
        for (const b of src) {
          const open = b.t - 6.5 * 3600, cnt = Math.floor(8.5 * 3600 / step); let p = b.o;
          for (let i = 0; i < cnt; i++) {
            const target = b.o + (b.c - b.o) * (i + 1) / cnt;
            p = p + (target - p) * 0.3 + p * 0.0015 * (r() - 0.5) * 2;
            out.push({ t: open + i * step, o: p, h: p * 1.0008, l: p * 0.9992, c: p, v: 1000 });
          }
          out[out.length - 1].c = b.c;
        }
        bars = out;
      } else {
        bars = bars.filter(b => b.t >= lastT - back * 864e2);
        if (interval === '1wk') bars = aggregate(bars, t => Math.floor((t / 864e2 + 3) / 7));
        if (interval === '1mo') bars = aggregate(bars, t => new Date(t * 1000).toISOString().slice(0, 7));
      }
      const last = bars[bars.length - 1];
      const nowS = Math.floor(Date.now() / 1000), dayStart = nowS - nowS % 86400;
      return {
        symbol: sym, name: inf.name, shortName: inf.name, currency: inf.cur, exchange: inf.ex, type: inf.type,
        price: last.c, time: last.t, dayHigh: last.h, dayLow: last.l, volume: last.v,
        w52High: Math.max(...daily(sym).slice(-252).map(b => b.h)), w52Low: Math.min(...daily(sym).slice(-252).map(b => b.l)),
        chartPrevClose: null, gmtoffset: 0, tz: 'UTC', tradingStart: dayStart + 8 * 3600, tradingEnd: dayStart + 22 * 3600, bars,
      };
    }
    async function search(q) {
      const s = q.toLowerCase();
      return CATALOG.filter(c => c[0].toLowerCase().includes(s) || c[1].toLowerCase().includes(s))
        .slice(0, 10).map(c => ({ symbol: c[0], name: c[1], exchange: c[4], type: c[5] }));
    }
    return { chart, search };
  })();

  window.TGData = { configure, chart, quote, search, sourceLabel, dayKey, prevCloseFrom, hasServer };
})();
