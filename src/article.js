async function loadFullArticle(url) {
  assertFetch();

  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'user-agent': 'feedshell/0.1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при загрузке статьи`);
  }

  const html = await response.text();
  const title = pickTitle(html);
  const text = extractReadableText(html, title);

  return {
    title,
    text: text || 'Не удалось извлечь полный текст статьи.',
    url
  };
}

function extractReadableText(html, title = '') {
  const source = String(html);
  const structured = articleBodyFromJsonLd(source);
  if (structured && !sameText(structured, title)) {
    return removeLeadingTitle(htmlToText(structured), title);
  }

  const clean = stripNoiseElements(source);
  const article = bestContentBlock(clean);
  return removeLeadingTitle(htmlToText(article || clean), title);
}

function bestContentBlock(html) {
  const candidates = collectContentBlocks(html)
    .map((block) => ({ ...block, score: scoreBlock(block) }))
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0] ? candidates[0].html : '';
}

function scoreBlock(block) {
  const text = htmlToText(block.html);
  const words = wordCount(text);
  const paragraphs = paragraphCount(block.html);
  const density = linkDensity(block.html);

  if (words < 20 && paragraphs < 2) {
    return 0;
  }

  return words
    + paragraphs * 45
    + positiveAttributeScore(block.openTag)
    + tagScore(block.tag)
    - negativeAttributeScore(block.openTag) * 120
    - Math.round(words * density * 2);
}

function paragraphCount(block) {
  return (block.match(/<p\b/gi) || []).length;
}

function collectContentBlocks(html) {
  const contentTags = new Set(['article', 'main', 'section', 'div']);
  const blocks = [];
  const stack = [];
  const pattern = /<\/?([a-z][a-z0-9:-]*)\b[^>]*\/?>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const openTag = match[0];
    const tag = match[1].toLowerCase();
    const closing = openTag.startsWith('</');
    const selfClosing = openTag.endsWith('/>') || VOID_TAGS.has(tag);

    if (closing) {
      const index = lastStackIndex(stack, tag);
      if (index === -1) {
        continue;
      }

      const [item] = stack.splice(index, 1);
      if (contentTags.has(tag)) {
        blocks.push({
          tag,
          openTag: item.openTag,
          html: html.slice(item.start, pattern.lastIndex)
        });
      }
    } else if (!selfClosing) {
      stack.push({ tag, start: match.index, openTag });
    }
  }

  return blocks;
}

function stripNoiseElements(html) {
  return stripElements(html.replace(/<!--[\s\S]*?-->/g, ' '), (tag, openTag) => {
    return STRIP_TAGS.has(tag) || (ATTRIBUTE_FILTER_TAGS.has(tag) && isNoisyOpenTag(openTag));
  }).replace(/<(input|link|meta|source|track)\b[^>]*>/gi, ' ');
}

function stripElements(html, shouldStrip) {
  const ranges = [];
  const stack = [];
  const pattern = /<\/?([a-z][a-z0-9:-]*)\b[^>]*\/?>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const openTag = match[0];
    const tag = match[1].toLowerCase();
    const closing = openTag.startsWith('</');
    const selfClosing = openTag.endsWith('/>') || VOID_TAGS.has(tag);

    if (closing) {
      const index = lastStackIndex(stack, tag);
      if (index === -1) {
        continue;
      }

      const [item] = stack.splice(index, 1);
      if (item.strip) {
        ranges.push({ start: item.start, end: pattern.lastIndex });
      }
    } else if (selfClosing) {
      if (shouldStrip(tag, openTag)) {
        ranges.push({ start: match.index, end: pattern.lastIndex });
      }
    } else {
      stack.push({ tag, start: match.index, strip: shouldStrip(tag, openTag) });
    }
  }

  return removeRanges(html, ranges);
}

function removeRanges(value, ranges) {
  if (!ranges.length) {
    return value;
  }

  const merged = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  let result = '';
  let index = 0;
  for (const range of merged) {
    result += value.slice(index, range.start);
    result += ' ';
    index = range.end;
  }

  return result + value.slice(index);
}

function lastStackIndex(stack, tag) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].tag === tag) {
      return index;
    }
  }

  return -1;
}

function pickTitle(html) {
  return decodeHtml(firstMatch(html, /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
    || '').trim();
}

function articleBodyFromJsonLd(html) {
  const scripts = String(html).match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of scripts) {
    const raw = firstMatch(script, /<script\b[^>]*>([\s\S]*?)<\/script>/i);
    const json = cleanJsonScript(raw);

    for (const candidate of [json, decodeHtml(json)]) {
      let data;
      try {
        data = JSON.parse(candidate);
      } catch {
        continue;
      }

      const body = findArticleBody(data);
      if (wordCount(body) >= 30) {
        return body;
      }
    }
  }

  return '';
}

