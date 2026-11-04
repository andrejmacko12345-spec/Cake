const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
const Module = require('node:module');

const stored = new Map();
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === '@react-native-async-storage/async-storage') return {
    getItem: async (key) => stored.get(key) ?? null,
    setItem: async (key, value) => { stored.set(key, value); },
  };
  return originalLoad.call(this, id, ...args);
};

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};

const { applyEarningsConsensus, combineFinancialSources, earningsOutcome, growth, mergeQuarters } = require('./quarterly.ts');
const { archivedRevenueConsensus, captureRevenueForecast, parseEarningsConsensus, parseUpcomingEarnings } = require('./earnings-consensus.ts');
const { parseSecQuarters } = require('./sec.ts');
const { fetchFmpQuarterly } = require('./fmp.ts');
const { fetchCompanyEvents } = require('./events.ts');
const { getEventsCacheSnapshot, preloadCompanyEvents } = require('./events-cache.ts');
const { getFinancialHistory, saveFinancialHistory, parseHistorySnapshot } = require('./earnings-history.ts');
const mockedLoad = Module._load;
Module._load = originalLoad;

const time = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
const quarter = (date, revenue, eps, period = 'Q2', fiscalYear = date.slice(0, 4)) =>
  ({ time: time(date), revenue, eps, period, fiscalYear });
const fact = (start, end, val, extra = {}) => ({
  start, end, val, fy: 2025, fp: 'FY', form: '10-K', filed: '2026-02-01', ...extra,
});
const facts = (revenue, eps = []) => ({
  facts: { 'us-gaap': {
    Revenues: { units: { USD: revenue } },
    EarningsPerShareDiluted: { units: { 'USD/shares': eps } },
  } },
});

const forecastSummary = () => ({
  calendarEvents: { earnings: { earningsDate: [{ raw: time('2026-11-05') + 21 * 3600 }] } },
  earnings: { financialCurrency: 'USD', defaultMethodology: 'gaap' },
  earningsTrend: { trend: [
    { period: '0q', endDate: '2026-09-30', revenueEstimate: { avg: { raw: 100 }, revenueCurrency: 'USD' } },
    { period: '+1q', endDate: '2026-12-31', revenueEstimate: { avg: 120, revenueCurrency: 'USD' } },
    { period: '0y', endDate: '2026-12-31', revenueEstimate: { avg: 450, revenueCurrency: 'USD' } },
  ] },
});

test('earnings card outcome requires both beats for green and any miss for red', () => {
  for (const [revenueBeat, epsBeat, expected] of [
    [10, 0.1, 'beat'], [-10, 0.1, 'miss'], [10, -0.1, 'miss'], [-10, -0.1, 'miss'],
    [null, -0.1, 'miss'], [-10, null, 'miss'], [null, 0.1, 'neutral'], [10, null, 'neutral'],
    [null, null, 'neutral'], [0, 0, 'neutral'], [0, 0.1, 'neutral'], [10, 0, 'neutral'],
  ]) assert.equal(earningsOutcome({ revenueBeat, epsBeat }), expected);
});

test('upcoming estimates include report-day revenue, EPS and same-methodology YoY without entering history', () => {
  const summary = forecastSummary();
  summary.earningsTrend.trend[0].revenueEstimate.yearAgoRevenue = 80;
  summary.earningsTrend.trend[0].earningsEstimate = {
    avg: { raw: 0.6 }, yearAgoEps: 0.5, earningsCurrency: 'USD',
  };
  const known = [quarter('2026-06-30', 90, 1)];
  const now = time('2026-11-05') + 10 * 3600;
  const result = parseUpcomingEarnings(summary, known, now);
  assert.equal(result.label, 'Q3 2026');
  assert.equal(result.revenue, 100);
  assert.equal(result.revenueYoY, 25);
  assert.equal(result.eps, 0.6);
  assert.ok(Math.abs(result.epsYoY - 20) < 1e-10);
  assert.equal(result.revenueCurrency, 'USD');
  assert.deepEqual(captureRevenueForecast(summary, known, now), []);
  assert.equal(mergeQuarters([known], now).length, 1);
  assert.equal(parseUpcomingEarnings(summary, known, time('2026-11-06')), null);
  summary.earningsTrend.trend[0].endDate = '2026-06-30';
  assert.equal(parseUpcomingEarnings(summary, known, now), null);
});

test('upcoming fiscal labels use period ends and keep zero, negative and missing estimates honest', () => {
  const summary = forecastSummary();
  summary.earningsTrend.trend[0].endDate = '2026-08-31';
  summary.earningsTrend.trend[0].revenueEstimate = { avg: 100, revenueCurrency: 'USD', growth: 0.1 };
  summary.earningsTrend.trend[0].earningsEstimate = { avg: 0, yearAgoEps: -0.5, earningsCurrency: 'USD' };
  const known = [quarter('2026-05-31', 90, 1)];
  const now = time('2026-11-04');
  const result = parseUpcomingEarnings(summary, known, now);
  assert.equal(result.label, 'Q3 2026');
  assert.equal(result.revenueYoY, 10);
  assert.equal(result.eps, 0);
  assert.equal(result.epsYoY, 100);
  summary.earningsTrend.trend[0].earningsEstimate.avg = -0.2;
  assert.equal(parseUpcomingEarnings(summary, known, now).eps, -0.2);
  delete summary.earningsTrend.trend[0].earningsEstimate;
  delete summary.earningsTrend.trend[0].revenueEstimate.revenueCurrency;
  const missing = parseUpcomingEarnings(summary, known, now);
  assert.equal(missing.revenue, null);
  assert.equal(missing.revenueYoY, null);
  assert.equal(missing.eps, null);
  assert.equal(missing.epsYoY, null);
});

