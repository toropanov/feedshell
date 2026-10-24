const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { extractReadableHtml } = require('./article');

async function archiveArticle(article, configPath, options = {}) {
  assertFetch();

  const url = String(article && (article.link || article.url) || '');
  if (!url) {
    throw new Error('У статьи нет URL.');
  }

  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'user-agent': 'feedshell/0.1.1'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при загрузке статьи`);
  }

  const sourceHtml = await response.text();
  const title = pickTitle(sourceHtml) || article.title || url;
  const directory = options.directory || archiveDirectory(configPath, url);
  clearPreviousArchives(path.dirname(directory));
  fs.mkdirSync(directory, { recursive: true });

  const articleHtml = extractReadableHtml(sourceHtml)
    || `<p>${escapeHtml('Не удалось извлечь разметку статьи.')}</p>`;
  const html = absolutizeMediaUrls(articleHtml, url);
  const filePath = path.join(directory, 'index.html');
  fs.writeFileSync(filePath, renderDocument({ title, url, content: html }), 'utf8');

  return { filePath, title };
}

function archiveDirectory(configPath, url) {
  return path.join(path.dirname(configPath), 'data', 'articles', stableName(url));
}

function clearPreviousArchives(archivesDirectory) {
  if (!fs.existsSync(archivesDirectory)) {
    return;
  }

  for (const entry of fs.readdirSync(archivesDirectory, { withFileTypes: true })) {
    fs.rmSync(path.join(archivesDirectory, entry.name), { recursive: true, force: true });
  }
}

function absolutizeMediaUrls(html, articleUrl) {
  let result = String(html).replace(/<(img|source|video|audio)\b[^>]*>/gi, (tag) => {
    let next = tag.replace(/\s(src|data-src|poster)=(['"])(.*?)\2/gi, (match, attribute, quote, value) => {
      return ` ${attribute}=${quote}${absoluteAssetUrl(value, articleUrl)}${quote}`;
    });
    next = next.replace(/\s(srcset|data-srcset)=(['"])(.*?)\2/gi, (match, attribute, quote, value) => {
      const srcset = decodeAssetUrl(value).split(',').map((candidate) => {
        const [rawUrl, ...descriptor] = candidate.trim().split(/\s+/);
        return [absoluteAssetUrl(rawUrl, articleUrl), ...descriptor].join(' ');
      }).join(', ');
      return ` ${attribute}=${quote}${srcset}${quote}`;
    });
    return next;
  });

  return result.replace(/\sstyle=(['"])(.*?)\1/gi, (match, quote, style) => {
    const absoluteStyle = style.replace(/url\((['"]?)(.*?)\1\)/gi, (urlMatch, innerQuote, value) => {
      return `url(${innerQuote}${absoluteAssetUrl(value, articleUrl)}${innerQuote})`;
    });
    return ` style=${quote}${absoluteStyle}${quote}`;
  });
}

function absoluteAssetUrl(value, baseUrl) {
  const normalized = decodeAssetUrl(value).trim();
  if (/^data:/i.test(normalized)) {
    return normalized;
  }

  try {
    const url = new URL(normalized, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : normalized;
  } catch {
    return normalized;
  }
}

function decodeAssetUrl(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function renderDocument({ title, url, content }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-serif, Georgia, serif; line-height: 1.65; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
    .source { font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; color: color-mix(in srgb, CanvasText 60%, Canvas); margin-bottom: 28px; }
    .source a { color: inherit; }
    img, video { display: block; box-sizing: border-box; max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 6px; }
    figure { margin: 1.5em 0; } figcaption { color: color-mix(in srgb, CanvasText 65%, Canvas); font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
    pre { overflow-x: auto; padding: 16px; border-radius: 6px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
    blockquote { margin: 1.5em 0; padding-left: 1em; border-left: 3px solid color-mix(in srgb, CanvasText 35%, Canvas); }
    table { display: block; overflow-x: auto; border-collapse: collapse; } th, td { padding: .4em .65em; border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); }
  </style>
</head>
<body>
  <main>
    <div class="source">Локальная копия · <a href="${escapeAttribute(url)}">оригинал</a></div>
    ${content}
  </main>
</body>
</html>
`;
}

function pickTitle(html) {
  const match = String(html).match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(match ? match[1] : '').trim();
}

function stableName(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function assertFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Нужен Node.js 18+ с global fetch.');
  }
}

module.exports = { archiveArticle };
