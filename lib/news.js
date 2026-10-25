'use strict';

const { getText } = require('./http');
const { parseFeed } = require('./rss');

const googleNews = (query, lang = 'de') => {
  const loc = lang === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=de&gl=DE&ceid=DE:de';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&${loc}`;
};

/** Kuratierte Nachrichtenkategorien und ihre RSS-Quellen. */
const CATEGORIES = {
  maerkte: {
    label: 'Märkte',
    feeds: [
      { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
      { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
      { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
      { source: 'Financial Times', url: 'https://www.ft.com/markets?format=rss' },
    ],
  },
  deutschland: {
    label: 'Deutschland',
    feeds: [
      { source: 'tagesschau', url: 'https://www.tagesschau.de/wirtschaft/finanzen/index~rss2.xml' },
      { source: 'tagesschau', url: 'https://www.tagesschau.de/wirtschaft/unternehmen/index~rss2.xml' },
      { source: '', url: googleNews('DAX OR Börse OR Anleihen') },
    ],
  },
  levfin: {
    label: 'Leveraged Finance',
    feeds: [
      { source: '', url: googleNews('"leveraged finance" OR "leveraged loan" OR "high yield bond" OR "unitranche"', 'en') },
      { source: '', url: googleNews('"private credit" OR "direct lending" OR "LBO financing"', 'en') },
    ],
  },
  projfin: {
    label: 'Project Finance',
    feeds: [
      { source: '', url: googleNews('"project finance" OR "financial close" OR "infrastructure financing"', 'en') },
      { source: '', url: googleNews('Projektfinanzierung OR "Financial Close" OR Infrastrukturfinanzierung') },
    ],
  },
  ma: {
    label: 'M&A / Private Equity',
    feeds: [
      { source: '', url: googleNews('merger OR acquisition OR takeover OR buyout "private equity"', 'en') },
      { source: '', url: googleNews('Übernahme OR Fusion OR "Private Equity"') },
    ],
  },
  makro: {
    label: 'Makro & Zinsen',
    feeds: [
      { source: '', url: googleNews('EZB OR Fed OR Inflation OR Leitzins OR Rendite Bundesanleihe') },
      { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
    ],
  },
};

function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Mehrere Feeds parallel laden, deduplizieren, nach Datum sortieren. */
async function aggregate(feeds, limit = 60) {
  const results = await Promise.allSettled(
    feeds.map(async (f) => parseFeed(await getText(f.url, { timeout: 8000 }), f.source)),
  );
  const seen = new Set();
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push(`${feeds[i].source || new URL(feeds[i].url).host}: ${r.reason.message}`);
      return;
    }
    for (const item of r.value) {
      const key = normalizeTitle(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  });
  if (!items.length && errors.length) throw new Error(`Keine Nachrichtenquelle erreichbar (${errors.join('; ')})`);
  items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  return { items: items.slice(0, limit), errors };
}

function categoryNews(key) {
  const cat = CATEGORIES[key];
  if (!cat) return null;
  return aggregate(cat.feeds);
}

function searchNews(query, lang) {
  return aggregate([{ source: '', url: googleNews(query, lang) }], 50);
}

function listCategories() {
  return Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }));
}

module.exports = { CATEGORIES, aggregate, categoryNews, searchNews, listCategories, googleNews };