test('company events load upcoming estimates separately from historical results', async (t) => {
  const now = time('2026-11-05') + 10 * 3600;
  t.mock.method(Date, 'now', () => now * 1000);
  t.mock.method(console, 'warn', () => {});
  await saveFinancialHistory('TEST-UPCOMING', { yahoo: [quarter('2026-06-30', 90, 1)] }, true);
  const summary = forecastSummary();
  summary.earningsTrend.trend[0].earningsEstimate = { avg: 0.6, earningsCurrency: 'USD', growth: 0.2 };
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    if (url.includes('getcrumb')) return { ok: true, text: async () => 'upcoming-test' };
    if (url.includes('quoteSummary')) return { ok: true, json: async () => ({ quoteSummary: { result: [summary] } }) };
    return { ok: true, json: async () => ({}) };
  });
  const company = await fetchCompanyEvents('TEST-UPCOMING', true);
  assert.ok(urls.some((url) => url.includes('earningsTrend')));
  assert.equal(company.nextEarnings.label, 'Q3 2026');
  assert.equal(company.nextEarnings.estimates.revenue, 100);
  assert.equal(company.nextEarnings.estimates.eps, 0.6);
  assert.equal(company.nextEarnings.estimates.epsYoY, 20);
  assert.equal(company.quarters.length, 1);
  assert.equal(company.quarters[0].periodEnd, '2026-06-30');
});

test('pre-report collector archives only the next unreported quarter before the report day', () => {
  const known = [quarter('2026-06-30', 90, 1)];
  const summary = forecastSummary();
  const now = time('2026-11-04');
  const rows = captureRevenueForecast(summary, known, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].time, time('2026-09-30'));
  assert.equal(rows[0].revenueEstimate, 100);
  assert.equal(rows[0].revenueEstimateCapturedAt, now);
  assert.equal(rows[0].revenueCurrency, 'USD');
  assert.equal(rows[0].revenue, null);
  assert.deepEqual(mergeQuarters([rows], now), []);
  assert.deepEqual(captureRevenueForecast(summary, known, time('2026-11-05')), []);
  assert.deepEqual(captureRevenueForecast(summary, [quarter('2026-09-30', 110, 1)], now), []);
  assert.deepEqual(captureRevenueForecast(summary, [], now), []);
  summary.earningsTrend.trend[0].endDate = '2026-02-31';
  assert.deepEqual(captureRevenueForecast(summary, known, now), []);
});

test('forecast collection rejects missing currency, stale periods and already published Yahoo results', () => {
  const known = [quarter('2026-06-30', 90, 1)];
  const now = time('2026-11-04');
  for (const change of [
    (s) => { delete s.earningsTrend.trend[0].revenueEstimate.revenueCurrency; },
    (s) => { s.earningsTrend.trend[0].revenueEstimate.avg = 0; },
    (s) => { s.earningsTrend.trend[0].endDate = '2026-06-30'; },
    (s) => { delete s.calendarEvents; },
    (s) => { s.calendarEvents.earnings.earningsDate = [{ raw: time('2026-09-01') }]; },
    (s) => { s.earningsHistory = { history: [{ quarter: time('2026-09-30'), epsActual: 2 }] }; },
  ]) {
    const summary = forecastSummary();
    change(summary);
    assert.deepEqual(captureRevenueForecast(summary, known, now), []);
  }
});

test('archived forecast produces a provisional revenue beat then yields to manual verification', (t) => {
  t.mock.method(Date, 'now', () => time('2026-11-06') * 1000);
  const captured = captureRevenueForecast(forecastSummary(), [quarter('2026-06-30', 90, 1)], time('2026-11-04'));
  const actual = {
    ...quarter('2026-09-26', 110, 2), revenueCurrency: 'USD', reportedAt: time('2026-11-05') + 21 * 3600,
    epsBasis: 'gaap', epsEstimate: 1.8,
  };
  const now = time('2026-11-06');
  const paired = archivedRevenueConsensus(captured, [actual], now);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].revenueEstimate, 100);
  assert.equal(paired[0].revenue, 110);
  assert.equal(paired[0].eps, null);
  const merged = mergeQuarters([[actual]], now);
  const provisional = applyEarningsConsensus(merged, [paired, [actual]])[0];
  assert.equal(provisional.revenueBeat, 10);
  assert.equal(provisional.revenueBeatProvisional, true);
  assert.equal(provisional.epsActual, 2);
  const verified = applyEarningsConsensus(merged, [[{ ...actual, revenueEstimate: 102 }], paired, [actual]])[0];
  assert.equal(verified.revenueBeat, 8);
  assert.equal(verified.revenueBeatProvisional, false);
  for (const changed of [
    { ...actual, revenueCurrency: 'EUR' },
    { ...actual, revenueCurrency: undefined },
    { ...actual, reportedAt: undefined },
    { ...actual, reportedAt: time('2026-11-04') },
    { ...actual, reportedAt: time('2026-12-05') },
    { ...actual, time: time('2026-06-30') },
  ]) assert.deepEqual(archivedRevenueConsensus(captured, [changed], now), []);
  assert.deepEqual(archivedRevenueConsensus(captured, [actual], time('2026-11-05')), []);
  assert.deepEqual(archivedRevenueConsensus([{ ...captured[0], revenueEstimateCapturedAt: time('2026-11-05') }], [actual], now), []);
});

