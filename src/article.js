async function loadFullArticle(url) {
  assertFetch();

  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'user-agent': 'rss-cli/0.1'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при загрузке статьи`);
  }

  const html = await response.text();
  const title = pickTitle(html);
  const text = extractReadableText(html);

  return {
    title,
    text: text || 'Не удалось извлечь полный текст статьи.',
    url
  };
}

function extractReadableText(html) {
  const clean = String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, ' ');

  const article = firstBlock(clean, 'article') || firstBlock(clean, 'main') || bestContentBlock(clean);
  return htmlToText(article || clean);
}

function bestContentBlock(html) {
  const candidates = [...html.matchAll(/<(section|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[0])
    .filter((block) => paragraphCount(block) >= 3)
    .sort((a, b) => scoreBlock(b) - scoreBlock(a));

  return candidates[0] || '';
}

function scoreBlock(block) {
  return paragraphCount(block) * 25 + htmlToText(block).length;
}

function paragraphCount(block) {
  return (block.match(/<p\b/gi) || []).length;
}

function firstBlock(html, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = html.match(pattern);
  return match ? match[1] : '';
}

function pickTitle(html) {
  return decodeHtml(firstMatch(html, /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
    || '').trim();
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
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
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

module.exports = {
  extractReadableText,
  loadFullArticle
};
