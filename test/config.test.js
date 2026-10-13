const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { defaultConfigPath, loadConfig, saveConfig } = require('../src/config');

test('uses the XDG config directory by default', () => {
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = '/tmp/feedshell-test-config';
  assert.equal(defaultConfigPath(), '/tmp/feedshell-test-config/feedshell/config.json');
  original === undefined ? delete process.env.XDG_CONFIG_HOME : process.env.XDG_CONFIG_HOME = original;
});

test('creates user data beside an explicit config file', () => {
  const directory = path.join(os.tmpdir(), `feedshell-${process.pid}-${Date.now()}`);
  const configPath = path.join(directory, 'config.json');
  const { data } = loadConfig(configPath);
  data.sources.push({ id: 'example', title: 'Example', url: 'https://example.com/feed.xml' });
  saveConfig(configPath, data);
  assert.equal(loadConfig(configPath).data.sources[0].id, 'example');
  fs.rmSync(directory, { recursive: true, force: true });
});