test('stored forecast pairs with live Yahoo revenue, persists offline and carries provisional status', async (t) => {
  const forecast = captureRevenueForecast(forecastSummary(), [quarter('2026-06-30', 90, 1)], time('2026-11-04'));
  t.mock.method(Date, 'now', () => time('2026-11-06') * 1000);
  t.mock.method(console, 'warn', () => {});
  await saveFinancialHistory('TEST-FORECAST', {
    'yahoo-forecast': forecast,
    yahoo: [quarter('2025-09-30', 80, 1)],
  }, true);
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('getcrumb')) return { ok: true, text: async () => 'forecast-test' };
    if (url.includes('quoteSummary')) return { ok: true, json: async () => ({ quoteSummary: { result: [{
      earnings: {
        financialCurrency: 'USD', defaultMethodology: 'gaap',
        earningsChart: { quarterly: [{
          periodEndDate: time('2026-09-30'), reportedDate: time('2026-11-05') + 21 * 3600,
          date: '3Q2026', actual: 2, estimate: 1.8,
        }] },
        financialsChart: { quarterly: [{ date: '3Q2026', revenue: 110 }] },
      },
    }] } }) };
    return { ok: true, json: async () => ({}) };
  });
  const live = (await fetchCompanyEvents('TEST-FORECAST', true)).quarters[0];
  assert.equal(live.revenueBeat, 10);
  assert.equal(live.revenueBeatProvisional, true);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const offline = (await fetchCompanyEvents('TEST-FORECAST', true)).quarters[0];
  assert.equal(offline.revenueBeat, 10);
  assert.equal(offline.revenueBeatProvisional, true);
  const storedHistory = await getFinancialHistory('TEST-FORECAST');
  assert.equal(storedHistory.sources['yahoo-forecast'][0].revenueEstimateCapturedAt, time('2026-11-04'));
  const parsed = parseHistorySnapshot({
    version: 1, generatedAt: '2026-11-06T00:00:00Z',
    companies: { 'TEST-FORECAST': { updatedAt: '2026-11-06T00:00:00Z', sources: storedHistory.sources } },
  });
  assert.equal(parsed.companies['TEST-FORECAST'].sources['yahoo-forecast'][0].revenueCurrency, 'USD');
});

test('growth handles losses, zero and missing bases without inventing values', () => {
  assert.equal(growth(2, 1), 100);
  assert.equal(growth(-1, -2), 50);
  assert.equal(growth(1, -1), 200);
  assert.equal(growth(0, 1), -100);
  assert.equal(growth(1, 0), null);
  assert.equal(growth(null, 1), null);
});

test('beat uses paired actual and consensus, never statement EPS or another provider estimate', () => {
  const financials = mergeQuarters([[quarter('2026-06-30', 100, 1.38)]]);
  const adjusted = {
    ...quarter('2026-06-30', 100, 1.66), epsBasis: 'adjusted', epsEstimate: 1.6, revenueEstimate: 95,
  };
  const result = applyEarningsConsensus(financials, [[adjusted]])[0];
  assert.equal(result.epsActual, 1.66);
  assert.ok(Math.abs(result.epsBeat - 0.06) < 1e-10);
  assert.equal(result.revenueBeat, 5);
  const zeroEstimate = applyEarningsConsensus(financials, [[{
    ...adjusted, epsEstimate: 0, revenueEstimate: 0,
  }]])[0];
  assert.equal(zeroEstimate.epsBeat, 1.66);
  assert.equal(zeroEstimate.revenueBeat, 100);
  const missing = applyEarningsConsensus(financials, [[{ ...adjusted, epsEstimate: null }], [
    { ...adjusted, eps: 2, epsEstimate: 1 },
  ]])[0];
  assert.equal(missing.epsBeat, null);
  assert.equal(missing.epsActual, 1.66);
  const noConsensus = applyEarningsConsensus(financials, [])[0];
  assert.equal(noConsensus.epsActual, null);
  assert.equal(noConsensus.epsBeat, null);
  const gaap = applyEarningsConsensus(financials, [[{ ...adjusted, epsBasis: 'gaap', eps: 1.38 }]])[0];
  assert.equal(gaap.epsActual, 1.38);
  assert.ok(gaap.epsBeat < 0);
});

