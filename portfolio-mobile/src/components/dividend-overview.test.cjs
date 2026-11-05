const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, 'dividend-overview.tsx'), 'utf8');
const source = ts.createSourceFile('dividend-overview.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
function evaluate(expression, context) {
  const { outputText } = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  return vm.runInNewContext(outputText, context);
}

test('holding a monthly dividend column shows its selection and release clears it', () => {
  const target = find(source, (node) => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(source) === 'Pressable'
    && node.attributes.properties.some((attribute) => attribute.name?.getText(source) === 'onPressIn'));
  assert.ok(target);
  const attribute = (name) => target.attributes.properties.find((item) => item.name?.getText(source) === name)
    .initializer.expression.getText(source);
  let selected = null;
  const context = { index: 7, setSelectedMonth: (value) => { selected = value; } };
  evaluate(attribute('onPressIn'), context)();
  assert.equal(selected, 7);
  evaluate(attribute('onPressOut'), context)();
  assert.equal(selected, null);
  assert.match(text, /monthlyAmounts\[selectedMonth\]\.label/);
  assert.match(text, /money\(monthlyAmounts\[selectedMonth\]\.amount\)/);
  assert.match(text, /useEffect\(\(\) => setSelectedMonth\(null\), \[period\]\)/);
});

test('dividend tooltip and accessible labels use the privacy-aware EUR formatter', () => {
  const money = find(source, (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === 'money');
  assert.ok(money);
  const hidden = evaluate(money.initializer.getText(source), { hideAmounts: true, language: 'sk' });
  assert.equal(hidden(123.4), '•••••');
  const visible = evaluate(money.initializer.getText(source), { hideAmounts: false, language: 'sk' });
  assert.match(visible(123.4), /123,40/);
  assert.match(visible(123.4), /€/);
  assert.match(text, /accessibilityLabel=\{`\$\{item\.label\} · \$\{money\(item\.amount\)\}`\}/);
});
