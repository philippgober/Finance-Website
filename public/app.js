'use strict';

/* ---------- Hilfsfunktionen ---------- */

const $ = (sel) => document.querySelector(sel);
const LOCALE = 'de-DE';
const WATCHLIST_KEY = 'finance-desk:watchlist';
const DEFAULT_WATCHLIST = ['SAP.DE', 'SIE.DE', 'ALV.DE', 'AAPL', 'MSFT'];

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#';
}

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
  return body;
}

const nf = (digits) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);

function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e12) return `${NF2.format(v / 1e12)} Bio.`;
  if (a >= 1e9) return `${NF2.format(v / 1e9)} Mrd.`;
  if (a >= 1e6) return `${NF1.format(v / 1e6)} Mio.`;
  if (a >= 1e4) return `${NF1.format(v / 1e3)} Tsd.`;
  return NF0.format(v);
}

/** Formatiert einen Kennzahlwert nach Typ. Gibt { text, na } zurück. */
function fmt(value, type, { currency, financialCurrency, key } = {}) {
  if (value == null || Number.isNaN(value)) return { text: 'n/a', na: true };
  switch (type) {
    case 'money':
      return { text: `${compact(value)} ${financialCurrency || ''}`.trim() };
    case 'price':
      return { text: `${NF2.format(value)} ${currency || ''}`.trim() };
    case 'x':
      if (key === 'netLeverage' && value < 0) return { text: 'Net Cash' };
      if (value < 0) return { text: 'n. m.', na: true };
      return { text: `${NF1.format(value)}x` };
    case 'pct':
      return { text: `${NF1.format(value * 100)} %` };
    case 'ratio':
      return { text: NF2.format(value) };
    case 'int':
      return { text: compact(value) };
    case 'date':
      return { text: new Date(value).toLocaleDateString(LOCALE) };
    default:
      return { text: String(value) };
  }
}

function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 7 * 86400) return `vor ${Math.floor(diff / 86400)} Tg.`;
  return new Date(iso).toLocaleDateString(LOCALE);
}

function signClass(v) {
  return v > 0 ? 'up' : v < 0 ? 'down' : '';
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- Watchlist ---------- */

let memWatchlist = null;

const watchlist = {
  get() {
    if (memWatchlist) return [...memWatchlist];
    try {
      const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
      memWatchlist = Array.isArray(list) ? list : [...DEFAULT_WATCHLIST];
    } catch {
      memWatchlist = [...DEFAULT_WATCHLIST];
    }
    return [...memWatchlist];
  },
  set(list) {
    memWatchlist = [...list];
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    } catch {
      /* Speicher nicht verfügbar – Watchlist gilt nur für die Sitzung */
    }
  },
  has(sym) {
    return this.get().includes(sym);
  },
  toggle(sym) {
    const list = this.get();
    this.set(list.includes(sym) ? list.filter((s) => s !== sym) : [...list, sym]);
  },
};

/* ---------- Routing ---------- */

const state = { view: 'news', symbol: null, range: '1y', newsCategory: 'maerkte', compsSort: { key: null, asc: false } };

function parseHash() {
  const [view, sym] = location.hash.replace(/^#\/?/, '').split('/');
  return { view: ['news', 'stocks', 'comps'].includes(view) ? view : 'news', symbol: sym ? decodeURIComponent(sym) : null };
}

function route() {
  const { view, symbol } = parseHash();
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'news') initNews();
  if (view === 'stocks') {
    renderWatchlist();
    if (symbol && symbol !== state.symbol) loadStock(symbol);
    if (!symbol && !state.symbol) showEmpty();
  }
  if (view === 'comps') loadComps();
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    location.hash = t.dataset.view === 'stocks' && state.symbol ? `stocks/${encodeURIComponent(state.symbol)}` : t.dataset.view;
  }),
);
window.addEventListener('hashchange', route);

/* ---------- Nachrichten ---------- */

let newsInitialized = false;
let newsTimer = null;

async function initNews() {
  if (!newsInitialized) {
    newsInitialized = true;
    try {
      const { categories } = await api('/api/news/categories');
      const box = $('#news-categories');
      box.innerHTML = categories
        .map((c) => `<button class="chip" data-cat="${esc(c.id)}">${esc(c.label)}</button>`)
        .join('');
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.newsCategory = btn.dataset.cat;
        $('#news-query').value = '';
        loadNews();
      });
    } catch (e) {
      setStatus('#news-status', e.message, true);
    }
    $('#news-search').addEventListener('submit', (e) => {
      e.preventDefault();
      loadNews();
    });
    loadNews();
  }
}

