const assert = require('node:assert/strict');
const { test } = require('node:test');
const { amount, parseConsensusTable, matchPeriods, displayed, parseConstituents, complete, importOfflineTables } = require('./expand-earnings-history.cjs');

const now = Date.parse('2026-11-05T12:00:00Z');
function table(eps = '$1.22', estimate = '$1.18', beat = '+$0.04') {
  const headers = ['Date', 'Quarter', 'Consensus Estimate', 'Reported EPS', 'Beat/Miss', 'GAAP EPS',
    'Revenue Estimate', 'Actual Revenue', 'Details'];
  const cells = ['10/28/2026', 'Q1 2027', estimate, eps, beat, '$1.18', '$4.04B', '$4.14B',
    '<a href="/earnings/reports/2026-10-28-example/">Report</a>'];
  return `<table id="earnings-history"><thead><tr>${headers.map((value) => `<th>${value}</th>`).join('')}</tr></thead>`
    + `<tbody><tr>${cells.map((value) => `<td>${value}</td>`).join('')}</tr></tbody></table>`;
}

test('public consensus parser retains source precision, matching pairs and report provenance', () => {
  assert.equal(amount('$4.04B'), 4040000000);
  assert.equal(amount('-$0.0340'), -0.034);
  assert.equal(amount('N/A'), null);
  const rows = parseConsensusTable(table(), now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revenue, 4140000000);
  assert.equal(rows[0].epsBasis, 'adjusted');
  assert.equal(rows[0].publishedAt, '2026-10-28T23:59:59Z');
  assert.equal(rows[0].source, 'https://www.marketbeat.com/earnings/reports/2026-10-28-example/');
});

test('incomplete pairs, future reports, schema changes and suspicious split scales are not imported', () => {
  assert.equal(parseConsensusTable(table().replace('$4.04B', 'N/A'), now).length, 0);
  assert.equal(parseConsensusTable(table(), Date.parse('2026-10-27')).length, 0);
  assert.throws(() => parseConsensusTable(table().replace('Reported EPS', 'FFO'), now), /schema/);
  assert.throws(() => parseConsensusTable(table('$9.40', '$0.9170', '+$8.4830'), now), /split/);
  assert.throws(() => parseConsensusTable(table('$1.22', '$1.18', '+$0.20'), now), /surprise/);
});

test('publication dates map to independently matching revenue periods, not fiscal-year labels', () => {
  const rows = parseConsensusTable(table(), now);
  const quarter = {
    time: Date.parse('2026-09-30') / 1000, fiscalYear: '2027', period: 'Q1',
    revenue: 4143000000, eps: 1.18,
  };
  const matched = matchPeriods(rows, [quarter]);
  assert.equal(matched[0].periodEnd, '2026-09-30');
  assert.throws(() => matchPeriods(rows, [{ ...quarter, revenue: 3000000000 }]), /mismatch/);
  assert.throws(() => matchPeriods(rows, []), /No reported period/);
  const yahoo = { ...quarter, time: Date.parse('2026-09-30') / 1000 };
  const alternative = matchPeriods(rows, [{ ...quarter, revenue: 3000000000 }], [yahoo]);
  assert.equal(alternative[0].validationSource, 'yahoo');
  assert.equal(matchPeriods(rows, [quarter], [{ ...yahoo, revenue: 3000000000 }])[0].validationSource, 'sec');
  assert.throws(() => matchPeriods(rows, [{ ...quarter, revenue: 3000000000 }], [
    { ...yahoo, time: Date.parse('2026-06-30') / 1000 },
  ]), /mismatch/);
});

test('completeness is measured using the screen merge, where missing beats remain missing', () => {
  const row = { time: Date.parse('2026-09-30') / 1000, fiscalYear: '2026', period: 'Q3', revenue: 100, eps: 1 };
  const sources = { sec: [row], 'reported-consensus': [{ ...row, revenueEstimate: 90, epsEstimate: 0.9, epsBasis: 'gaap' }] };
  assert.equal(displayed(sources)[0].revenueBeat, 10);
  assert.ok(Math.abs(displayed(sources)[0].epsBeat - 0.1) < 1e-10);
  delete sources['reported-consensus'][0].revenueEstimate;
  assert.equal(displayed(sources)[0].revenueBeat, null);
  assert.equal(complete(sources), false);
});

test('full-index discovery validates membership counts and normalizes share-class symbols', () => {
  const rows = Array.from({ length: 503 }, (_, index) => {
    const symbol = index === 0 ? 'BRK.B' : `T${index}`;
    return `<tr>${[symbol, 'Company', 'Sector', 'Industry', 'City', '2020-01-01', '123', '1900']
      .map((value) => `<td>${value}</td>`).join('')}</tr>`;
  });
  const html = `<table id="constituents">${rows.join('')}</table>`;
  assert.equal(parseConstituents(html)[0].symbol, 'BRK-B');
  assert.equal(parseConstituents(html).length, 503);
  assert.throws(() => parseConstituents('<table id="constituents"></table>'), /membership count/);
  assert.throws(() => parseConstituents(html.replace('T502', 'T501')), /membership count/);
});

