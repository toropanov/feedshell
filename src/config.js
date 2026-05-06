const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

  if (!fs.existsSync(resolvedPath)) {
    return { path: resolvedPath, data: emptyConfig() };
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8').trim();
  const data = raw ? JSON.parse(raw) : emptyConfig();

  return {
    path: resolvedPath,
    data: normalizeConfig(data)
  };
}

function saveConfig(configPath, data) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalizeConfig(data), null, 2)}\n`);
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
  resolvePath,
  saveConfig
};
