const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { stdin, stdout } = require('node:process');

const { createSource, defaultConfigPath, loadConfig, normalizeArticleRecord, saveConfig } = require('./config');
const { fetchFeed } = require('./feed');
const { loadFullArticle } = require('./article');

const ARTICLE_SCROLL_STEP = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function main(argv) {
  const parsed = parseArgs(argv);
  const { path: configPath, data: config } = loadConfig(parsed.configPath);
  const command = parsed.args[0] || 'browse';
  const args = parsed.args.slice(1);

  switch (command) {
    case 'add':
      return addSource(configPath, config, args, parsed.options);
    case 'list':
    case 'sources':
      return listSources(config);
    case 'remove':
    case 'rm':
      return removeSource(configPath, config, args);
    case 'fetch':
    case 'refresh':
      return refresh(configPath, config, parsed.options);
    case 'articles':
      return listArticles(configPath, config, args);
    case 'read':
    case 'open':
      return readArticle(configPath, config, args);
    case 'browse':
      return browse(configPath, config);
    case 'config':
      console.log(configPath || defaultConfigPath());
      return;
    case 'help':
    case '--help':
    case '-h':
      return help();
    default:
      throw new Error(`Неизвестная команда: ${command}\n\n${usage()}`);
  }
}

async function addSource(configPath, config, args, options) {
  const url = args[0];
  if (!url) {
    throw new Error(`Укажите URL.\n\n${usage()}`);
  }

  assertHttpUrl(url);

  if (config.sources.some((source) => source.url === url)) {
    throw new Error('Источник уже добавлен.');
  }

  const source = createSource(url, options.title);

  try {
    const feed = await fetchFeed(source);
    source.title = options.title || feed.title || source.title;
  } catch (error) {
    if (options.strict) {
      throw error;
    }
  }

  config.sources.push(source);
  saveConfig(configPath, config, { replaceSources: true });
  console.log(`Добавлено: ${source.title}`);
}

function listSources(config) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  for (const [index, source] of config.sources.entries()) {
    console.log(`${index + 1}. ${source.title}`);
    console.log(`   ${source.url}`);
  }
}

function removeSource(configPath, config, args) {
  const query = args[0];
  if (!query) {
    throw new Error('Укажите номер, id или URL источника.');
  }

  const index = findSourceIndex(config, query);
  if (index === -1) {
    throw new Error('Источник не найден.');
  }

  const [removed] = config.sources.splice(index, 1);
  saveConfig(configPath, config, { replaceSources: true });
  console.log(`Удалено: ${removed.title}`);
}

async function refresh(configPath, config) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  let total = 0;
  let dirty = false;
  const titleFilters = compileEntryTitleFilters(config.entryTitleFilters);

  for (const source of config.sources) {
    try {
      const feed = await fetchFeed(source);
      const previousTitle = source.title;
      source.title = source.title || feed.title;
      if (source.title !== previousTitle) {
        dirty = true;
      }
      const fresh = ingestFeedArticles(config, feed.items, titleFilters, {
        dirtyRef: () => { dirty = true; }
      });
      total += fresh.length;
      console.log(`${source.title}: ${feed.items.length}`);
    } catch (error) {
      console.error(`${source.title}: ${error.message}`);
    }
  }

  if (dirty) {
    saveConfig(configPath, config);
  }
  console.log(`Готово. В RSS сейчас: ${total}`);
}

async function listArticles(configPath, config, args) {
  const source = args[0] ? findSource(config, args[0]) : null;
  if (args[0] && !source) {
    throw new Error('Источник не найден.');
  }

  const articles = await loadUnreadArticles(configPath, config, source);

  if (!articles.length) {
    console.log('Непрочитанных статей нет.');
    return;
  }

  printArticles(articles);
}

async function readArticle(configPath, config, args) {
  const article = await resolveArticle(configPath, config, args);
  if (!article) {
    throw new Error('Статья не найдена. Используйте: rss articles');
  }

  const full = await loadFullArticle(article.link);
  if (setArticleRecord(config, article.link, {
    read: true,
    published_at: article.published || '',
    title: article.title || ''
  })) {
    saveConfig(configPath, config);
  }
  printArticle(full.title || article.title, full.text);
}

async function browse(configPath, config) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  const articles = await loadUnreadArticles(configPath, config, null, { silent: true });
  await runBrowser(configPath, config, articles);
}