test('six-report parsing never substitutes an older complete pair for a missing recent pair', () => {
  const valid = table();
  const row = /<tbody>([\s\S]+?)<\/tbody>/.exec(valid)[1];
  const bad = row.replace('$4.04B', 'N/A');
  const history = valid.replace(row, bad + row.repeat(6));
  assert.equal(parseConsensusTable(history, now, 6).length, 5);
  assert.equal(parseConsensusTable(history, now).length, 6);
});

function offlineFixture() {
  const dates = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
  const sec = dates.map((date) => ({
    time: Date.parse(date) / 1000, fiscalYear: date.slice(0, 4), period: '',
    revenue: 4143000000, eps: 1.18,
  }));
  const rows = sec.map((quarter) => {
    const release = new Date((quarter.time + 28 * 86400) * 1000);
    const period = new Date(quarter.time * 1000);
    return {
      cells: [`${release.getUTCMonth() + 1}/${release.getUTCDate()}/${release.getUTCFullYear()}`,
        `Q${Math.floor(period.getUTCMonth() / 3) + 1} ${period.getUTCFullYear()}`,
        '$1.18', '$1.22', '+$0.04', '$1.18', '$4.04B', '$4.14B', 'Report'],
      report: `/earnings/reports/${release.toISOString().slice(0, 10)}-example/`,
    };
  });
  return {
    capture: {
      capturedAt: new Date(now).toISOString(),
      results: [{
        symbol: 'TEST', url: 'https://www.marketbeat.com/stocks/NYSE/TEST/earnings/', status: 200,
        headers: ['Date', 'Quarter', 'Consensus Estimate', 'Reported EPS', 'Beat/Miss', 'GAAP EPS',
          'Revenue Estimate', 'Actual Revenue', 'Details'],
        rows,
      }],
    },
    snapshot: { generatedAt: '2026-01-01T00:00:00Z', companies: {
      TEST: { updatedAt: '2026-01-01T00:00:00Z', sources: { sec } },
    } },
    consensus: {},
  };
}

function supplement(fixture, overrides = {}) {
  fixture.capture.supplements = [{
    symbol: 'TEST', source: 'https://seekingalpha.com/symbol/TEST/earnings/eps-surprise-summary?period=quarterly',
    provider: 'Seeking Alpha quarterly earnings surprise', observedAt: fixture.capture.capturedAt,
    rows: [{
      periodEnd: '2026-09-30', periodLabel: 'FQ3 2026 (Sep 2026)',
      revenue: 4143000000, revenueEstimate: 4134567890, eps: 1.25, epsEstimate: 1.2,
      ...overrides,
    }],
  }];
}

function runOffline({ capture, snapshot, consensus }) {
  return importOfflineTables(capture, snapshot, consensus)[0];
}

test('offline imports require no network and complete exactly six displayed reports', (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => { requests++; throw new Error('No network allowed'); });
  const fixture = offlineFixture();
  const result = runOffline(fixture);
  assert.equal(requests, 0);
  assert.equal(result.imported.length, 6);
  assert.equal(result.complete, true);
  assert.equal(fixture.snapshot.generatedAt, fixture.capture.capturedAt);
  assert.equal(fixture.consensus.TEST.length, 6);
  assert.ok(displayed(fixture.snapshot.companies.TEST.sources).every((row) =>
    Number.isFinite(row.revenueBeat) && Number.isFinite(row.epsBeat)));
  const saved = structuredClone(fixture);
  assert.equal(runOffline(fixture).imported.length, 0);
  assert.deepEqual(fixture, saved);
});

test('offline imports retain verified partial pairs without borrowing an older seventh report', () => {
  const fixture = offlineFixture();
  const rows = fixture.capture.results[0].rows;
  rows.push({ ...structuredClone(rows[5]), cells: ['4/28/2025', 'Q1 2025', ...rows[5].cells.slice(2)] });
  rows[0].cells[6] = 'N/A';
  const result = runOffline(fixture);
  assert.equal(result.imported.length, 5);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, ['2026-09-30']);
  assert.ok(result.rejected.some((reason) => /Missing comparable/.test(reason)));
});

