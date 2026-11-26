/**
 * Optionaler, kostenloser Proxy für die Watchlist (Cloudflare Workers).
 * Damit funktioniert die Watchlist auch über GitHub Pages / unterwegs am Handy zuverlässig,
 * ohne dass dein Mac laufen muss.
 *
 * 1. https://dash.cloudflare.com → Workers & Pages → Worker erstellen
 * 2. Diesen Code einfügen und "Deploy" klicken
 * 3. In der Watchlist: Einstellungen → Datenquelle "Eigene Proxy-URL"
 *    → https://DEIN-WORKER.workers.dev/?url={url}
 */
export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(request.url).searchParams.get('url');
    let u;
    try { u = new URL(target); } catch (_) { return new Response('url fehlt', { status: 400, headers: cors }); }
    // Nur Yahoo Finance erlauben – kein offener Proxy
    if (!/^query[12]\.finance\.yahoo\.com$/.test(u.hostname)) return new Response('nicht erlaubt', { status: 403, headers: cors });
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  },
};
