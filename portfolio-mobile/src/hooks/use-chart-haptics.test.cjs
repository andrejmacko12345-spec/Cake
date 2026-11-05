const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const platform = { OS: 'android' };
const calls = [];
let failure = null;
const feedback = (type) => {
  calls.push(type);
  return failure ? Promise.reject(failure) : Promise.resolve();
};
const originalLoad = Module._load;
let useChartHaptics;
let selectionHaptic;
try {
  Module._load = function (id, ...args) {
    if (id === 'react') return { useRef: (value) => ({ current: value }), useCallback: (callback) => callback };
    if (id === 'react-native') return { Platform: platform };
    if (id === 'expo-haptics') return {
      AndroidHaptics: { Segment_Frequent_Tick: 'tick', Keyboard_Tap: 'tap' },
      performAndroidHapticsAsync: (type) => feedback(type),
      selectionAsync: () => feedback('selection'),
    };
    return originalLoad.call(this, id, ...args);
  };
  ({ useChartHaptics } = require('./use-chart-haptics.ts'));
  ({ selectionHaptic } = require('../data/haptics.ts'));
} finally {
  Module._load = originalLoad;
}

test('chart feedback deduplicates selected points, limits pulse frequency and resets after touch end', (context) => {
  platform.OS = 'android';
  calls.length = 0;
  let now = 100;
  context.mock.method(Date, 'now', () => now);
  const select = useChartHaptics();
  select(0);
  select(0);
  now += 20;
  select(1);
  now += 20;
  select(2);
  assert.deepEqual(calls, ['tick', 'tick']);
  now += 100;
  select(2);
  assert.equal(calls.length, 2);
  select(null);
  select(2);
  assert.equal(calls.length, 3);
  select(-1);
  select(NaN);
  select(1.5);
  assert.equal(calls.length, 3);
});

test('iOS uses selection feedback, web does not vibrate and each chart tracks its own gesture', () => {
  calls.length = 0;
  platform.OS = 'ios';
  useChartHaptics()(4);
  useChartHaptics()(4);
  assert.deepEqual(calls, ['selection', 'selection']);
  platform.OS = 'web';
  const select = useChartHaptics();
  select(0);
  select(1);
  assert.equal(calls.length, 2);
});

test('unavailable device feedback is reported without interrupting chart selection', async (context) => {
  platform.OS = 'android';
  failure = new Error('Device feedback unavailable');
  const warnings = [];
  context.mock.method(console, 'warn', (...args) => warnings.push(args));
  try {
    assert.doesNotThrow(() => useChartHaptics()(0));
    await Promise.resolve();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1], failure);
  } finally {
    failure = null;
  }
});

test('sort taps give one native selection pulse per tap and do not vibrate on web', () => {
  calls.length = 0;
  platform.OS = 'android';
  selectionHaptic();
  selectionHaptic();
  assert.deepEqual(calls, ['tap', 'tap']);
  platform.OS = 'ios';
  selectionHaptic();
  assert.deepEqual(calls, ['tap', 'tap', 'selection']);
  platform.OS = 'web';
  selectionHaptic();
  assert.equal(calls.length, 3);
});

function pressHandler(file, marker, context) {
  const filename = path.resolve(__dirname, '..', file);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === 'onPress' &&
        node.initializer?.expression && node.initializer.expression.getText(source).includes(marker)) {
      handler = node.initializer.expression.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler, `${file}: ${marker}`);
  const { outputText } = ts.transpileModule(`const handler = ${handler};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return vm.runInNewContext(`${outputText}\nhandler;`, context);
}

test('home add-position, analytics and dividend actions emit one soft tap and retain their action', () => {
  platform.OS = 'android';
  calls.length = 0;
  const filename = path.resolve(__dirname, '..', 'app', 'index.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let open;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'openNewTransaction') open = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(open);
  const updates = [];
  const { outputText } = ts.transpileModule(`const open = ${open};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(`${outputText}\nopen();`, {
    selectionHaptic,
    setInitialType: (type) => updates.push(type),
    setFormVisible: (visible) => updates.push(visible),
  });
  assert.deepEqual(updates, ['BUY', true]);
  const routes = [];
  for (const route of ['/analytics', '/dividends']) {
    pressHandler('app/index.tsx', `router.navigate('${route}')`, {
      selectionHaptic, router: { navigate: (value) => routes.push(value) },
    })();
  }
  assert.deepEqual(routes, ['/analytics', '/dividends']);
  assert.deepEqual(calls, ['tap', 'tap', 'tap']);
});

test('stock Buy, Sell and share-count actions give one soft tap and retain their action', () => {
  platform.OS = 'android';
  calls.length = 0;
  const filename = path.resolve(__dirname, '..', 'app', 'position.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'addTransaction') handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler);
  const updates = [];
  const { outputText } = ts.transpileModule(`const add = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const context = {
    selectionHaptic,
    setEditingTransaction: (value) => updates.push(value),
    setInitialType: (value) => updates.push(value),
    setFormVisible: (value) => updates.push(value),
  };
  vm.runInNewContext(`${outputText}\nadd('BUY'); add('SELL');`, context);
  assert.deepEqual(updates, [undefined, 'BUY', true, undefined, 'SELL', true]);
  let historyOpen = false;
  pressHandler('app/position.tsx', 'setMovementsOpen(true)', {
    selectionHaptic, setMovementsOpen: (value) => { historyOpen = value; },
  })();
  assert.equal(historyOpen, true);
  assert.deepEqual(calls, ['tap', 'tap', 'tap']);
});

test('chart range buttons tap once on changes, not when the selected period is pressed again', () => {
  platform.OS = 'android';
  for (const file of ['components/range-swipe-row.tsx', 'app/analytics.tsx', 'components/market-overview.tsx', 'components/dividend-overview.tsx']) {
    for (const same of [false, true]) {
      calls.length = 0;
      const updates = [];
      const context = {
        selectionHaptic,
        item: file.includes('market-overview') ? '1M' : { label: '1M' },
        period: { label: '1M' },
        range: same ? '1M' : '1D',
        comparisonPeriod: same ? '1M' : '1D',
        selected: file.includes('range-swipe-row') ? (same ? '1M' : '1D') : same,
        label: '1M',
        onChange: (value) => updates.push(value),
        onRangeChange: (value) => updates.push(value),
        setComparisonPeriod: (value) => updates.push(value),
        setSelected() {}, setEntry() {},
        setRange: (value) => updates.push(value),
        onPress: () => updates.push('dividend-period'),
      };
      const marker = file.includes('analytics') ? 'setComparisonPeriod' :
        file.includes('market-overview') ? 'setRange(item)' :
        file.includes('dividend-overview') ? 'onPress()' : 'onChange(label)';
      pressHandler(file, marker, context)();
      assert.equal(calls.length, same ? 0 : 1, `${file}, selected=${same}`);
      if (!same) assert.equal(updates.length, 1, file);
    }
  }
});
