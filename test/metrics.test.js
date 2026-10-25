'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMetrics, metricsFromChartMeta } = require('../lib/metrics');
const fx = require('./fixtures');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('berechnet Leverage- und Bewertungskennzahlen', () => {
  const m = buildMetrics(fx.quoteSummary);
  const s = m.summary;
  assert.equal(m.name, 'Siemens Aktiengesellschaft');
  assert.equal(m.currency, 'EUR');
  assert.equal(s.netDebt, 40e9);
  close(s.netLeverage, 2.5); // 40 / 16
  close(s.grossLeverage, 3.125); // 50 / 16
  close(s.interestCoverage, 8); // 12 / |−1,5|
  close(s.debtToEquity, 0.855);
  close(s.fcfYield, 0.05); // 8 / 160
  close(s.cashConversion, 0.5); // 8 / 16
  assert.equal(s.evEbitda, 12.5);
  assert.equal(s.nextEarnings, '2025-11-13');
  close(m.quote.changePct, 0.020408);
  assert.equal(m.profile.recommendation, 'buy');
});

test('normiert Prozentangaben in Prozentpunkten auf Anteile', () => {
  const qs = structuredClone(fx.quoteSummary);
  qs.price.regularMarketChangePercent = 2.0408;
  close(buildMetrics(qs).quote.changePct, 0.020408);
});

test('versteht {raw, fmt}-Objekte und fehlende Module', () => {
  const m = buildMetrics({ price: { marketCap: { raw: 5e9, fmt: '5B' }, currency: 'USD' } });
  assert.equal(m.summary.marketCap, 5e9);
  assert.equal(m.summary.netLeverage, null);
  assert.equal(m.summary.evEbitda, null);
});

test('keine FCF-Rendite bei abweichender Berichtswährung', () => {
  const qs = structuredClone(fx.quoteSummary);
  qs.financialData.financialCurrency = 'USD';
  assert.equal(buildMetrics(qs).summary.fcfYield, null);
});

test('Fallback aus Chart-Metadaten', () => {
  const m = metricsFromChartMeta(fx.chart.chart.result[0].meta);
  assert.equal(m.partial, true);
  assert.equal(m.quote.price, 200);
  close(m.quote.changePct, 4 / 196);
});
