'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed } = require('../lib/rss');

test('parst RSS 2.0 inkl. CDATA, Entities und Google-News-Quelle', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Kanal</title>
    <item>
      <title><![CDATA[Bund platziert Anleihe &amp; mehr - Handelsblatt]]></title>
      <link>https://example.com/a</link>
      <pubDate>Fri, 24 Oct 2026 08:00:00 GMT</pubDate>
      <description>&lt;a href="x"&gt;Bund platziert Anleihe &amp;amp; mehr&lt;/a&gt;</description>
      <source url="https://handelsblatt.com">Handelsblatt</source>
    </item>
    <item>
      <title>Zweite Meldung</title>
      <link>https://example.com/b</link>
      <description><![CDATA[<p>Fließtext mit <b>HTML</b></p>]]></description>
    </item>
    <item><title>Ohne Link</title></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'Bund platziert Anleihe & mehr',
    link: 'https://example.com/a',
    source: 'Handelsblatt',
    published: '2026-10-24T08:00:00.000Z',
    summary: '',
  });
  assert.equal(items[1].summary, 'Fließtext mit HTML');
  assert.equal(items[1].source, 'Kanal');
  assert.equal(items[1].published, null);
});

test('parst Atom-Feeds', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
    <entry><title>Eintrag</title><link href="https://example.com/e"/><updated>2026-10-20T10:00:00Z</updated><summary>Kurz</summary></entry>
  </feed>`;
  const [e] = parseFeed(xml, 'Quelle');
  assert.equal(e.title, 'Eintrag');
  assert.equal(e.link, 'https://example.com/e');
  assert.equal(e.source, 'Quelle');
  assert.equal(e.summary, 'Kurz');
});