function runBrowser(configPath, config, initialArticles = []) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Нужен интерактивный терминал.');
  }

  return new Promise((resolve) => {
    const state = {
      view: 'articles',
      articleIndex: 0,
      articleOffset: 0,
      articleScroll: 0,
      article: null,
      articles: initialArticles,
      status: '',
      loading: false,
      closed: false
    };

    let busy = false;
    let closed = false;
    const keyQueue = [];
    const wasRaw = Boolean(stdin.isRaw);

    const render = () => renderBrowser(config, state);

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      state.closed = true;
      stdin.off('keypress', onKey);
      stdout.off('resize', render);
      process.off('SIGINT', close);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }
      stdout.write('\x1b[?25h\x1b[?1049l');
      stdin.pause();
      resolve();
    };

    const drainKeys = async () => {
      if (busy || closed) {
        return;
      }

      busy = true;
      try {
        while (keyQueue.length && !closed) {
          const event = keyQueue.shift();
          await handleBrowserKey(configPath, config, state, event.value, event.key, render, close);
        }
      } catch (error) {
        if (!state.closed) {
          state.status = error.message || String(error);
          render();
        }
      } finally {
        busy = false;
      }
    };

    const onKey = (value, key = {}) => {
      if (closed) {
        return;
      }

      keyQueue.push({ value, key });
      drainKeys();
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKey);
    stdout.on('resize', render);
    process.once('SIGINT', close);
    stdout.write('\x1b[?1049h\x1b[?25l');
    render();
  });
}

async function handleBrowserKey(configPath, config, state, value, key, render, close) {
  if (key.ctrl && key.name === 'c') {
    close();
    return;
  }

  if (state.loading) {
    return;
  }

  state.status = '';

  if (state.view === 'article') {
    await handleArticleKey(configPath, config, state, value, key, render);
  } else {
    await handleArticlesKey(configPath, config, state, value, key, render, close);
  }

  if (!state.closed) {
    render();
  }
}

async function handleArticlesKey(configPath, config, state, value, key, render, close) {
  const articles = currentArticles(config, state);
  const pageSize = browserPageSize();

  if (isQuitKey(value, key)) {
    close();
  } else if (isRefreshKey(value, key)) {
    await refreshBrowser(configPath, config, state, render);
  } else if (isOpenKey(value, key)) {
    await openSelectedArticle(configPath, config, state, render);
  } else if (isOpenUrlKey(value, key)) {
    await openSelectedArticleUrl(configPath, config, state, render);
  } else if (isHideKey(value, key)) {
    await hideSelectedArticle(configPath, config, state, render);
  } else if (isDownKey(value, key)) {
    state.articleIndex = clamp(state.articleIndex + 1, 0, articles.length - 1);
  } else if (isUpKey(value, key)) {
    state.articleIndex = clamp(state.articleIndex - 1, 0, articles.length - 1);
  } else if (isPageDownKey(value, key)) {
    state.articleIndex = clamp(state.articleIndex + pageSize, 0, articles.length - 1);
  } else if (isPageUpKey(value, key)) {
    state.articleIndex = clamp(state.articleIndex - pageSize, 0, articles.length - 1);
  } else if (isTopKey(value, key)) {
    state.articleIndex = 0;
  } else if (isBottomKey(value, key)) {
    state.articleIndex = Math.max(0, articles.length - 1);
  }
}

async function handleArticleKey(configPath, config, state, value, key, render) {
  const pageSize = browserPageSize();
  const maxScroll = maxArticleScroll(state);

  if (isBackKey(value, key)) {
    state.view = 'articles';
    state.article = null;
    state.articleScroll = 0;
  } else if (isDownKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll + ARTICLE_SCROLL_STEP, 0, maxScroll);
  } else if (isUpKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll - ARTICLE_SCROLL_STEP, 0, maxScroll);
  } else if (isPageDownKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll + pageSize, 0, maxScroll);
  } else if (isPageUpKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll - pageSize, 0, maxScroll);
  } else if (isTopKey(value, key)) {
    state.articleScroll = 0;
  } else if (isBottomKey(value, key)) {
    state.articleScroll = maxScroll;
  } else if (isRefreshKey(value, key)) {
    await refreshBrowser(configPath, config, state, render);
  } else if (vimKey(value) === 'n') {
    await openSelectedArticle(configPath, config, state, render);
  } else if (vimKey(value) === 'p') {
    moveArticleSelection(config, state, -1);
    await openSelectedArticle(configPath, config, state, render);
  } else if (isOpenUrlKey(value, key)) {
    await openSelectedArticleUrl(configPath, config, state, render);
  }
}

