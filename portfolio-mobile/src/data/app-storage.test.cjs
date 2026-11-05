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

test('app storage persists locally and notifies listeners after successful changes', async () => {
  const values = new Map();
  const original = Module._load;
  Module._load = function (id, ...args) {
    if (id === '@react-native-async-storage/async-storage') return {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value); },
      removeItem: async (key) => { values.delete(key); },
      multiSet: async (pairs) => { for (const [key, value] of pairs) values.set(key, value); },
    };
    return original.call(this, id, ...args);
  };
  let storage;
  try { storage = require('./app-storage.ts'); } finally { Module._load = original; }

  const changes = [];
  const bulkChanges = [];
  const unsubscribe = storage.onStorageChange(() => changes.push('changed'));
  const unsubscribeBulk = storage.onBulkStorageChange(() => bulkChanges.push('changed'));
  const app = storage.useAppStorage();
  await app.setItem('@portfolio-mobile/language', 'en');
  assert.equal(await app.getItem('@portfolio-mobile/language'), 'en');
  assert.equal(await storage.appStorage.getItem('@portfolio-mobile/language'), 'en');
  await storage.appStorage.setItem('@portfolio-mobile/language', 'sk');
  assert.equal(await app.getItem('@portfolio-mobile/language'), 'sk');
  await app.removeItem('@portfolio-mobile/language');
  assert.equal(await app.getItem('@portfolio-mobile/language'), null);
  assert.deepEqual(changes, ['changed', 'changed', 'changed']);
  await storage.setItems([['@portfolio-mobile/language', 'en']]);
  assert.deepEqual(changes, ['changed', 'changed', 'changed', 'changed']);
  assert.deepEqual(bulkChanges, ['changed']);
  unsubscribe();
  unsubscribeBulk();
});