async function loadNews() {
  clearTimeout(newsTimer);
  const q = $('#news-query').value.trim();
  const lang = $('#news-lang').value;
  document.querySelectorAll('#news-categories .chip').forEach((c) =>
    c.classList.toggle('active', !q && c.dataset.cat === state.newsCategory),
  );
  setStatus('#news-status', 'Lade Nachrichten …');
  try {
    const url = q ? `/api/news?q=${encodeURIComponent(q)}&lang=${lang}` : `/api/news?category=${state.newsCategory}`;
    const { items, errors } = await api(url);
    renderNews($('#news-list'), items);
    const stamp = new Date().toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    const errInfo = errors?.length ? ` · ${errors.length} Quelle(n) nicht erreichbar` : '';
    setStatus('#news-status', `${items.length} Meldungen · aktualisiert ${stamp}${errInfo}`);
  } catch (e) {
    $('#news-list').innerHTML = '';
    setStatus('#news-status', e.message, true);
  }
  // Automatische Aktualisierung alle 5 Minuten
  newsTimer = setTimeout(() => state.view === 'news' && loadNews(), 5 * 60 * 1000);
}

function renderNews(list, items) {
  if (!items.length) {
    list.innerHTML = '<li class="empty">Keine Meldungen gefunden.</li>';
    return;
  }
  list.innerHTML = items
    .map(
      (n) => `<li>
        <div class="src"><b>${esc(n.source)}</b><span title="${esc(n.published ? new Date(n.published).toLocaleString(LOCALE) : '')}">${esc(relTime(n.published))}</span></div>
        <a class="title" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
      </li>`,
    )
    .join('');
}

function setStatus(sel, text, isError = false) {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/* ---------- Aktiensuche ---------- */

const input = $('#stock-query');
const sugBox = $('#suggestions');
let suggestions = [];
let activeIdx = -1;

const runSearch = debounce(async (q) => {
  if (q.length < 1) return hideSuggestions();
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (input.value.trim() !== q) return;
    suggestions = results;
    activeIdx = -1;
    renderSuggestions();
  } catch {
    hideSuggestions();
  }
}, 250);

function renderSuggestions() {
  if (!suggestions.length) return hideSuggestions();
  sugBox.innerHTML = suggestions
    .map(
      (s, i) => `<li role="option" data-i="${i}" aria-selected="${i === activeIdx}">
        <span class="sym">${esc(s.symbol)}</span><span>${esc(s.name)}</span><span class="exch">${esc(s.exchange)} · ${esc(s.type)}</span>
      </li>`,
    )
    .join('');
  sugBox.hidden = false;
}

function hideSuggestions() {
  sugBox.hidden = true;
  suggestions = [];
}

function pick(symbol) {
  hideSuggestions();
  input.value = '';
  location.hash = `stocks/${encodeURIComponent(symbol)}`;
}

input.addEventListener('input', () => runSearch(input.value.trim()));
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return;
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    renderSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const s = suggestions[activeIdx] || suggestions[0];
    if (s) pick(s.symbol);
    else if (input.value.trim()) pick(input.value.trim().toUpperCase());
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});
sugBox.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) pick(suggestions[Number(li.dataset.i)].symbol);
});
input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

function renderWatchlist() {
  const list = watchlist.get();
  $('#watchlist').innerHTML = list.length
    ? list
        .map(
          (s) => `<button class="chip ${s === state.symbol ? 'active' : ''}" data-sym="${esc(s)}">${esc(s)}<span class="x" data-remove="${esc(s)}" title="Entfernen">×</span></button>`,
        )
        .join('')
    : '<span class="meta">Noch leer – füge Aktien über „☆ Watchlist“ hinzu.</span>';
}

$('#watchlist').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    watchlist.toggle(rm.dataset.remove);
    renderWatchlist();
    updateWatchButton();
    return;
  }
  const chip = e.target.closest('[data-sym]');
  if (chip) location.hash = `stocks/${encodeURIComponent(chip.dataset.sym)}`;
});

/* ---------- Aktiendetail ---------- */

let current = null;

function showEmpty() {
  $('#stock-empty').hidden = false;
  $('#stock-detail').hidden = true;
}

