const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'asset-discovery.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const api = {};
vm.runInNewContext(outputText, {
  exports: api,
  require: (id) => {
    assert.equal(id, './portfolio');
    return {
      colors: { red: '#f00', blue: '#00f', violet: '#90f', green: '#0f0', cyan: '#0ff' },
    };
  },
});

test('default browse lists provide examples in all three categories and filter locally', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(api.assetCategories)), ['stocks', 'etfs', 'indexes']);
  const symbols = JSON.parse(JSON.stringify(api.getFeaturedAssets('stocks').map((asset) => asset.symbol)));
  assert.deepEqual(symbols.slice(0, 5), ['NVDA', 'AAPL', 'GOOG', 'MSFT', 'AMZN']);
  assert.equal(symbols.slice(0, 5).includes('O'), false);
  assert.ok(api.getFeaturedAssets('etfs').length >= 20);
  assert.ok(api.getFeaturedAssets('indexes').length >= 15);
  assert.ok(api.getFeaturedAssets('etfs').some((asset) => asset.symbol === 'SPY'));
  assert.ok(api.getFeaturedAssets('indexes').some((asset) => asset.symbol === '^GSPC'));
  assert.deepEqual(JSON.parse(JSON.stringify(api.getFeaturedAssets('stocks', 'app').map((asset) => asset.symbol))), ['AAPL']);
});

test('frequently viewed assets lead their category without duplicates or changing typed search', () => {
  const makeVisit = (symbol, views, lastViewedAt, category = 'stocks') => ({
    asset: { symbol, name: symbol, price: 0, change: 0, color: '#fff', category }, views, lastViewedAt,
  });
  const visits = [
    makeVisit('ORCL', 5, 1),
    makeVisit('NVDA', 2, 2),
    makeVisit('CRM', 5, 3),
    makeVisit('ONCE', 1, 4),
    makeVisit('SPY', 20, 5, 'etfs'),
  ];
  const symbols = JSON.parse(JSON.stringify(api.getDiscoveryAssets('stocks', visits).map((asset) => asset.symbol)));
  assert.deepEqual(symbols.slice(0, 3), ['CRM', 'ORCL', 'NVDA']);
  assert.equal(new Set(symbols).size, symbols.length);
  assert.equal(symbols.includes('ONCE'), false);
  assert.equal(symbols.includes('SPY'), false);
  assert.ok(symbols.length >= 40);
  assert.equal(api.getDiscoveryAssets('stocks', visits, 'orcl')[0].symbol, 'ORCL');
});

test('Yahoo quote types classify stocks, ETFs and indexes without admitting other products', () => {
  assert.equal(api.getAssetCategory('EQUITY'), 'stocks');
  assert.equal(api.getAssetCategory('ETF'), 'etfs');
  assert.equal(api.getAssetCategory('INDEX'), 'indexes');
  assert.equal(api.getAssetCategory('MUTUALFUND'), undefined);
  assert.equal(api.getAssetCategory('CRYPTOCURRENCY'), undefined);
});

test('category filtering only returns matching assets', () => {
  const assets = [
    { symbol: 'AAPL', category: 'stocks' },
    { symbol: 'SPY', category: 'etfs' },
    { symbol: '^GSPC', category: 'indexes' },
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.filterAssetsByCategory(assets, 'indexes'))),
    [{ symbol: '^GSPC', category: 'indexes' }],
  );
  assert.equal(api.filterAssetsByCategory(assets).length, 3);
});

test('Yahoo search results carry their category and unsupported quote types are excluded', async () => {
  const quotesSource = fs.readFileSync(path.join(__dirname, 'quotes.ts'), 'utf8');
  const quotesModule = ts.transpileModule(quotesSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const quotesExports = {};
  const fetchCalls = [];
  const response = {
    ok: true,
    json: async () => ({ quotes: [
      { symbol: 'AAPL', longname: 'Apple Inc.', quoteType: 'EQUITY' },
      { symbol: 'SPY', longname: 'SPDR S&P 500 ETF Trust', quoteType: 'ETF' },
      { symbol: '^GSPC', longname: 'S&P 500', quoteType: 'INDEX' },
      { symbol: 'FUND', longname: 'Example Fund', quoteType: 'MUTUALFUND' },
    ] }),
  };
  vm.runInNewContext(quotesModule.outputText, {
    exports: quotesExports,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => { fetchCalls.push(url); return response; },
    require: (id) => {
      if (id === 'react-native') return { Platform: { OS: 'web' } };
      if (id === './request-cache') return { createRequestCache: () => async (_key, load) => load() };
      if (id === './portfolio') return { availableAssets: [], colors: { violet: '#90f' } };
      if (id === './asset-discovery') return api;
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  const found = await quotesExports.searchAssets('market');
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(found.map(({ symbol, category }) => ({ symbol, category })))),
    [{ symbol: 'AAPL', category: 'stocks' }, { symbol: 'SPY', category: 'etfs' }, { symbol: '^GSPC', category: 'indexes' }]);
});
