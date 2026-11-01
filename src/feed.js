const crypto = require('node:crypto');

async function fetchFeed(source) {
  assertFetch();

  const response = await fetch(telegramPublicChannelUrl(source.url) || source.url, {
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'user-agent': 'feedshell/0.1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`${source.title}: HTTP ${response.status}`);
  }

  const xml = await response.text();
  const feed = parseFeed(xml, source);
  if (!feed.items.length && !/<(?:rss|feed)\b/i.test(xml)) {
    throw new Error(`${source.title}: URL не является RSS/Atom-лентой`);
  }

  return feed;
}

function parseFeed(xml, source) {
  const vcFeed = parseVcCommunityFeed(xml, source);
  if (vcFeed) {
    return vcFeed;
  }

  const telegramFeed = parseTelegramChannelFeed(xml, source);
  if (telegramFeed) {
    return telegramFeed;
  }

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

function parseTelegramChannelFeed(html, source) {
  const channelUrl = telegramPublicChannelUrl(source.url);
  if (!channelUrl) {
    return null;
  }

  const channel = new URL(channelUrl).pathname.split('/').pop();
  const items = telegramMessageBlocks(html)
    .map((block) => telegramEntry(block, source.id, channel))
    .filter((item) => item.title && item.link);

  if (!items.length) {
    return null;
  }

  return {
    title: telegramChannelTitle(html) || source.title || source.url,
    items
  };
}

function telegramPublicChannelUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 't.me' && hostname !== 'telegram.me' && hostname !== 'www.telegram.me') {
      return '';
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const channel = parts[0] === 's' ? parts[1] : parts[0];
    if (!/^[a-z0-9_]{5,}$/i.test(channel || '')) {
      return '';
    }

    return `https://t.me/s/${channel}`;
  } catch {
    return '';
  }
}

function telegramChannelTitle(html) {
  const title = htmlByClass(html, 'tgme_channel_info_header_title')
    || htmlByClass(html, 'tgme_header_title');
  return cleanText(title);
}

function telegramMessageBlocks(html) {
  const pattern = /<div\b[^>]*\bclass=["'][^"']*\btgme_widget_message_wrap\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass=["'][^"']*\btgme_widget_message_wrap\b|$)/gi;
  return [...String(html).matchAll(pattern)].map((match) => match[1]);
}

function telegramEntry(block, sourceId, channel) {
  const post = attributeValue(block, 'data-post');
  const link = telegramPostLink(block, post, channel);
  const summary = cleanText(htmlByClass(block, 'tgme_widget_message_text'));
  const published = firstMatch(block, /<time\b[^>]*\bdatetime=["']([^"']+)["'][^>]*>/i);
  const title = titleFromArticle(summary) || `Публикация @${channel}`;

  return {
    id: stableId(`${sourceId}:${post || link}`),
    sourceId,
    title: cleanText(title),
    link,
    published: normalizeDate(published),
    summary,
    read: false,
    fetchedAt: new Date().toISOString()
  };
}

function telegramPostLink(block, post, channel) {
  const link = firstMatch(block, /<a\b[^>]*\bclass=["'][^"']*\btgme_widget_message_date\b[^"']*["'][^>]*\bhref=["']([^"']+)["']/i);
  if (link) {
    return decodeXml(link);
  }

  if (post && post.includes('/')) {
    return `https://t.me/${post}`;
  }

  return `https://t.me/${channel}`;
}

function htmlByClass(html, className) {
  const pattern = new RegExp(`<(?:div|span)\\b[^>]*\\bclass=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:div|span)>`, 'i');
  return firstMatch(String(html), pattern);
}

function attributeValue(html, name) {
  return firstMatch(String(html), new RegExp(`\\b${escapeRegex(name)}=["']([^"']*)["']`, 'i'));
}

function parseVcCommunityFeed(html, source) {
  if (!isVcCommunityUrl(source.url)) {
    return null;
  }

  const state = vcInitialState(html);
  const entries = state && state['feed@subsite'] && state['feed@subsite'].items;
  if (!Array.isArray(entries)) {
    return null;
  }

  const pathname = new URL(source.url).pathname.replace(/^\/+|\/+$/g, '');
  const community = state[`subsite@${pathname}`];

  return {
    title: community && community.name || source.title || source.url,
    items: entries
      .filter((entry) => entry && entry.type === 'entry' && entry.data)
      .map((entry) => vcEntry(entry.data, source.id))
      .filter((item) => item.title && item.link)
  };
}

function isVcCommunityUrl(value) {
  try {
    const url = new URL(value);
    return (url.hostname === 'vc.ru' || url.hostname.endsWith('.vc.ru'))
      && /^\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function vcInitialState(html) {
  const marker = 'window.__INITIAL_STATE__ = ';
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const end = html.indexOf(';</script>', start);
  if (end === -1) {
    return null;
  }

  try {
    return JSON.parse(html.slice(start + marker.length, end));
  } catch {
    return null;
  }
}

function vcEntry(entry, sourceId) {
  const published = Number.isFinite(entry.date)
    ? new Date(entry.date * 1000).toISOString()
    : '';
  const link = String(entry.url || '');

  return {
    id: stableId(`${sourceId}:${entry.id || link}`),
    sourceId,
    title: cleanText(entry.title || ''),
    link,
    published,
    summary: cleanText(entry.ogDescription || ''),
    read: false,
    fetchedAt: new Date().toISOString()
  };
}

function parseItem(node, sourceId) {
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
  const feedTitle = textFromTag(node, 'title');
  const title = isGenericHabrPostTitle(feedTitle) ? titleFromArticle(summary) : feedTitle || titleFromArticle(summary);
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

function isGenericHabrPostTitle(title) {
  return /^Пост @.+ — .+ — (?:\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}|N\/P)$/u.test(String(title).trim());
}

function titleFromArticle(text) {
  const firstLine = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
  const periodIndex = firstLine.indexOf('.');

  return (periodIndex === -1 ? firstLine : firstLine.slice(0, periodIndex)).trim();
}

function mergeArticles(existing, incoming, limit) {
  const seen = new Map();

  for (const item of [...incoming, ...existing]) {
    const current = seen.get(item.id);
    seen.set(item.id, current ? { ...item, read: current.read || item.read } : item);
  }

  const sorted = [...seen.values()]
    .sort((a, b) => dateValue(b.published) - dateValue(a.published));

  if (!Number.isFinite(limit) || limit <= 0) {
    return sorted;
  }

  const unread = sorted.filter((item) => !item.read);
  const read = sorted.filter((item) => item.read);
  const keepRead = Math.max(0, limit - unread.length);

  return [...unread, ...read.slice(0, keepRead)]
    .sort((a, b) => dateValue(b.published) - dateValue(a.published));
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