test('reviewed consensus overrides inconsistent GAAP actuals in automated EPS feeds', () => {
  const financials = mergeQuarters([[quarter('2026-09-30', 127577000000, 2.12)]]);
  const reviewed = {
    ...quarter('2026-09-30', 127580000000, 2.67),
    epsBasis: 'adjusted', epsEstimate: 3.02, revenueEstimate: 128220000000,
  };
  const mislabeledFeed = {
    ...quarter('2026-09-30', null, 2.12), epsBasis: 'gaap', epsEstimate: 3.006,
  };
  const result = applyEarningsConsensus(financials, [[reviewed], [mislabeledFeed]])[0];
  assert.equal(result.revenue, 127577000000);
  assert.equal(result.epsActual, 2.67);
  assert.ok(Math.abs(result.epsBeat - (2.67 - 3.02)) < 1e-10);
  assert.equal(result.revenueBeat, -640000000);
});

test('consensus parser archives reported EPS and excludes forecasts, future releases and rolling revenue estimates', () => {
  const rows = parseEarningsConsensus({
    earningsHistory: { defaultMethodology: 'nongaap', history: [
      { quarter: { raw: time('2026-06-30') }, epsActual: { raw: 1.66 }, epsEstimate: { raw: 1.6 } },
    ] },
    earnings: {
      defaultMethodology: 'nongaap', financialCurrency: 'USD',
      earningsChart: {
        quarterly: [{
          periodEndDate: { raw: time('2026-06-30') }, reportedDate: { raw: time('2026-08-04') },
          date: '2Q2026', actual: { raw: 1.66 }, estimate: { raw: 1.6 },
        }, {
          periodEndDate: { raw: time('2026-09-30') }, reportedDate: { raw: time('2026-12-01') },
          actual: { raw: 9 }, estimate: { raw: 1 },
        }],
        currentPeriodEndDate: { raw: time('2026-12-31') },
        currentQuarterActual: { raw: 3 }, currentQuarterEstimate: { raw: 2 },
      },
      financialsChart: { quarterly: [{ date: '2Q2026', revenue: { raw: 11536000000 } }] },
    },
    earningsTrend: { trend: [{
      period: '0q', endDate: '2026-06-30', revenueEstimate: { avg: { raw: 9000000000 }, revenueCurrency: 'USD' },
    }] },
  }, time('2026-11-04'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].epsBasis, 'adjusted');
  assert.equal(rows[0].epsEstimate, 1.6);
  assert.equal(rows[0].revenue, 11536000000);
  assert.equal(rows[0].revenueEstimate, undefined);
  const current = parseEarningsConsensus({ earnings: {
    defaultMethodology: 'gaap', earningsChart: {
      currentPeriodEndDate: { raw: time('2026-09-30') },
      currentQuarterActual: { raw: 0 }, currentQuarterEstimate: { raw: -0.1 },
    },
  } }, time('2026-11-04'));
  assert.equal(current[0].eps, 0);
  assert.equal(current[0].epsBasis, 'gaap');
  const beat = applyEarningsConsensus(
    mergeQuarters([[quarter('2026-09-30', null, 0)]], time('2026-11-04')), [current],
  )[0];
  assert.equal(beat.epsBeat, 0.1);
});

test('stored estimates survive null live updates and invalid estimate types are rejected', () => {
  const sources = combineFinancialSources({
    'yahoo-earnings': [{ ...quarter('2026-06-30', 100, 1), epsBasis: 'adjusted', epsEstimate: 0.9 }],
  }, { 'yahoo-earnings': [{ ...quarter('2026-06-30', 100, 1), epsEstimate: null }] });
  assert.equal(sources['yahoo-earnings'][0].epsEstimate, 0.9);
  assert.equal(sources['yahoo-earnings'][0].epsBasis, 'adjusted');
  assert.throws(() => parseHistorySnapshot({
    version: 1, generatedAt: '2026-11-04', companies: {
      BAD: { updatedAt: '2026-11-04', sources: {
        'yahoo-earnings': [{ ...quarter('2026-06-30', 1, 1), epsEstimate: '1' }],
      } },
    },
  }), /zdroj/);
});
test('merges individual fields without losing history or mixing EPS methodologies', () => {
  const official = [quarter('2026-06-27', 150, 1.38), quarter('2025-06-28', 100, 0.54)];
  const yahoo = [quarter('2026-06-30', 150, 1.38), quarter('2025-06-30', 100, 0.54)];
  const adjusted = [quarter('2026-06-30', null, 1.66)];
  const rows = mergeQuarters([official, yahoo, adjusted]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].revenueYoY, 50);
  assert.equal(rows[0].epsActual, 1.38);
  assert.ok(Math.abs(rows[0].epsYoY - 155.5555555556) < 0.0001);
  const sparse = mergeQuarters([[quarter('2026-06-30', null, null)], official, adjusted]);
  assert.equal(sparse[0].revenue, 150);
  assert.equal(sparse[0].epsActual, 1.38);
  const noComparable = mergeQuarters([[official[0]], [adjusted[0], quarter('2025-06-30', null, 0.9)]]);
  assert.equal(noComparable[0].epsYoY, null);
});

test('YoY matches the prior year while labels use calendar rather than fiscal dates', () => {
  const rows = mergeQuarters([[
    quarter('2026-07-26', 200, 2, 'Q2', '2027'),
    quarter('2025-07-27', 100, 1, 'Q2', '2026'),
    quarter('2026-04-26', 160, 1.5, 'Q1', '2027'),
  ]]);
  assert.equal(rows[0].label, 'Q3 2026');
  assert.equal(rows[0].revenueYoY, 100);
  assert.equal(rows[0].revenueQoQ, 25);
});

