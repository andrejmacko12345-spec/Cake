const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'position.tsx'), 'utf8');
const source = ts.createSourceFile('position.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
const effect = find(source, (node) => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
  && node.arguments[0]?.getText(source).includes('getLocalCompanyReports'));
const tick = () => new Promise(setImmediate);
function setup() {
  const state = {};
  const pending = {};
  const context = { symbol: 'AAPL', console };
  for (const name of ['StatsLoading', 'EstimatesLoading', 'ReportsLoading', 'Stats', 'Estimates', 'Events', 'MetricsError', 'ReportsError']) {
    context[`set${name}`] = (value) => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  for (const name of ['fetchKeyStats', 'fetchStockEstimates', 'fetchCompanyEvents', 'getLocalCompanyReports']) {
    context[name] = () => new Promise((resolve, reject) => { pending[name] = { resolve, reject }; });
  }
  const { outputText } = ts.transpileModule(`(${effect.arguments[0].getText(source)})`, {});
  const cleanup = vm.runInNewContext(outputText, context)();
  return { state, pending, cleanup };
}

test('local reports and basic metrics render before unrelated slow network requests finish', async () => {
  const { state, pending } = setup();
  pending.getLocalCompanyReports.resolve({ quarters: [{ label: 'Q3' }] });
  pending.fetchKeyStats.resolve({ pe: 25 });
  await tick();
  assert.equal(state.ReportsLoading, false);
  assert.equal(state.Events.quarters.length, 1);
  assert.equal(state.Stats.pe, 25);
  assert.equal(state.StatsLoading, false);
  assert.equal(state.EstimatesLoading, true);
  pending.fetchStockEstimates.resolve({ epsThisYear: 3 });
  pending.fetchCompanyEvents.resolve({ quarters: [{ label: 'new' }] });
  await tick();
  assert.equal(state.Events.quarters[0].label, 'new');
  assert.equal(state.EstimatesLoading, false);
});

test('late local results cannot replace refreshed reports or data for a different stock', async () => {
  const app = setup();
  app.pending.fetchCompanyEvents.resolve({ quarters: [{ label: 'live' }] });
  await tick();
  app.pending.getLocalCompanyReports.resolve({ quarters: [{ label: 'old' }] });
  await tick();
  assert.equal(app.state.Events.quarters[0].label, 'live');
  app.cleanup();
  app.pending.fetchKeyStats.resolve({ pe: 999 });
  app.pending.fetchStockEstimates.resolve({ epsThisYear: 999 });
  await tick();
  assert.equal(app.state.Stats, null);
  assert.equal(app.state.Estimates, null);
});
