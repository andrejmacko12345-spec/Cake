const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function setup() {
  const file = path.join(__dirname, 'market-overview.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const detail = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'IndexDetail');
  const { outputText } = ts.transpileModule(detail.getText(source), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  const state = [];
  const requests = [];
  let slot = 0;
  let deps;
  let cleanup;
  const chartArea = { height: 245 };
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState: (initial) => {
      const index = slot++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useEffect: (effect, nextDeps) => {
      if (!deps || nextDeps.some((value, index) => value !== deps[index])) {
        cleanup?.();
        cleanup = effect();
        deps = nextDeps;
      }
    },
    useThemedStyles: () => ({ chartArea, loadingChart: { opacity: 0.35 } }),
    createStyles() {},
    useLocale: () => ({ t: (text) => text, language: 'sk' }),
    selectionHaptic() {},
    fetchIndexHistory: (symbol, range) => new Promise((resolve, reject) => requests.push({ range, resolve, reject })),
    indexRanges: ['1D', '1M', '1Y'],
    colors: { green: 'green', red: 'red' },
    StyleSheet: { absoluteFill: {} },
    formatPercent: (value) => `${value}%`,
  };
  for (const name of ['Modal', 'View', 'Pressable', 'Text', 'ScrollView', 'ActivityIndicator', 'PortfolioChart', 'X']) context[name] = name;
  const renderDetail = vm.runInNewContext(`${outputText}\nIndexDetail;`, context);
  const render = () => {
    slot = 0;
    return renderDetail({ index: { symbol: '^GSPC', name: 'S&P 500' }, onClose() {} });
  };
  return { render, requests, chartArea };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}

const history = (price) => ({
  baseline: 100,
  points: [{ price, timestamp: 1700000000 }, { price: price + 1, timestamp: 1700000300 }],
});

test('switching index ranges preserves chart height and old curve until new data arrives', async () => {
  const app = setup();
  let tree = app.render();
  assert.ok(find(tree, (node) => node.props?.style === app.chartArea));
  app.requests[0].resolve(history(110));
  await Promise.resolve();
  tree = app.render();
  const chart = find(tree, (node) => node.type === 'PortfolioChart');
  assert.equal(chart.props.values[0], 110);
  find(tree, (node) => node.type === 'Pressable' && node.props.key === '1M').props.onPress();
  tree = app.render();
  assert.equal(find(tree, (node) => node.type === 'PortfolioChart').props.values[0], 110);
  assert.ok(find(tree, (node) => node.props?.pointerEvents === 'none' && node.props.style?.opacity === 0.35));
  assert.equal(find(tree, (node) => node.props?.style === app.chartArea).props.accessibilityState.busy, true);
  app.requests[1].resolve(history(120));
  await Promise.resolve();
  tree = app.render();
  assert.equal(find(tree, (node) => node.type === 'PortfolioChart').props.values[0], 120);
  assert.equal(find(tree, (node) => node.props?.style === app.chartArea).props.accessibilityState.busy, false);
});

test('rapid range changes ignore stale results and errors remain visible in the fixed chart area', async () => {
  const app = setup();
  let tree = app.render();
  find(tree, (node) => node.type === 'Pressable' && node.props.key === '1M').props.onPress();
  tree = app.render();
  find(tree, (node) => node.type === 'Pressable' && node.props.key === '1Y').props.onPress();
  app.render();
  app.requests[1].resolve(history(999));
  await Promise.resolve();
  assert.equal(find(app.render(), (node) => node.type === 'PortfolioChart'), undefined);
  app.requests[2].reject(new Error('Network failed'));
  await Promise.resolve();
  await Promise.resolve();
  tree = app.render();
  assert.ok(find(tree, (node) => node.props?.style === app.chartArea));
  assert.ok(find(tree, (node) => node.props?.accessibilityRole === 'alert'));
  assert.equal(find(tree, (node) => node.type === 'PortfolioChart'), undefined);
});
