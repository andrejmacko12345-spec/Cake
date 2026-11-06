const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { displayed, complete, updateCoverage, main } = require('./refresh-financial-history.cjs');

const data = path.join(__dirname, '..', 'src', 'data');
const historyPath = path.join(data, 'financial-history.json');
const coveragePath = path.join(data, 'sp500-earnings-coverage.json');
const seed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const quarter = (date) => ({
  time: Date.parse(date) / 1000, fiscalYear: '', period: '', revenue: 100, eps: 1,
});
const sources = () => {
  const rows = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'].map(quarter);
  return {
    sec: rows,
    'reported-consensus': rows.map((row) => ({
      ...row, revenueEstimate: 90, epsEstimate: 0.9, epsBasis: 'gaap',
    })),
  };
};
const coverage = (status) => ({
  checkedAt: '2026-11-05T00:00:00Z', requiredReports: 6, membershipSource: 'https://example.com/index',
  members: [{ symbol: 'TEST', name: 'Test company', complete: status, reason: status ? null : 'Old rejection.' }],
});

test('a seventh report rolls coverage forward without hiding it or inventing missing beats', () => {
  const history = sources();
  assert.equal(complete(history), true);
  history.yahoo = [quarter('2026-09-30')];
  const snapshot = { generatedAt: '2026-11-06T00:00:00Z', companies: { TEST: { sources: history } } };
  const before = coverage(true);
  const after = updateCoverage(snapshot, before);
  assert.equal(after.checkedAt, snapshot.generatedAt);
  assert.equal(after.members[0].complete, false);
  assert.match(after.members[0].reason, /5\/6 verified Revenue beats; 5\/6 EPS beats/);
  assert.equal(before.members[0].complete, true);
  assert.equal(displayed(history)[0].periodEnd, '2026-09-30');
  assert.equal(displayed(history)[0].revenueBeat, null);
  assert.equal(displayed(history)[0].epsBeat, null);
  assert.equal(history.sec.length, 6);
});

test('coverage permits real improvements, clears stale rejection reasons and preserves membership', () => {
  const before = coverage(false);
  const snapshot = { generatedAt: '2026-11-06T00:00:00Z', companies: { TEST: { sources: sources() } } };
  const after = updateCoverage(snapshot, before);
  assert.equal(after.members[0].complete, true);
  assert.equal(after.members[0].reason, null);
  assert.equal(after.members[0].name, 'Test company');
  assert.equal(after.membershipSource, before.membershipSource);
  assert.equal(after.requiredReports, 6);
  assert.equal(after.members.length, 1);
  assert.equal(before.members[0].reason, 'Old rejection.');
});

test('coverage rejects short histories, absent companies and non-comparable EPS', () => {
  const history = sources();
  history['reported-consensus'][0].epsEstimateComparable = false;
  assert.equal(complete(history), false);
  assert.equal(displayed(history)[0].epsBeat, null);
  assert.equal(complete({ sec: history.sec.slice(0, 5), 'reported-consensus': history['reported-consensus'] }), false);
  const absent = updateCoverage({ generatedAt: '2026-11-06T00:00:00Z', companies: {} }, coverage(true));
  assert.equal(absent.members[0].complete, false);
  assert.equal(absent.members[0].reason, 'No offline history.');
});

function mockRefresh(t, { offline = false } = {}) {
  const writes = new Map();
  const messages = [];
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === historyPath) return JSON.stringify(seed);
    if (file === coveragePath) return JSON.stringify(audit);
    return read(file, ...args);
  });
  t.mock.method(fs, 'writeFileSync', (file, content) => { writes.set(file, content); });
  t.mock.method(fs, 'renameSync', (from, to) => {
    assert.ok(writes.has(from));
    writes.set(to, writes.get(from));
    writes.delete(from);
  });
  t.mock.method(fs, 'appendFileSync', () => {});
  for (const method of ['log', 'error', 'warn']) t.mock.method(console, method, (...args) => { messages.push(args.join(' ')); });
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (offline) throw new Error('simulated provider outage');
    if (url === 'https://fc.yahoo.com') return { headers: { getSetCookie: () => [] } };
    if (url.includes('/getcrumb')) return { ok: true, text: async () => 'test-crumb' };
    if (url.includes('/quoteSummary/')) return { ok: true, json: async () => ({ quoteSummary: { result: [{}] } }) };
    assert.ok(url.includes('/fundamentals-timeseries/'), url);
    return {
      ok: true,
      json: async () => ({
        timeseries: { result: [{ quarterlyTotalRevenue: [{
          asOfDate: '2026-09-30', periodType: '3M', reportedValue: { raw: 350000000 },
        }] }] },
      }),
    };
  });
  return { writes, messages };
}

test('scheduled refresh writes snapshot and matching audit together when ELF gains a newer report', async (t) => {
  const { writes, messages } = mockRefresh(t);
  await main(['--earnings-only', 'ELF']);
  const snapshot = JSON.parse(writes.get(historyPath));
  const actualAudit = JSON.parse(writes.get(coveragePath));
  assert.equal(writes.size, 2);
  assert.equal(actualAudit.checkedAt, snapshot.generatedAt);
  assert.deepEqual(actualAudit, updateCoverage(snapshot, audit));
  assert.equal(displayed(snapshot.companies.ELF.sources)[0].periodEnd, '2026-09-30');
  for (const row of seed.companies.ELF.sources['reported-consensus']) {
    assert.ok(snapshot.companies.ELF.sources['reported-consensus'].some((entry) => entry.time === row.time));
  }
  assert.ok(messages.some((message) => message.includes('Latest six-report coverage')));
});

test('archived reviewed pairs do not mask a total provider outage or write a successful update', async (t) => {
  const { writes, messages } = mockRefresh(t, { offline: true });
  await assert.rejects(main(['--earnings-only', 'ELF']), /No symbols refreshed/);
  assert.equal(writes.size, 0);
  assert.ok(messages.some((message) => message.includes('no new provider data; retaining previous snapshot')));
  assert.ok(messages.some((message) => message.includes('simulated provider outage')));
});
