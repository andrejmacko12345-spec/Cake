const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { CSV_HEADER, transactionCsvTemplate, parseTransactionCsv, rowsToTransactions, reconcileOversells, transactionsToCsv } = require('./transaction-csv.ts');

test('CSV template imports purchases, fractional quantities and a covered sale without adjustments', () => {
  const csv = transactionCsvTemplate();
  assert.equal(csv.split('\n')[0], CSV_HEADER.join(','));
  const rows = parseTransactionCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.currency), ['USD', 'USD', 'EUR']);
  assert.deepEqual(rows.map((row) => row.quantity), [2, -1, 1.5]);
  assert.equal(rows[1].toCash, true);
  const transactions = rowsToTransactions(rows, () => 0.9, (symbol) => symbol);
  assert.deepEqual(transactions.map((item) => item.type), ['BUY', 'SELL', 'BUY']);
  const reconciled = reconcileOversells([], transactions);
  assert.equal(reconciled.adjusted, 0);
  assert.equal(reconciled.dropped, 0);
  assert.equal(reconciled.transactions.length, 3);
  assert.equal(parseTransactionCsv(transactionsToCsv(transactions)).length, 3);
});
