'use strict';

/**
 * Wandelt Yahoo-quoteSummary-Daten in strukturierte Kennzahlen um.
 *
 * Typen (Formatierung im Frontend):
 *   price = Kurs in Handelswährung, money = Betrag in Berichtswährung (Mio./Mrd.),
 *   x = Multiple, pct = Anteil (0.12 = 12 %), ratio = Verhältniszahl, int = Stückzahl, date = ISO-Datum
 */

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'raw' in v) return num(v.raw);
  return null;
}

function div(a, b) {
  return a != null && b != null && b !== 0 ? a / b : null;
}

function toDate(v) {
  const n = num(v);
  if (n == null) return typeof v === 'string' ? v : null;
  return new Date(n < 1e11 ? n * 1000 : n).toISOString().slice(0, 10);
}

function item(key, label, value, type, hint) {
  return { key, label, value: value ?? null, type, ...(hint ? { hint } : {}) };
}

function buildMetrics(qs) {
  const price = qs.price || {};
  const sd = qs.summaryDetail || {};
  const ks = qs.defaultKeyStatistics || {};
  const fd = qs.financialData || {};
  const ap = qs.assetProfile || {};
  const inc = qs.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
  const cal = qs.calendarEvents || {};

  const currency = price.currency || sd.currency || null;
  const financialCurrency = fd.financialCurrency || currency;

  const last = num(price.regularMarketPrice) ?? num(fd.currentPrice);
  const marketCap = num(price.marketCap) ?? num(sd.marketCap);
  const ev = num(ks.enterpriseValue);
  const revenue = num(fd.totalRevenue);
  const ebitda = num(fd.ebitda);
  const ebit = num(inc.ebit) ?? num(inc.operatingIncome);
  const interestExpense = num(inc.interestExpense);
  const netIncome = num(ks.netIncomeToCommon);
  const totalDebt = num(fd.totalDebt);
  const totalCash = num(fd.totalCash);
  const netDebt = totalDebt != null && totalCash != null ? totalDebt - totalCash : null;
  const fcf = num(fd.freeCashflow);
  const ocf = num(fd.operatingCashflow);
  const ebitdaMargin = num(fd.ebitdaMargins) ?? div(ebitda, revenue);
  // Yahoo liefert Debt/Equity in Prozentpunkten (z. B. 150 = 150 %)
  const debtToEquity = num(fd.debtToEquity) != null ? num(fd.debtToEquity) / 100 : null;
  // Market Cap in Handelswährung, FCF in Berichtswährung – Rendite nur bei gleicher Währung
  const fcfYield = currency === financialCurrency ? div(fcf, marketCap) : null;
  const earningsDate = cal.earnings?.earningsDate?.[0];

  const groups = [
    {
      id: 'valuation',
      title: 'Bewertung',
      items: [
        item('marketCap', 'Marktkapitalisierung', marketCap, 'money'),
        item('ev', 'Enterprise Value', ev, 'money', 'Marktkapitalisierung + Finanzverbindlichkeiten − Cash'),
        item('evRevenue', 'EV / Umsatz', num(ks.enterpriseToRevenue) ?? div(ev, revenue), 'x'),
        item('evEbitda', 'EV / EBITDA', num(ks.enterpriseToEbitda) ?? div(ev, ebitda), 'x'),
        item('peTrailing', 'KGV (TTM)', num(sd.trailingPE), 'x'),
        item('peForward', 'KGV (Forward)', num(sd.forwardPE) ?? num(ks.forwardPE), 'x'),
        item('peg', 'PEG Ratio', num(ks.pegRatio) ?? num(ks.trailingPegRatio), 'ratio'),
        item('pb', 'Kurs / Buchwert', num(ks.priceToBook), 'x'),
        item('ps', 'Kurs / Umsatz (TTM)', num(sd.priceToSalesTrailing12Months), 'x'),
        item('fcfYield', 'FCF-Rendite', fcfYield, 'pct', 'Free Cashflow / Marktkapitalisierung'),
      ],
    },
    {
      id: 'leverage',
      title: 'Verschuldung & Liquidität',
      items: [
        item('totalDebt', 'Finanzverbindlichkeiten', totalDebt, 'money'),
        item('totalCash', 'Liquide Mittel', totalCash, 'money'),
        item('netDebt', 'Nettoverschuldung', netDebt, 'money', 'Finanzverbindlichkeiten − liquide Mittel'),
        item('netLeverage', 'Net Debt / EBITDA', div(netDebt, ebitda), 'x', 'Netto-Leverage (TTM-EBITDA)'),
        item('grossLeverage', 'Total Debt / EBITDA', div(totalDebt, ebitda), 'x', 'Brutto-Leverage (TTM-EBITDA)'),
        item('interestCoverage', 'Zinsdeckung (EBIT / Zinsen)', div(ebit, interestExpense != null ? Math.abs(interestExpense) : null), 'x', 'Basis: letzter Jahresabschluss'),
        item('debtToEquity', 'Debt / Equity', debtToEquity, 'pct'),
        item('currentRatio', 'Current Ratio', num(fd.currentRatio), 'ratio'),
        item('quickRatio', 'Quick Ratio', num(fd.quickRatio), 'ratio'),
      ],
    },
    {
      id: 'profitability',
      title: 'Ergebnis & Profitabilität (TTM)',
      items: [
        item('revenue', 'Umsatz', revenue, 'money'),
        item('ebitda', 'EBITDA', ebitda, 'money'),
        item('netIncome', 'Jahresüberschuss', netIncome, 'money'),
        item('grossMargin', 'Bruttomarge', num(fd.grossMargins), 'pct'),
        item('ebitdaMargin', 'EBITDA-Marge', ebitdaMargin, 'pct'),
        item('operatingMargin', 'Operative Marge (EBIT)', num(fd.operatingMargins), 'pct'),
        item('netMargin', 'Nettomarge', num(fd.profitMargins), 'pct'),
        item('roe', 'Eigenkapitalrendite (RoE)', num(fd.returnOnEquity), 'pct'),
        item('roa', 'Gesamtkapitalrendite (RoA)', num(fd.returnOnAssets), 'pct'),
      ],
    },
    {
      id: 'cashflow',
      title: 'Cashflow & Wachstum',
      items: [
        item('ocf', 'Operativer Cashflow', ocf, 'money'),
        item('fcf', 'Free Cashflow (levered)', fcf, 'money'),
        item('cashConversion', 'Cash Conversion (FCF / EBITDA)', div(fcf, ebitda), 'pct'),
        item('revenueGrowth', 'Umsatzwachstum (YoY, Quartal)', num(fd.revenueGrowth), 'pct'),
        item('earningsGrowth', 'Gewinnwachstum (YoY, Quartal)', num(fd.earningsGrowth), 'pct'),
        item('epsTrailing', 'EPS (TTM)', num(ks.trailingEps), 'price'),
        item('epsForward', 'EPS (Forward)', num(ks.forwardEps), 'price'),
      ],
    },
    {
      id: 'market',
      title: 'Aktie & Dividende',
      items: [
        item('dividendYield', 'Dividendenrendite', num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield), 'pct'),
        item('dividendRate', 'Dividende je Aktie', num(sd.dividendRate) ?? num(sd.trailingAnnualDividendRate), 'price'),
        item('payoutRatio', 'Ausschüttungsquote', num(sd.payoutRatio), 'pct'),
        item('beta', 'Beta (5J, monatlich)', num(sd.beta) ?? num(ks.beta), 'ratio'),
        item('high52', '52W-Hoch', num(sd.fiftyTwoWeekHigh), 'price'),
        item('low52', '52W-Tief', num(sd.fiftyTwoWeekLow), 'price'),
        item('change52', '52W-Performance', num(ks['52WeekChange']), 'pct'),
        item('ma200', '200-Tage-Linie', num(sd.twoHundredDayAverage), 'price'),
        item('shares', 'Aktien im Umlauf', num(ks.sharesOutstanding), 'int'),
        item('freeFloat', 'Free Float', num(ks.floatShares), 'int'),
        item('insiders', 'Anteil Insider', num(ks.heldPercentInsiders), 'pct'),
        item('institutions', 'Anteil Institutionelle', num(ks.heldPercentInstitutions), 'pct'),
        item('targetPrice', 'Ø Kursziel Analysten', num(fd.targetMeanPrice), 'price'),
        item('analysts', 'Anzahl Analysten', num(fd.numberOfAnalystOpinions), 'int'),
        item('nextEarnings', 'Nächste Zahlen', toDate(earningsDate), 'date'),
      ],
    },
  ];

  const change = num(price.regularMarketChange);
  const changePct = num(price.regularMarketChangePercent);

  return {
    symbol: price.symbol || null,
    name: price.longName || price.shortName || price.symbol || null,
    exchange: price.exchangeName || null,
    quoteType: price.quoteType || null,
    marketState: price.marketState || null,
    currency,
    financialCurrency,
    quote: {
      price: last,
      change,
      // Yahoo liefert hier je nach Endpunkt Anteil oder Prozent – auf Anteil normieren
      changePct: changePct != null && change != null && last ? normalizePct(changePct, change, last) : changePct,
      previousClose: num(price.regularMarketPreviousClose) ?? num(sd.previousClose),
      dayHigh: num(price.regularMarketDayHigh),
      dayLow: num(price.regularMarketDayLow),
      volume: num(price.regularMarketVolume),
      time: toIsoTime(price.regularMarketTime),
    },
    profile: {
      sector: ap.sector || null,
      industry: ap.industry || null,
      country: ap.country || null,
      city: ap.city || null,
      employees: num(ap.fullTimeEmployees),
      website: ap.website || null,
      description: ap.longBusinessSummary || null,
      recommendation: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
    },
    groups,
    // Kompakte Kennzahlen für die Peer-Vergleichstabelle
    summary: Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.key, i.value]))),
  };
}

