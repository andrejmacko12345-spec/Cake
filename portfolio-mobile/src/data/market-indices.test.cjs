const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === 'react-native') return { Platform: { OS: 'android' } };
  return originalLoad.call(this, id, ...args);
};
const { fetchIndexHistory, indexRanges } = require('./quotes.ts');
Module._load = originalLoad;

const response = (meta = {}) => ({
  chart: { result: [{
    meta: { previousClose: 100, ...meta },
    timestamp: [1000, 2000, 3000, 4000],
    indicators: { quote: [{ close: [101, null, 102, 103] }] },
  }] },
});

test('indices use previous close for daily change and reject unsupported symbols', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(url, /%5EGSPC/);
    assert.match(url, /range=1d&interval=5m/);
    return { ok: true, json: async () => response() };
  };
  try {
    const result = await fetchIndexHistory('^GSPC', '1D');
    assert.equal(result.baseline, 100);
    assert.equal(result.points.length, 3);
    assert.equal(result.timestamp, 4000);
    assert.ok(Math.abs((result.points[2].price / result.baseline - 1) * 100 - 3) < 1e-10);
    await assert.rejects(() => fetchIndexHistory('AAPL', '1D'), /Neplatný index/);
  } finally { global.fetch = originalFetch; }
});

test('all index horizons request supported intervals and use the first point outside daily view', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => response() };
  };
  try {
    for (const range of indexRanges) {
      const result = await fetchIndexHistory('^DJI', range);
      assert.equal(result.baseline, range === '1D' ? 100 : 101);
    }
    assert.match(urls[1], /range=5d&interval=5m/);
    assert.match(urls[5], /range=5y&interval=1wk/);
    assert.match(urls[6], /range=max&interval=1mo/);
  } finally { global.fetch = originalFetch; }
});

test('missing daily baseline, empty charts and provider errors are explicit', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => response({ previousClose: null }) });
    await assert.rejects(() => fetchIndexHistory('^IXIC', '1D'), /uzavretie/);
    global.fetch = async () => ({ ok: true, json: async () => ({ chart: { result: [] } }) });
    await assert.rejects(() => fetchIndexHistory('^IXIC', '1D'), /dostupné/);
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(() => fetchIndexHistory('^IXIC', '1D'), /429/);
  } finally { global.fetch = originalFetch; }
});
