const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('earnings numeric cells fit a single line without changing table column widths', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  const source = ts.createSourceFile('position.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cells = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'Text'
      && node.attributes.properties.some((prop) => prop.name?.getText(source) === 'style'
        && prop.initializer?.getText(source).includes('styles.reportCell'))) cells.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(cells.length, 5);
  for (const cell of cells) {
    const prop = (name) => cell.attributes.properties.find((item) => item.name?.getText(source) === name);
    assert.equal(prop('numberOfLines')?.initializer.expression.getText(source), '1');
    assert.ok(prop('adjustsFontSizeToFit'));
    assert.equal(prop('minimumFontScale')?.initializer.expression.getText(source), '0.65');
  }
});
