const readline = require('node:readline');
const { stdin, stdout } = require('node:process');

const { createSource, defaultConfigPath, loadConfig, saveConfig } = require('./config');
const { fetchFeed, mergeArticles } = require('./feed');
const { loadFullArticle } = require('./article');

const DEFAULT_LIMIT = 50;

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
      return listArticles(config, args);
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
    config.articles[source.id] = mergeArticles([], feed.items, Number(options.limit) || DEFAULT_LIMIT);
  } catch (error) {
    if (options.strict) {
      throw error;
    }
  }

  config.sources.push(source);
  saveConfig(configPath, config);
  console.log(`Добавлено: ${source.title}`);
}

function listSources(config) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  for (const [index, source] of config.sources.entries()) {
    const count = (config.articles[source.id] || []).length;
    console.log(`${index + 1}. ${source.title} (${count})`);
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
  delete config.articles[removed.id];
  saveConfig(configPath, config);
  console.log(`Удалено: ${removed.title}`);
}

async function refresh(configPath, config, options = {}) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  const limit = Number(options.limit) || DEFAULT_LIMIT;
  let total = 0;

  for (const source of config.sources) {
    try {
      const feed = await fetchFeed(source);
      source.title = source.title || feed.title;
      const existing = config.articles[source.id] || [];
      config.articles[source.id] = mergeArticles(existing, feed.items, limit);
      total += feed.items.length;
      console.log(`${source.title}: ${feed.items.length}`);
    } catch (error) {
      console.error(`${source.title}: ${error.message}`);
    }
  }

  saveConfig(configPath, config);
  console.log(`Готово. Загружено: ${total}`);
}

function listArticles(config, args) {
  const source = args[0] ? findSource(config, args[0]) : null;
  if (args[0] && !source) {
    throw new Error('Источник не найден.');
  }

  const articles = source ? config.articles[source.id] || [] : allArticles(config);

  if (!articles.length) {
    console.log('Статей нет. Выполните: rss fetch');
    return;
  }

  printArticles(articles, source ? '' : config);
}

async function readArticle(configPath, config, args) {
  const article = resolveArticle(config, args);
  if (!article) {
    throw new Error('Статья не найдена. Используйте: rss articles');
  }

  const full = await loadFullArticle(article.link);
  article.read = true;
  saveConfig(configPath, config);
  printArticle(full.title || article.title, full.url, full.text);
}

async function browse(configPath, config) {
  if (!config.sources.length) {
    console.log('Источников нет. Добавьте: rss add <url>');
    return;
  }

  await refreshSilently(configPath, config);
  await runBrowser(configPath, config);
}

function runBrowser(configPath, config) {
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
    state.articleScroll = clamp(state.articleScroll + 1, 0, maxScroll);
  } else if (isUpKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll - 1, 0, maxScroll);
  } else if (isPageDownKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll + pageSize, 0, maxScroll);
  } else if (isPageUpKey(value, key)) {
    state.articleScroll = clamp(state.articleScroll - pageSize, 0, maxScroll);
  } else if (isTopKey(value, key)) {
    state.articleScroll = 0;
  } else if (isBottomKey(value, key)) {
    state.articleScroll = maxScroll;
  } else if (vimKey(value) === 'n') {
    moveArticleSelection(config, state, 1);
    await openSelectedArticle(configPath, config, state, render);
  } else if (vimKey(value) === 'p') {
    moveArticleSelection(config, state, -1);
    await openSelectedArticle(configPath, config, state, render);
  }
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
    saveConfig(configPath, config);
    state.article = {
      title: full.title || article.title,
      url: full.url || article.link,
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
  await refreshSilently(configPath, config);
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
    `Articles ${articles.length ? `${state.articleIndex + 1}/${articles.length}` : '0/0'}`,
    ''
  ];

  if (!articles.length) {
    lines.push('No articles');
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

  drawLines(lines, rows, width, footerText(state, 'j/k  C-d/C-u  gg/G  Enter/l  r  q'));
}

function renderArticle(state, rows, width) {
  const lines = buildArticleLines(state.article, width);
  const viewRows = Math.max(1, rows - 1);
  state.articleScroll = clamp(state.articleScroll, 0, Math.max(0, lines.length - viewRows));
  const visible = lines.slice(state.articleScroll, state.articleScroll + viewRows);
  const footer = footerText(state, 'j/k  C-d/C-u  gg/G  n/p  q/h');
  drawLines(visible, rows, width, footer);
}

function drawLines(lines, rows, width, footer) {
  const visibleRows = Math.max(0, rows - 1);
  const output = [];

  for (let index = 0; index < visibleRows; index += 1) {
    output.push(truncateDisplay(lines[index] || '', width));
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
  const chunks = [
    cleanDisplay(article.title),
    cleanDisplay(article.url),
    '',
    cleanDisplay(article.text)
  ];

  return chunks.flatMap((chunk) => {
    if (!chunk) {
      return [''];
    }

    return wrapText(chunk, wrapWidth).split('\n');
  });
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

function currentArticles(config) {
  return allArticles(config);
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
  return vimKey(value) === 'r' || key.name === 'r';
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

function cleanDisplay(value) {
  return String(value || '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
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
  и: 'b',
  И: 'B'
};

async function refreshSilently(configPath, config) {
  for (const source of config.sources) {
    try {
      const feed = await fetchFeed(source);
      config.articles[source.id] = mergeArticles(config.articles[source.id] || [], feed.items, DEFAULT_LIMIT);
    } catch {
    }
  }

  saveConfig(configPath, config);
}

function printArticles(articles, configOrPrefix = '') {
  for (const article of articles) {
    const marker = article.read ? ' ' : '*';
    console.log(`${marker} ${article.title}`);
  }
}

function printArticle(title, url, text) {
  console.log(`\n${title}\n${url}\n`);
  console.log(wrapText(text, process.stdout.columns || 100));
}

function allArticles(config) {
  return config.sources
    .flatMap((source) => config.articles[source.id] || [])
    .sort((a, b) => dateValue(b.published) - dateValue(a.published));
}

function resolveArticle(config, args) {
  if (args.length >= 2) {
    const source = findSource(config, args[0]);
    return source ? (config.articles[source.id] || [])[toIndex(args[1])] : null;
  }

  return allArticles(config)[toIndex(args[0] || '1')];
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
    '  fetch [--limit <n>]          обновить статьи',
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
