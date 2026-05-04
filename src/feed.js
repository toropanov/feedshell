const crypto = require('node:crypto');

async function fetchFeed(source) {
  assertFetch();

  const response = await fetch(source.url, {
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'user-agent': 'rss-cli/0.1'
    }
  });

  if (!response.ok) {
    throw new Error(`${source.title}: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseFeed(xml, source);
}

function parseFeed(xml, source) {
  const channel = firstMatch(xml, /<channel\b[^>]*>([\s\S]*?)<\/channel>/i) || xml;
  const feedTitle = textFromTag(channel, 'title') || source.title || source.url;
  const rssItems = blocks(xml, 'item');
  const atomEntries = blocks(xml, 'entry');
  const nodes = rssItems.length ? rssItems : atomEntries;

  return {
    title: feedTitle,
    items: nodes.map((node) => parseItem(node, source.id)).filter((item) => item.title && item.link)
  };
}

function parseItem(node, sourceId) {
  const title = textFromTag(node, 'title');
  const link = findLink(node);
  const published = textFromTag(node, 'pubDate')
    || textFromTag(node, 'published')
    || textFromTag(node, 'updated')
    || textFromTag(node, 'dc:date')
    || '';
  const summary = stripTags(textFromTag(node, 'content:encoded')
    || textFromTag(node, 'description')
    || textFromTag(node, 'summary')
    || textFromTag(node, 'content')
    || '');
  const guid = textFromTag(node, 'guid') || link || `${sourceId}:${title}:${published}`;

  return {
    id: stableId(`${sourceId}:${guid}`),
    sourceId,
    title: cleanText(title),
    link: decodeXml(link),
    published: normalizeDate(published),
    summary: cleanText(summary),
    read: false,
    fetchedAt: new Date().toISOString()
  };
}

function mergeArticles(existing, incoming, limit) {
  const seen = new Map();

  for (const item of [...incoming, ...existing]) {
    const current = seen.get(item.id);
    seen.set(item.id, current ? { ...item, read: current.read || item.read } : item);
  }

  return [...seen.values()]
    .sort((a, b) => dateValue(b.published) - dateValue(a.published))
    .slice(0, limit);
}

function blocks(xml, tag) {
  const pattern = new RegExp(`<${escapeRegex(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function textFromTag(xml, tag) {
  const pattern = new RegExp(`<${escapeRegex(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'i');
  const value = firstMatch(xml, pattern);

  return cleanText(value || '');
}

function findLink(node) {
  const rssLink = textFromTag(node, 'link');
  if (rssLink) {
    return rssLink;
  }

  const atomLink = firstMatch(node, /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return atomLink || '';
}

function stripTags(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function cleanText(value) {
  return decodeXml(stripTags(value))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function normalizeDate(value) {
  const date = Date.parse(value);
  return Number.isNaN(date) ? '' : new Date(date).toISOString();
}

function dateValue(value) {
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : date;
}

function stableId(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function firstMatch(value, pattern) {
  const match = value.match(pattern);
  return match ? match[1] : '';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Нужен Node.js 18+ с global fetch.');
  }
}

module.exports = {
  fetchFeed,
  mergeArticles,
  parseFeed
};