function updateWatchButton() {
  const btn = $('#sd-watch');
  const on = state.symbol && watchlist.has(state.symbol);
  btn.textContent = on ? '★ In Watchlist' : '☆ Watchlist';
  btn.classList.toggle('on', !!on);
}

$('#sd-watch').addEventListener('click', () => {
  if (!state.symbol) return;
  watchlist.toggle(state.symbol);
  updateWatchButton();
  renderWatchlist();
});

async function loadStock(symbol) {
  state.symbol = symbol;
  renderWatchlist();
  $('#stock-empty').hidden = true;
  $('#stock-detail').hidden = false;
  $('#sd-name').textContent = symbol;
  $('#sd-meta').textContent = 'Lade Daten …';
  $('#sd-price').textContent = '';
  $('#sd-change').textContent = '';
  $('#sd-time').textContent = '';
  $('#sd-warning').hidden = true;
  $('#metrics').innerHTML = '';
  $('#profile').innerHTML = '';
  $('#description').textContent = '';
  $('#stock-news').innerHTML = '';
  updateWatchButton();

  loadChart(symbol, state.range);
  loadStockNews(symbol);

  try {
    const data = await api(`/api/stock/${encodeURIComponent(symbol)}`);
    if (state.symbol !== symbol) return;
    current = data;
    renderStock(data);
  } catch (e) {
    if (state.symbol !== symbol) return;
    $('#sd-meta').textContent = '';
    const w = $('#sd-warning');
    w.textContent = e.message;
    w.hidden = false;
  }
}

