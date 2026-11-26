/* TradeGear Watchlist – App */
(function () {
  'use strict';
  const D = window.TGData, A = window.TGAnalytics;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ======================================================================
  // Zustand & Speicherung
  // ======================================================================
  const STORE_KEY = 'tradegear-watchlist-v1';
  const EXTRA_COLS = [
    { id: '1W', label: '1W', title: '1 Woche' },
    { id: '1M', label: '1M', title: '1 Monat' },
    { id: 'YTD', label: 'YTD', title: 'Seit Jahresbeginn' },
    { id: '1J', label: '1J', title: '1 Jahr' },
  ];
  const sec = title => ({ type: 'section', id: uid(), title, collapsed: false });
  const sym = s => ({ type: 'symbol', symbol: s });

  function defaultState() {
    return {
      lists: [
        {
          id: uid(), name: 'Meine Watchlist', items: [
            sec('Indizes'), ...['^GDAXI', '^MDAXI', '^STOXX50E', '^GSPC', '^NDX', '^DJI', '^N225'].map(sym),
            sec('Rohstoffe, Devisen & Krypto'), ...['GC=F', 'BZ=F', 'EURUSD=X', 'BTC-EUR'].map(sym),
            sec('Aktien'), ...['SAP.DE', 'SIE.DE', 'RHM.DE', 'ALV.DE', 'AAPL', 'MSFT', 'NVDA', 'AMZN'].map(sym),
          ],
        },
        { id: uid(), name: 'Musterdepot KI', items: ['RHM.DE', 'NDX1.DE', 'NVDA', 'MSFT', 'ALV.DE', 'ERIC-B.ST'].map(sym) },
      ],
      activeId: null,
      selected: null,
      sort: { key: null, dir: 0 },
      chartRange: '1J',
      chartType: 'area',
      settings: { refreshMin: 2, columns: ['YTD'], source: 'auto', proxyUrl: '', theme: null },
    };
  }

  let state;
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { state = null; }
  if (!state || !Array.isArray(state.lists) || !state.lists.length) state = defaultState();
  const defs = defaultState();
  state.settings = Object.assign({}, defs.settings, state.settings || {});
  state.sort = state.sort || defs.sort;
  state.chartRange = state.chartRange || '1J';
  state.chartType = state.chartType || 'area';
  if (!state.lists.find(l => l.id === state.activeId)) state.activeId = state.lists[0].id;

  // URL-Parameter ?demo erzwingt Demo-Daten (zum Ausprobieren)
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) state.settings.source = 'demo';

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* privat / voll */ }
  }
  const activeList = () => state.lists.find(l => l.id === state.activeId) || state.lists[0];
  const listSymbols = (l = activeList()) => [...new Set(l.items.filter(i => i.type === 'symbol').map(i => i.symbol))];

  // Laufzeit-Caches
  const quotes = new Map();   // symbol -> quote
  const qErrors = new Map();  // symbol -> message
  const ext = new Map();      // symbol -> { bars, off, at }
  const detailCache = new Map(); // symbol -> { daily, monthly, at }
  const intraCache = new Map();  // key -> { data, at }
  let lastPrices = new Map();
  let lastUpdate = null, nextUpdate = null, refreshing = false, lastError = null;

  // ======================================================================
  // Formatierung
  // ======================================================================
  const NICE = {
    '^GDAXI': 'DAX', '^MDAXI': 'MDAX', '^SDAXI': 'SDAX', '^TECDAX': 'TecDAX', '^GSPC': 'S&P 500', '^NDX': 'Nasdaq 100',
    '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^STOXX50E': 'Euro Stoxx 50', '^STOXX': 'Stoxx 600', '^N225': 'Nikkei 225',
    '^FTSE': 'FTSE 100', '^FCHI': 'CAC 40', '^HSI': 'Hang Seng', '^RUT': 'Russell 2000', '^VIX': 'VIX', '^ATX': 'ATX', '^SSMI': 'SMI',
    'GC=F': 'Gold', 'SI=F': 'Silber', 'BZ=F': 'Brent Öl', 'CL=F': 'WTI Öl', 'NG=F': 'Erdgas', 'HG=F': 'Kupfer',
    'EURUSD=X': 'EUR/USD', 'EURCHF=X': 'EUR/CHF', 'EURGBP=X': 'EUR/GBP', 'EURJPY=X': 'EUR/JPY', 'USDJPY=X': 'USD/JPY',
    'BTC-EUR': 'Bitcoin', 'BTC-USD': 'Bitcoin $', 'ETH-EUR': 'Ethereum', 'ETH-USD': 'Ethereum $',
  };
  function displaySym(item) {
    if (item.label) return item.label;
    return NICE[item.symbol] || item.symbol.replace(/^\^/, '');
  }
  function decimals(v, symbol) {
    if (v == null) return 2;
    if (/=X$/.test(symbol || '')) return 4;
    const a = Math.abs(v);
    return a < 1 ? 4 : a < 10 ? 3 : 2;
  }
  const nfCache = {};
  function nf(d) { return nfCache[d] || (nfCache[d] = new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })); }
  function fmtPrice(v, symbol) { return v == null || !isFinite(v) ? '—' : nf(decimals(v, symbol)).format(v); }
  function fmtChg(v, symbol, ref) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(decimals(ref != null ? ref : v, symbol)).format(Math.abs(v)); }
  function fmtPct(v, space) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(2).format(Math.abs(v)) + (space ? ' %' : '%'); }
  const cls = v => v == null || !isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';
  function fmtVol(v) {
    if (!v) return '—';
    if (v >= 1e9) return nf(2).format(v / 1e9) + ' Mrd.';
    if (v >= 1e6) return nf(2).format(v / 1e6) + ' Mio.';
    if (v >= 1e3) return nf(1).format(v / 1e3) + ' Tsd.';
    return String(v);
  }
  const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
  const dtFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function logoHtml(item) {
    const label = displaySym(item).replace(/[^A-Za-z0-9ÄÖÜäöü]/g, '');
    const txt = (label.slice(0, 2) || '?').toUpperCase();
    return `<span class="logo" style="background:hsl(${hue(item.symbol)} 55% 45%)">${esc(txt)}</span>`;
  }
  function isOpen(q) {
    if (!q || !q.tradingStart || !q.tradingEnd) return false;
    const now = Date.now() / 1000;
    return now >= q.tradingStart && now <= q.tradingEnd;
  }
  const TYPE_DE = { EQUITY: 'Aktie', INDEX: 'Index', ETF: 'ETF', FUTURE: 'Future', CURRENCY: 'Devisen', CRYPTOCURRENCY: 'Krypto', MUTUALFUND: 'Fonds' };

  // ======================================================================
  // Theme
  // ======================================================================
  function applyTheme() {
    const t = state.settings.theme;
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const dark = isDark();
    $('meta[name=theme-color]').setAttribute('content', dark ? '#131722' : '#ffffff');
    if (chartState.chart) chartState.chart.applyOptions(chartOptions());
    if (chartState.series) applySeriesColors();
  }
  function isDark() {
    const t = state.settings.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  $('#btnTheme').addEventListener('click', () => {
    state.settings.theme = isDark() ? 'light' : 'dark';
    save(); applyTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ======================================================================
  // Toast & Dialoge
  // ======================================================================
  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (action ? ` <button class="btn ghost" style="margin-left:10px;padding:2px 10px;color:inherit;border-color:currentColor">${esc(action.label)}</button>` : '');
    el.hidden = false;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3000);
  }

  function prompt(title, { text = '', value = '', placeholder = '', okLabel = 'OK', input = true, danger = false } = {}) {
    return new Promise(resolve => {
      const dlg = $('#dlgPrompt');
      $('#promptTitle').textContent = title;
      $('#promptText').textContent = text;
      const inp = $('#promptInput');
      inp.hidden = !input; inp.value = value; inp.placeholder = placeholder;
      const ok = $('#promptOk');
      ok.textContent = okLabel;
      ok.style.background = danger ? 'var(--down)' : '';
      ok.style.borderColor = danger ? 'var(--down)' : '';
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? (input ? inp.value.trim() : true) : null);
      dlg.showModal();
      if (input) { inp.focus(); inp.select(); }
    });
  }
  const confirmBox = (title, text, okLabel = 'Löschen') => prompt(title, { text, input: false, okLabel, danger: true });

  // Popup-Menü
  const menu = $('#menu');
  function openMenu(anchor, entries, at) {
    menu.innerHTML = '';
    for (const e of entries) {
      if (e === '-') { menu.appendChild(document.createElement('hr')); continue; }
      if (e.label && !e.fn) { const d = document.createElement('div'); d.className = 'menu-label'; d.textContent = e.label; menu.appendChild(d); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = esc(e.text) + (e.count != null ? `<span class="cnt">${e.count}</span>` : '');
      if (e.on) b.classList.add('on');
      if (e.danger) b.classList.add('danger');
      b.onclick = () => { closeMenu(); e.fn(); };
      menu.appendChild(b);
    }
    menu.hidden = false;
    const r = at || anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = at ? r.left : r.right - mw, top = at ? r.top : r.bottom + 4;
    if (!at && anchor.id === 'btnLists') left = r.left;
    left = Math.max(8, Math.min(left, innerWidth - mw - 8));
    if (top + mh > innerHeight - 8) top = Math.max(8, (at ? r.top : r.top - 4) - mh);
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outside, { once: true }), 0);
    function outside(ev) { if (!menu.contains(ev.target)) closeMenu(); else document.addEventListener('pointerdown', outside, { once: true }); }
  }
  function closeMenu() { menu.hidden = true; }
  addEventListener('resize', closeMenu);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  // ======================================================================
  // Watchlist rendern
  // ======================================================================
  const wlBody = $('#wlBody'), wlCols = $('#wlCols'), wlEl = $('#wl');
  let editing = false;

  function columns() {
    const extra = EXTRA_COLS.filter(c => state.settings.columns.includes(c.id));
    const narrow = innerWidth < 420 && extra.length > 0;
    const cols = [
      { key: 'sym', label: 'Symbol', w: 'minmax(0,1fr)' },
      { key: 'price', label: 'Kurs', w: '78px' },
      ...(narrow ? [] : [{ key: 'chg', label: 'Änd.', w: '64px' }]),
      { key: 'chgPct', label: 'Änd. %', w: '64px' },
      ...extra.map(c => ({ key: 'x:' + c.id, label: c.label, title: c.title, w: '58px' })),
    ];
    return cols;
  }

  function sortValue(item, key) {
    const q = quotes.get(item.symbol);
    if (key === 'sym') return displaySym(item).toLowerCase();
    if (!q) return null;
    if (key === 'price') return q.price;
    if (key === 'chg') return q.change;
    if (key === 'chgPct') return q.changePct;
    if (key.startsWith('x:')) { const p = extPerf(item.symbol); return p && p[key.slice(2)] ? p[key.slice(2)].pct : null; }
    return null;
  }

  function extPerf(symbol) {
    const e = ext.get(symbol); if (!e) return null;
    const q = quotes.get(symbol);
    return A.performance(e.bars, e.off, q ? q.price : null);
  }

  function renderHeader() {
    const cols = columns();
    wlEl.style.setProperty('--cols', cols.map(c => c.w).join(' '));
    wlEl.classList.toggle('wide', cols.length === 5 || cols.length === 6);
    wlEl.classList.toggle('wider', cols.length > 6);
    wlEl.classList.toggle('editing', editing);
    wlCols.style.paddingLeft = editing ? '44px' : '';
    wlCols.style.paddingRight = editing ? '48px' : '';
    wlCols.innerHTML = cols.map(c => {
      const sorted = state.sort.key === c.key;
      const arrow = sorted ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return `<div data-key="${c.key}" class="${sorted ? 'sorted' : ''}" title="${esc(c.title || c.label)} – klicken zum Sortieren">${esc(c.label)}${arrow}</div>`;
    }).join('');
    $('#listName').textContent = activeList().name;
  }

  wlCols.addEventListener('click', e => {
    const k = e.target.closest('[data-key]'); if (!k) return;
    const key = k.dataset.key;
    const first = key === 'sym' ? 1 : -1;
    if (state.sort.key !== key) state.sort = { key, dir: first };
    else if (state.sort.dir === first) state.sort.dir = -first;
    else state.sort = { key: null, dir: 0 };
    save(); render();
  });

  // Reihenfolge der Darstellung (inkl. Sortierung innerhalb von Abschnitten)
  function viewOrder(list) {
    const groups = [{ head: null, rows: [] }];
    list.items.forEach((it, idx) => {
      if (it.type === 'section') groups.push({ head: { it, idx }, rows: [] });
      else groups[groups.length - 1].rows.push({ it, idx });
    });
    if (state.sort.key) {
      const { key, dir } = state.sort;
      for (const g of groups) {
        g.rows.sort((a, b) => {
          const va = sortValue(a.it, key), vb = sortValue(b.it, key);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
        });
      }
    }
    return groups;
  }

  const ICON_HANDLE = '<svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function rowHtml(it, idx, cols) {
    const q = quotes.get(it.symbol), err = qErrors.get(it.symbol);
    const sel = state.selected === it.symbol ? ' selected' : '';
    const name = q ? q.shortName || q.name : (err ? 'Fehler beim Laden' : '');
    const cells = cols.slice(1).map(c => {
      if (!q) return `<div class="c ${err ? 'err' : ''}">${err ? '—' : '<span class="skeleton">00,00</span>'}</div>`;
      switch (c.key) {
        case 'price': {
          const prev = lastPrices.get(it.symbol);
          const flash = prev != null && q.price != null && prev !== q.price ? (q.price > prev ? ' flash-up' : ' flash-down') : '';
          return `<div class="c price${flash}">${fmtPrice(q.price, it.symbol)}</div>`;
        }
        case 'chg': return `<div class="c ${cls(q.change)}">${fmtChg(q.change, it.symbol, q.price)}</div>`;
        case 'chgPct': return `<div class="c ${cls(q.changePct)}">${fmtPct(q.changePct)}</div>`;
        default: {
          const p = extPerf(it.symbol), v = p && p[c.key.slice(2)];
          if (!ext.has(it.symbol)) return `<div class="c"><span class="skeleton">+0,0%</span></div>`;
          return `<div class="c ${cls(v && v.pct)}">${v ? fmtPct(v.pct) : '—'}</div>`;
        }
      }
    }).join('');
    return `<div class="row${sel}" data-idx="${idx}" data-sym="${esc(it.symbol)}" title="${esc(it.symbol)}${q ? ' · ' + esc(q.name) : ''}">
      <button class="handle" type="button" aria-label="Verschieben">${ICON_HANDLE}</button>
      <div class="sym">${logoHtml(it)}<div class="sym-text"><b>${esc(displaySym(it))}${q ? `<i class="mkt${isOpen(q) ? ' open' : ''}" title="${isOpen(q) ? 'Markt geöffnet' : 'Markt geschlossen'}"></i>` : ''}</b><small>${esc(name)}</small></div></div>
      ${cells}
      <button class="del" type="button" aria-label="Entfernen" title="Entfernen">${ICON_DEL}</button>
    </div>`;
  }

  function render() {
    if (drag && drag.started) return;
    renderHeader();
    const list = activeList(), cols = columns();
    if (!list.items.length) {
      wlBody.innerHTML = `<div class="wl-empty">Diese Watchlist ist leer.<br><button class="btn primary" type="button" id="emptyAdd">Symbol hinzufügen</button></div>`;
      $('#emptyAdd').onclick = openAdd;
      renderFoot();
      return;
    }
    let html = '';
    for (const g of viewOrder(list)) {
      if (g.head) {
        const s = g.head.it;
        html += `<div class="section${s.collapsed ? ' collapsed' : ''}" data-idx="${g.head.idx}">
          <button class="handle" type="button" aria-label="Abschnitt verschieben">${ICON_HANDLE}</button>
          ${ICON_CHEV}<span class="title">${esc(s.title)}</span><span class="count">${g.rows.length}</span>
          <button class="del" type="button" aria-label="Abschnitt löschen" title="Abschnitt löschen">${ICON_DEL}</button>
        </div>`;
        if (s.collapsed) continue;
      }
      for (const r of g.rows) html += rowHtml(r.it, r.idx, cols);
    }
    wlBody.innerHTML = html;
    lastPrices = new Map([...quotes].map(([k, q]) => [k, q.price]));
    renderFoot();
  }

  function renderFoot() {
    const n = listSymbols().length;
    $('#wlFoot').innerHTML = `<span>${n} ${n === 1 ? 'Wert' : 'Werte'}${state.sort.key ? ' · sortiert' : ''}</span><span>Kurse verzögert · Yahoo Finance</span>`;
  }

  // Klicks in der Liste
  let suppressClick = 0;
  wlBody.addEventListener('click', async e => {
    if (Date.now() < suppressClick) return;
    const del = e.target.closest('.del');
    const row = e.target.closest('.row'), section = e.target.closest('.section');
    if (e.target.closest('.handle')) return;
    if (del && row) return removeItem(+row.dataset.idx);
    if (del && section) {
      const s = activeList().items[+section.dataset.idx];
      if (await confirmBox('Abschnitt löschen?', `„${s.title}“ wird entfernt. Die Symbole darin bleiben in der Liste.`)) {
        activeList().items.splice(+section.dataset.idx, 1); save(); render();
      }
      return;
    }
    if (section) {
      const s = activeList().items[+section.dataset.idx];
      if (editing && e.target.closest('.title')) {
        const t = await prompt('Abschnitt umbenennen', { value: s.title });
        if (t) { s.title = t; save(); render(); }
        return;
      }
      s.collapsed = !s.collapsed; save(); render(); return;
    }
    if (row) {
      if (editing) return rowMenu(row, e);
      selectSymbol(row.dataset.sym);
    }
  });
  wlBody.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row'); if (!row) return;
    e.preventDefault(); rowMenu(row, e);
  });

  function rowMenu(row, e) {
    const idx = +row.dataset.idx, list = activeList(), it = list.items[idx];
    const sections = list.items.map((x, i) => ({ x, i })).filter(o => o.x.type === 'section');
    const entries = [
      { label: displaySym(it) + ' · ' + it.symbol },
      { text: 'Details öffnen', fn: () => selectSymbol(it.symbol) },
      { text: 'Anzeigenamen ändern…', fn: async () => {
        const t = await prompt('Anzeigename', { text: `Eigener Name für ${it.symbol} (leer = Standard)`, value: it.label || '' });
        if (t !== null) { it.label = t || undefined; save(); render(); if (state.selected === it.symbol) renderDetailInfo(); }
      } },
      { text: 'Ganz nach oben', fn: () => moveBlock(idx, 0) },
    ];
    if (sections.length) {
      entries.push('-', { label: 'Verschieben nach' });
      for (const s of sections) entries.push({ text: s.x.title, fn: () => moveBlock(idx, s.i + 1) });
    }
    if (state.lists.length > 1) {
      entries.push('-', { label: 'Kopieren in Liste' });
      for (const l of state.lists) if (l.id !== list.id) entries.push({ text: l.name, fn: () => {
        if (!l.items.some(x => x.symbol === it.symbol)) { l.items.push(sym(it.symbol)); save(); toast(`${displaySym(it)} zu „${l.name}“ hinzugefügt`); }
        else toast(`${displaySym(it)} ist schon in „${l.name}“`);
      } });
    }
    entries.push('-', { text: 'Entfernen', danger: true, fn: () => removeItem(idx) });
    openMenu(row, entries, { left: e.clientX, top: e.clientY });
  }

  function removeItem(idx) {
    const list = activeList(), it = list.items[idx];
    list.items.splice(idx, 1); save(); render();
    toast(`${displaySym(it)} entfernt`, { label: 'Rückgängig', fn: () => { list.items.splice(idx, 0, it); save(); render(); } });
    if (state.selected === it.symbol && !list.items.some(x => x.symbol === it.symbol)) closeDetail();
  }

  // Block verschieben (Abschnitt inkl. Inhalt oder ein Symbol); target = Index, vor dem eingefügt wird
  function moveBlock(from, target) {
    const items = activeList().items;
    let end = from + 1;
    if (items[from].type === 'section') while (end < items.length && items[end].type !== 'section') end++;
    if (target >= from && target <= end) return false;
    const block = items.splice(from, end - from);
    if (target > from) target -= block.length;
    items.splice(target, 0, ...block);
    save(); render();
    return true;
  }

  // ---- Drag & Drop (Maus: ganze Zeile, Touch: Griff im Bearbeiten-Modus) ----
  let drag = null;
  wlBody.addEventListener('pointerdown', e => {
    const el = e.target.closest('.row, .section');
    if (!el || e.target.closest('.del') || e.button !== 0) return;
    const onHandle = !!e.target.closest('.handle');
    if (e.pointerType !== 'mouse' && !onHandle) return;
    if (state.sort.key) {
      if (onHandle) toast('Sortierung aktiv – Spaltenkopf erneut klicken, um manuell anzuordnen');
      return;
    }
    if (onHandle) e.preventDefault();
    drag = { el, idx: +el.dataset.idx, y0: e.clientY, s0: wlBody.scrollTop, started: false, id: e.pointerId };
    addEventListener('pointermove', onDragMove, { passive: false });
    addEventListener('pointerup', onDragEnd);
    addEventListener('pointercancel', onDragEnd);
  });

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.started) {
      if (Math.abs(dy) < 6) return;
      drag.started = true;
      drag.el.classList.add('dragging');
      const bodyTop = wlBody.getBoundingClientRect().top;
      drag.others = [...wlBody.querySelectorAll('.row, .section')].filter(x => x !== drag.el).map(x => {
        const r = x.getBoundingClientRect();
        return { idx: +x.dataset.idx, top: r.top - bodyTop + wlBody.scrollTop, bottom: r.bottom - bodyTop + wlBody.scrollTop };
      });
      drag.line = document.createElement('div');
      drag.line.className = 'drop-line';
      Object.assign(drag.line.style, { position: 'absolute', left: 0, right: 0, pointerEvents: 'none' });
      wlBody.style.position = 'relative';
      wlBody.appendChild(drag.line);
    }
    e.preventDefault();
    const br = wlBody.getBoundingClientRect();
    if (e.clientY < br.top + 30) wlBody.scrollTop -= 8;
    else if (e.clientY > br.bottom - 30) wlBody.scrollTop += 8;
    drag.el.style.transform = `translateY(${dy + wlBody.scrollTop - drag.s0}px)`;
    const y = e.clientY - br.top + wlBody.scrollTop;
    let k = drag.others.findIndex(o => y < (o.top + o.bottom) / 2);
    if (k < 0) k = drag.others.length;
    drag.k = k;
    const lineY = k < drag.others.length ? drag.others[k].top : (drag.others.length ? drag.others[drag.others.length - 1].bottom : 0);
    drag.line.style.top = (lineY - 1) + 'px';
  }

  function onDragEnd(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    removeEventListener('pointermove', onDragMove);
    removeEventListener('pointerup', onDragEnd);
    removeEventListener('pointercancel', onDragEnd);
    const d = drag; drag = null;
    if (!d.started) return;
    suppressClick = Date.now() + 250;
    if (d.line) d.line.remove();
    d.el.classList.remove('dragging'); d.el.style.transform = '';
    if (e.type === 'pointercancel' || d.k == null) return render();
    const target = d.k < d.others.length ? d.others[d.k].idx : activeList().items.length;
    if (!moveBlock(d.idx, target)) render();
  }

  // Bearbeiten-Modus
  $('#btnEdit').addEventListener('click', () => {
    editing = !editing;
    $('#btnEdit').classList.toggle('on', editing);
    render();
    if (editing) toast('Bearbeiten: Griff ziehen zum Sortieren, ✕ zum Löschen, Zeile antippen für mehr');
  });

  // Tastatur: Pfeiltasten wechseln die Auswahl
  addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea, dialog') || document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...wlBody.querySelectorAll('.row')];
      if (!rows.length) return;
      let i = rows.findIndex(r => r.dataset.sym === state.selected);
      i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      e.preventDefault();
      selectSymbol(rows[i].dataset.sym);
      rows[i].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Delete' && state.selected) {
      const idx = activeList().items.findIndex(x => x.symbol === state.selected);
      if (idx >= 0) removeItem(idx);
    }
  });

  // ======================================================================
  // Listen-Verwaltung
  // ======================================================================
  $('#btnLists').addEventListener('click', e => {
    const l = activeList();
    openMenu(e.currentTarget, [
      { label: 'Watchlists' },
      ...state.lists.map(x => ({ text: x.name, on: x.id === l.id, count: listSymbols(x).length, fn: () => switchList(x.id) })),
      '-',
      { text: 'Neue Watchlist…', fn: async () => {
        const n = await prompt('Neue Watchlist', { placeholder: 'Name, z.B. Tech-Werte' });
        if (n) { const nl = { id: uid(), name: n, items: [] }; state.lists.push(nl); switchList(nl.id); }
      } },
      { text: 'Umbenennen…', fn: async () => {
        const n = await prompt('Watchlist umbenennen', { value: l.name });
        if (n) { l.name = n; save(); render(); }
      } },
      { text: 'Kopie erstellen', fn: () => {
        const nl = { id: uid(), name: l.name + ' (Kopie)', items: JSON.parse(JSON.stringify(l.items)) };
        state.lists.push(nl); switchList(nl.id);
      } },
      { text: 'Watchlist löschen…', danger: true, fn: async () => {
        if (state.lists.length < 2) return toast('Die letzte Watchlist kann nicht gelöscht werden');
        if (await confirmBox('Watchlist löschen?', `„${l.name}“ mit ${listSymbols(l).length} Werten wird endgültig gelöscht.`)) {
          state.lists = state.lists.filter(x => x.id !== l.id); switchList(state.lists[0].id);
        }
      } },
    ]);
  });

  function switchList(id) {
    state.activeId = id; save(); render();
    refreshAll(true);
  }

  $('#btnMore').addEventListener('click', e => {
    openMenu(e.currentTarget, [
      { text: 'Symbol hinzufügen…', fn: openAdd },
      { text: 'Abschnitt hinzufügen…', fn: async () => {
        const t = await prompt('Neuer Abschnitt', { placeholder: 'z.B. Halbleiter' });
        if (t) { activeList().items.push(sec(t)); save(); render(); wlBody.scrollTop = wlBody.scrollHeight; }
      } },
      ...(state.sort.key ? [{ text: 'Sortierung aufheben', fn: () => { state.sort = { key: null, dir: 0 }; save(); render(); } }] : []),
      { text: 'Alle Abschnitte ein-/ausklappen', fn: () => {
        const ss = activeList().items.filter(x => x.type === 'section');
        const anyOpen = ss.some(s => !s.collapsed);
        ss.forEach(s => { s.collapsed = anyOpen; }); save(); render();
      } },
      '-',
      { text: 'Spalten & Einstellungen…', fn: openSettings },
      { text: 'Watchlists exportieren', fn: exportLists },
      { text: 'Watchlists importieren…', fn: () => $('#importFile').click() },
    ]);
  });

  // ======================================================================
  // Symbol hinzufügen
  // ======================================================================
  const dlgAdd = $('#dlgAdd'), addInput = $('#addInput'), addResults = $('#addResults');
  const POPULAR = [
    ['^GDAXI', 'DAX', 'Index'], ['^GSPC', 'S&P 500', 'Index'], ['^NDX', 'Nasdaq 100', 'Index'], ['^STOXX50E', 'Euro Stoxx 50', 'Index'],
    ['^TECDAX', 'TecDAX', 'Index'], ['^DJI', 'Dow Jones', 'Index'], ['URTH', 'iShares MSCI World (USD)', 'ETF'], ['EUNL.DE', 'iShares Core MSCI World (EUR)', 'ETF'],
    ['GC=F', 'Gold', 'Future'], ['SI=F', 'Silber', 'Future'], ['BZ=F', 'Brent Öl', 'Future'], ['EURUSD=X', 'EUR/USD', 'Devisen'], ['BTC-EUR', 'Bitcoin in EUR', 'Krypto'],
  ];
  let addResultsData = [], kbIndex = -1, searchSeq = 0, searchTimer;

  function openAdd() {
    addInput.value = '';
    renderAddTarget();
    showResults(POPULAR.map(p => ({ symbol: p[0], name: p[1], type: p[2], exchange: '' })), 'Beliebt');
    dlgAdd.showModal();
    addInput.focus();
  }
  $('#btnAdd').addEventListener('click', openAdd);

  function renderAddTarget() {
    const list = activeList();
    const sections = list.items.map((x, i) => ({ x, i })).filter(o => o.x.type === 'section');
    $('#addTarget').innerHTML = `Hinzufügen zu <b>${esc(list.name)}</b>` + (sections.length
      ? ` → <select id="addSection"><option value="end">Ende der Liste</option>${sections.map(s => `<option value="${esc(s.x.id)}">${esc(s.x.title)}</option>`).join('')}</select>` : '');
    const sel = $('#addSection');
    if (sel && renderAddTarget.last) sel.value = renderAddTarget.last;
    if (sel && !sel.value) sel.value = 'end';
    if (sel) sel.onchange = () => { renderAddTarget.last = sel.value; };
  }

  function showResults(rows, head, msg) {
    addResultsData = rows; kbIndex = -1;
    const inList = new Set(listSymbols());
    addResults.innerHTML = (head ? `<div class="res-head">${esc(head)}</div>` : '') +
      (msg ? `<div class="res-msg">${msg}</div>` : '') +
      rows.map((r, i) => `<div class="res${inList.has(r.symbol) ? ' added' : ''}" data-i="${i}">
        ${logoHtml({ symbol: r.symbol })}<span class="rs">${esc(NICE[r.symbol] || r.symbol)}</span>
        <span class="rn">${esc(r.name)}${NICE[r.symbol] ? ` <small style="color:var(--faint)">${esc(r.symbol)}</small>` : ''}</span>
        <span class="rx">${inList.has(r.symbol) ? '<span class="ok">✓ in Liste</span>' : esc([TYPE_DE[String(r.type).toUpperCase()] || r.type, r.exchange].filter(Boolean).join(' · '))}</span>
      </div>`).join('');
  }

  addInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = addInput.value.trim();
    if (!q) return showResults(POPULAR.map(p => ({ symbol: p[0], name: p[1], type: p[2], exchange: '' })), 'Beliebt');
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      addResults.innerHTML = '<div class="res-msg">Suche…</div>';
      try {
        const rows = await D.search(q);
        if (seq !== searchSeq) return;
        showResults(rows, rows.length ? 'Suchergebnisse' : '', rows.length ? '' : `Nichts gefunden. Mit <b>Enter</b> wird „${esc(q.toUpperCase())}“ direkt als Symbol hinzugefügt.`);
      } catch (err) {
        if (seq !== searchSeq) return;
        showResults([], '', `Suche nicht verfügbar (${esc(err.message)}).<br>Mit <b>Enter</b> wird „${esc(q.toUpperCase())}“ direkt als Symbol hinzugefügt.`);
      }
    }, 280);
  });

  addInput.addEventListener('keydown', e => {
    const rows = addResults.querySelectorAll('.res');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      kbIndex = e.key === 'ArrowDown' ? Math.min(rows.length - 1, kbIndex + 1) : Math.max(-1, kbIndex - 1);
      rows.forEach((r, i) => r.classList.toggle('kb', i === kbIndex));
      if (rows[kbIndex]) rows[kbIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (kbIndex >= 0 && addResultsData[kbIndex]) return addSymbol(addResultsData[kbIndex].symbol, true);
      const q = addInput.value.trim().toUpperCase();
      if (q) addSymbol(q, false);
    }
  });

  addResults.addEventListener('click', e => {
    const r = e.target.closest('.res'); if (!r) return;
    addSymbol(addResultsData[+r.dataset.i].symbol, true);
  });

  async function addSymbol(symbol, trusted) {
    const list = activeList();
    if (list.items.some(x => x.symbol === symbol)) return toast(`${NICE[symbol] || symbol} ist bereits in der Liste`);
    if (!/^[A-Za-z0-9.^=\-_]{1,20}$/.test(symbol)) return toast('Ungültiges Symbol');
    if (!trusted) {
      try {
        const q = await D.quote(symbol);
        quotes.set(symbol, q); qErrors.delete(symbol);
      } catch (err) {
        return toast(`„${symbol}“ wurde nicht gefunden`);
      }
    }
    // Einfügeposition
    const secId = $('#addSection') && $('#addSection').value;
    let pos = list.items.length;
    if (secId && secId !== 'end') {
      const si = list.items.findIndex(x => x.id === secId);
      if (si >= 0) { pos = si + 1; while (pos < list.items.length && list.items[pos].type !== 'section') pos++; }
    }
    list.items.splice(pos, 0, sym(symbol));
    save(); render();
    toast(`${NICE[symbol] || symbol} hinzugefügt`);
    // Ergebnisliste aktualisieren (Häkchen)
    showResults(addResultsData, addResults.querySelector('.res-head') ? addResults.querySelector('.res-head').textContent : '');
    refreshSymbols([symbol]);
    if (state.settings.columns.length) refreshExt([symbol]);
  }

  // ======================================================================
  // Einstellungen, Export, Import
  // ======================================================================
  const dlgSettings = $('#dlgSettings');
  function openSettings() {
    const s = state.settings;
    $('#setInterval').value = String(s.refreshMin);
    $('#setSource').value = s.source;
    $('#setProxy').value = s.proxyUrl || '';
    $('#setColumns').innerHTML = EXTRA_COLS.map(c => `<label><input type="checkbox" value="${c.id}" ${s.columns.includes(c.id) ? 'checked' : ''}> ${esc(c.title)}</label>`).join('');
    $('#proxyField').hidden = s.source !== 'custom';
    dlgSettings.showModal();
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#setSource').addEventListener('change', () => { $('#proxyField').hidden = $('#setSource').value !== 'custom'; });
  dlgSettings.addEventListener('close', () => {
    if (dlgSettings.returnValue !== 'save') return;
    const s = state.settings;
    const srcChanged = s.source !== $('#setSource').value || s.proxyUrl !== $('#setProxy').value.trim();
    s.refreshMin = +$('#setInterval').value;
    s.source = $('#setSource').value;
    s.proxyUrl = $('#setProxy').value.trim();
    s.columns = [...$('#setColumns').querySelectorAll('input:checked')].map(i => i.value);
    save();
    D.configure(s);
    if (srcChanged) { quotes.clear(); ext.clear(); detailCache.clear(); intraCache.clear(); }
    render();
    refreshAll(true);
    if (srcChanged && state.selected) openDetail(state.selected);
    toast('Einstellungen gespeichert');
  });

  function exportLists() {
    const data = { app: 'tradegear-watchlist', version: 1, exported: new Date().toISOString(), lists: state.lists };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `watchlists-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Watchlists exportiert');
  }
  $('#btnExport').addEventListener('click', exportLists);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const lists = Array.isArray(data) ? data : data.lists;
      if (!Array.isArray(lists) || !lists.length) throw new Error('Keine Watchlists in der Datei');
      let n = 0;
      for (const l of lists) {
        if (!l || !Array.isArray(l.items)) continue;
        const items = l.items.filter(i => i && (i.type === 'section' ? i.title : i.symbol))
          .map(i => i.type === 'section' ? { type: 'section', id: uid(), title: String(i.title), collapsed: !!i.collapsed }
            : { type: 'symbol', symbol: String(i.symbol), ...(i.label ? { label: String(i.label) } : {}) });
        let name = String(l.name || 'Importiert');
        if (state.lists.some(x => x.name === name)) name += ' (Import)';
        state.lists.push({ id: uid(), name, items }); n++;
      }
      if (!n) throw new Error('Keine gültigen Watchlists');
      save();
      switchList(state.lists[state.lists.length - 1].id);
      if (dlgSettings.open) dlgSettings.close();
      toast(`${n} Watchlist${n > 1 ? 's' : ''} importiert`);
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message);
    }
  });

  // ======================================================================
  // Aktualisierung
  // ======================================================================
  async function pool(items, n, fn) {
    const queue = items.slice();
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }));
  }

  async function refreshSymbols(symbols) {
    let ok = 0, fail = 0;
    await pool(symbols, 4, async s => {
      try {
        const q = await D.quote(s);
        quotes.set(s, q); qErrors.delete(s); ok++;
      } catch (err) {
        qErrors.set(s, err.message); fail++; lastError = err.message;
      }
    });
    render();
    return { ok, fail };
  }

  async function refreshExt(symbols, force) {
    const need = symbols.filter(s => force || !ext.has(s) || Date.now() - ext.get(s).at > 30 * 60e3);
    await pool(need, 3, async s => {
      try {
        const d = await D.chart(s, '1y', '1d');
        ext.set(s, { bars: d.bars, off: d.gmtoffset, at: Date.now() });
      } catch (_) { /* Spalte bleibt leer */ }
    });
    if (need.length) render();
  }

  async function refreshAll(force) {
    if (refreshing) return;
    refreshing = true; lastError = null;
    setStatus();
    $('#btnRefresh').classList.add('spin');
    const syms = listSymbols();
    try {
      const { ok, fail } = await refreshSymbols(syms);
      if (ok || !syms.length) lastUpdate = new Date();
      if (!ok && fail) lastError = lastError || 'Keine Daten';
      else if (ok) lastError = null;
      if (state.settings.columns.length) await refreshExt(syms, false);
      if (state.selected) updateDetailLive();
    } finally {
      refreshing = false;
      $('#btnRefresh').classList.remove('spin');
      scheduleNext();
      setStatus();
    }
  }

  let timer = null;
  function scheduleNext() {
    clearTimeout(timer);
    const m = state.settings.refreshMin;
    if (!m) { nextUpdate = null; return; }
    nextUpdate = Date.now() + m * 60e3;
    timer = setTimeout(() => { if (!document.hidden) refreshAll(); else nextUpdate = 0; }, m * 60e3);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && nextUpdate !== null && Date.now() >= (nextUpdate || 0)) refreshAll();
  });
  $('#btnRefresh').addEventListener('click', () => { detailCache.forEach(v => { v.at = 0; }); refreshAll(true); });

  function setStatus() {
    const dot = $('#statusDot'), txt = $('#statusText');
    dot.className = 'dot ' + (refreshing ? 'busy' : lastError ? 'err' : lastUpdate ? 'ok' : '');
    if (refreshing && !lastUpdate) { txt.textContent = 'Lade Kurse…'; return; }
    const parts = [];
    if (lastError && !refreshing) parts.push('Fehler: ' + lastError);
    parts.push(D.sourceLabel());
    if (lastUpdate) parts.push(timeFmt.format(lastUpdate));
    if (nextUpdate) {
      const s = Math.max(0, Math.round((nextUpdate - Date.now()) / 1000));
      parts.push(`nächste in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    } else if (!state.settings.refreshMin) parts.push('nur manuell');
    txt.textContent = parts.join(' · ');
    $('#status').title = lastError ? `Letzter Fehler: ${lastError}\nTipp: Starte "node server.js" im Ordner watchlist für eine stabile Datenquelle.` : 'Datenquelle & letzte Aktualisierung';
  }
  setInterval(setStatus, 1000);

  // ======================================================================
  // Detailansicht
  // ======================================================================
  const detailEl = $('#detail');
  const RANGES = [
    { id: '1T', label: '1T', perf: 'D', intraday: ['1d', '5m'] },
    { id: '5T', label: '5T', perf: '1W', intraday: ['5d', '15m'] },
    { id: '1M', label: '1M', perf: '1M', months: 1 },
    { id: '3M', label: '3M', perf: '3M', months: 3 },
    { id: '6M', label: '6M', perf: '6M', months: 6 },
    { id: 'YTD', label: 'YTD', perf: 'YTD', ytd: true },
    { id: '1J', label: '1J', perf: '1J', years: 1 },
    { id: '5J', label: '5J', perf: '5J', years: 5 },
    { id: 'MAX', label: 'Max', perf: 'MAX', max: true },
  ];
  const mobile = () => innerWidth <= 900;

  function selectSymbol(symbol) {
    state.selected = symbol; save();
    wlBody.querySelectorAll('.row').forEach(r => r.classList.toggle('selected', r.dataset.sym === symbol));
    openDetail(symbol);
    if (mobile() && !document.body.classList.contains('show-detail')) {
      document.body.classList.add('show-detail');
      history.pushState({ detail: symbol }, '');
    }
  }
  function closeDetail() {
    document.body.classList.remove('show-detail');
  }
  addEventListener('popstate', () => { if (document.body.classList.contains('show-detail')) closeDetail(); });

  let detailSeq = 0;
  async function openDetail(symbol) {
    const seq = ++detailSeq;
    const item = activeList().items.find(x => x.symbol === symbol) || { symbol };
    detailEl.innerHTML = `<div class="d-wrap">
      <button class="d-back" type="button" id="dBack"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>Watchlist</button>
      <div id="dHead"></div>
      <div class="toolbar">
        <div class="seg" id="dRanges"></div>
        <div class="seg" id="dType">
          <button type="button" data-t="area" title="Liniendiagramm">Linie</button>
          <button type="button" data-t="candle" title="Kerzendiagramm">Kerzen</button>
        </div>
      </div>
      <div class="chart-box" id="dChart"><div class="chart-legend" id="dLegend"></div><div class="chart-msg" id="dChartMsg">Lade Chart…</div></div>
      <h2 class="sec">Performance <small id="dPerfNote"></small></h2>
      <div class="perf-wrap"><div class="perf-grid" id="dPerf"></div></div>
      <h2 class="sec">Kennzahlen</h2>
      <div id="dStats"></div>
      <div id="dYears"></div>
      <div id="dHeat"></div>
    </div>`;
    detailEl.scrollTop = 0;
    $('#dBack').onclick = () => { if (history.state && history.state.detail) history.back(); else closeDetail(); };
    $('#dType').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.chartType = b.dataset.t; save(); drawChart();
    });
    $('#dRanges').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.chartRange = b.dataset.r; save(); drawChart();
    });
    detailState = { symbol, item, daily: null, monthly: null };
    renderDetailInfo();
    createChart();

    // Daten laden
    try {
      let q = quotes.get(symbol);
      const cached = detailCache.get(symbol);
      let daily, monthly;
      if (cached && Date.now() - cached.at < 15 * 60e3) ({ daily, monthly } = cached);
      else {
        const [d5, mx, qq] = await Promise.all([
          D.chart(symbol, '5y', '1d'),
          D.chart(symbol, 'max', '1mo').catch(() => null),
          q ? Promise.resolve(q) : D.quote(symbol).catch(() => null),
        ]);
        daily = d5; monthly = mx; q = qq || q;
        detailCache.set(symbol, { daily, monthly, at: Date.now() });
      }
      if (seq !== detailSeq) return;
      if (q) quotes.set(symbol, q);
      detailState.daily = daily; detailState.monthly = monthly;
      renderDetailInfo();
      drawChart();
    } catch (err) {
      if (seq !== detailSeq) return;
      $('#dChartMsg').textContent = '';
      $('#dHead').insertAdjacentHTML('afterend', `<div class="err-box"><b>Daten konnten nicht geladen werden.</b><br>${esc(err.message)}<br><small>Prüfe das Symbol oder die Datenquelle in den Einstellungen. Am zuverlässigsten: im Ordner <code>watchlist</code> den Befehl <code>node server.js</code> starten.</small></div>`);
    }
  }

  let detailState = null;

  function currentQuote() {
    const s = detailState; if (!s) return null;
    const q = quotes.get(s.symbol);
    if (q) return q;
    if (s.daily) {
      const d = s.daily, prev = D.prevCloseFrom(d);
      return { symbol: d.symbol, name: d.name, shortName: d.shortName, currency: d.currency, exchange: d.exchange, type: d.type, price: d.price, prevClose: prev,
        change: d.price - prev, changePct: (d.price / prev - 1) * 100, time: d.time, dayHigh: d.dayHigh, dayLow: d.dayLow, volume: d.volume,
        w52High: d.w52High, w52Low: d.w52Low, tradingStart: d.tradingStart, tradingEnd: d.tradingEnd, gmtoffset: d.gmtoffset };
    }
    return null;
  }

  function perfAll() {
    const s = detailState, q = currentQuote();
    const out = { D: q && q.changePct != null ? { pct: q.changePct, abs: q.change } : null };
    if (s.daily) Object.assign(out, A.performance(s.daily.bars, s.daily.gmtoffset, q ? q.price : null));
    if (s.monthly && s.monthly.bars.length && q) {
      const first = s.monthly.bars[0].c;
      out.MAX = { pct: (q.price / first - 1) * 100, abs: q.price - first, ref: first };
    }
    return out;
  }

  function renderDetailInfo() {
    if (!detailState || !$('#dHead')) return;
    const s = detailState, q = currentQuote(), it = activeList().items.find(x => x.symbol === s.symbol) || s.item;
    const open = isOpen(q);
    $('#dHead').innerHTML = `<div class="d-head">
      <div class="d-title">${logoHtml(it)}<div>
        <h1>${esc(q ? q.name : displaySym(it))}</h1>
        <div class="meta"><span>${esc(it.symbol)}</span>${q ? `<span>${esc(q.exchange)}</span><span>${esc(TYPE_DE[q.type] || q.type || '')}</span>
          <span class="badge"><i class="mkt${open ? ' open' : ''}"></i>${open ? 'Markt geöffnet' : 'Markt geschlossen'}</span>` : ''}</div>
      </div></div>
      <div class="d-price">${q ? `
        <div class="big">${fmtPrice(q.price, it.symbol)}<small>${esc(q.currency)}</small></div>
        <div class="chg ${cls(q.change)}">${fmtChg(q.change, it.symbol, q.price)} (${fmtPct(q.changePct, true)}) <span style="color:var(--muted);font-weight:400;font-size:12.5px">heute</span></div>
        <div class="time">Stand: ${q.time ? dtFmt.format(new Date(q.time * 1000)) : '—'} · verzögert</div>` :
        '<div class="big skeleton">00.000,00</div><div class="chg skeleton">+00,00 (+0,00 %)</div>'}
      </div></div>`;

    const perf = perfAll();
    // Zeitraum-Buttons mit Performance
    $('#dRanges').innerHTML = RANGES.map(r => {
      const p = perf[r.perf];
      return `<button type="button" data-r="${r.id}" class="${state.chartRange === r.id ? 'on' : ''}">${r.label}<span class="p ${cls(p && p.pct)}">${p ? fmtPct(p.pct) : '&nbsp;'}</span></button>`;
    }).join('');
    $('#dType').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === state.chartType));

    // Performance-Kacheln
    const tiles = [{ id: 'D', label: 'Heute' }, ...A.PERIODS];
    const loading = !s.daily;
    $('#dPerf').innerHTML = tiles.map(t => {
      const p = perf[t.id];
      if (loading && t.id !== 'D') return `<div class="perf"><div class="lbl">${esc(t.label)}</div><div class="val skeleton">+0,00 %</div><div class="sub skeleton">+000,00</div></div>`;
      return `<div class="perf ${p ? cls(p.pct) : 'na'}"><div class="lbl">${esc(t.label)}</div>
        <div class="val ${p ? cls(p.pct) : ''}">${p ? fmtPct(p.pct, true) : '—'}</div>
        <div class="sub">${p ? fmtChg(p.abs, it.symbol, q && q.price) + (p.ref ? ' · von ' + fmtPrice(p.ref, it.symbol) : '') : 'keine Daten'}</div></div>`;
    }).join('');
    $('#dPerfNote').textContent = q ? `bezogen auf ${fmtPrice(q.price, it.symbol)} ${q.currency}` : '';

    // Kennzahlen
    if (q) {
      const ath = s.monthly ? A.allTimeHigh(s.monthly.bars) : (s.daily ? A.allTimeHigh(s.daily.bars) : null);
      const athVal = ath ? Math.max(ath.h, q.price) : null;
      const lastBar = s.daily && s.daily.bars[s.daily.bars.length - 1];
      const todayOpen = lastBar && q.time && D.dayKey(lastBar.t, s.daily.gmtoffset) === D.dayKey(q.time, s.daily.gmtoffset) ? lastBar.o : null;
      const w52h = q.w52High, w52l = q.w52Low;
      const bar = (title, lo, hi, v) => {
        if (lo == null || hi == null || hi <= lo) return '';
        const pos = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
        return `<div class="range-bar"><div class="top"><span>${title}</span></div><div class="track"><div class="knob" style="left:${pos}%"></div></div>
          <div class="ends"><span>${fmtPrice(lo, it.symbol)}</span><span>${fmtPrice(hi, it.symbol)}</span></div></div>`;
      };
      const row = (k, v) => `<div class="stat"><span>${k}</span><span>${v}</span></div>`;
      $('#dStats').innerHTML = `<div class="stats">
        <div>
          ${row('Vortagesschluss', fmtPrice(q.prevClose, it.symbol))}
          ${row('Eröffnung', fmtPrice(todayOpen, it.symbol))}
          ${row('Volumen', fmtVol(q.volume))}
          ${bar('Tagesspanne', q.dayLow, q.dayHigh, q.price)}
        </div>
        <div>
          ${row('52-Wochen-Hoch', fmtPrice(w52h, it.symbol))}
          ${row('Abstand zum 52W-Hoch', `<span class="${cls(w52h ? q.price / w52h - 1 : null)}">${w52h ? fmtPct((q.price / w52h - 1) * 100, true) : '—'}</span>`)}
          ${row('52-Wochen-Tief', fmtPrice(w52l, it.symbol))}
          ${bar('52-Wochen-Spanne', w52l, w52h, q.price)}
        </div>
        <div>
          ${row('Allzeithoch' + (ath ? ` <small>(${s.monthly ? 'seit ' + new Date(s.monthly.bars[0].t * 1000).getFullYear() : '5 J.'})</small>` : ''), athVal ? fmtPrice(athVal, it.symbol) : '—')}
          ${row('Abstand zum Allzeithoch', athVal ? `<span class="${cls(q.price / athVal - 1)}">${fmtPct((q.price / athVal - 1) * 100, true)}</span>` : '—')}
          ${row('Währung', esc(q.currency || '—'))}
          ${row('Börse', esc(q.exchange || '—'))}
        </div>
      </div>`;
    } else $('#dStats').innerHTML = '<div class="stat"><span class="skeleton">Lade Kennzahlen…</span><span></span></div>';

    // Jahresperformance
    const src = s.monthly && s.monthly.bars.length > 13 ? s.monthly : s.daily;
    const years = src ? A.yearly(src.bars, src.gmtoffset, q && q.price).slice(0, 12) : [];
    if (years.length) {
      const maxAbs = Math.max(...years.map(y => Math.abs(y.pct)), 1);
      $('#dYears').innerHTML = `<h2 class="sec">Jahresperformance <small>Kalenderjahre</small></h2><div class="years">${years.map(y => {
        const w = Math.abs(y.pct) / maxAbs * 100;
        return `<div class="yrow"><span class="y">${y.year}${y.running ? '*' : ''}</span>
          <div class="neg">${y.pct < 0 ? `<div class="bar d" style="width:${w}%"></div>` : ''}</div>
          <div class="pos">${y.pct >= 0 ? `<div class="bar u" style="width:${w}%"></div>` : ''}</div>
          <span class="v ${cls(y.pct)}">${fmtPct(y.pct, true)}</span></div>`;
      }).join('')}</div><p class="hint" style="margin-top:6px">* laufendes Jahr (seit Jahresbeginn)</p>`;
    } else $('#dYears').innerHTML = '';

    // Monats-Heatmap
    if (s.daily) {
      const mon = A.monthly(s.daily.bars, s.daily.gmtoffset, q && q.price);
      const yrs = Object.keys(mon).map(Number).sort((a, b) => b - a).slice(0, 5);
      const yMap = Object.fromEntries(years.map(y => [y.year, y.pct]));
      const M = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      const bg = v => {
        if (v == null) return '';
        const a = Math.min(0.85, 0.12 + Math.abs(v) / 12);
        return `background:${v >= 0 ? `rgba(8,153,129,${a})` : `rgba(242,54,69,${a})`};color:${a > 0.45 ? '#fff' : 'inherit'}`;
      };
      $('#dHeat').innerHTML = yrs.length ? `<h2 class="sec">Monatsperformance</h2><div class="heat-wrap"><table class="heat">
        <thead><tr><th>Jahr</th>${M.map(m => `<th>${m}</th>`).join('')}<th>Jahr</th></tr></thead>
        <tbody>${yrs.map(y => `<tr><td class="yr">${y}</td>${mon[y].map(v => `<td style="${bg(v)}">${v == null ? '' : fmtPct(v).replace('%', '')}</td>`).join('')}
          <td class="total" style="${bg(yMap[y] != null ? yMap[y] / 3 : null)}">${yMap[y] != null ? fmtPct(yMap[y]) : ''}</td></tr>`).join('')}</tbody>
      </table></div>` : '';
    }
  }

  // Bei jeder Aktualisierung
  async function updateDetailLive() {
    if (!detailState || !$('#dHead')) return;
    renderDetailInfo();
    const r = RANGES.find(x => x.id === state.chartRange);
    if (r && r.intraday) drawChart(true);
    else if (chartState.series && detailState.daily && r && !r.max) {
      const q = quotes.get(detailState.symbol);
      if (q && q.price != null && q.time) {
        const t = D.dayKey(q.time, detailState.daily.gmtoffset);
        const last = chartState.lastPoint;
        try {
          if (state.chartType === 'candle' && last) chartState.series.update({ time: t, open: last.time === t ? last.open : q.price, high: Math.max(last.time === t ? last.high : q.price, q.price), low: Math.min(last.time === t ? last.low : q.price, q.price), close: q.price });
          else chartState.series.update({ time: t, value: q.price });
        } catch (_) { /* älter als letzter Punkt */ }
      }
    }
  }

  // ======================================================================
  // Chart (TradingView Lightweight Charts)
  // ======================================================================
  const chartState = { chart: null, series: null, lastPoint: null, first: null, seq: 0 };
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function chartOptions() {
    return {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--bg') }, textColor: css('--muted'), fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', attributionLogo: true },
      grid: { vertLines: { color: isDark() ? 'rgba(42,46,57,.6)' : 'rgba(224,227,235,.6)' }, horzLines: { color: isDark() ? 'rgba(42,46,57,.6)' : 'rgba(224,227,235,.6)' } },
      rightPriceScale: { borderColor: css('--border'), scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: css('--border'), rightOffset: 2, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0, vertLine: { labelBackgroundColor: isDark() ? '#363a45' : '#131722' }, horzLine: { labelBackgroundColor: isDark() ? '#363a45' : '#131722' } },
      localization: { locale: 'de-DE', priceFormatter: p => fmtPrice(p, detailState && detailState.symbol) },
      handleScale: { axisPressedMouseMove: true },
    };
  }

  function createChart() {
    if (chartState.chart) { chartState.chart.remove(); chartState.chart = null; chartState.series = null; }
    const box = $('#dChart');
    if (!box || !window.LightweightCharts) return;
    chartState.chart = LightweightCharts.createChart(box, chartOptions());
    chartState.chart.subscribeCrosshairMove(onCrosshair);
  }

  function seriesColors(up) {
    const c = up ? css('--up') : css('--down');
    const rgb = up ? (isDark() ? '34,171,148' : '8,153,129') : (isDark() ? '247,82,95' : '242,54,69');
    return { lineColor: c, topColor: `rgba(${rgb},.28)`, bottomColor: `rgba(${rgb},0)` };
  }
  function applySeriesColors() {
    if (!chartState.series) return;
    if (state.chartType === 'area') chartState.series.applyOptions(seriesColors(chartState.up));
    else chartState.series.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down') });
  }

  function cutoffKey(r, lastT, off) {
    const d = new Date((lastT + off) * 1000);
    if (r.ytd) return `${d.getUTCFullYear() - 1}-12-31`;
    if (r.months) d.setUTCMonth(d.getUTCMonth() - r.months);
    if (r.years) d.setUTCFullYear(d.getUTCFullYear() - r.years);
    return d.toISOString().slice(0, 10);
  }

  async function drawChart(silent) {
    const s = detailState; if (!s || !chartState.chart) return;
    const seq = ++chartState.seq;
    const r = RANGES.find(x => x.id === state.chartRange) || RANGES[6];
    $('#dRanges').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.r === r.id));
    $('#dType').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === state.chartType));
    const msg = $('#dChartMsg');

    let bars, off, intraday = false, baseline = null;
    try {
      if (r.intraday) {
        intraday = true;
        const key = s.symbol + ':' + r.id;
        let c = intraCache.get(key);
        if (!c || Date.now() - c.at > 55e3) {
          if (!silent) msg.textContent = 'Lade Chart…';
          const d = await D.chart(s.symbol, r.intraday[0], r.intraday[1]);
          c = { data: d, at: Date.now() };
          intraCache.set(key, c);
        }
        if (seq !== chartState.seq) return;
        bars = c.data.bars; off = c.data.gmtoffset;
        const q = currentQuote();
        if (r.id === '1T') {
          // nur letzter Handelstag
          const lastDay = bars.length ? D.dayKey(bars[bars.length - 1].t, off) : null;
          bars = bars.filter(b => D.dayKey(b.t, off) === lastDay);
          baseline = q && q.prevClose;
        }
      } else if (r.max) {
        if (!s.monthly && !s.daily) { msg.textContent = 'Lade Chart…'; return; }
        const src = s.monthly && s.monthly.bars.length > 2 ? s.monthly : s.daily;
        bars = src.bars; off = src.gmtoffset;
      } else {
        if (!s.daily) { msg.textContent = 'Lade Chart…'; return; }
        off = s.daily.gmtoffset;
        const all = s.daily.bars;
        const key = cutoffKey(r, all[all.length - 1].t, off);
        let i = all.findIndex(b => D.dayKey(b.t, off) > key);
        if (i < 0) i = all.length - 1;
        bars = all.slice(Math.max(0, i - 1));
      }
    } catch (err) {
      if (seq !== chartState.seq) return;
      msg.textContent = 'Chart konnte nicht geladen werden: ' + err.message;
      return;
    }
    if (!bars || !bars.length) { msg.textContent = 'Keine Chartdaten für diesen Zeitraum'; return; }
    msg.textContent = '';

    // Daten für Lightweight Charts
    const seen = new Set();
    const pts = [];
    for (const b of bars) {
      const time = intraday ? b.t + off : D.dayKey(b.t, off);
      if (seen.has(time)) { pts[pts.length - 1] = { ...b, time }; continue; }
      seen.add(time); pts.push({ ...b, time });
    }
    const first = baseline || pts[0].c, lastC = pts[pts.length - 1].c;
    chartState.up = lastC >= first;
    chartState.first = first;
    chartState.intraday = intraday;

    if (chartState.series) { chartState.chart.removeSeries(chartState.series); chartState.series = null; }
    if (state.chartType === 'candle') {
      chartState.series = chartState.chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down') });
      chartState.series.setData(pts.map(p => ({ time: p.time, open: p.o, high: p.h, low: p.l, close: p.c })));
      const l = pts[pts.length - 1];
      chartState.lastPoint = { time: l.time, open: l.o, high: l.h, low: l.l };
    } else {
      chartState.series = chartState.chart.addAreaSeries({ ...seriesColors(chartState.up), lineWidth: 2, priceLineVisible: true, crosshairMarkerRadius: 4 });
      chartState.series.setData(pts.map(p => ({ time: p.time, value: p.c })));
      chartState.lastPoint = { time: pts[pts.length - 1].time };
    }
    if (baseline) chartState.series.createPriceLine({ price: baseline, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Vortag' });
    chartState.chart.applyOptions({ timeScale: { timeVisible: intraday, secondsVisible: false } });
    chartState.chart.timeScale().fitContent();
    chartState.pts = pts;
    onCrosshair({});
  }

  function onCrosshair(param) {
    const leg = $('#dLegend'); if (!leg || !chartState.pts || !chartState.pts.length) return;
    let p = null;
    if (param && param.time !== undefined && param.seriesData && chartState.series) {
      const d = param.seriesData.get(chartState.series);
      if (d) p = { time: param.time, c: d.value != null ? d.value : d.close, o: d.open, h: d.high, l: d.low };
    }
    if (!p) { const l = chartState.pts[chartState.pts.length - 1]; p = { time: l.time, c: l.c, o: l.o, h: l.h, l: l.l }; }
    const sym = detailState.symbol;
    let label;
    if (typeof p.time === 'number') label = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(p.time * 1000));
    else if (typeof p.time === 'string') label = dateFmt.format(new Date(p.time + 'T00:00:00Z'));
    else label = `${String(p.time.day).padStart(2, '0')}.${String(p.time.month).padStart(2, '0')}.${p.time.year}`;
    const chg = chartState.first ? (p.c / chartState.first - 1) * 100 : null;
    leg.innerHTML = `<span>${esc(label)}</span>` +
      (state.chartType === 'candle' && p.o != null ? `<span>O <b>${fmtPrice(p.o, sym)}</b></span><span>H <b>${fmtPrice(p.h, sym)}</b></span><span>T <b>${fmtPrice(p.l, sym)}</b></span><span>S <b>${fmtPrice(p.c, sym)}</b></span>`
        : `<span><b>${fmtPrice(p.c, sym)}</b></span>`) +
      (chg != null ? `<span class="${cls(chg)}">${fmtPct(chg, true)}</span>` : '');
  }

  // ======================================================================
  // Start
  // ======================================================================
  D.configure(state.settings);
  applyTheme();
  let lastW = innerWidth;
  addEventListener('resize', () => {
    const crossed = (lastW <= 900) !== (innerWidth <= 900) || (lastW < 420) !== (innerWidth < 420);
    lastW = innerWidth;
    if (crossed) render();
  });
  render();
  refreshAll(true);
  if (state.selected && !mobile() && activeList().items.some(x => x.symbol === state.selected)) openDetail(state.selected);
  else if (!mobile()) {
    const first = activeList().items.find(x => x.type === 'symbol');
    if (first) { state.selected = first.symbol; render(); openDetail(first.symbol); }
  }
})();
