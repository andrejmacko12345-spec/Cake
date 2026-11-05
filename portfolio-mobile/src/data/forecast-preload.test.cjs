const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'forecast.tsx'), 'utf8');
const source = ts.createSourceFile('forecast.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
const effect = find(source, (node) => ts.isCallExpression(node)
  && node.expression.getText(source) === 'useEffect'
  && node.arguments[0]?.getText(source).includes('smoothedPortfolioReturn'));

test('forecast prepares the model after transactions load without waiting for settings', async () => {
  assert.ok(effect);
  assert.equal(effect.arguments[1].getText(source), '[positionsLoading, transactions, currentYear]');
  const { outputText } = ts.transpileModule(`(${effect.arguments[0].getText(source)})`, {});
  const transactions = [{ id: 'trade' }];
  const results = [];
  let calls = 0;
  const context = {
    positionsLoading: true, transactions, currentYear: 2026,
    smoothedPortfolioReturn: async (items, year) => {
      calls++;
      assert.equal(items, transactions);
      assert.equal(year, 2026);
      return { rate: 12, years: 3 };
    },
    setModelResult: (value) => results.push(value),
  };
  vm.runInNewContext(outputText, context)();
  assert.equal(calls, 0);
  context.positionsLoading = false;
  vm.runInNewContext(outputText, context)();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(results[0].rate, 12);
});

test('an obsolete calculation cannot replace the model after transaction changes', async () => {
  const { outputText } = ts.transpileModule(`(${effect.arguments[0].getText(source)})`, {});
  let complete;
  let result;
  const cleanup = vm.runInNewContext(outputText, {
    positionsLoading: false, transactions: [], currentYear: 2026,
    smoothedPortfolioReturn: () => new Promise((resolve) => { complete = resolve; }),
    setModelResult: (value) => { result = value; },
  })();
  cleanup();
  complete({ rate: 10, years: 1 });
  await new Promise(setImmediate);
  assert.equal(result, undefined);
});
