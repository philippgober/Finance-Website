'use strict';

const { request, getJson, UpstreamError } = require('./http');

/**
 * Zugriff auf die (inoffiziellen) Yahoo-Finance-Endpunkte.
 * quoteSummary benötigt Cookie + Crumb; Suche und Chart funktionieren ohne.
 */

const Q1 = 'https://query1.finance.yahoo.com';
const Q2 = 'https://query2.finance.yahoo.com';
const SESSION_TTL = 30 * 60 * 1000;

let session = null;
let sessionPromise = null;

function extractCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return list.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function createSession() {
  const res = await request('https://fc.yahoo.com/', { redirect: 'manual' });
  const cookie = extractCookies(res);
  const crumbRes = await request(`${Q2}/v1/test/getcrumb`, { headers: cookie ? { cookie } : {} });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || /[<{\s]/.test(crumb)) {
    throw new UpstreamError(`Yahoo-Crumb konnte nicht ermittelt werden (HTTP ${crumbRes.status})`, crumbRes.status);
  }
  return { cookie, crumb, created: Date.now() };
}

async function getSession(force = false) {
  if (!force && session && Date.now() - session.created < SESSION_TTL) return session;
  if (!sessionPromise) {
    sessionPromise = createSession()
      .then((s) => (session = s))
      .finally(() => (sessionPromise = null));
  }
  return sessionPromise;
}

function resetSession() {
  session = null;
}

async function search(query) {
  const url = `${Q2}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=true&lang=de-DE&region=DE`;
  const data = await getJson(url);
  return (data.quotes || [])
    .filter((q) => q.symbol && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(q.quoteType))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || '',
      type: q.typeDisp || q.quoteType,
      sector: q.sectorDisp || q.sector || '',
    }));
}

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
  'incomeStatementHistory',
  'calendarEvents',
].join(',');

async function quoteSummary(symbol, retry = true) {
  const s = await getSession();
  const url = `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}&formatted=false&lang=de-DE&region=DE`;
  const res = await request(url, { headers: s.cookie ? { cookie: s.cookie } : {} });
  if ((res.status === 401 || res.status === 403) && retry) {
    resetSession();
    await getSession(true);
    return quoteSummary(symbol, false);
  }
  const data = await res.json().catch(() => null);
  const err = data?.quoteSummary?.error;
  if (res.status === 404 || err?.code === 'Not Found') throw new UpstreamError(`Symbol "${symbol}" nicht gefunden`, 404);
  if (!res.ok || !data?.quoteSummary?.result?.[0]) {
    throw new UpstreamError(err?.description || `quoteSummary HTTP ${res.status}`, res.status);
  }
  return data.quoteSummary.result[0];
}

const RANGES = {
  '1d': '5m',
  '5d': '30m',
  '1mo': '1d',
  '6mo': '1d',
  ytd: '1d',
  '1y': '1d',
  '5y': '1wk',
  max: '1mo',
};

async function chart(symbol, range = '1y') {
  const interval = RANGES[range] || '1d';
  const url = `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div,split`;
  let data;
  try {
    data = await getJson(url);
  } catch (e) {
    if (e.status === 404) throw new UpstreamError(`Symbol "${symbol}" nicht gefunden`, 404);
    throw e;
  }
  const result = data?.chart?.result?.[0];
  if (!result) throw new UpstreamError(data?.chart?.error?.description || 'Keine Kursdaten', 404);
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  ts.forEach((t, i) => {
    if (closes[i] != null) points.push([t * 1000, closes[i]]);
  });
  return { meta: result.meta || {}, range, interval, points };
}

/** Unternehmensnachrichten aus der Yahoo-Suche. */
async function symbolNews(symbol) {
  const url = `${Q2}/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=15&lang=en-US&region=US`;
  const data = await getJson(url);
  return (data.news || []).map((n) => ({
    title: n.title,
    link: n.link,
    source: n.publisher || 'Yahoo Finance',
    published: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    summary: '',
  }));
}

module.exports = { search, quoteSummary, chart, symbolNews, RANGES, resetSession };