function cleanJsonScript(value) {
  return String(value)
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '')
    .trim();
}

function findArticleBody(value) {
  if (!value) {
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const body = findArticleBody(item);
      if (body) {
        return body;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  if (typeof value.articleBody === 'string') {
    return value.articleBody;
  }

  for (const key of ['@graph', 'mainEntity', 'hasPart', 'articleSection']) {
    const body = findArticleBody(value[key]);
    if (body) {
      return body;
    }
  }

  return '';
}

function htmlToText(html) {
  return decodeHtml(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h[1-6]|p|li|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h[1-6]|p|li|blockquote|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isNoiseLine(line))
    .join('\n\n')
    .trim();
}

function linkDensity(html) {
  const text = htmlToText(html);
  if (!text) {
    return 0;
  }

  const linkText = htmlToText((String(html).match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []).join(' '));
  return linkText.length / text.length;
}

function wordCount(value) {
  return (String(value).match(/[A-Za-zА-Яа-яЁё0-9]+/g) || []).length;
}

function tagScore(tag) {
  if (tag === 'article') {
    return 250;
  }

  if (tag === 'main') {
    return 160;
  }

  return 0;
}

function positiveAttributeScore(openTag) {
  const attrs = attributeText(openTag);
  let score = 0;

  if (/\b(article|content|entry|main|post|story|text|body)\b/i.test(attrs)) {
    score += 220;
  }

  if (/\b(article[-_]?body|articlebody)\b/i.test(attrs)) {
    score += 520;
  }

  if (/\b(news|publication|single)\b/i.test(attrs)) {
    score += 80;
  }

  return score;
}

function negativeAttributeScore(openTag) {
  const attrs = attributeText(openTag);
  let score = 0;

  if (NOISE_ATTRIBUTE_PATTERN.test(attrs)) {
    score += 2;
  }

  if (/\b(navigation|complementary|banner|contentinfo|search)\b/i.test(attrs)) {
    score += 3;
  }

  return score;
}

function isNoisyOpenTag(openTag) {
  const attrs = attributeText(openTag);
  return NOISE_ATTRIBUTE_PATTERN.test(attrs)
    || /\b(navigation|complementary|banner|contentinfo|search)\b/i.test(attrs);
}

function isNoiseLine(line) {
  const normalized = String(line).replace(/\s+/g, ' ').trim();

  if (normalized.length > 90) {
    return false;
  }

  return /^(advertisement|comments?|continue reading|more from|read also|recommended|related|share|sign up|subscribe|trending)$/i.test(normalized)
    || /^(комментари[ия]|поделиться|подписаться|реклама|рекомендуем|читайте также|ещ[её] по теме)$/i.test(normalized);
}

function removeLeadingTitle(text, title) {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return String(text || '').trim();
  }

  const lines = String(text || '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  if (lines.length && normalizeText(lines[0]) === normalizedTitle) {
    lines.shift();
  }

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  return lines.join('\n').trim();
}

function sameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value) {
  return decodeHtml(String(value || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function attributeText(openTag) {
  return String(openTag)
    .replace(/^<\/?[a-z][a-z0-9:-]*/i, ' ')
    .replace(/\/?>$/i, ' ')
    .replace(/["']/g, ' ')
    .toLowerCase();
}

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    bull: '•',
    copy: '©',
    ensp: ' ',
    emsp: ' ',
    hellip: '…',
    laquo: '«',
    ldquo: '“',
    lsquo: '‘',
    nbsp: ' ',
    gt: '>',
    lt: '<',
    mdash: '—',
    ndash: '–',
    para: '¶',
    quot: '"',
    raquo: '»',
    rdquo: '”',
    rsquo: '’',
    trade: '™'
  };

  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] || `&${name};`);
}

function firstMatch(value, pattern) {
  const match = value.match(pattern);
  return match ? match[1] : '';
}

function assertFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Нужен Node.js 18+ с global fetch.');
  }
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

const STRIP_TAGS = new Set([
  'aside',
  'button',
  'canvas',
  'dialog',
  'footer',
  'form',
  'header',
  'iframe',
  'menu',
  'nav',
  'noscript',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea'
]);

const ATTRIBUTE_FILTER_TAGS = new Set([
  'div',
  'ol',
  'section',
  'ul'
]);

const NOISE_ATTRIBUTE_PATTERN = /\b(ad|ads|advert|advertisement|article-card|banner|breadcrumb|comment|comments|cookie|display-card|modal|newsletter|outbrain|popup|popular|promo|recommend|recommended|recommendation|related|share|social|subscribe|taboola|tags|teaser|trending|widget|yandex|zen)\b/i;

module.exports = {
  extractReadableText,
  loadFullArticle
};