test('calendar labels do not depend on the four-row fiscal earnings chart', () => {
  const rows = mergeQuarters([[
    quarter('2026-09-30', 300, 3, 'Q1', '2027'),
    quarter('2025-09-30', 200, 2, '', ''),
  ]]);
  assert.equal(rows[0].label, 'Q3 2026');
  assert.equal(rows[1].label, 'Q3 2025');
  assert.equal(rows[0].revenueYoY, 50);
});

test('persisting live quarters retains older comparables and preserves source separation', () => {
  const old = { yahoo: [quarter('2025-06-30', 100, 1), quarter('2026-06-30', 150, 2)] };
  const combined = combineFinancialSources(old, {
    yahoo: [quarter('2026-06-30', null, 2.1, '', ''), quarter('2026-09-30', 180, 3, 'Q3')],
    'yahoo-earnings': [quarter('2026-06-30', null, 3)],
  });
  assert.equal(combined.yahoo.length, 3);
  assert.equal(combined.yahoo.find((row) => row.period === 'Q2' && row.fiscalYear === '2026').revenue, 150);
  assert.equal(old.yahoo[1].eps, 2);
  assert.equal(combined['yahoo-earnings'][0].eps, 3);
  assert.ok(Math.abs(mergeQuarters([combined.yahoo])[1].epsYoY - 110) < 1e-10);
});

