const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const configSnapshots = new WeakMap();

function defaultConfigPath() {
  if (process.env.RSS_CONFIG) {
    return resolvePath(process.env.RSS_CONFIG);
  }

  return path.join(__dirname, '..', 'config.json');
}

function resolvePath(filePath) {
  if (!filePath) {
    return defaultConfigPath();
  }

  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }

  return path.resolve(filePath);
}

function emptyConfig() {
  return {
    version: 1,
    sources: [],
    articles: {},
    entryTitleFilters: [DEFAULT_ENTRY_TITLE_FILTER]
  };
}

function loadConfig(filePath) {
  const resolvedPath = resolvePath(filePath);
  const { sourcesPath, postsPath } = dataPaths(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    const data = emptyConfig();
    data.sources = readJsonFile(sourcesPath, []);
    data.articles = normalizeArticleState(readJsonFile(postsPath, {}));
    rememberConfig(data);
    return { path: resolvedPath, data };
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8').trim();
  const data = raw ? JSON.parse(raw) : emptyConfig();
  const normalized = normalizeConfig(data);
  normalized.sources = readJsonFile(sourcesPath, normalized.sources);
  normalized.articles = normalizeArticleState(readJsonFile(postsPath, normalized.articles));
  rememberConfig(normalized);

  return {
    path: resolvedPath,
    data: normalized
  };
}

function saveConfig(configPath, data, options = {}) {
  const incoming = normalizeConfig(data);
  const baseline = configSnapshots.get(data) || emptyConfig();
  const current = loadConfig(configPath).data;
  const normalized = {
    version: incoming.version,
    sources: mergeSources(current.sources, baseline.sources, incoming.sources),
    articles: mergeRecords(current.articles, baseline.articles, incoming.articles),
    entryTitleFilters: sameValue(incoming.entryTitleFilters, baseline.entryTitleFilters)
      ? current.entryTitleFilters
      : incoming.entryTitleFilters
  };
  const { sourcesPath, postsPath } = dataPaths(configPath);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(sourcesPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({
    version: normalized.version,
    entryTitleFilters: normalized.entryTitleFilters
  }, null, 2)}\n`);

  fs.writeFileSync(sourcesPath, `${JSON.stringify(normalized.sources, null, 2)}\n`);
  fs.writeFileSync(postsPath, `${JSON.stringify(normalized.articles, null, 2)}\n`);
  data.sources = normalized.sources;
  data.articles = normalized.articles;
  data.entryTitleFilters = normalized.entryTitleFilters;
  rememberConfig(data);
}

function reloadConfig(configPath, data) {
  const current = loadConfig(configPath).data;
  data.sources = current.sources;
  data.articles = current.articles;
  data.entryTitleFilters = current.entryTitleFilters;
  rememberConfig(data);
  return data;
}

function mergeSources(current, baseline, incoming) {
  const baselineByUrl = new Map(baseline.map((source) => [source.url, source]));
  const incomingByUrl = new Map(incoming.map((source) => [source.url, source]));
  const result = current
    .filter((source) => baselineByUrl.has(source.url) ? incomingByUrl.has(source.url) : true)
    .map((source) => {
      const previous = baselineByUrl.get(source.url);
      const next = incomingByUrl.get(source.url);
      return previous && next && !sameValue(previous, next) ? next : source;
    });
  const urls = new Set(result.map((source) => source.url));

  for (const source of incoming) {
    if (!baselineByUrl.has(source.url) && !urls.has(source.url)) {
      result.push(source);
    }
  }

  return result;
}

function mergeRecords(current, baseline, incoming) {
  const result = { ...current };
  const keys = new Set([...Object.keys(baseline), ...Object.keys(incoming)]);

  for (const key of keys) {
    if (sameValue(baseline[key], incoming[key])) {
      continue;
    }

    if (Object.hasOwn(incoming, key)) {
      result[key] = mergeRecord(current[key], baseline[key], incoming[key]);
    } else {
      delete result[key];
    }
  }

  return result;
}

function mergeRecord(current = {}, baseline = {}, incoming = {}) {
  const result = { ...current };

  for (const key of new Set([...Object.keys(baseline), ...Object.keys(incoming)])) {
    if (!sameValue(baseline[key], incoming[key])) {
      result[key] = incoming[key];
    }
  }

  return result;
}

function rememberConfig(data) {
  configSnapshots.set(data, JSON.parse(JSON.stringify(normalizeConfig(data))));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dataPaths(configPath) {
  const directory = path.dirname(configPath);
  const extension = path.extname(configPath);
  const basename = path.basename(configPath, extension);
  const prefix = basename === 'config' ? '' : `${basename}.`;
  const dataDirectory = path.join(directory, 'data');

  return {
    sourcesPath: path.join(dataDirectory, `${prefix}sources.json`),
    postsPath: path.join(dataDirectory, `${prefix}posts.json`)
  };
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? JSON.parse(raw) : fallback;
}

function normalizeConfig(data) {
  return {
    version: 1,
    sources: Array.isArray(data.sources) ? data.sources : [],
    articles: normalizeArticleState(data.articles),
    entryTitleFilters: normalizeEntryTitleFilters(data.entryTitleFilters)
  };
}

function normalizeArticleState(articles) {
  if (!articles || typeof articles !== 'object' || Array.isArray(articles)) {
    return {};
  }

  const state = {};

  for (const [key, value] of Object.entries(articles)) {
    if (isHttpUrl(key) && (typeof value === 'boolean' || typeof value === 'string' || isPlainObject(value))) {
      state[key] = normalizeArticleRecord(value);
      continue;
    }

    if (!Array.isArray(value)) {
      continue;
    }

    for (const article of value) {
      const url = article && (article.link || article.url);
      if (article && article.read === true && isHttpUrl(url)) {
        state[url] = normalizeArticleRecord({
          read: true,
          published_at: article.published || article.published_at || '',
          title: article.title || '',
          hidden: article.hidden === true
        });
      }
    }
  }

  return state;
}

function normalizeArticleRecord(value) {
  if (typeof value === 'boolean') {
    return {
      read: value,
      published_at: '',
      title: '',
      hidden: false
    };
  }

  if (typeof value === 'string') {
    return {
      read: true,
      published_at: value,
      title: '',
      hidden: false
    };
  }

  if (!isPlainObject(value)) {
    return {
      read: false,
      published_at: '',
      title: '',
      hidden: false
    };
  }

  return {
    read: value.read === true,
    published_at: String(value.published_at || value.publishedAt || value.published || ''),
    title: String(value.title || ''),
    hidden: value.hidden === true
  };
}

function normalizeEntryTitleFilters(filters) {
  if (!filters) {
    return [DEFAULT_ENTRY_TITLE_FILTER];
  }

  const values = Array.isArray(filters) ? filters : [filters];
  const normalized = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return normalized.length ? normalized : [DEFAULT_ENTRY_TITLE_FILTER];
}

function createSource(url, title) {
  return {
    id: makeId(url),
    title: title || url,
    url,
    addedAt: new Date().toISOString()
  };
}

function makeId(value) {
  const normalized = String(value).toLowerCase().replace(/^https?:\/\//, '');
  return normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `source-${Date.now()}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const DEFAULT_ENTRY_TITLE_FILTER = '(?i)(самодельн|жиг(и|а|ул[ия])|волг(а|у)|гонк(а|и|е|ах)|заезд(ы)?|драг|drag|стрит|street|челлендж|challenge|битва|баттл|\\bvs\\b|против|розыгр(ыш|ива|ал(и)?|ыва(ем|ют)?)|разыгра(л(и)?|ем|ют)|give\\s*away|giveaway|гив(ы|эвей)?|конкурс(ы)?|приз(ы|овой)?|подар(ок|ки)|выигра(й|л|ли|ем|ют)|победител(ь|и)|участ(ие|вуй)|ключ\\s*-?\\s*на\\s*-?\\s*ключ|обмен(яю|яем|яют)?|бартер|swap|trade|угробил(и)?|разбил(и)?|авари(я|и)|дтп|хлам|приор(а|у)?|priora|нив(а|у)|стар(ый|ая|ую)|ваз|калин(а|у)|ках(а|i)|смотр(ит|ю|ят|им)|анар|lada|сабина\\s*лада|тусовк[а-я]*|блогер[а-я]*|бустер[а-я]*|угада[а-я]*|контейнер[а-я]*|забери\\s*-?\\s*тачк[ауыеиоя]*|девочк[а-я]*|угар[а-я]*|юра\\s*волков)';

module.exports = {
  createSource,
  defaultConfigPath,
  loadConfig,
  normalizeArticleRecord,
  reloadConfig,
  resolvePath,
  saveConfig
};
