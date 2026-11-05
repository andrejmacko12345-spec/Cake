const assert = require('node:assert/strict');
const { test } = require('node:test');
const { amount, parseConsensusTable, matchPeriods, displayed, parseConstituents, complete } = require('./expand-earnings-history.cjs');

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