async function markSelectedArticleRead(configPath, config, state, render) {
  const articles = currentArticles(config, state);
  const article = articles[state.articleIndex];
  if (!article) {
    state.status = 'No article';
    return;
  }

  article.read = true;
  if (setArticleRecord(config, article.link, {
    read: true,
    published_at: article.published || '',
    title: article.title || '',
    hidden: article.hidden === true
  })) {
    saveConfig(configPath, config);
  }
  clampBrowserState(config, state);
  state.status = 'Marked read';
  render();
}

async function hideSelectedArticle(configPath, config, state, render) {
  const articles = currentArticles(config, state);
  const article = articles[state.articleIndex];
  if (!article) {
    state.status = 'No article';
    return;
  }

  article.hidden = true;
  if (setArticleRecord(config, article.link, {
    hidden: true,
    read: article.read === true,
    published_at: article.published || '',
    title: article.title || ''
  })) {
    saveConfig(configPath, config);
  }
  clampBrowserState(config, state);
  state.status = 'Hidden';
  render();
}

async function openSelectedArticleUrl(configPath, config, state, render) {
  const article = state.view === 'article' && state.article
    ? { link: state.article.link || state.article.url, title: state.article.title || '', published: '' }
    : currentArticles(config, state)[state.articleIndex];

  if (!article) {
    state.status = 'No article';
    return;
  }

  const url = article.link || article.url;
  openUrl(url);
  if (setArticleRecord(config, article.link || article.url, {
    read: true,
    published_at: article.published || '',
    title: article.title || ''
  })) {
    saveConfig(configPath, config);
  }
  clampBrowserState(config, state);
  state.status = 'Opened and marked read';
  render();
}

async function openSelectedArticle(configPath, config, state, render) {
  const articles = currentArticles(config, state);
  const article = articles[state.articleIndex];
  if (!article) {
    state.status = 'No article';
    return;
  }

  state.loading = true;
  state.status = 'Loading...';
  render();

  try {
    const full = await loadFullArticle(article.link);
    article.read = true;
    if (setArticleRecord(config, article.link, {
      read: true,
      published_at: article.published || '',
      title: article.title || ''
    })) {
      saveConfig(configPath, config);
    }
    state.article = {
      title: full.title || article.title,
      url: full.url || article.link,
      link: article.link,
      text: full.text || ''
    };
    state.articleScroll = 0;
    state.view = 'article';
    state.status = '';
  } catch (error) {
    state.status = error.message || String(error);
  } finally {
    state.loading = false;
  }
}

async function refreshBrowser(configPath, config, state, render) {
  state.loading = true;
  state.status = 'Reloading...';
  render();
  state.articles = await loadUnreadArticles(configPath, config, null, { silent: true });
  saveConfig(configPath, config);
  clampBrowserState(config, state);
  state.status = 'Reloaded';
  state.loading = false;
}

function renderBrowser(config, state) {
  const { rows, columns } = terminalSize();
  readline.cursorTo(stdout, 0, 0);
  readline.clearScreenDown(stdout);

  if (state.view === 'article') {
    renderArticle(state, rows, columns);
  } else {
    renderArticles(config, state, rows, columns);
  }
}

function renderArticles(config, state, rows, width) {
  clampBrowserState(config, state);
  const articles = currentArticles(config, state);
  const listRows = Math.max(1, rows - 3);
  state.articleOffset = fitOffset(state.articleOffset, state.articleIndex, listRows, articles.length);

  const lines = [
    `Unread ${articles.length ? `${state.articleIndex + 1}/${articles.length}` : '0/0'}`,
    ''
  ];

  if (!articles.length) {
    lines.push('No unread articles');
  } else {
    for (let row = 0; row < listRows; row += 1) {
      const index = state.articleOffset + row;
      const article = articles[index];
      if (!article) {
        lines.push('');
        continue;
      }

      const cursor = index === state.articleIndex ? '>' : ' ';
      const marker = article.read ? ' ' : '*';
      lines.push(`${cursor} ${marker} ${article.title}`);
    }
  }

  drawLines(lines, rows, width, footerText(state, 'j/k  C-d/C-u  gg/G  Enter/l  o  r  h  q'));
}

