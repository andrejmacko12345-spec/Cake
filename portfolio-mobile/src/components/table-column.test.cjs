const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function loadTable(colors) {
  const text = fs.readFileSync(path.join(__dirname, 'table-column.tsx'), 'utf8');
  const exports = {};
  const react = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const output = ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(output, {
    exports, React: react,
    require: (name) => {
      if (name === '../data/theme') return { useThemedStyles: (create) => create() };
      if (name === '../data/portfolio') return { colors };
      if (name === 'react-native') return { View: 'View', StyleSheet: { create: (styles) => styles, hairlineWidth: 1 } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

test('shared cool palette keeps headers and cells consistent in both themes', () => {
  for (const colors of [
    { border: '#364355', surfaceRaised: '#202a3a' },
    { border: '#e3c28e', surfaceRaised: '#f8e3bd' },
  ]) {
    const { TableColumn, tableToneBackgrounds } = loadTable(colors);
    const backgrounds = [];
    for (const tone of ['cyan', 'blue', 'violet', 'slate']) {
      for (const header of [false, true]) {
        const cell = TableColumn({ tone, header, children: '12.3' });
        const style = Object.assign({}, ...cell.props.style.filter(Boolean));
        assert.equal(style.backgroundColor, tableToneBackgrounds[tone]);
        assert.equal(style.borderLeftColor, colors.border);
      }
      backgrounds.push(tableToneBackgrounds[tone]);
    }
    assert.equal(new Set(backgrounds).size, 4);
    const first = TableColumn({ tone: 'cyan', first: true, header: true, children: 'Value' });
    assert.equal(Object.assign({}, ...first.props.style.filter(Boolean)).borderLeftWidth, 0);
  }
});

test('CAGR result coloring depends on the metric rather than its background tone', () => {
  const text = fs.readFileSync(path.join(__dirname, 'stock-projections.tsx'), 'utf8');
  assert.ok(text.includes("(row.key === 'cagrLow' || row.key === 'cagrHigh')"));
  assert.equal(text.includes("row.tone === 'green'"), false);
});

test('all four table colors have equal saturation, lightness and opacity with matching accents', () => {
  const { tableToneBackgrounds, tableToneAccents } = loadTable({});
  const hues = [];
  const levels = ['cyan', 'blue', 'violet', 'slate'].map((tone) => {
    const [r, g, b, alpha] = tableToneBackgrounds[tone].match(/[\d.]+/g).map(Number);
    assert.equal(tableToneAccents[tone], `rgb(${r},${g},${b})`);
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const lightness = (max + min) / 2;
    assert.ok(lightness > 0.5, 'Table colors should use lighter base shades');
    assert.equal(alpha, 0.22);
    const saturation = (max - min) / (1 - Math.abs(2 * lightness - 1));
    assert.ok(saturation < 0.4, 'Table colors should stay muted');
    const high = Math.max(r, g, b);
    const delta = high - Math.min(r, g, b);
    const hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hues.push((hue * 60 + 360) % 360);
    return [saturation, lightness, alpha];
  });
  for (const level of levels) assert.deepEqual(level, levels[0]);
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const gap = Math.abs(hues[i] - hues[j]);
      assert.ok(Math.min(gap, 360 - gap) >= 80, 'Table hues should be clearly separated');
    }
  }
});

test('comparison headings use only colored dots in the projection palette order', () => {
  const text = fs.readFileSync(path.join(__dirname, 'stock-compare.tsx'), 'utf8');
  const tones = ['Pe', 'Revenue', 'Eps', 'Profitability'].map((group) => {
    const match = text.match(new RegExp(`groupIndicator${group}: \\{ backgroundColor: tableToneAccents\\.(\\w+)`));
    assert.ok(match, `Missing colored dot for ${group}`);
    return match[1];
  });
  const projections = fs.readFileSync(path.join(__dirname, 'stock-projections.tsx'), 'utf8');
  const projectionTones = ['revenue', 'margin', 'priceLow', 'cagrLow'].map((key) => {
    const match = projections.match(new RegExp(`key: '${key}'[^\\n]+tone: '(\\w+)'`));
    assert.ok(match, `Missing projection background for ${key}`);
    return match[1];
  });
  assert.deepEqual(tones, projectionTones);
  assert.equal(new Set(tones).size, 4);
  const divider = text.match(/groupDivider: \{([\s\S]*?)\n  \}/);
  assert.ok(divider);
  assert.equal(/backgroundColor|borderLeft/.test(divider[1]), false);
  assert.equal(text.includes('groupDividerStyle'), false);
  const stockTones = text.match(/function stockColumnTone[\s\S]*?\n\}/);
  assert.ok(stockTones);
  assert.deepEqual([...stockTones[0].matchAll(/return '(\w+)'/g)].map((match) => match[1]), projectionTones.slice(0, 3));
  assert.ok(text.includes('tone={stockColumnTone(symbolIndex)}'));
  assert.ok(text.includes('const stockTone = stockColumnTone(symbolIndex)'));
});

test('stock detail projections share section colors without coloring year headings', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
  assert.ok(text.includes('<TableColumn first tone={section.tone} style={styles.projectionLabel}>'));
  assert.ok(text.includes('<TableColumn key={index} tone={section.tone} style={styles.projectionValue}>'));
  assert.ok(text.includes('<TableColumn key={year} style={styles.projectionValue}>'));
  assert.ok(text.includes('revenueSectionTitle: { color: tableToneAccents.cyan }'));
  assert.ok(text.includes('valuationSectionTitle: { color: tableToneAccents.violet }'));
});
