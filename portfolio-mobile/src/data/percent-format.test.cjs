const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const exportsObject = {};
const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'portfolio.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
vm.runInNewContext(outputText, { exports: exportsObject });

test('percentage returns always retain two decimals including integers, zero and trailing zeros', () => {
  for (const [value, expected] of [[6.1, '+6,10 %'], [6, '+6,00 %'], [0, '0,00 %'], [-6.1, '-6,10 %'], [6.127, '+6,13 %']]) {
    assert.equal(exportsObject.formatPercent(value), expected);
  }
});

test('English forecast amounts and returns use English number formatting', () => {
  assert.equal(exportsObject.formatMoney(78560, true, 'en'), '€78.56K');
  assert.equal(exportsObject.formatMoney(78560, true), '78,56\u00a0tis.\u00a0€');
  assert.equal(exportsObject.formatPercent(10.57, 2, 'en'), '+10.57 %');
  assert.equal(exportsObject.formatPercent(-3.9, 2, 'en'), '-3.90 %');
});

test('watchlist percentage output retains two decimals in Slovak and English', () => {
  const file = path.resolve(__dirname, '..', 'app', 'watchlist.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'formatMovement') {
      expression = ts.transpileModule(`const formatMovement = ${node.initializer.getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression);
  for (const language of ['sk', 'en']) {
    for (const change of [6.1, 6, 0, -6.1]) {
      const actual = vm.runInNewContext(`${expression}\nformatMovement(change, true)`, { language, change });
      const expected = `${change > 0 ? '+' : ''}${change.toFixed(2).replace('.', language === 'sk' ? ',' : '.')}%`;
      assert.equal(actual, expected);
    }
  }
});