test('SEC uses quarterly durations, restatements and annual-minus-nine-month revenue', () => {
  const data = facts([
    fact('2025-01-01', '2025-12-31', 1000),
    fact('2025-01-01', '2025-09-30', 700, { fp: 'Q3', form: '10-Q', filed: '2025-11-01' }),
    fact('2025-04-01', '2025-06-30', 200, { fp: 'Q2', form: '10-Q', filed: '2025-08-01' }),
    fact('2025-04-01', '2025-06-30', 220, { filed: '2026-03-01' }),
    fact('2026-01-01', '2026-06-30', 900, { fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-08-01' }),
    fact('2026-04-01', '2026-06-30', 300, { fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-08-01' }),
    fact('2026-07-01', '2026-09-30', 999, { fy: 2026, fp: 'Q3', filed: '2026-12-01' }),
  ], [
    fact('2025-01-01', '2025-12-31', 10),
    fact('2025-01-01', '2025-09-30', 7, { fp: 'Q3', form: '10-Q', filed: '2025-11-01' }),
    fact('2025-04-01', '2025-06-30', 2, { fp: 'Q2', form: '10-Q', filed: '2025-08-01' }),
    fact('2026-04-01', '2026-06-30', 3, { fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-08-01' }),
  ]);
  const rows = parseSecQuarters(data, time('2026-11-04'));
  const q4 = rows.find((row) => row.period === 'Q4');
  assert.equal(q4.revenue, 300);
  assert.equal(q4.eps, null);
  assert.equal(rows.find((row) => row.time === time('2025-06-30')).revenue, 220);
  assert.equal(rows[0].revenue, 300);
  assert.equal(rows[0].period, 'Q2');
  assert.equal(rows.length, 3);
  assert.equal(mergeQuarters([rows])[0].epsYoY, 50);
});

test('SEC infers a non-calendar fiscal year and does not subtract unrelated revenue concepts', () => {
  const data = facts([
    fact('2024-09-29', '2025-09-27', 1000),
    fact('2024-09-29', '2025-06-28', 700, { fp: 'Q3', form: '10-Q', filed: '2025-08-01' }),
    fact('2025-09-28', '2025-12-27', 400, { fy: 2026, fp: 'Q1', form: '10-Q', filed: '2026-02-01' }),
  ]);
  data.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax = { units: { USD: [
    fact('2024-09-29', '2025-06-28', 200, { filed: '2026-01-31' }),
  ] } };
  const rows = parseSecQuarters(data, time('2026-11-04'));
  assert.equal(rows[0].fiscalYear, '2026');
  assert.equal(rows[0].period, 'Q1');
  assert.equal(rows.find((row) => row.period === 'Q4').revenue, 300);
});

test('SEC bank totals outrank contract-only revenue, including newer partial comparatives and derived Q4', () => {
  const data = facts([]);
  data.facts['us-gaap'].RevenuesNetOfInterestExpense = { units: { USD: [
    fact('2025-01-01', '2025-12-31', 3500),
    fact('2025-01-01', '2025-09-30', 2500, { fp: 'Q3', filed: '2025-11-01' }),
    fact('2025-04-01', '2025-06-30', 854944000),
    fact('2026-04-01', '2026-06-30', 1218676000, { filed: '2026-08-06' }),
  ] } };
  data.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax = { units: { USD: [
    fact('2025-01-01', '2025-12-31', 600, { filed: '2026-10-01' }),
    fact('2025-01-01', '2025-09-30', 450, { fp: 'Q3', filed: '2026-10-01' }),
    fact('2025-04-01', '2025-06-30', 151890000, { filed: '2026-10-01' }),
    fact('2026-04-01', '2026-06-30', 153577000, { filed: '2026-10-01' }),
  ] } };
  const rows = parseSecQuarters(data, time('2026-11-04'));
  assert.equal(rows.find((row) => row.time === time('2026-06-30')).revenue, 1218676000);
  assert.equal(rows.find((row) => row.time === time('2025-12-31')).revenue, 1000);
  assert.ok(Math.abs(mergeQuarters([rows])[0].revenueYoY - (1218676000 / 854944000 - 1) * 100) < 1e-10);
});

test('non-comparable reviewed EPS blocks stale consensus without hiding reported EPS or revenue beat', () => {
  const old = { ...quarter('2026-03-31', 12250000000, 1.23), epsBasis: 'gaap', epsEstimate: 1.24746 };
  const reviewed = { ...old, epsEstimate: null, epsEstimateComparable: false, revenueEstimate: 12180000000 };
  const merged = combineFinancialSources({ 'reported-consensus': [old] }, { 'reported-consensus': [reviewed] });
  const result = applyEarningsConsensus(mergeQuarters([[old]]), [merged['reported-consensus'], [old]])[0];
  assert.equal(result.epsActual, 1.23);
  assert.equal(result.epsBeat, null);
  assert.equal(result.revenueBeat, 70000000);
});

test('provider failures are explicit and a partial FMP response does not erase other data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ 'Error Message': 'Unavailable' }) }));
  await assert.rejects(fetchFmpQuarterly('TEST', 'test-key'), /platné finančné výkazy/);
});

test('company events work with statement data even when Yahoo summary fails; cache can refresh', async (t) => {
  const current = new Date();
  current.setUTCMonth(current.getUTCMonth() - 3);
  const end = current.toISOString().slice(0, 10);
  const prior = new Date(current);
  prior.setUTCFullYear(prior.getUTCFullYear() - 1);
  const priorEnd = prior.toISOString().slice(0, 10);
  let total = 100;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('getcrumb')) return { ok: false, status: 503 };
    if (url.includes('company_tickers.json')) return { ok: true, json: async () => ({}) };
    if (url.includes('fundamentals-timeseries')) return { ok: true, json: async () => ({
      timeseries: { result: [
        { quarterlyTotalRevenue: [
          { asOfDate: priorEnd, reportedValue: { raw: total / 2 } },
          { asOfDate: end, reportedValue: { raw: total } },
        ] },
        { quarterlyDilutedEPS: [
          { asOfDate: priorEnd, reportedValue: { raw: 1 } },
          { asOfDate: end, reportedValue: { raw: 2 } },
        ] },
      ] },
    }) };
    return { ok: true, json: async () => ({}) };
  });
  const company = await fetchCompanyEvents('TEST-FALLBACK', true);
  assert.equal(company.quarters[0].revenue, 100);
  assert.equal(company.quarters[0].revenueYoY, 100);
  assert.equal(company.financialDataIssue, 'incomplete-data');
  await preloadCompanyEvents(['TEST-CACHE'], true);
  assert.equal(getEventsCacheSnapshot().data['TEST-CACHE'].quarters[0].revenue, 100);
  total = 200;
  const later = Date.now() + 31 * 60 * 1000;
  t.mock.method(Date, 'now', () => later);
  await preloadCompanyEvents(['TEST-CACHE']);
  assert.equal(getEventsCacheSnapshot().data['TEST-CACHE'].quarters[0].revenue, 200);
});

test('Yahoo financial chart can fill revenue when the timeseries provider fails', async (t) => {
  const reportDate = time('2026-10-25');
  t.mock.method(console, 'warn', () => {});
  t.mock.method(Date, 'now', () => time('2026-11-04') * 1000);
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('getcrumb')) return { ok: true, text: async () => 'test-crumb' };
    if (url.includes('quoteSummary')) return { ok: true, json: async () => ({
      quoteSummary: { result: [{
        calendarEvents: { earnings: { earningsDate: [{ raw: reportDate }] } },
        earningsHistory: { defaultMethodology: 'nongaap', history: [{ quarter: { raw: time('2026-09-30') }, epsActual: { raw: 2 } }] },
        earnings: {
          earningsChart: { quarterly: [{ date: '3Q2026' }] },
          financialsChart: { quarterly: [{ date: '3Q2026', revenue: 123000000 }] },
        },
      }] },
    }) };
    if (url.includes('fundamentals-timeseries')) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({}) };
  });
  const company = await fetchCompanyEvents('TEST-CHART', true);
  assert.equal(company.quarters[0].revenue, 123000000);
  assert.equal(company.quarters[0].epsActual, 2);
  assert.equal(company.quarters[0].label, 'Q3 2026');
  assert.equal(company.nextEarnings, null);
  assert.equal(company.lastReportDate, reportDate);
});