test('offline supplements preserve exact paired values and derive publication provenance', () => {
  const fixture = offlineFixture();
  supplement(fixture);
  assert.equal(runOffline(fixture).complete, true);
  const pair = fixture.consensus.TEST[0];
  assert.equal(pair.revenueEstimate, 4134567890);
  assert.equal(pair.eps, 1.25);
  assert.equal(pair.epsEstimate, 1.2);
  assert.equal(pair.epsBasis, 'adjusted');
  assert.equal(pair.validationSource, 'sec');
  assert.equal(pair.publishedAt, '2026-10-28T23:59:59Z');
  assert.match(pair.publicationSource, /^https:\/\/www.marketbeat.com\/earnings\/reports\//);
  assert.equal(fixture.consensus.TEST.length, 6);
});

test('all offline sources enforce numeric, scale, period, revenue and release-date validation', () => {
  for (const overrides of [
    { revenue: 3e9 }, { eps: null }, { revenueEstimate: 0 },
    { eps: 9.4, epsEstimate: 0.917 }, { publishedAt: 'invalid' },
    { publishedAt: '2026-09-29T23:59:59Z' }, { publishedAt: '2026-12-01T23:59:59Z' },
    { publishedAt: '2026-07-28T23:59:59Z' },
  ]) {
    const fixture = offlineFixture();
    fixture.capture.results[0].rows[0].cells[6] = 'N/A';
    supplement(fixture, overrides);
    const result = runOffline(fixture);
    assert.equal(result.complete, false, JSON.stringify(overrides));
    assert.equal(fixture.consensus.TEST.some((row) => row.periodEnd === '2026-09-30'), false);
    assert.ok(result.rejected.length > 0);
  }
});

test('offline sources are ticker-bound and invalid schemas are reported', () => {
  for (const mutate of [
    (fixture) => { fixture.capture.results[0].url = 'https://www.marketbeat.com/stocks/NYSE/OTHER/earnings/'; },
    (fixture) => { fixture.capture.results[0].headers[3] = 'FFO'; },
  ]) {
    const fixture = offlineFixture();
    mutate(fixture);
    const result = runOffline(fixture);
    assert.equal(result.imported.length, 0);
    assert.ok(result.rejected.length > 0);
  }
  const fixture = offlineFixture();
  supplement(fixture);
  fixture.capture.supplements[0].source = fixture.capture.supplements[0].source.replace('/TEST/', '/OTHER/');
  const result = runOffline(fixture);
  assert.ok(result.rejected.some((reason) => /supplemental source/.test(reason)));
  assert.ok(fixture.consensus.TEST.every((row) => row.provider === 'MarketBeat historical earnings table'));
});

test('offline import never overwrites reviewed pairs or non-comparable EPS', () => {
  const fixture = offlineFixture();
  const reviewed = { periodEnd: '2026-09-30', source: 'reviewed', eps: 9 };
  fixture.consensus.TEST = [reviewed];
  assert.equal(runOffline(fixture).imported.length, 5);
  assert.deepEqual(fixture.consensus.TEST[0], reviewed);
  const nearby = offlineFixture();
  nearby.consensus.TEST = [{ ...reviewed, periodEnd: '2026-09-29' }];
  assert.equal(runOffline(nearby).imported.length, 5);
  assert.equal(nearby.consensus.TEST.some((row) => row.periodEnd === '2026-09-30'), false);
  const excluded = offlineFixture();
  excluded.consensus.TEST = [{ ...reviewed, epsEstimateComparable: false }];
  const original = structuredClone(excluded);
  const result = runOffline(excluded);
  assert.deepEqual(excluded, original);
  assert.equal(result.complete, false);
  assert.match(result.rejected[0], /non-comparable/);
});

test('same-period alternative revenue definitions are validated without hunting older reports', () => {
  const period = Date.parse('2026-09-30') / 1000;
  const rows = [{ publishedAt: '2026-10-15T23:59:59Z', revenue: 100 }];
  const alternatives = [
    { time: period, revenue: 140, validationSource: 'yahoo' },
    { time: period, revenue: 100, validationSource: 'yahoo-earnings' },
  ];
  assert.equal(matchPeriods(rows, [], alternatives)[0].validationSource, 'yahoo-earnings');
  alternatives[1].time = Date.parse('2026-06-30') / 1000;
  assert.throws(() => matchPeriods(rows, [], alternatives), /No reported period/);
});

test('fiscal/calendar duplicates cannot be made complete by importing the same report twice', () => {
  const fixture = offlineFixture();
  const sources = fixture.snapshot.companies.TEST.sources;
  sources.yahoo = [structuredClone(sources.sec[0])];
  sources.sec[0].time = Date.parse('2026-09-05') / 1000;
  supplement(fixture);
  const result = runOffline(fixture);
  assert.equal(result.complete, false);
  assert.ok(result.rejected.some((reason) => /Fiscal\/calendar duplicate/.test(reason)));
  assert.equal(fixture.consensus.TEST.some((row) => row.periodEnd === '2026-09-30'), false);
});

test('Investing.com requires validated or explicitly sourced EPS methodology', () => {
  for (const reviewed of [false, true]) {
    const fixture = offlineFixture();
    fixture.capture.results[0].rows[0].cells[6] = 'N/A';
    supplement(fixture, {
      publishedAt: '2026-10-28T23:59:59Z',
      ...(reviewed ? { epsBasis: 'adjusted', methodologySource: 'https://issuer.example/quarterly-results' } : {}),
    });
    const source = fixture.capture.supplements[0];
    source.source = 'https://www.investing.com/equities/test-earnings';
    source.title = 'Test (TEST) Earnings Date & Report - Investing.com';
    source.provider = 'Investing.com earnings history';
    const result = runOffline(fixture);
    assert.equal(result.complete, reviewed);
    if (reviewed) assert.equal(fixture.consensus.TEST[0].methodologySource, 'https://issuer.example/quarterly-results');
    else assert.ok(result.rejected.some((reason) => /EPS methodology/.test(reason)));
  }
});
