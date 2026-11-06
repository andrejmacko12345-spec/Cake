const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
const Module = require('node:module');
const originalLoad = Module._load;
let localSources = {};
Module._load = function (id, ...args) {
  if (id === './earnings-history') return { getLocalFinancialHistory: async () => localSources };
  return originalLoad.call(this, id, ...args);
};

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { fetchStockEstimates, quarterlyRevenueGrowthTTM } = require('./fundamentals.ts');
const year = new Date().getFullYear();
const raw = (value) => ({ raw: value });

function provider(t, { fiscalMonth = '12', trailing = true, sparse = false } = {}) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    if (url.includes('/timeseries/')) return { ok: true, json: async () => ({
      timeseries: { result: [{
        trailingTotalRevenue: trailing ? [
          { asOfDate: `${year - 1}-${sparse ? '03' : '06'}-30`, reportedValue: raw(80e9), currencyCode: 'DKK' },
          { asOfDate: `${year}-06-30`, reportedValue: raw(100e9), currencyCode: 'DKK' },
          { asOfDate: `${year + 1}-06-30`, reportedValue: raw(999e9), currencyCode: 'DKK' },
          { asOfDate: `${year}-09-30`, reportedValue: raw(NaN), currencyCode: 'DKK' },
        ] : [],
      }] },
    }) };
    if (url.includes('/quoteSummary/')) return { ok: true, json: async () => ({
      quoteSummary: { result: [{
        price: { regularMarketPrice: raw(30) },
        summaryDetail: { priceToSalesTrailing12Months: raw(6) },
        earningsTrend: { trend: [
          { period: '0y', endDate: `${year}-${fiscalMonth}-31`,
            revenueEstimate: { avg: raw(120e9), yearAgoRevenue: raw(90e9) },
            earningsEstimate: { avg: raw(3), yearAgoEps: raw(2) } },
          { period: '+1y', endDate: `${year + 1}-${fiscalMonth}-31`,
            revenueEstimate: { avg: raw(150e9), yearAgoRevenue: raw(120e9) },
            earningsEstimate: { avg: raw(4), yearAgoEps: raw(3) } },
        ] },
      }] },
    }) };
    if (url === 'https://fc.yahoo.com') return { ok: true };
    if (url.includes('/getcrumb')) return { ok: true, text: async () => 'test-token' };
    throw new Error(`Unexpected request: ${url}`);
  });
  return requests;
}

test('revenue metrics use the latest reported TTM and both annual consensus amounts', async (t) => {
  const requests = provider(t);
  const result = await fetchStockEstimates('TEST-REVENUE');
  assert.equal(result.revenueTTM, 100e9);
  assert.equal(result.revenueGrowthTTM, 0.25);
  assert.equal(result.revenueCurrency, 'DKK');
  assert.equal(result.revenueThisYear, 120e9);
  assert.equal(result.revenueNextYear, 150e9);
  assert.equal(result.calendarApproximate, false);
  assert.equal(result.epsThisYear, 3);
  assert.equal(result.peThisYear, 10);
  assert.equal(result.priceToSalesTTM, 6);
  assert.equal(result.priceToSalesThisYear, 5);
  assert.equal(result.priceToSalesNextYear, 4);
  assert.equal(requests.filter((url) => url.includes('/timeseries/')).length, 1);
  assert.equal(requests.filter((url) => url.includes('/quoteSummary/')).length, 1);
});

test('revenue estimates follow the existing calendar-year weighting, not fiscal-year labels', async (t) => {
  provider(t, { fiscalMonth: '01' });
  const result = await fetchStockEstimates('TEST-FISCAL');
  assert.equal(result.revenueThisYear, 120e9 / 12 + 150e9 * 11 / 12);
  assert.equal(result.revenueNextYear, null);
  assert.equal(result.priceToSalesNextYear, null);
  assert.equal(result.calendarApproximate, true);
});

test('missing trailing revenue is not replaced by an annual estimate or zero', async (t) => {
  provider(t, { trailing: false });
  const result = await fetchStockEstimates('TEST-NO-TTM');
  assert.equal(result.revenueTTM, null);
  assert.equal(result.priceToSalesThisYear, null);
  assert.equal(result.priceToSalesNextYear, null);
  assert.equal(result.revenueCurrency, null);
  assert.equal(result.revenueThisYear, 120e9);
});

test('sparse Yahoo TTM history uses the matching prior four-quarter sum, not a 15-month comparison', async (t) => {
  provider(t, { sparse: true });
  localSources = { yahoo: [
    `${year}-06-30`, `${year}-03-31`, `${year - 1}-12-31`, `${year - 1}-09-30`,
    `${year - 1}-06-30`, `${year - 1}-03-31`, `${year - 2}-12-31`, `${year - 2}-09-30`,
  ].map((date, index) => ({ time: Date.parse(date) / 1000, revenue: index < 4 ? 25e9 : 20e9, eps: null })) };
  t.after(() => { localSources = {}; });
  const result = await fetchStockEstimates('TEST-SPARSE');
  assert.equal(result.revenueGrowthTTM, 0.25);
});

test('quarterly TTM growth rejects missing quarters, stale periods and mismatched currency scales', () => {
  const dates = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30',
    '2025-06-30', '2025-03-31', '2024-12-31', '2024-09-30'];
  const sec = dates.map((date, index) => ({
    time: Date.parse(date) / 1000, revenue: index < 4 ? 25 : 20, eps: null,
  }));
  assert.equal(quarterlyRevenueGrowthTTM({ sec }, dates[0], 100), 0.25);
  assert.equal(quarterlyRevenueGrowthTTM({ sec }, dates[0], 1000), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec: sec.slice(0, 7) }, dates[0], 100), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec }, '2026-08-15', 100), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec: sec.map((row, index) =>
    index === 4 ? { ...row, time: sec[3].time } : row) }, dates[0], 100), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec: sec.map((row, index) =>
    index >= 4 ? { ...row, revenue: 0 } : row) }, dates[0], 100), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec: sec.map((row) => ({ ...row, revenue: 25 })) }, dates[0], 100), 0);
  assert.equal(quarterlyRevenueGrowthTTM({ sec }, dates[0], 100, 'DKK'), null);
  assert.equal(quarterlyRevenueGrowthTTM({ sec: sec.slice(1) }, dates[0], 100, 'USD'), 0.25);
});
