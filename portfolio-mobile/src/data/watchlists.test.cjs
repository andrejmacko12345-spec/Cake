const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
const exportsObject = {};
new Function('exports', ts.transpileModule(fs.readFileSync(require.resolve('./watchlists.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(exportsObject);
const { parseWatchlists } = exportsObject;

test('shared watchlist parser preserves every group, custom name, empty list and legacy ticker', () => {
  assert.deepEqual(parseWatchlists(null).lists[0].symbols, ['NVDA', 'AMZN']);
  assert.deepEqual(parseWatchlists('["AAPL","BRK-B"]').lists[0].symbols, ['AAPL', 'BRK-B']);
  const saved = { selectedId: 'income', lists: [
    { id: 'growth', name: 'Growth Picks', symbols: ['NVDA', 'AMD'] },
    { id: 'income', name: 'Income Picks', symbols: ['KO'] },
    { id: 'empty', name: 'Empty Picks', symbols: [] },
  ] };
  assert.deepEqual(parseWatchlists(JSON.stringify(saved)), saved);
  assert.equal(parseWatchlists(JSON.stringify({ ...saved, selectedId: 'missing' })).selectedId, 'growth');
  for (const invalid of ['null', '{}', '{"lists":[]}', '["aapl"]',
    '{"lists":[{"id":"one","name":"One","symbols":[123]}]}']) {
    assert.throws(() => parseWatchlists(invalid));
  }
});