function renderStock(d) {
  const q = d.quote || {};
  $('#sd-name').textContent = d.name || d.symbol;
  $('#sd-meta').textContent = [d.symbol, d.exchange, d.currency, d.profile?.sector].filter(Boolean).join(' · ');
  $('#sd-price').textContent = q.price != null ? `${NF2.format(q.price)} ${d.currency || ''}` : 'n/a';
  const ch = $('#sd-change');
  if (q.change != null) {
    const sign = q.change > 0 ? '+' : '';
    ch.textContent = `${sign}${NF2.format(q.change)} (${sign}${NF2.format((q.changePct ?? 0) * 100)} %)`;
    ch.className = `change ${signClass(q.change)}`;
  }
  const marketState = { REGULAR: 'Handel geöffnet', PRE: 'Vorbörse', POST: 'Nachbörse', CLOSED: 'Handel geschlossen' }[d.marketState] || '';
  $('#sd-time').textContent = [q.time ? new Date(q.time).toLocaleString(LOCALE) : '', marketState].filter(Boolean).join(' · ');

  const warnings = [];
  if (d.warning) warnings.push(d.warning);
  if (d.financialCurrency && d.currency && d.financialCurrency !== d.currency) {
    warnings.push(`Hinweis: Kurs in ${d.currency}, Bilanz-/GuV-Werte in Berichtswährung ${d.financialCurrency}.`);
  }
  if (warnings.length) {
    $('#sd-warning').textContent = warnings.join(' ');
    $('#sd-warning').hidden = false;
  }

  const ctx = { currency: d.currency, financialCurrency: d.financialCurrency };
  $('#metrics').innerHTML = d.groups
    .map(
      (g) => `<div class="card"><h2>${esc(g.title)}</h2><dl class="kpis">${g.items
        .map((i) => {
          const f = fmt(i.value, i.type, { ...ctx, key: i.key });
          return `<div><dt${i.hint ? ` title="${esc(i.hint)}"` : ''}>${esc(i.label)}</dt><dd class="${f.na ? 'na' : ''}">${esc(f.text)}</dd></div>`;
        })
        .join('')}</dl></div>`,
    )
    .join('');

  const p = d.profile || {};
  const recs = { strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell' };
  const rows = [
    ['Sektor', p.sector],
    ['Branche', p.industry],
    ['Sitz', [p.city, p.country].filter(Boolean).join(', ')],
    ['Mitarbeiter', p.employees != null ? NF0.format(p.employees) : null],
    ['Analystenkonsens', recs[p.recommendation] || p.recommendation],
    ['Website', p.website ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(p.website.replace(/^https?:\/\//, ''))}</a>` : null, true],
  ].filter((r) => r[1]);
  $('#profile').innerHTML = rows.map(([k, v, html]) => `<dt>${esc(k)}</dt><dd>${html ? v : esc(v)}</dd>`).join('');
  $('#description').textContent = p.description || (rows.length ? '' : 'Kein Profil verfügbar.');
}

async function loadStockNews(symbol) {
  const list = $('#stock-news');
  list.innerHTML = '<li class="meta">Lade …</li>';
  try {
    const { items } = await api(`/api/stock/${encodeURIComponent(symbol)}/news`);
    if (state.symbol !== symbol) return;
    renderNews(list, items.slice(0, 10));
  } catch (e) {
    if (state.symbol === symbol) list.innerHTML = `<li class="meta">${esc(e.message)}</li>`;
  }
}

/* ---------- Kurschart (SVG) ---------- */

let chartData = null;

$('#ranges').addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (!b || !state.symbol) return;
  state.range = b.dataset.range;
  loadChart(state.symbol, state.range);
});

async function loadChart(symbol, range) {
  document.querySelectorAll('#ranges button').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
  const box = $('#chart');
  box.innerHTML = '<div class="empty">Lade Kursverlauf …</div>';
  $('#chart-perf').textContent = '';
  try {
    const data = await api(`/api/stock/${encodeURIComponent(symbol)}/chart?range=${range}`);
    if (state.symbol !== symbol || state.range !== range) return;
    chartData = data;
    drawChart();
  } catch (e) {
    if (state.symbol === symbol) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function drawChart() {
  const box = $('#chart');
  const d = chartData;
  if (!d || d.points.length < 2) {
    box.innerHTML = '<div class="empty">Keine Kursdaten für diesen Zeitraum.</div>';
    return;
  }
  const W = box.clientWidth || 800;
  const H = box.clientHeight || 300;
  const pad = { l: 8, r: 64, t: 10, b: 24 };
  const pts = d.points;
  const base = (d.range === '1d' && d.previousClose) || pts[0][1];
  const last = pts[pts.length - 1][1];
  const perf = last / base - 1;

  const ys = pts.map((p) => p[1]);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  const span = max - min || max * 0.01 || 1;
  min -= span * 0.05;
  max += span * 0.05;

  const x = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
  const color = perf >= 0 ? 'var(--up)' : 'var(--down)';

  const yTicks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const intraday = d.range === '1d' || d.range === '5d';
  const fmtDate = (t) =>
    new Date(t).toLocaleDateString(LOCALE, intraday ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : d.range === '5y' || d.range === 'max' ? { month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' });
  const xTickIdx = Array.from({ length: 5 }, (_, i) => Math.round((i * (pts.length - 1)) / 4));

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Kursverlauf">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${yTicks.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${W - pad.r + 6}" y="${y(v) + 4}">${NF2.format(v)}</text>`).join('')}
    ${xTickIdx.map((i, k) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${esc(fmtDate(pts[i][0]))}</text>`).join('')}
    ${d.range === '1d' && d.previousClose ? `<line class="cross" x1="${pad.l}" x2="${W - pad.r}" y1="${y(base)}" y2="${y(base)}"/>` : ''}
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
    <line class="cross" id="cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <circle id="dot" r="4" fill="${color}" visibility="hidden"/>
  </svg><div class="tooltip" hidden></div>`;

  const perfEl = $('#chart-perf');
  perfEl.textContent = `${perf >= 0 ? '+' : ''}${NF2.format(perf * 100)} % im Zeitraum`;
  perfEl.className = `chart-perf ${signClass(perf)}`;

  const svg = box.querySelector('svg');
  const tip = box.querySelector('.tooltip');
  const cross = svg.querySelector('#cross');
  const dot = svg.querySelector('#dot');
  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (pts.length - 1))));
    const [t, v] = pts[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(v));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    const when = new Date(t).toLocaleString(LOCALE, intraday ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' });
    tip.textContent = `${when} · ${NF2.format(v)} ${d.currency || ''}`;
    tip.hidden = false;
    const left = (x(i) / W) * rect.width;
    tip.style.left = `${Math.min(left + 10, rect.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.max(0, (y(v) / H) * rect.height - 34)}px`;
  });
  svg.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}

window.addEventListener('resize', debounce(() => state.view === 'stocks' && chartData && drawChart(), 150));

/* ---------- Peer-Vergleich ---------- */

const COMPS_COLS = [
  { key: 'marketCap', label: 'Marktkap.', type: 'money', median: false },
  { key: 'ev', label: 'EV', type: 'money', median: false },
  { key: 'evRevenue', label: 'EV/Umsatz', type: 'x' },
  { key: 'evEbitda', label: 'EV/EBITDA', type: 'x' },
  { key: 'peTrailing', label: 'KGV TTM', type: 'x' },
  { key: 'peForward', label: 'KGV fwd', type: 'x' },
  { key: 'ebitdaMargin', label: 'EBITDA-Marge', type: 'pct' },
  { key: 'revenueGrowth', label: 'Umsatz-Wachst.', type: 'pct' },
  { key: 'netLeverage', label: 'Net Debt/EBITDA', type: 'x' },
  { key: 'dividendYield', label: 'Div.-Rendite', type: 'pct' },
  { key: 'beta', label: 'Beta', type: 'ratio' },
  { key: 'change52', label: '52W-Perf.', type: 'pct' },
];

let compsRows = [];

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function loadComps() {
  const list = watchlist.get();
  if (!list.length) {
    $('#comps-table').innerHTML = '';
    setStatus('#comps-status', 'Die Watchlist ist leer. Füge im Tab „Aktien“ Werte hinzu.');
    return;
  }
  setStatus('#comps-status', `Lade ${list.length} Werte …`);
  const results = await mapLimit(list, 4, async (sym) => {
    try {
      return await api(`/api/stock/${encodeURIComponent(sym)}`);
    } catch (e) {
      return { symbol: sym, name: sym, error: e.message, summary: {} };
    }
  });
  compsRows = results;
  const failed = results.filter((r) => r.error || r.partial).map((r) => r.symbol);
  setStatus('#comps-status', failed.length ? `Unvollständige Daten für: ${failed.join(', ')}` : `${results.length} Werte geladen.`);
  renderComps();
}

function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function renderComps() {
  const { key: sortKey, asc } = state.compsSort;
  const rows = [...compsRows];
  if (sortKey) {
    rows.sort((a, b) => {
      const va = a.summary?.[sortKey];
      const vb = b.summary?.[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? va - vb : vb - va;
    });
  }
  const th = COMPS_COLS.map(
    (c) => `<th data-key="${c.key}" class="${sortKey === c.key ? `sorted ${asc ? 'asc' : ''}` : ''}">${esc(c.label)}</th>`,
  ).join('');
  const body = rows
    .map((r) => {
      const ctx = { currency: r.currency, financialCurrency: r.currency };
      const cells = COMPS_COLS.map((c) => {
        const f = fmt(r.summary?.[c.key], c.type, { ...ctx, key: c.key });
        return `<td class="${f.na ? 'na' : ''}">${esc(f.text)}</td>`;
      }).join('');
      const price = r.quote?.price != null ? `${NF2.format(r.quote.price)} ${r.currency || ''}` : 'n/a';
      return `<tr><td><a href="#stocks/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a><span class="meta">${esc(r.name || '')}</span></td><td>${esc(price)}</td>${cells}</tr>`;
    })
    .join('');
  const med = COMPS_COLS.map((c) => {
    if (c.median === false) return '<td></td>';
    // Negative Multiples (n. m.) gehen nicht in den Median ein
    const vals = rows.map((r) => r.summary?.[c.key]).filter((v) => !(c.type === 'x' && c.key !== 'netLeverage' && v < 0));
    const f = fmt(median(vals), c.type, { key: c.key });
    return `<td class="${f.na ? 'na' : ''}">${esc(f.text)}</td>`;
  }).join('');
  $('#comps-table').innerHTML = `<thead><tr><th>Unternehmen</th><th>Kurs</th>${th}</tr></thead><tbody>${body}</tbody><tfoot><tr><td>Median</td><td></td>${med}</tr></tfoot>`;
}

$('#comps-table').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  state.compsSort = { key, asc: state.compsSort.key === key ? !state.compsSort.asc : false };
  renderComps();
});

$('#comps-refresh').addEventListener('click', loadComps);

/* ---------- Uhr & Start ---------- */

function tick() {
  const now = new Date();
  const fmtTz = (tz) => now.toLocaleTimeString(LOCALE, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  $('#clock').textContent = `FRA ${fmtTz('Europe/Berlin')} · LDN ${fmtTz('Europe/London')} · NYC ${fmtTz('America/New_York')}`;
}
tick();
setInterval(tick, 30 * 1000);

route();
