const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
const exportsObject = {};
new Function('exports', ts.transpileModule(fs.readFileSync(require.resolve('./request-cache.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(exportsObject);
const { createRequestCache } = exportsObject;

test('concurrent chart/metrics requests share one load and cached reads do not request the network', async (t) => {
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const cached = createRequestCache(60000);
  let calls = 0;
  let resolve;
  const load = () => { calls++; return new Promise((done) => { resolve = done; }); };
  const first = cached('AAPL|1D', load);
  const second = cached('AAPL|1D', load);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ points: [1, 2] });
  const value = await first;
  assert.equal(await cached('AAPL|1D', load), value);
  assert.equal(calls, 1);
  now += 60000;
  assert.equal(await cached('AAPL|1D', async () => { calls++; return 'refreshed'; }), 'refreshed');
  assert.equal(calls, 2);
});

test('failed loads propagate, can retry and never become success-shaped cached values', async () => {
  const cached = createRequestCache(1000);
  await assert.rejects(cached('AAPL', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cached('AAPL', async () => 10), 10);
  assert.equal(await cached('MSFT', async () => 20), 20);
});

test('cache capacity is bounded and parameter-specific requests do not collide', async () => {
  const cached = createRequestCache(10000, 2);
  await cached('AAPL|1D', async () => 1);
  await cached('AAPL|1Y', async () => 2);
  await cached('MSFT|1D', async () => 3);
  assert.equal(await cached('AAPL|1D', async () => 4), 4);
});
