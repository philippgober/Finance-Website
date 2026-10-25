'use strict';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** fetch() mit Timeout und Browser-User-Agent. */
async function request(url, { headers = {}, timeout = 10000, ...opts } = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
}

async function getJson(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status} für ${new URL(url).host}`, res.status);
  return res.json();
}

async function getText(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status} für ${new URL(url).host}`, res.status);
  return res.text();
}

module.exports = { UA, UpstreamError, request, getJson, getText };
