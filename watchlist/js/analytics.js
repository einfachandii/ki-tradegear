/* TradeGear Watchlist – Performance-Auswertung */
(function () {
  'use strict';
  const { dayKey } = window.TGData;

  // Datum (UTC-basierte Tagesrechnung in Börsenzeit) als Date
  function localDate(t, off) { return new Date((t + (off || 0)) * 1000); }
  function keyOf(date) { return date.toISOString().slice(0, 10); }

  // Letzter Schlusskurs mit Tag <= key
  function closeOnOrBefore(bars, off, key) {
    let lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dayKey(bars[mid].t, off) <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? bars[ans].c : null;
  }

  function shift(date, { days = 0, months = 0, years = 0 }) {
    const d = new Date(date.getTime());
    if (years) d.setUTCFullYear(d.getUTCFullYear() - years);
    if (months) d.setUTCMonth(d.getUTCMonth() - months);
    if (days) d.setUTCDate(d.getUTCDate() - days);
    return d;
  }

  const PERIODS = [
    { id: '1W', label: '1 Woche', days: 7 },
    { id: '1M', label: '1 Monat', months: 1 },
    { id: '3M', label: '3 Monate', months: 3 },
    { id: '6M', label: '6 Monate', months: 6 },
    { id: 'YTD', label: 'Seit Jahresbeginn', ytd: true },
    { id: '1J', label: '1 Jahr', years: 1 },
    { id: '3J', label: '3 Jahre', years: 3 },
    { id: '5J', label: '5 Jahre', years: 5 },
  ];

  /**
   * Performance-Kennzahlen aus Tagesbalken.
   * @param {Array} bars Tagesbalken (aufsteigend)
   * @param {number} off gmtoffset
   * @param {number} price aktueller Kurs (überschreibt letzten Schluss)
   * @returns {Object} { '1W': {pct, ref, refDate}, ... }
   */
  function performance(bars, off, price) {
    const out = {};
    if (!bars || !bars.length) return out;
    const last = bars[bars.length - 1];
    const p = price != null ? price : last.c;
    const now = localDate(last.t, off);
    const firstKey = dayKey(bars[0].t, off);
    for (const per of PERIODS) {
      let refKey;
      if (per.ytd) refKey = `${now.getUTCFullYear() - 1}-12-31`;
      else refKey = keyOf(shift(now, per));
      // kleine Toleranz: Datenreihe beginnt evtl. ein paar Tage nach dem Stichtag
      if (refKey < firstKey && (new Date(firstKey) - new Date(refKey)) > 7 * 864e5) { out[per.id] = null; continue; }
      const ref = refKey < firstKey ? bars[0].c : closeOnOrBefore(bars, off, refKey);
      out[per.id] = ref ? { pct: (p / ref - 1) * 100, abs: p - ref, ref } : null;
    }
    return out;
  }

  // Kalenderjahres-Performance aus (Monats-)Balken: [{year, pct, close}]
  function yearly(bars, off, price) {
    if (!bars || bars.length < 2) return [];
    const byYear = new Map();
    for (const b of bars) byYear.set(+dayKey(b.t, off).slice(0, 4), b.c);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const curYear = years[years.length - 1];
    if (price != null) byYear.set(curYear, price);
    const out = [];
    for (let i = 1; i < years.length; i++) {
      const y = years[i], prev = byYear.get(years[i - 1]), c = byYear.get(y);
      if (prev && c && years[i - 1] === y - 1) out.push({ year: y, pct: (c / prev - 1) * 100, close: c, running: y === curYear });
    }
    return out.reverse();
  }

  // Monats-Performance je Jahr aus Tagesbalken: { 2025: [12 Werte|null], ... }
  function monthly(bars, off, price) {
    const ends = new Map(); // 'YYYY-MM' -> close
    for (const b of bars) ends.set(dayKey(b.t, off).slice(0, 7), b.c);
    const keys = [...ends.keys()].sort();
    if (price != null && keys.length) ends.set(keys[keys.length - 1], price);
    const res = {};
    for (let i = 1; i < keys.length; i++) {
      const [y, m] = keys[i].split('-').map(Number);
      const [py, pm] = keys[i - 1].split('-').map(Number);
      if (!((py === y && pm === m - 1) || (py === y - 1 && pm === 12 && m === 1))) continue;
      (res[y] = res[y] || Array(12).fill(null))[m - 1] = (ends.get(keys[i]) / ends.get(keys[i - 1]) - 1) * 100;
    }
    return res;
  }

  // Allzeithoch aus Balken
  function allTimeHigh(bars) {
    let best = null;
    for (const b of bars || []) if (!best || b.h > best.h) best = b;
    return best;
  }

  window.TGAnalytics = { PERIODS, performance, yearly, monthly, allTimeHigh, closeOnOrBefore };
})();
