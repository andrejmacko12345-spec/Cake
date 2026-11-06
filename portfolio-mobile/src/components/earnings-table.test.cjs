const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

test('revenue and EPS beats use the same subtle divider', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  for (const [column, tone] of [['colRevenueBeat', 'reportRevenueTone'], ['colBeat', 'reportEpsTone']]) {
    assert.ok(text.includes(`styles.${column}, styles.${tone}, styles.reportBeatDivider`));
  }
  assert.match(text, /reportBeatDivider: \{ borderLeftWidth: 1, borderLeftColor: 'rgba\(170,180,195,0\.22\)' \}/);
});

test('earnings card keeps its original padding while metric cells retain shared colors', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  const card = text.match(/reportCard: \{([^}]+)\}/)[1];
  assert.match(card, /paddingVertical: 14/);
  assert.equal(card.includes('transparent'), false);
  const quarter = text.match(/reportQuarter: \{([^}]+)\}/)[1];
  assert.match(quarter, /marginBottom: 4/);
  assert.equal(quarter.includes('marginTop'), false);
  assert.match(quarter, /borderRadius: 12/);
  assert.match(quarter, /overflow: 'hidden'/);
  assert.match(text, /reportRow: \{[^}]*borderRadius: 8, overflow: 'hidden'/);
  for (const [section, tone] of [['Revenue', 'cyan'], ['Growth', 'blue'], ['Eps', 'violet']]) {
    assert.ok(text.includes(`report${section}Tone: { backgroundColor: tableToneBackgrounds.${tone} }`));
  }
});

test('earnings keeps five numeric cells and fits long revenue beats and YoY on one line', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  const source = ts.createSourceFile('position.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cells = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'Text'
      && node.attributes.properties.some((prop) => prop.name?.getText(source) === 'style'
        && /styles\.report(?:Secondary|Beat)\b/.test(prop.initializer?.getText(source) ?? ''))) cells.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(cells.length, 5);
  const fitted = cells.filter((cell) => cell.attributes.properties.some((prop) => prop.name?.getText(source) === 'adjustsFontSizeToFit'));
  assert.equal(fitted.length, 2);
  for (const [index, cell] of fitted.entries()) {
    const prop = (name) => cell.attributes.properties.find((item) => item.name?.getText(source) === name);
    assert.equal(prop('numberOfLines')?.initializer.expression.getText(source), '1');
    assert.ok(prop('adjustsFontSizeToFit'));
    assert.equal(prop('minimumFontScale')?.initializer.expression.getText(source), index === 0 ? '0.85' : '0.75');
  }
});