function renderArticle(state, rows, width) {
  const lines = buildArticleLines(state.article, width);
  const viewRows = Math.max(1, rows - 1);
  state.articleScroll = clamp(state.articleScroll, 0, Math.max(0, lines.length - viewRows));
  const visible = lines.slice(state.articleScroll, state.articleScroll + viewRows);
  const footer = footerText(state, 'j/k  C-d/C-u  gg/G  n/p  o  r  q/h');
  drawLines(visible, rows, width, footer);
}

function drawLines(lines, rows, width, footer) {
  const visibleRows = Math.max(0, rows - 1);
  const output = [];

  for (let index = 0; index < visibleRows; index += 1) {
    output.push(formatLine(lines[index] || '', width));
  }

  output.push(inverseLine(footer, width));
  stdout.write(output.join('\n'));
}

function footerText(state, fallback) {
  return state.status || fallback;
}

function buildArticleLines(article, width) {
  if (!article) {
    return ['Loading...'];
  }

  const wrapWidth = Math.max(40, Math.min(width, 120));
  const title = cleanDisplay(article.title);
  const text = removeDuplicateTitle(cleanDisplay(article.text), title);
  const titleLines = wrapText(title, wrapWidth)
    .split('\n')
    .map((line) => ({ text: line, style: 'bold' }));
  const bodyLines = formatParagraphs(text, wrapWidth);

  return [...titleLines, '', ...bodyLines];
}

function maxArticleScroll(state) {
  const lines = buildArticleLines(state.article, terminalSize().columns);
  const viewRows = Math.max(1, terminalSize().rows - 1);
  return Math.max(0, lines.length - viewRows);
}

function clampBrowserState(config, state) {
  const articles = currentArticles(config, state);
  state.articleIndex = clamp(state.articleIndex, 0, articles.length - 1);
}

function currentArticles(config, state) {
  return (state.articles || [])
    .filter((article) => !isArticleRead(config, article.link) && !isArticleHidden(config, article.link))
    .sort((a, b) => dateValue(b.published) - dateValue(a.published));
}

function moveArticleSelection(config, state, delta) {
  const articles = currentArticles(config, state);
  state.articleIndex = clamp(state.articleIndex + delta, 0, articles.length - 1);
}

function browserPageSize() {
  return Math.max(5, terminalSize().rows - 4);
}

function terminalSize() {
  return {
    rows: stdout.rows || 24,
    columns: stdout.columns || 100
  };
}

