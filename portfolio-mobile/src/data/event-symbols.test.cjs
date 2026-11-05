const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, dependencies) {
  const exports = {};
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, console });
  return exports;
}

const selection = load('event-symbols.ts', {
  './watchlists': { isValidSymbol: (value) => /^[A-Z0-9.^=-]{1,20}$/.test(value) },
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test('default selection follows the portfolio but never includes watchlists automatically', () => {
  assert.deepEqual(plain(selection.resolveEventSymbols(['AAPL', 'AAPL'], ['NVDA'], null)), ['AAPL']);
  assert.deepEqual(plain(selection.resolveEventSymbols(['AAPL', 'META'], ['NVDA'], null)), ['AAPL', 'META']);
});

test('custom selection includes watchlists, deduplicates stocks and ignores removed stocks', () => {
  assert.deepEqual(plain(selection.resolveEventSymbols(['AAPL'], ['NVDA', 'NVDA', 'AMZN'], ['NVDA', 'NVDA', 'MSFT'])), ['NVDA']);
  assert.deepEqual(plain(selection.resolveEventSymbols(['META'], ['NVDA'], ['AAPL', 'NVDA'])), ['NVDA']);
  assert.deepEqual(plain(selection.resolveEventSymbols(['META'], ['NVDA'], [])), []);
});

test('old preferences use defaults; malformed stock selections are rejected', () => {
  assert.equal(selection.parseEventSymbols(undefined), null);
  assert.equal(selection.parseEventSymbols(null), null);
  assert.deepEqual(plain(selection.parseEventSymbols(['AAPL', 'AAPL'])), ['AAPL']);
  for (const value of [false, 'AAPL', {}, [123], ['invalid symbol']]) {
    assert.throws(() => selection.parseEventSymbols(value), /Invalid event stock selection/);
  }
});

test('group selection selects all, clears all and completes a partial selection', () => {
  const toggle = selection.toggleEventSymbolGroup;
  assert.deepEqual(plain(toggle(['AAPL'], null, ['NVDA', 'AMZN'])), ['AAPL', 'NVDA', 'AMZN']);
  assert.deepEqual(plain(toggle(['AAPL'], ['AAPL', 'NVDA', 'AMZN'], ['NVDA', 'AMZN'])), ['AAPL']);
  assert.deepEqual(plain(toggle([], ['NVDA'], ['NVDA', 'AMZN'])), ['NVDA', 'AMZN']);
  assert.deepEqual(plain(toggle(['AAPL'], null, ['AAPL'], true)), []);
  assert.equal(toggle(['AAPL', 'META'], ['AAPL'], ['AAPL', 'META'], true), null);
  assert.deepEqual(plain(toggle(['AAPL'], ['NVDA'], ['AAPL'], true)), ['NVDA', 'AAPL']);
});

test('overlapping groups share choices and preserve saved unavailable stocks', () => {
  const toggle = selection.toggleEventSymbolGroup;
  assert.deepEqual(plain(toggle(['AAPL'], ['AAPL', 'REMOVED'], ['AAPL', 'NVDA'])), ['AAPL', 'REMOVED', 'NVDA']);
  assert.deepEqual(plain(toggle(['AAPL'], ['AAPL', 'NVDA', 'REMOVED'], ['AAPL', 'NVDA'])), ['REMOVED']);
  assert.deepEqual(plain(toggle([], ['REMOVED'], [])), ['REMOVED']);
});

function setup(raw) {
  let stored = raw;
  let failure = null;
  let subscriber;
  let reset;
  const writes = [];
  const changes = [];
  const prefs = load('event-prefs.ts', {
    './event-symbols': selection,
    './app-storage': {
      appStorage: {
        getItem: async () => stored,
        setItem: async (_key, value) => {
          if (failure) throw failure;
          stored = value;
          writes.push(JSON.parse(value));
        },
      },
      onBulkStorageChange: (callback) => { reset = callback; },
    },
    react: {
      useState: (initial) => [initial, (value) => { changes.push(plain(value)); }],
      useEffect: (effect) => { subscriber = effect(); },
    },
  });
  prefs.useEventPrefs();
  return {
    prefs, writes, changes,
    fail: () => { failure = new Error('Storage failed'); },
    restore: (value) => { stored = value; reset(); },
    stop: () => subscriber(),
  };
}

test('saving waits for loading, preserves category preferences and persists custom selection', async () => {
  const app = setup('{"earnings":false,"dividends":true,"news":false}');
  await app.prefs.setEventSymbols(['NVDA', 'AAPL']);
  assert.deepEqual(app.writes[0], { earnings: false, dividends: true, news: false, symbols: ['NVDA', 'AAPL'] });
  await app.prefs.setEventPref('news', true);
  assert.deepEqual(app.writes[1].symbols, ['NVDA', 'AAPL']);
  await app.prefs.setEventSymbols(null);
  assert.equal(app.writes[2].symbols, null);
  app.stop();
});

test('failed save does not publish success and backup restoration reloads selected stocks', async () => {
  const app = setup(null);
  await app.prefs.setEventSymbols(['AAPL']);
  const changeCount = app.changes.length;
  app.fail();
  await assert.rejects(() => app.prefs.setEventSymbols(['NVDA']), /Storage failed/);
  assert.equal(app.changes.length, changeCount);
  assert.deepEqual(app.changes.at(-1).symbols, ['AAPL']);
  app.restore('{"earnings":true,"symbols":["NVDA"]}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.changes.at(-1).symbols, ['NVDA']);
  app.stop();
});
