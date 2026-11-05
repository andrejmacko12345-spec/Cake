const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};

const stored = new Map();
let randomCall = 0;
const gcm = (key, nonce, aad) => ({
  encrypt: (plaintext) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  },
  decrypt: (ciphertext) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  },
});
const originalLoad = Module._load;
let backups;
try {
  Module._load = function (id, ...args) {
    if (id === '@noble/ciphers/aes.js') return { gcm };
    if (id === '@noble/ciphers/utils.js') return {
      utf8ToBytes: (value) => Buffer.from(value, 'utf8'),
      bytesToUtf8: (value) => Buffer.from(value).toString('utf8'),
    };
    if (id === 'expo-crypto') return {
      getRandomBytesAsync: async (count) => Buffer.alloc(count, ++randomCall),
    };
    if (id === '@react-native-async-storage/async-storage') return {
      getItem: async (key) => stored.get(key) ?? null,
      setItem: async (key, value) => { stored.set(key, value); },
      removeItem: async (key) => { stored.delete(key); },
      multiSet: async (pairs) => { for (const [key, value] of pairs) stored.set(key, value); },
    };
    return originalLoad.call(this, id, ...args);
  };
  backups = require('./local-backup.ts');
} finally {
  Module._load = originalLoad;
}

test('encrypted backup round-trips local portfolio and settings using a separate recovery code', async () => {
  const transaction = {
    id: 'buy-1', symbol: 'AAPL', name: 'Apple', type: 'BUY', shares: 2,
    price: 100, currency: 'USD', fxToEur: 0.9, date: '2026-01-02',
    createdAt: '2026-01-02T10:00:00.000Z',
  };
  stored.set('@portfolio-mobile/transactions-v1', JSON.stringify({
    transactions: [transaction], quotes: { AAPL: { price: 999 } },
  }));
  stored.set('@portfolio-mobile/language', 'en');
  stored.set('@portfolio-mobile/theme', 'light');

  const exported = await backups.createEncryptedBackup();
  assert.equal(exported.recoveryCode.length, 43);
  assert.doesNotMatch(exported.content, /Apple|AAPL/);
  const restored = await backups.decryptBackup(exported.content, exported.recoveryCode);
  assert.equal(restored.values['@portfolio-mobile/language'], 'en');
  assert.equal(restored.values['@portfolio-mobile/theme'], 'light');
  assert.deepEqual(backups.getBackupTransactions(restored), [transaction]);
  assert.equal(restored.values['@portfolio-mobile/transactions-v1'].includes('999'), false);

  await backups.restoreLocalBackup(restored);
  assert.equal(stored.get('@portfolio-mobile/language'), 'en');
  assert.equal(stored.get('@portfolio-mobile/theme'), 'light');
  assert.equal(stored.get('event-preferences'), '{"earnings":true,"dividends":false,"news":false}');
});

test('backup decryption rejects incorrect codes, tampering and invalid portfolio data', async () => {
  const { content, recoveryCode } = await backups.createEncryptedBackup();
  const file = JSON.parse(content);
  const changedCiphertext = `${file.ciphertext[0] === 'A' ? 'B' : 'A'}${file.ciphertext.slice(1)}`;
  await assert.rejects(() => backups.decryptBackup(content, 'A'.repeat(43)), /incorrect|damaged/);
  await assert.rejects(() => backups.decryptBackup(JSON.stringify({ ...file, ciphertext: changedCiphertext }), recoveryCode), /incorrect|damaged/);
  await assert.rejects(() => backups.decryptBackup('{"format":"wrong"}', recoveryCode), /Unsupported/);
  assert.throws(() => backups.parseLocalBackup({ version: 1, values: { unexpected: 'x' } }), /Invalid backup field/);
  assert.throws(() => backups.parseLocalBackup({
    version: 1,
    values: { '@portfolio-mobile/transactions-v1': '{"transactions":[{"type":"SELL"}]}' },
  }));
});

test('backup preserves event stock selection and rejects invalid symbols', () => {
  const preference = '{"earnings":true,"dividends":false,"news":false,"symbols":["AAPL","NVDA"]}';
  const backup = backups.parseLocalBackup({ version: 1, values: { 'event-preferences': preference } });
  assert.equal(backup.values['event-preferences'], preference);
  assert.throws(() => backups.parseLocalBackup({
    version: 1, values: { 'event-preferences': '{"symbols":["invalid symbol"]}' },
  }), /Invalid event stock selection/);
});
