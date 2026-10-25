'use strict';

/**
 * Minimaler RSS-2.0-/Atom-Parser (ohne Abhängigkeiten). Liefert
 * [{ title, link, source, published, summary }].
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function stripCdata(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(str) {
  return str
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(str) {
  if (!str) return '';
  // Entities zweimal dekodieren: viele Feeds escapen HTML doppelt
  return stripHtml(decodeEntities(stripHtml(decodeEntities(stripCdata(str)))));
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function attr(block, name, attribute) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${attribute}=["']([^"']+)["'][^>]*/?>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(clean(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function truncate(str, max = 280) {
  return str.length > max ? `${str.slice(0, max).replace(/\s+\S*$/, '')} …` : str;
}

function parseFeed(xml, fallbackSource = '') {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  const channelTitle = clean(tag(xml.replace(/<item[\s\S]*$/i, ''), 'title'));

  for (const block of blocks) {
    let title = clean(tag(block, 'title'));
    let link = isAtom ? attr(block, 'link', 'href') : clean(tag(block, 'link')) || clean(tag(block, 'guid'));
    const source = clean(tag(block, 'source')) || fallbackSource || channelTitle;
    const published = toIso(
      tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'),
    );
    let summary = clean(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'));

    // Google News hängt " - Quelle" an den Titel an
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    // Google-News-Beschreibungen wiederholen nur Titel + Quelle
    if (summary && (summary.startsWith(title) || summary === source)) summary = '';
    if (!title || !/^https?:\/\//i.test(link)) continue;

    items.push({ title, link, source, published, summary: truncate(summary) });
  }
  return items;
}

module.exports = { parseFeed, decodeEntities, clean };
