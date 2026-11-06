const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'use-positions.tsx'), 'utf8');
const source = ts.createSourceFile('use-positions.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'deleteSymbolTransactions') initializer = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);

function setup(persist) {
  const transactions = [
    { id: 'buy', symbol: 'AAPL', type: 'BUY' },
    { id: 'other', symbol: 'MSFT', type: 'BUY' },
    { id: 'sell', symbol: 'AAPL', type: 'SELL' },
  ];
  assert.ok(initializer);
  return vm.runInNewContext(ts.transpileModule(`(${initializer.getText(source)})`, {}).outputText, {
    transactions, quotes: {}, persist,
    validateLedger: (next) => assert.equal(next.some((item) => item.symbol === 'AAPL'), false),
  });
}

test('deleting a stock removes all buys and sells in one write and preserves other stocks', async () => {
  const writes = [];
  await setup(async (next) => writes.push(next))('AAPL');
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(writes[0], (item) => item.id), ['other']);
});

test('stock transaction deletion propagates storage failures', async () => {
  await assert.rejects(setup(async () => { throw new Error('Storage unavailable'); })('AAPL'), /Storage unavailable/);
});

test('bulk deletion requires a destructive confirmation and reports errors', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  assert.ok(screen.includes("Alert.alert(t('Vymazať všetky transakcie?')"));
  assert.ok(screen.includes('deleteSymbolTransactions(targetSymbol)'));
  assert.ok(screen.includes("t('Transakcie sa neodstránili')"));
  assert.ok(screen.includes('disabled={deletingTransactions} onPress={removeAllTransactions}'));
  assert.ok(screen.indexOf('disabled={deletingTransactions} onPress={removeAllTransactions}') < screen.indexOf('<TransactionList transactions='));
});
