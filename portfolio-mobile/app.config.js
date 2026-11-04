const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('@expo/env');

const rootEnvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(rootEnvPath) && fs.statSync(rootEnvPath).isFile()) {
  const rootEnv = parseEnv(fs.readFileSync(rootEnvPath, 'utf8'));
  for (const key of ['EXPO_PUBLIC_FMP_API_KEY', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
    const alias = key.replace('EXPO_PUBLIC_', 'NEXT_PUBLIC_');
    if (!process.env[key] && (rootEnv[key] || rootEnv[alias])) {
      process.env[key] = rootEnv[key] || rootEnv[alias];
    }
  }
}

module.exports = require('./app.json').expo;
