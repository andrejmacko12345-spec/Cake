const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, dependencies, globals = {}) {
  const api = {};
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    exports: api,
    require: (id) => {
      assert.ok(id in dependencies, id);
      return dependencies[id];
    },
    ...globals,
  });
  return api;
}

const portfolio = load('portfolio.ts', {});
const discovery = load('asset-discovery.ts', { './portfolio': portfolio });
const tick = () => new Promise(setImmediate);
const customAsset = (symbol) => ({
  symbol, name: `${symbol} company`, price: 100, change: 5, color: '#abcdef', category: 'stocks',
});

function setup(initial = null) {
  let raw = initial;
  let failure = false;
  const warnings = [];
  let visits;
  const api = load('asset-discovery-history.ts', {
    './portfolio': portfolio,
    './asset-discovery': discovery,
    './app-storage': { appStorage: {
      getItem: async () => raw,
      setItem: async (_key, value) => {
        if (failure) throw new Error('Storage unavailable');
        raw = value;
      },
    } },
    react: {
      useState: (initialState) => [initialState, (value) => { visits = value; }],
      useEffect: (effect) => effect(),
    },
  }, { console: { warn: (...args) => warnings.push(args) } });
  api.useDiscoveryVisits();
  return {
    api, warnings,
    raw: () => raw,
    visits: () => visits,
    fail: (value) => { failure = value; },
  };
}

test('actual detail views are serialized, persisted and survive reopening the app', async () => {
  const app = setup();
  app.api.rememberDiscoveryAsset(customAsset('ORCL'));
  app.api.recordAssetView('ORCL');
  app.api.recordAssetView('ORCL');
  await tick();
  const saved = app.api.parseDiscoveryHistory(app.raw());
  assert.equal(saved[0].views, 2);
  assert.equal(saved[0].asset.name, 'ORCL company');
  assert.equal(saved[0].asset.price, 0);
  const reopened = setup(app.raw());
  await tick();
  assert.equal(reopened.visits()[0].views, 2);
  assert.equal(discovery.getDiscoveryAssets('stocks', reopened.visits())[0].symbol, 'ORCL');
});

test('selecting an asset for a watchlist does not count as opening its detail', async () => {
  const app = setup();
  app.api.rememberDiscoveryAsset(customAsset('ORCL'));
  await tick();
  assert.equal(app.api.parseDiscoveryHistory(app.raw())[0].views, 0);
  assert.equal(discovery.getDiscoveryAssets('stocks', app.visits())[0].symbol, 'NVDA');
});

test('known stock visits work without prior search and history is bounded to 80 entries', async () => {
  const app = setup();
  app.api.recordAssetView('NVDA');
  app.api.recordAssetView('NVDA');
  await tick();
  assert.equal(app.api.parseDiscoveryHistory(app.raw())[0].views, 2);
  for (let index = 0; index < 90; index++) app.api.rememberDiscoveryAsset(customAsset(`TEST${index}`));
  await tick();
  const saved = app.api.parseDiscoveryHistory(app.raw());
  assert.equal(saved.length, 80);
  assert.ok(saved.some((visit) => visit.asset.symbol === 'TEST89'));
  assert.equal(new Set(saved.map((visit) => visit.asset.symbol)).size, 80);
});

test('invalid saved metadata is rejected and failed writes are reported without blocking later writes', async () => {
  const app = setup();
  for (const raw of ['{}', '{"version":1,"entries":[{}]}']) assert.throws(() => app.api.parseDiscoveryHistory(raw));
  app.fail(true);
  app.api.rememberDiscoveryAsset(customAsset('ORCL'));
  await tick();
  assert.equal(app.raw(), null);
  assert.equal(app.warnings.length, 1);
  app.fail(false);
  app.api.rememberDiscoveryAsset(customAsset('ORCL'));
  app.api.recordAssetView('ORCL');
  await tick();
  assert.equal(app.api.parseDiscoveryHistory(app.raw())[0].views, 1);
});