function normalizePct(pct, change, last) {
  const prev = last - change;
  if (!prev) return pct;
  const asFraction = change / prev;
  // Wert, der näher an der berechneten Veränderung liegt, gewinnt
  return Math.abs(pct - asFraction) <= Math.abs(pct / 100 - asFraction) ? pct : pct / 100;
}

function toIsoTime(v) {
  const n = num(v);
  if (n == null) return typeof v === 'string' ? v : null;
  return new Date(n < 1e11 ? n * 1000 : n).toISOString();
}

/** Reduzierte Kennzahlen, falls quoteSummary nicht verfügbar ist (nur Chart-Metadaten). */
function metricsFromChartMeta(meta) {
  const last = num(meta.regularMarketPrice);
  const prev = num(meta.chartPreviousClose) ?? num(meta.previousClose);
  const change = last != null && prev != null ? last - prev : null;
  const groups = [
    {
      id: 'market',
      title: 'Aktie',
      items: [
        item('high52', '52W-Hoch', num(meta.fiftyTwoWeekHigh), 'price'),
        item('low52', '52W-Tief', num(meta.fiftyTwoWeekLow), 'price'),
        item('dayHigh', 'Tageshoch', num(meta.regularMarketDayHigh), 'price'),
        item('dayLow', 'Tagestief', num(meta.regularMarketDayLow), 'price'),
        item('volume', 'Volumen', num(meta.regularMarketVolume), 'int'),
      ],
    },
  ];
  return {
    symbol: meta.symbol || null,
    name: meta.longName || meta.shortName || meta.symbol || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    quoteType: meta.instrumentType || null,
    marketState: null,
    currency: meta.currency || null,
    financialCurrency: meta.currency || null,
    quote: {
      price: last,
      change,
      changePct: div(change, prev),
      previousClose: prev,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      volume: num(meta.regularMarketVolume),
      time: toIsoTime(meta.regularMarketTime),
    },
    profile: {},
    groups,
    summary: Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.key, i.value]))),
    partial: true,
  };
}

module.exports = { buildMetrics, metricsFromChartMeta, num, div };