test('bundled GOOGL history fixes all six revenue comparisons without contacting SEC or FMP', async (t) => {
  const urls = [];
  t.mock.method(Date, 'now', () => Date.parse('2026-11-04T08:30:00Z'));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    if (url.includes('getcrumb')) return { ok: false, status: 503 };
    if (url.includes('raw.githubusercontent.com')) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({}) };
  });
  const company = await fetchCompanyEvents('GOOGL', true);
  const rows = company.quarters.slice(0, 6);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.revenueYoY !== null));
  assert.ok(rows.every((row) => /^Q[1-4] \d{4}$/.test(row.label)));
  assert.ok(!urls.some((url) => /sec\.gov|financialmodelingprep/.test(url)));
  const seriesUrl = new URL(urls.find((url) => url.includes('fundamentals-timeseries')));
  const days = (Number(seriesUrl.searchParams.get('period2')) - Number(seriesUrl.searchParams.get('period1'))) / 86400;
  assert.equal(days, 120);
});

test('GOOG and GOOGL have all six historical revenue/EPS beats offline with reviewed EPS methodology', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-04T08:30:00Z'));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const entries = require('./reported-consensus.json').GOOGL;
  for (const symbol of ['GOOG', 'GOOGL']) {
    const company = await fetchCompanyEvents(symbol, true);
    const quarters = company.quarters.slice(0, 6);
    assert.equal(quarters.length, 6);
    for (let index = 0; index < quarters.length; index++) {
      const row = quarters[index];
      const entry = entries[index];
      assert.equal(row.periodEnd, entry.periodEnd, symbol);
      assert.equal(row.epsActual, entry.eps, `${symbol} ${row.label}`);
      assert.equal(row.revenueBeat, entry.revenue - entry.revenueEstimate);
      assert.ok(Math.abs(row.epsBeat - (entry.eps - entry.epsEstimate)) < 1e-10);
    }
    assert.equal(company.financialDataIssue, null);
    assert.ok(quarters[0].revenueBeat < 0);
    assert.ok(quarters[0].epsBeat < 0);
    assert.ok(quarters[1].revenueBeat > 0);
    assert.ok(quarters[1].epsBeat < 0);
    assert.ok(quarters[2].epsBeat < 0);
  }
});

test('all ten requested companies have six offline reports, revenue comparisons and reviewed beats', async (t) => {
  const consensus = require('./reported-consensus.json');
  const universe = require('./financial-universe.json');
  t.mock.method(Date, 'now', () => Date.parse('2026-11-04T08:30:00Z'));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  let revenueBeats = 0;
  let epsBeats = 0;
  for (const symbol of ['AMD', 'SOFI', 'META', 'ELF', 'GOOGL', 'HIMS', 'NFLX', 'CELH', 'NKE', 'NOW']) {
    assert.ok(universe.includes(symbol), symbol);
    const company = await fetchCompanyEvents(symbol, true);
    const rows = company.quarters.slice(0, 6);
    assert.equal(rows.length, 6, symbol);
    assert.equal(consensus[symbol].length, 6, symbol);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const entry = consensus[symbol][index];
      const label = `${symbol} ${row.label}`;
      assert.equal(row.periodEnd, entry.periodEnd, label);
      assert.ok(row.revenue > 0, label);
      assert.ok(Number.isFinite(row.revenueYoY), label);
      assert.equal(row.epsActual, entry.eps, label);
      assert.equal(row.revenueBeat, entry.revenue - entry.revenueEstimate, label);
      revenueBeats++;
      if (entry.epsEstimateComparable === false) {
        assert.equal(symbol, 'NFLX');
        assert.equal(entry.periodEnd, '2026-03-31');
        assert.equal(row.epsBeat, null, label);
        assert.ok(entry.notes.includes('not comparable'));
      } else {
        assert.ok(Math.abs(row.epsBeat - (entry.eps - entry.epsEstimate)) < 1e-10, label);
        epsBeats++;
      }
      assert.ok(Date.parse(entry.publishedAt) <= Date.now(), label);
      assert.ok(new URL(entry.source).protocol === 'https:', label);
    }
    assert.equal(company.financialDataIssue, symbol === 'NFLX' ? 'incomplete-data' : null, symbol);
    if (symbol === 'SOFI') {
      assert.equal(rows[0].revenue, 1385099000);
      assert.equal(rows[1].revenue, 1218676000);
    }
    if (symbol === 'NKE') assert.equal(rows[0].label, 'Q3 2026');
    if (symbol === 'ELF') assert.equal(rows[0].label, 'Q2 2026');
  }
  assert.equal(revenueBeats, 60);
  assert.equal(epsBeats, 59);
  assert.equal(consensus.NFLX[4].eps, 0.587);
  assert.equal(consensus.NOW[4].eps, 0.964);
});

test('history remains available offline, persists live results and rejects malformed snapshots', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const before = await getFinancialHistory('GOOGL');
  assert.ok(before.sources.sec.length >= 12);
  await saveFinancialHistory('TEST-PERSIST', { yahoo: [quarter('2026-06-30', 100, 1)] }, true);
  await saveFinancialHistory('TEST-PERSIST', { yahoo: [quarter('2026-09-30', 120, 2, 'Q3')] }, false);
  const history = await getFinancialHistory('TEST-PERSIST');
  assert.equal(history.sources.yahoo.length, 2);
  const saved = JSON.parse(stored.get('@portfolio-mobile/financial-history-v1'));
  assert.equal(saved.snapshot.companies['TEST-PERSIST'].sources.yahoo.length, 2);
  assert.throws(() => parseHistorySnapshot({ version: 2 }), /formát/);
  assert.throws(() => parseHistorySnapshot({
    version: 1, generatedAt: '2026-11-04', companies: {
      BAD: { updatedAt: '2026-11-04', sources: { yahoo: [{ ...quarter('2026-06-30', 1, 1), eps: '1' }] } },
    },
  }), /zdroj/);
});

