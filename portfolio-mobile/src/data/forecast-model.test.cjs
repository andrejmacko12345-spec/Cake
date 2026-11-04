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
  if (id === './quotes') return {
    fetchHistoricalQuoteSeries: async () => { throw new Error('History unavailable'); },
  };
  return originalLoad.call(this, id, ...args);
};
const model = require('./forecast-model.ts');
Module._load = originalLoad;

const transaction = (date, type, shares, price = 100, symbol = 'TEST') => ({
  id: date, symbol, name: symbol, date, createdAt: `${date}T00:00:00Z`,
  type, shares, price, currency: 'EUR', fxToEur: 1,
});
const series = (symbol, rows, currency = 'EUR') => [symbol, {
  symbol, currency, points: rows.map(([date, price]) => ({ timestamp: Date.parse(`${date}T00:00:00Z`) / 1000, price })),
}];

test('market baseline compounds exactly 20 completed total-return years and rejects stale data', () => {
  const expected = (model.marketReturns.reduce((value, rate) => value * (1 + rate / 100), 1) ** (1 / 20) - 1) * 100;
  assert.equal(model.marketReturns.length, 20);
  assert.ok(Math.abs(model.marketAnnualReturn(2026) - expected) < 1e-10);
  assert.throws(() => model.marketAnnualReturn(2027), /aktualizovať/);
});

test('median and short-history shrinkage reduce the impact of a single strong year', () => {
  assert.ok(model.smoothAnnualReturns([100], 10) > 10);
  assert.ok(model.smoothAnnualReturns([100], 10) < 30);
  assert.ok(Math.abs(model.smoothAnnualReturns([10, 12, 150], 10)
    - model.smoothAnnualReturns([10, 12, 15], 10)) < 1e-10);
  assert.ok(model.smoothAnnualReturns([-30, -20, -10], 10) < 0);
  assert.equal(model.smoothAnnualReturns([], 10), 10);
  assert.throws(() => model.smoothAnnualReturns([NaN], 10));
});

test('partial entry year and unfinished current year are excluded', () => {
  assert.deepEqual(model.completedPortfolioYears([transaction('2023-07-01', 'BUY', 1)], 2026), [2024, 2025]);
  assert.deepEqual(model.completedPortfolioYears([transaction('2025-01-01', 'BUY', 1)], 2026), [2025]);
});

test('yearly return accounts for cash flows, closed positions and EUR/USD at each boundary', () => {
  const history = new Map([
    series('TEST', [['2023-12-29', 100], ['2024-12-31', 110], ['2025-12-31', 121]]),
  ]);
  const returns = model.portfolioYearReturns([transaction('2023-06-01', 'BUY', 1)], history, 2026);
  assert.equal(returns.length, 2);
  const expected = [366, 365].map((days) => (1.1 ** (365.25 / days) - 1) * 100);
  returns.forEach((rate, index) => assert.ok(Math.abs(rate - expected[index]) < 1e-6));
  const withDeposit = model.portfolioYearReturns([
    transaction('2023-06-01', 'BUY', 1), transaction('2024-01-01', 'BUY', 1),
  ], history, 2025);
  assert.ok(Math.abs(withDeposit[0] - expected[0]) < 1e-6);
  const closed = model.portfolioYearReturns([
    transaction('2023-06-01', 'BUY', 1), transaction('2024-07-01', 'SELL', 1, 100),
  ], history, 2026);
  assert.equal(closed.length, 1);
  assert.ok(Math.abs(closed[0]) < 0.001);
  const fxHistory = new Map([
    series('TEST', [['2024-12-31', 100], ['2025-12-31', 100]], 'USD'),
    series('EURUSD=X', [['2024-12-31', 1], ['2025-12-31', 1.1]], 'USD'),
  ]);
  const fx = model.portfolioYearReturns([transaction('2024-01-01', 'BUY', 1)], fxHistory, 2026);
  assert.ok(Math.abs(fx[1] - ((1 / 1.1 - 1) * 100)) < 0.02);
});

test('missing or stale histories fail explicitly rather than fabricating a return', () => {
  assert.throws(() => model.portfolioYearReturns([transaction('2024-06-01', 'BUY', 1)], new Map(), 2026), /história/);
  const old = new Map([series('TEST', [['2024-01-01', 100]])]);
  assert.throws(() => model.portfolioYearReturns([transaction('2024-06-01', 'BUY', 1)], old, 2026), /cena/);
});

test('short portfolios use the documented market baseline without fetching history', async () => {
  const result = await model.smoothedPortfolioReturn([transaction('2026-03-01', 'BUY', 1)], 2026);
  assert.equal(result.years, 0);
  assert.equal(result.rate, model.marketAnnualReturn(2026));
});

test('history fetch failure propagates instead of using an inflated all-time return', async () => {
  Module._load = function (id, ...args) {
    if (id === './quotes') return {
      fetchHistoricalQuoteSeries: async () => { throw new Error('History unavailable'); },
    };
    return originalLoad.call(this, id, ...args);
  };
  try {
    await assert.rejects(() => model.smoothedPortfolioReturn([transaction('2023-06-01', 'BUY', 1)], 2026), /History unavailable/);
  } finally {
    Module._load = originalLoad;
  }
});
