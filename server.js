'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const yahoo = require('./lib/yahoo');
const news = require('./lib/news');
const { buildMetrics, metricsFromChartMeta } = require('./lib/metrics');
const { TtlCache } = require('./lib/cache');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIN = 60 * 1000;
const cache = new TtlCache();

const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return null;
  }
}

function requireSymbol(raw) {
  const symbol = (safeDecode(raw || '') || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, 'Ungültiges Tickersymbol');
  return symbol;
}

async function loadStock(symbol) {
  try {
    const qs = await yahoo.quoteSummary(symbol);
    return buildMetrics(qs);
  } catch (err) {
    if (err.status === 404) throw new HttpError(404, err.message);
    // Fallback: Chart-Metadaten liefern zumindest Kurs und Handelsdaten
    const { meta } = await yahoo.chart(symbol, '5d');
    return { ...metricsFromChartMeta(meta), warning: `Fundamentaldaten aktuell nicht verfügbar (${err.message}).` };
  }
}

const routes = [
  {
    pattern: /^\/api\/news\/categories$/,
    handler: async () => ({ categories: news.listCategories() }),
  },
  {
    pattern: /^\/api\/news$/,
    handler: async (_m, url) => {
      const q = (url.searchParams.get('q') || '').trim();
      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'de';
      if (q) {
        if (q.length > 120) throw new HttpError(400, 'Suchbegriff zu lang');
        return cache.wrap(`news:q:${lang}:${q.toLowerCase()}`, 5 * MIN, () => news.searchNews(q, lang));
      }
      const category = url.searchParams.get('category') || 'maerkte';
      if (!news.CATEGORIES[category]) throw new HttpError(404, 'Unbekannte Kategorie');
      return cache.wrap(`news:c:${category}`, 5 * MIN, () => news.categoryNews(category));
    },
  },
  {
    pattern: /^\/api\/search$/,
    handler: async (_m, url) => {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return { results: [] };
      if (q.length > 60) throw new HttpError(400, 'Suchbegriff zu lang');
      const results = await cache.wrap(`search:${q.toLowerCase()}`, 60 * MIN, () => yahoo.search(q));
      return { results };
    },
  },
  {
    pattern: /^\/api\/stock\/([^/]+)$/,
    handler: async (m) => {
      const symbol = requireSymbol(m[1]);
      return cache.wrap(`stock:${symbol}`, 2 * MIN, () => loadStock(symbol));
    },
  },
  {
    pattern: /^\/api\/stock\/([^/]+)\/chart$/,
    handler: async (m, url) => {
      const symbol = requireSymbol(m[1]);
      const range = url.searchParams.get('range') || '1y';
      if (!yahoo.RANGES[range]) throw new HttpError(400, 'Ungültiger Zeitraum');
      const ttl = range === '1d' || range === '5d' ? 1 * MIN : 15 * MIN;
      return cache.wrap(`chart:${symbol}:${range}`, ttl, async () => {
        const { meta, points, interval } = await yahoo.chart(symbol, range);
        return { symbol, range, interval, currency: meta.currency || null, previousClose: meta.chartPreviousClose ?? null, points };
      });
    },
  },
  {
    pattern: /^\/api\/stock\/([^/]+)\/news$/,
    handler: async (m) => {
      const symbol = requireSymbol(m[1]);
      return cache.wrap(`stocknews:${symbol}`, 10 * MIN, async () => ({ items: await yahoo.symbolNews(symbol) }));
    },
  },
];

async function handleApi(req, res, url) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Methode nicht erlaubt' });
  for (const route of routes) {
    const m = url.pathname.match(route.pattern);
    if (!m) continue;
    try {
      return sendJson(res, 200, await route.handler(m, url));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err.status === 404 ? 404 : 502;
      if (status >= 500) console.error(`[api] ${url.pathname}: ${err.message}`);
      return sendJson(res, status, { error: err.message || 'Upstream-Fehler' });
    }
  }
  return sendJson(res, 404, { error: 'Endpunkt nicht gefunden' });
}

function serveStatic(req, res, url) {
  let pathname = safeDecode(url.pathname);
  if (pathname == null) {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Finance-Website läuft auf http://localhost:${PORT}`);
  });
}

module.exports = { createServer, cache };
