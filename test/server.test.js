'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixtures');
const { createServer, cache } = require('../server');
const yahoo = require('../lib/yahoo');

const RSS = `<rss><channel><title>Feed</title>
  <item><title>Leveraged-Loan-Markt zieht an</title><link>https://example.com/1</link><pubDate>Sat, 24 Oct 2026 09:00:00 GMT</pubDate></item>
  <item><title>Neuer Windpark erreicht Financial Close</title><link>https://example.com/2</link><pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

let qsMode = 'ok';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Upstream-APIs simulieren
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
  if (url.startsWith('https://fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=abc; Path=/' } });
  if (url.includes('/v1/test/getcrumb')) {
    assert.equal(init.headers.cookie, 'A3=abc');
    return new Response('crumb123');
  }
  if (url.includes('/v10/finance/quoteSummary/')) {
    if (qsMode === 'fail') return json({ quoteSummary: { result: null, error: { description: 'Unauthorized' } } }, 500);
    if (url.includes('NOPE')) return json({ quoteSummary: { result: null, error: { code: 'Not Found', description: 'No data' } } }, 404);
    assert.match(url, /crumb=crumb123/);
    return json({ quoteSummary: { result: [fx.quoteSummary], error: null } });
  }
  if (url.includes('/v8/finance/chart/')) return json(fx.chart);
  if (url.includes('/v1/finance/search')) {
    return json({
      quotes: [
        { symbol: 'SIE.DE', longname: 'Siemens AG', exchDisp: 'XETRA', quoteType: 'EQUITY', typeDisp: 'Aktie' },
        { symbol: 'SIEGY', shortname: 'Siemens ADR', exchDisp: 'OTC', quoteType: 'EQUITY' },
        { symbol: 'X', quoteType: 'FUTURE' },
      ],
      news: [{ title: 'Siemens-News', link: 'https://example.com/n', publisher: 'Reuters', providerPublishTime: 1761300000 }],
    });
  }
  return new Response(RSS, { headers: { 'content-type': 'application/rss+xml' } });
};

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  globalThis.fetch = realFetch;
});

test.beforeEach(() => {
  cache.clear();
  yahoo.resetSession();
  qsMode = 'ok';
});

async function get(path) {
  const res = await realFetch(base + path);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

test('liefert die Startseite aus', async () => {
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.match(body, /Finance Desk/);
});

test('blockiert Path Traversal', async () => {
  const { status } = await get('/..%2fserver.js');
  assert.notEqual(status, 200);
});

test('News-Kategorie aggregiert und dedupliziert', async () => {
  const { status, body } = await get('/api/news?category=levfin');
  assert.equal(status, 200);
  assert.equal(body.items.length, 2);
  assert.equal(body.items[0].title, 'Neuer Windpark erreicht Financial Close'); // neueste zuerst
});

test('News-Suche und unbekannte Kategorie', async () => {
  assert.equal((await get('/api/news?q=Schuldschein')).status, 200);
  assert.equal((await get('/api/news?category=foo')).status, 404);
});

test('Aktiensuche filtert auf relevante Instrumente', async () => {
  const { body } = await get('/api/search?q=siemens');
  assert.deepEqual(body.results.map((r) => r.symbol), ['SIE.DE', 'SIEGY']);
});

test('Kennzahlen zu einer Aktie', async () => {
  const { status, body } = await get('/api/stock/sie.de');
  assert.equal(status, 200);
  assert.equal(body.symbol, 'SIE.DE');
  assert.equal(body.summary.netLeverage, 2.5);
  assert.ok(body.groups.length >= 5);
});

test('Fallback auf Chart-Daten, wenn quoteSummary scheitert', async () => {
  qsMode = 'fail';
  const { status, body } = await get('/api/stock/SIE.DE');
  assert.equal(status, 200);
  assert.equal(body.partial, true);
  assert.match(body.warning, /Fundamentaldaten/);
});

test('unbekanntes Symbol → 404, ungültiges Symbol → 400', async () => {
  assert.equal((await get('/api/stock/NOPE')).status, 404);
  assert.equal((await get('/api/stock/%3Cscript%3E')).status, 400);
});

test('Chart- und Unternehmensnews-Endpunkte', async () => {
  const chart = await get('/api/stock/SIE.DE/chart?range=1mo');
  assert.equal(chart.status, 200);
  assert.equal(chart.body.points.length, 2); // null-Werte entfernt
  assert.equal((await get('/api/stock/SIE.DE/chart?range=7x')).status, 400);
  const news = await get('/api/stock/SIE.DE/news');
  assert.equal(news.body.items[0].source, 'Reuters');
});
