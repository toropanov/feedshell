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
    articles: {}
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
    articles: data.articles && typeof data.articles === 'object' ? data.articles : {}
  };
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

module.exports = {
  createSource,
  defaultConfigPath,
  loadConfig,
  resolvePath,
  saveConfig
};
