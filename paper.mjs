import { isbn13, normalize } from './theme.mjs';

function unescapeXml(value = '') {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&(amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi,
    (entity, name) => {
      const names = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
      if (name in names) return names[name];
      const point = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }).trim();
}

export function parseEditions(xml, title) {
  const editions = new Map();
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const field = tag => unescapeXml(item.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))?.[1]);
    const match = item.match(/<dc:identifier xsi:type="dcndl:ISBN(?:13)?">([^<]+)<\/dc:identifier>/);
    const isbn = isbn13(match?.[1] ?? '');
    const name = field('title');
    if (!isbn || !name || !/<category>紙<\/category>/.test(item) || editions.has(isbn)) continue;
    const link = field('link');
    editions.set(isbn, { id: 'isbn:' + isbn, isbn, title: name, publisher: field('dc:publisher'),
      author: field('author').replace(/,\s*(?:\d.*|著)$/, '').replaceAll(', ', ' '),
      year: field('dcterms:issued'), card: link.startsWith('https://ndlsearch.ndl.go.jp/books/') ? link : '' });
  }
  const q = normalize(title);
  const rank = title => normalize(title) === q ? 0 : normalize(title).startsWith(q) ? 1 : 2;
  return [...editions.values()].sort((a,b) => rank(a.title) - rank(b.title)).slice(0, 35);
}

export function ndlUrl(query, author = '') {
  const url = new URL('https://ndlsearch.ndl.go.jp/api/opensearch');
  const isbn = isbn13(query);
  url.search = new URLSearchParams({ cnt: '80', mediatype: 'booklet', dpid: 'iss-ndl-opac',
    ...(isbn ? { isbn } : { title: query, ...(author ? { creator: author } : {}) }) });
  return url;
}