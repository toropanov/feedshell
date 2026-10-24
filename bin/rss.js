#!/usr/bin/env node

// Compatibility entry point for existing `npm link` installations.
const fs = require('node:fs');
const path = require('node:path');

const legacyConfigPath = path.join(__dirname, '..', 'config.json');
if (!process.env.FEEDSHELL_CONFIG && !process.env.RSS_CONFIG && fs.existsSync(legacyConfigPath)) {
  process.env.FEEDSHELL_CONFIG = legacyConfigPath;
}

require('./feedshell');
