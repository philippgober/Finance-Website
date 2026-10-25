'use strict';

/** Ausschnitt einer Yahoo-quoteSummary-Antwort (formatted=false). */
const quoteSummary = {
  price: {
    symbol: 'SIE.DE',
    longName: 'Siemens Aktiengesellschaft',
    exchangeName: 'XETRA',
    quoteType: 'EQUITY',
    marketState: 'CLOSED',
    currency: 'EUR',
    regularMarketPrice: 200,
    regularMarketChange: 4,
    regularMarketChangePercent: 0.020408,
    regularMarketPreviousClose: 196,
    regularMarketTime: 1761321600,
    marketCap: 160e9,
  },
  summaryDetail: {
    trailingPE: 20,
    forwardPE: 17.5,
    dividendYield: 0.025,
    payoutRatio: 0.5,
    beta: 1.1,
    fiftyTwoWeekHigh: 210,
    fiftyTwoWeekLow: 150,
  },
  defaultKeyStatistics: {
    enterpriseValue: 200e9,
    enterpriseToEbitda: 12.5,
    enterpriseToRevenue: 2.5,
    priceToBook: 3,
    sharesOutstanding: 800e6,
    '52WeekChange': 0.2,
  },
  financialData: {
    financialCurrency: 'EUR',
    totalRevenue: 80e9,
    ebitda: 16e9,
    totalDebt: 50e9,
    totalCash: 10e9,
    freeCashflow: 8e9,
    operatingCashflow: 12e9,
    ebitdaMargins: 0.2,
    debtToEquity: 85.5,
    revenueGrowth: 0.05,
    recommendationKey: 'buy',
  },
  assetProfile: { sector: 'Industrials', industry: 'Conglomerates', country: 'Germany', fullTimeEmployees: 320000 },
  incomeStatementHistory: { incomeStatementHistory: [{ ebit: 12e9, interestExpense: -1.5e9 }] },
  calendarEvents: { earnings: { earningsDate: [1763020800] } },
};

const chart = {
  chart: {
    result: [
      {
        meta: { symbol: 'SIE.DE', currency: 'EUR', regularMarketPrice: 200, chartPreviousClose: 196, fiftyTwoWeekHigh: 210, longName: 'Siemens AG' },
        timestamp: [1761000000, 1761086400, 1761172800],
        indicators: { quote: [{ close: [195, null, 200] }] },
      },
    ],
    error: null,
  },
};

module.exports = { quoteSummary, chart };