test('all displayed quarters in the shared seed have calendar labels matching actual dates', () => {
  const snapshot = parseHistorySnapshot(require('./financial-history.json'));
  for (const [symbol, entry] of Object.entries(snapshot.companies)) {
    const quarters = mergeQuarters(['sec', 'fmp', 'yahoo'].map((source) => entry.sources[source] ?? [])).slice(0, 6);
    assert.ok(quarters.length > 0, symbol);
    assert.ok(quarters.every((row) => /^Q[1-4] \d{4}$/.test(row.label)), symbol);
    for (const row of quarters) {
      const date = new Date(`${row.periodEnd}T00:00:00Z`);
      assert.equal(row.label, `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`, symbol);
    }
  }
});

test('historical results exclude future period ends, future releases and empty forecast rows', () => {
  const rows = mergeQuarters([[
    quarter('2026-09-26', 13377000000, 1.46, 'Q2', '2027'),
    quarter('2026-10-31', null, null, 'Q43', '2026'),
    quarter('2026-12-31', 999, 9),
    quarter('2027-03-31', 999, 9),
    quarter('2026-06-30', null, null),
    { ...quarter('2026-03-31', 99, 1), reportedAt: time('2026-11-05') },
  ]], time('2026-11-04'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Q3 2026');
  assert.equal(rows[0].revenue, 13377000000);
  const reported = mergeQuarters([[
    { ...quarter('2026-10-25', 100, 1, 'Q1', '2027'), reportedAt: time('2026-11-02') },
  ]], time('2026-11-04'));
  assert.equal(reported[0].label, 'Q4 2026');
});

test('AMD Q3 actuals are present without relabeling Q2 and use GAAP prior-year comparisons', () => {
  const snapshot = require('./financial-history.json');
  const quarters = mergeQuarters(['sec', 'fmp', 'yahoo']
    .map((source) => snapshot.companies.AMD.sources[source] ?? []), time('2026-11-04'));
  assert.equal(quarters[0].label, 'Q3 2026');
  assert.equal(quarters[0].periodEnd, '2026-09-26');
  assert.equal(quarters[0].revenue, 13377000000);
  assert.equal(quarters[0].epsActual, 1.46);
  assert.ok(Math.abs(quarters[0].revenueYoY - (13377 / 9246 - 1) * 100) < 1e-10);
  assert.ok(Math.abs(quarters[0].epsYoY - (1.46 / 0.75 - 1) * 100) < 1e-10);
  assert.equal(quarters[1].label, 'Q2 2026');
  assert.equal(quarters[1].revenue, 11536000000);
});

test('hourly shared download survives restart without postponing monthly backfills', async (t) => {
  let now = Date.now() + 35 * 86400000;
  let downloads = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    downloads++;
    return { ok: true, json: async () => ({
      version: 1, generatedAt: new Date(now).toISOString(),
      companies: {
        'TEST-REMOTE': { updatedAt: new Date(now).toISOString(), backfilledAt: '2026-06-01T00:00:00Z', sources: {
          yahoo: [quarter('2026-06-30', 123, 1)],
        } },
      },
    }) };
  });
  const reload = () => {
    delete require.cache[require.resolve('./earnings-history.ts')];
    Module._load = mockedLoad;
    try {
      return require('./earnings-history.ts');
    } finally {
      Module._load = originalLoad;
    }
  };
  const first = reload();
  assert.equal((await first.getFinancialHistory('TEST-REMOTE')).sources.yahoo[0].revenue, 123);
  assert.equal(downloads, 1);
  assert.equal((await first.getFinancialHistory('TEST-PERSIST')).sources.yahoo.length, 2);
  const restarted = reload();
  await restarted.getFinancialHistory('TEST-REMOTE');
  assert.equal(downloads, 1);
  now += 2 * 3600000;
  assert.equal((await restarted.getFinancialHistory('TEST-REMOTE')).needsBackfill, true);
  assert.equal(downloads, 2);
});

test('monthly updater labels non-calendar fiscal quarters from annual statement dates', async (t) => {
  const { yahooHistory } = require('../../scripts/refresh-financial-history.cjs');
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    timeseries: { result: [
      { annualTotalRevenue: [{ asOfDate: '2026-03-31', reportedValue: { raw: 1000 } }] },
      { quarterlyTotalRevenue: [
        { asOfDate: '2026-06-30', periodType: '3M', reportedValue: { raw: 300 } },
        { asOfDate: '2026-03-31', periodType: '3M', reportedValue: { raw: 200 } },
      ] },
    ] },
  }) }));
  const rows = await yahooHistory('TEST');
  assert.equal(rows[0].period, 'Q1');
  assert.equal(rows[0].fiscalYear, '2027');
  assert.equal(rows[1].period, 'Q4');
  assert.equal(rows[1].fiscalYear, '2026');
});