function fitOffset(offset, index, size, total) {
  if (total <= size) {
    return 0;
  }

  if (index < offset) {
    return index;
  }

  if (index >= offset + size) {
    return index - size + 1;
  }

  return clamp(offset, 0, Math.max(0, total - size));
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function isOpenKey(value, key) {
  return vimKey(value) === 'l' || key.name === 'right' || key.name === 'return' || key.name === 'enter';
}

function isBackKey(value, key) {
  return isQuitKey(value, key) || vimKey(value) === 'h' || key.name === 'left' || key.name === 'escape';
}

function isQuitKey(value, key) {
  return vimKey(value) === 'q' || key.name === 'q';
}

function isRefreshKey(value, key) {
  return vimKey(value) === 'r' || key.name === 'r' || value === 'R' || key.name === 'R';
}

function isOpenUrlKey(value, key) {
  return vimKey(value) === 'o' || key.name === 'o';
}

function isHideKey(value, key) {
  return vimKey(value) === 'h' || key.name === 'h';
}

function isDownKey(value, key) {
  return vimKey(value) === 'j' || key.name === 'down';
}

function isUpKey(value, key) {
  return vimKey(value) === 'k' || key.name === 'up';
}

function isPageDownKey(value, key) {
  return value === ' ' || (key.ctrl && key.name === 'd') || key.name === 'pagedown';
}

function isPageUpKey(value, key) {
  return vimKey(value) === 'b' || (key.ctrl && key.name === 'u') || key.name === 'pageup';
}

function isTopKey(value, key) {
  return vimKey(value) === 'g' || key.name === 'home';
}

function isBottomKey(value, key) {
  return vimKey(value) === 'G' || key.name === 'end';
}

function vimKey(value) {
  return RU_VIM_KEYS[value] || value;
}

function formatLine(line, width) {
  if (line && typeof line === 'object') {
    const text = truncateDisplay(line.text, width);
    return line.style === 'bold' ? boldText(text) : text;
  }

  return truncateDisplay(line, width);
}

function truncateDisplay(value, width) {
  const text = cleanDisplay(value);
  if (width <= 0) {
    return '';
  }

  if (text.length <= width) {
    return text;
  }

  if (width <= 3) {
    return text.slice(0, width);
  }

  return `${text.slice(0, width - 3)}...`;
}

function inverseLine(value, width) {
  const text = truncateDisplay(value, width).padEnd(width, ' ');
  return `\x1b[7m${text}\x1b[0m`;
}

function boldText(value) {
  return `\x1b[1m${value}\x1b[0m`;
}

function cleanDisplay(value) {
  return String(value || '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
}

function removeDuplicateTitle(text, title) {
  const normalizedTitle = normalizeDisplayLine(title);
  if (!normalizedTitle) {
    return String(text || '').trim();
  }

  const lines = String(text || '').split('\n');
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  if (lines.length && normalizeDisplayLine(lines[0]) === normalizedTitle) {
    lines.shift();
  }

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  return lines.join('\n').trim();
}

function normalizeDisplayLine(value) {
  return cleanDisplay(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const RU_VIM_KEYS = {
  й: 'q',
  Й: 'Q',
  к: 'r',
  К: 'R',
  о: 'j',
  О: 'J',
  л: 'k',
  Л: 'K',
  р: 'h',
  Р: 'H',
  д: 'l',
  Д: 'L',
  п: 'g',
  П: 'G',
  т: 'n',
  Т: 'N',
  з: 'p',
  З: 'P',
  щ: 'o',
  Щ: 'O',
  и: 'b',
  И: 'B'
};

function printArticles(articles) {
  for (const article of articles) {
    const marker = article.read ? ' ' : '*';
    console.log(`${marker} ${boldText(article.title)}`);
  }
}

function printArticle(title, text) {
  const cleanTitle = cleanDisplay(title);
  const cleanText = removeDuplicateTitle(cleanDisplay(text), cleanTitle);
  console.log(`\n${boldText(cleanTitle)}\n`);
  console.log(formatParagraphs(cleanText, process.stdout.columns || 100).join('\n'));
}

async function loadUnreadArticles(configPath, config, source = null, options = {}) {
  const articles = await loadArticles(configPath, config, source, options);
  return articles
    .filter((article) => !article.read && !article.hidden)
    .sort((a, b) => dateValue(b.published) - dateValue(a.published));
}

async function loadArticles(configPath, config, source = null, options = {}) {
  const sources = source ? [source] : config.sources;
  const articles = [];
  let dirty = false;
  const titleFilters = compileEntryTitleFilters(config.entryTitleFilters);

  for (const item of sources) {
    try {
      const feed = await fetchFeed(item);
      const previousTitle = item.title;
      item.title = item.title || feed.title;
      if (item.title !== previousTitle) {
        dirty = true;
      }
      const fresh = ingestFeedArticles(config, feed.items, titleFilters, {
        dirtyRef: () => {
          dirty = true;
        }
      });
      articles.push(...fresh);
    } catch (error) {
      if (source || !options.silent) {
        console.error(`${item.title}: ${error.message}`);
      }
    }
  }

  if (dirty) {
    saveConfig(configPath, config);
  }

  return articles.sort((a, b) => dateValue(b.published) - dateValue(a.published));
}

function ingestFeedArticles(config, feedItems, titleFilters, hooks = {}) {
  const articles = [];
  const cutoff = Date.now() - WEEK_MS;

  for (const article of feedItems) {
    if (matchesEntryTitle(article.title, titleFilters)) {
      if (removeArticleRecord(config, article.link)) {
        hooks.dirtyRef?.();
      }
      continue;
    }

    if (isStaleArticle(article.published, cutoff)) {
      if (removeArticleRecord(config, article.link)) {
        hooks.dirtyRef?.();
      }
      continue;
    }

    const current = getArticleRecord(config, article.link);
    if (setArticleRecord(config, article.link, {
      read: current.read,
      published_at: article.published || current.published_at || '',
      title: article.title || current.title || ''
    })) {
      hooks.dirtyRef?.();
    }

    articles.push({
      ...article,
      read: isArticleRead(config, article.link),
      hidden: isArticleHidden(config, article.link)
    });
  }

  return articles;
}

function compileEntryTitleFilters(filters) {
  return (Array.isArray(filters) ? filters : [])
    .map((pattern) => compileEntryTitleFilter(pattern))
    .filter(Boolean);
}

function compileEntryTitleFilter(pattern) {
  const value = String(pattern || '').trim();
  if (!value) {
    return null;
  }

  const ignoreCase = value.startsWith('(?i)');
  const source = ignoreCase ? value.slice(4) : value;

  try {
    return new RegExp(source, ignoreCase ? 'i' : '');
  } catch {
    return null;
  }
}

function matchesEntryTitle(title, filters) {
  if (!title || !filters.length) {
    return false;
  }

  return filters.some((filter) => filter.test(title));
}

function isArticleRead(config, url) {
  return getArticleRecord(config, url).read === true;
}

function isArticleHidden(config, url) {
  return getArticleRecord(config, url).hidden === true;
}

function getArticleRecord(config, url) {
  return normalizeArticleRecord(config.articles[url]);
}

function setArticleRecord(config, url, patch) {
  if (!url) {
    return false;
  }

  const current = getArticleRecord(config, url);
  const next = normalizeArticleRecord({
    ...current,
    ...patch
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  config.articles[url] = next;
  return changed;
}

function removeArticleRecord(config, url) {
  if (!url || !config.articles[url]) {
    return false;
  }

  delete config.articles[url];
  return true;
}

function isStaleArticle(published, cutoff) {
  const value = Date.parse(published);
  return Number.isFinite(value) && value < cutoff;
}

function openUrl(url) {
  if (!url) {
    return;
  }

  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', url]
    : platform === 'darwin'
      ? ['-g', url]
      : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function resolveArticle(configPath, config, args) {
  if (args.length >= 2) {
    const source = findSource(config, args[0]);
    const articles = source ? await loadUnreadArticles(configPath, config, source) : [];
    return articles[toIndex(args[1])] || null;
  }

  const articles = await loadUnreadArticles(configPath, config);
  return articles[toIndex(args[0] || '1')] || null;
}

function findSource(config, query) {
  return config.sources[findSourceIndex(config, query)];
}

function findSourceIndex(config, query) {
  const normalized = String(query).trim();
  const index = toIndex(normalized);

  if (index >= 0 && config.sources[index]) {
    return index;
  }

  return config.sources.findIndex((source) => {
    return source.id === normalized || source.url === normalized || source.title === normalized;
  });
}

function toIndex(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number - 1 : -1;
}

function dateValue(value) {
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : date;
}

function parseArgs(argv) {
  const args = [];
  const options = {};
  let configPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--config' || value === '-c') {
      configPath = argv[++index];
      if (!configPath) {
        throw new Error('Для --config нужен путь к файлу.');
      }
    } else if (value.startsWith('--config=')) {
      configPath = value.slice('--config='.length);
    } else if (value === '--title') {
      options.title = argv[++index];
    } else if (value.startsWith('--title=')) {
      options.title = value.slice('--title='.length);
    } else if (value === '--limit') {
      options.limit = argv[++index];
    } else if (value.startsWith('--limit=')) {
      options.limit = value.slice('--limit='.length);
    } else if (value === '--strict') {
      options.strict = true;
    } else {
      args.push(value);
    }
  }

  return { args, configPath, options };
}

function assertHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Источник должен быть корректным http/https URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Источник должен быть корректным http/https URL.');
  }
}

function wrapText(text, width) {
  const safeWidth = Math.max(40, Math.min(width, 120));

  return String(text)
    .split('\n')
    .map((line) => wrapLine(line, safeWidth))
    .join('\n');
}

function formatParagraphs(text, width) {
  const safeWidth = Math.max(40, Math.min(width, 120));
  const paragraphs = String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const lines = [];

  for (const paragraph of paragraphs) {
    const wrapped = wrapText(
      paragraph.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim(),
      safeWidth
    ).split('\n');
    lines.push(...wrapped, '');
  }

  if (lines.length) {
    while (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  return lines;
}

function wrapLine(line, width) {
  if (line.length <= width) {
    return line;
  }

  const words = line.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.join('\n');
}

function help() {
  console.log(usage());
}

function usage() {
  return [
    'rss [--config <file>] <command>',
    '',
    'Команды:',
    '  add <url> [--title <name>]   добавить источник',
    '  sources                      показать источники',
    '  remove <num|id|url>          удалить источник',
    '  fetch                        проверить RSS',
    '  articles [source]            показать статьи',
    '  read [source] <num>          открыть статью с полным текстом',
    '  browse                       vim mode',
    '  config                       показать путь конфига'
  ].join('\n');
}

module.exports = {
  main,
  parseArgs
};
