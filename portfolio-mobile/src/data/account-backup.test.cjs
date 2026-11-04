const assert = require('node:assert/strict');
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
const { makeBackup, parseBackup, BACKUP_KEYS } = require('./account-backup.ts');
const { parseAuthLink } = require('./auth-link.ts');

test('backup allows only user data and strips quotes and credentials', () => {
  const result = makeBackup([
    ['@portfolio-mobile/transactions-v1', '{"transactions":[],"quotes":{"AAPL":{"price":9}}}'],
    ['@portfolio-mobile/language', 'en'],
    ['sb-auth-token', 'secret'],
    ['financial-history-cache', '{}'],
  ]);
  assert.deepEqual(result, { version: 1, values: {
    '@portfolio-mobile/transactions-v1': '{"transactions":[],"quotes":{}}',
    '@portfolio-mobile/language': 'en',
  } });
  assert.throws(() => parseBackup({ version: 2, values: {} }));
  assert.throws(() => parseBackup({ version: 1, values: { 'sb-auth-token': 'value' } }));
  assert.throws(() => parseBackup({ version: 1, values: { '@portfolio-mobile/language': 'invalid' } }));
  assert.throws(() => parseBackup({ version: 1, values: { '@portfolio-mobile/watchlist': 'bad json' } }));
  assert.throws(() => parseBackup({ version: 1, values: { '@portfolio-mobile/transactions-v1': '{}' } }));
});

test('guest and account storage remain isolated, including late writes and deletion', async () => {
  const stored = new Map();
  let writeBarrier = Promise.resolve();
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'react') return { useMemo: (fn) => fn() };
    if (id === '@react-native-async-storage/async-storage') return {
      getItem: async (key) => stored.get(key) ?? null,
      setItem: async (key, value) => { await writeBarrier; stored.set(key, value); },
      removeItem: async (key) => { stored.delete(key); },
      multiGet: async (keys) => keys.map((key) => [key, stored.get(key) ?? null]),
      multiSet: async (pairs) => { for (const [key, value] of pairs) stored.set(key, value); },
      getAllKeys: async () => [...stored.keys()],
      multiRemove: async (keys) => { for (const key of keys) stored.delete(key); },
    };
    return original.call(this, id, ...args);
  };
  let storage;
  try { storage = require('./app-storage.ts'); } finally { Module._load = original; }
  const guest = storage.useAppStorage();
  await guest.setItem('@portfolio-mobile/transactions-v1', '{"transactions":[],"quotes":{}}');
  await guest.setItem('@portfolio-mobile/language', 'en');
  const snapshot = await storage.readBackup(null);
  let releaseGuestWrite;
  writeBarrier = new Promise((resolve) => { releaseGuestWrite = resolve; });
  const guestWrite = guest.setItem('@portfolio-mobile/language', 'sk');
  let snapshotFinished = false;
  const pendingSnapshot = storage.readBackup(null).then((value) => { snapshotFinished = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshotFinished, false);
  releaseGuestWrite();
  await guestWrite;
  assert.equal((await pendingSnapshot).values['@portfolio-mobile/language'], 'sk');
  writeBarrier = Promise.resolve();
  await guest.setItem('@portfolio-mobile/language', 'en');
  await storage.restoreBackup('alice', snapshot);
  storage.setStorageOwner('alice');
  const alice = storage.useAppStorage();
  await alice.setItem('@portfolio-mobile/language', 'sk');
  storage.setStorageOwner('bob');
  const bob = storage.useAppStorage();
  const resumeBob = storage.pauseAccountWrites('bob');
  await assert.rejects(() => bob.setItem('@portfolio-mobile/language', 'sk'), /changing/);
  resumeBob();
  await bob.setItem('@portfolio-mobile/language', 'sk');
  await bob.removeItem('@portfolio-mobile/language');
  assert.equal(await bob.getItem('@portfolio-mobile/language'), null);
  await alice.setItem('@portfolio-mobile/language', 'en');
  assert.equal(await bob.getItem('@portfolio-mobile/language'), null);
  assert.equal(await guest.getItem('@portfolio-mobile/language'), 'en');
  await storage.restoreBackup('alice', { version: 1, values: {} });
  assert.equal(await alice.getItem('@portfolio-mobile/language'), 'sk');
  assert.deepEqual(JSON.parse(await alice.getItem('@portfolio-mobile/transactions-v1')).transactions, []);
  await assert.rejects(() => storage.restoreBackup('alice', { version: 1, values: { bad: 'value' } }));
  await storage.clearAccountData('alice');
  assert.equal(await alice.getItem('@portfolio-mobile/language'), null);
  await assert.rejects(() => alice.setItem('@portfolio-mobile/language', 'en'), /deleted/);
  storage.setStorageOwner('charlie');
  const charlie = storage.useAppStorage();
  let finishWrite;
  writeBarrier = new Promise((resolve) => { finishWrite = resolve; });
  const pendingWrite = charlie.setItem('@portfolio-mobile/language', 'en');
  const deleting = storage.clearAccountData('charlie');
  finishWrite();
  await Promise.all([pendingWrite, deleting]);
  assert.equal(await charlie.getItem('@portfolio-mobile/language'), null);
  await assert.rejects(() => charlie.setItem('@portfolio-mobile/language', 'en'), /deleted/);
  assert.equal(await guest.getItem('@portfolio-mobile/language'), 'en');
  assert.equal(BACKUP_KEYS.length, 8);
});

test('confirmation and recovery links require the configured destination and complete tokens', () => {
  const target = 'portfolio-mobile://settings';
  assert.deepEqual(parseAuthLink(`${target}#access_token=a&refresh_token=b&type=recovery`, target),
    { accessToken: 'a', refreshToken: 'b', recovery: true });
  assert.equal(parseAuthLink('other://settings#access_token=a&refresh_token=b', target), null);
  assert.equal(parseAuthLink('portfolio-mobile://unrelated#access_token=a&refresh_token=b', target), null);
  assert.equal(parseAuthLink(target, target), null);
  assert.throws(() => parseAuthLink(`${target}#access_token=a`, target));
  assert.throws(() => parseAuthLink(`${target}#error_description=Expired`, target), /Expired/);
  assert.deepEqual(parseAuthLink('http://localhost:8081/settings#access_token=a&refresh_token=b',
    'http://localhost:8081/settings'), { accessToken: 'a', refreshToken: 'b', recovery: false });
});
