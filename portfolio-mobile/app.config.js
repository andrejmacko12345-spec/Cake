const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('@expo/env');

const rootEnvPath = path.resolve(__dirname, '..', '.env');
if (!process.env.EXPO_PUBLIC_FMP_API_KEY && fs.existsSync(rootEnvPath) && fs.statSync(rootEnvPath).isFile()) {
  const rootEnv = parseEnv(fs.readFileSync(rootEnvPath, 'utf8'));
  if (rootEnv.EXPO_PUBLIC_FMP_API_KEY) {
    process.env.EXPO_PUBLIC_FMP_API_KEY = rootEnv.EXPO_PUBLIC_FMP_API_KEY;
  }
}

module.exports = require('./app.json').expo;
