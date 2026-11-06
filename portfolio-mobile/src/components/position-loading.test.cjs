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
  for (const name of ['StatsLoading', 'ResultsExpanded', 'EstimatesLoading', 'ReportsLoading', 'Stats', 'Estimates', 'Events', 'MetricsError', 'ReportsError']) {
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

function metricSections(stats, estimates, projection = false) {
  const groups = find(source, (node) => ts.isArrayLiteralExpression(node)
    && node.elements[0]?.getText(source).startsWith(projection
      ? "{ title: t('Tržby')" : "{ title: t('Dividendy a kapitalizácia')"));
  const formatter = find(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'formatBigNumber');
  const code = `${formatter.getText(source)}\nJSON.stringify(${groups.getText(source)})`;
  return JSON.parse(vm.runInNewContext(ts.transpileModule(code, {}).outputText, {
    stats, estimates, t: (value) => value, position: { currency: 'USD' },
  }));
}

function reportRow(quarter) {
  const render = find(source, (node) => ts.isArrowFunction(node)
    && node.parameters[0]?.getText(source) === 'quarter'
    && node.body.getText(source).includes('key={quarter.periodEnd}'));
  const formatter = find(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'formatBigNumber');
  const code = `${formatter.getText(source)}\n(${render.getText(source)})(quarter)`;
  return vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React },
  }).outputText, {
    quarter, t: (value) => value, styles: { reportSecondary: 'shared-metric-type' }, colors: { green: 'green', red: 'red' },
    View: 'View', Text: 'Text', TableColumn: 'TableColumn',
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  });
}

test('earnings keep the quarter beside five metric columns without horizontal scrolling', () => {
  const block = reportRow({ periodEnd: '2026-09-30', label: 'Q3 2026', revenue: 7.16e9,
    revenueBeat: -123.44e6, revenueYoY: 1.1, epsActual: 3.57, epsBeat: 0.19 });
  assert.equal(text.includes('<ScrollView horizontal'), false);
  const revenue = block.children[0];
  const contents = (row) => row.children.map((column) => column.children.filter(Boolean).map((cell) => cell.children.join('')).join(''));
  assert.equal(block.children.length, 1);
  assert.equal(revenue.children.length, 6);
  assert.deepEqual(contents(revenue), ['Q3\n2026', '7.2B', '-123.4M', '+1.1%', '3.57', '+0.19']);
  assert.equal(Array.isArray(revenue.children[3].children[0].props.style), false);
  for (const index of [1, 3, 4]) {
    const metric = revenue.children[index].children[0];
    assert.equal(metric.props.style, revenue.children[1].children[0].props.style);
  }
  assert.equal(revenue.children[2].children[0].props.style[1].color, 'red');
  assert.equal(revenue.children[5].children[0].props.style[1].color, 'green');
});

test('all earnings quarters put the year on a separate line', () => {
  for (const label of ['Q1 2026', 'Q2 2026', 'Q3 2025', 'Q4 2025']) {
    const block = reportRow({ periodEnd: label, label });
    assert.equal(block.children[0].children[0].children[0].children.join(''), label.replace(' ', '\n'));
  }
});

test('earnings header groups each actual with its beat alongside separate YoY', () => {
  const heading = find(source, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.getText(source) === 'style={styles.reportHeading}');
  assert.ok(heading);
  const markup = heading.getText(source);
  assert.ok(markup.includes('styles.reportRevenueGroup'));
  assert.ok(markup.includes('styles.reportEpsGroup'));
  assert.equal(markup.includes('styles.reportBeatGroup'), false);
  assert.equal(markup.includes("t('Hodnota')"), false);
  assert.equal(markup.includes('>Beat<'), false);
  assert.equal(markup.includes("t('Obdobie')"), false);
});

test('earnings preserve missing values, zeros and provisional revenue markers', () => {
  const missing = reportRow({ periodEnd: 'missing', label: 'Q1' });
  assert.equal(missing.children[0].children[1].children[0].children.join(''), '–');
  assert.equal(missing.children[0].children[5].children[0].children.join(''), '–');
  const zero = reportRow({ periodEnd: 'zero', label: 'Q1', revenue: 0, revenueBeat: 0,
    revenueBeatProvisional: true, revenueYoY: 0, epsActual: 0, epsBeat: 0 });
  assert.equal(zero.children[0].children[2].children[0].children.join(''), '0*');
  assert.equal(zero.children[0].children[5].children[0].children.join(''), '0.00');
  const growth = (value) => reportRow({ periodEnd: 'growth', label: 'Q1', revenueYoY: value })
    .children[0].children[3].children[0];
  assert.equal(growth(-3.2).children.join(''), '-3.2%');
  assert.equal(Array.isArray(growth(-3.2).props.style), false);
  assert.equal(growth(0).children.join(''), '0.0%');
  assert.equal(Array.isArray(growth(0).props.style), false);
  assert.equal(growth(null).children.join(''), '–');
  const largeGrowth = growth(110.7);
  assert.equal(largeGrowth.children.join(''), '+110.7%');
  assert.equal(largeGrowth.props.numberOfLines, 1);
  assert.equal(largeGrowth.props.adjustsFontSizeToFit, true);
});

test('current data contains only dividends and market cap', () => {
  const sections = metricSections({ pe: 14.2, eps: 23.84, dividendRate: 6.6, dividendYield: 0.0196, marketCap: 895.84e9 }, {
    revenueTTM: 100e9, revenueThisYear: 110e9, revenueNextYear: 120e9,
    revenueGrowthTTM: 0.125, revenueGrowthThisYear: -0.035, revenueGrowthNextYear: 0,
    peThisYear: 14, peNextYear: 13.2, epsThisYear: 24.02, epsNextYear: 25.57,
    priceToSalesTTM: 4.5, priceToSalesThisYear: 4.1, priceToSalesNextYear: 3.75,
  });
  assert.deepEqual(sections.map((section) => section.title),
    ['Dividendy a kapitalizácia']);
  assert.deepEqual(sections.map((section) => section.rows[0].length), [3]);
  assert.deepEqual(sections[0].rows[0].map((cell) => cell[0]), ['Ročná dividenda na akciu', 'Dividendový výnos', 'Trhová kapitalizácia']);
  assert.deepEqual(sections[0].rows[0].map((cell) => cell[1]), ['6.60 USD', '1.96 %', '895.84 B']);
  assert.ok(sections.every((section) => section.rows.every((row) => row.every(([label]) => !label.includes('Odhad')))));
});

test('dividend rows share the expanded position detail layout and typography', () => {
  const current = find(source, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.getText(source) === 'style={styles.currentMetrics}');
  assert.ok(current);
  const markup = current.getText(source);
  for (const style of ['currentMetricTile', 'currentMetricCaption', 'currentMetricAmount']) {
    assert.ok(markup.includes(`styles.${style}`));
  }
  assert.equal(markup.includes('<TableColumn'), false);
  assert.ok(text.includes("currentMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }"));
  assert.match(text, /currentMetricTile: \{[^}]*flex: 1[^}]*borderRadius: 12/);
});

test('holding summary and always-visible dividends share one surface', () => {
  const card = find(source, (node) => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(source) === 'Surface'
    && node.openingElement.attributes.getText(source) === 'style={styles.resultsCard}');
  assert.ok(card);
  assert.ok(card.getText(source).includes('styles.resultHero'));
  assert.ok(card.getText(source).includes('styles.currentMetrics'));
  assert.ok(card.getText(source).includes('heldPosition ? styles.currentMetricsDivider : undefined'));
  const holding = find(card, (node) => ts.isConditionalExpression(node)
    && node.condition.getText(source) === 'heldPosition');
  assert.ok(holding);
  assert.equal(holding.whenTrue.getText(source).includes('styles.currentMetrics'), false);
  const expanded = find(card, (node) => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(source) === 'AnimatedCollapse');
  assert.ok(expanded);
  assert.equal(expanded.getText(source).includes('styles.currentMetrics'), false);
});

test('projection contains only the two supplied annual forecasts, without TTM or dividends', () => {
  const sections = metricSections({ pe: 999, eps: 999, dividendRate: 999 }, {
    revenueThisYear: 110e9, revenueNextYear: 120e9,
    revenueGrowthThisYear: -0.035, revenueGrowthNextYear: 0,
    epsThisYear: 24.02, epsNextYear: 25.57, peThisYear: 14, peNextYear: 13.2,
    priceToSalesThisYear: 4.1, priceToSalesNextYear: 3.75,
  }, true);
  assert.deepEqual(sections.map((section) => section.title), ['Tržby', 'Ocenenie a zisk']);
  assert.deepEqual(sections[0].rows, [
    ['Odhad tržieb', '110.00 B', '120.00 B'],
    ['Rast tržieb', '-3.50 %', '0.00 %'],
  ]);
  assert.deepEqual(sections[1].rows, [
    ['Odhad EPS', '24.02', '25.57'], ['Odhad P/E', '14.0', '13.2'], ['Odhad P/S', '4.10', '3.75'],
  ]);
  const missing = metricSections(null, null, true);
  assert.ok(missing.every((section) => section.rows.every((row) => row.slice(1).every((value) => value === '–'))));
});

test('held-position value and returns precede untitled dividend data and projection', () => {
  const chart = text.indexOf('<StockChart position=');
  const current = text.indexOf('<View style={styles.currentMetrics}>');
  assert.equal(text.includes("<SectionTitle title={t('Aktuálny stav')}"), false);
  const projection = text.indexOf("<SectionTitle title={t('Projekcia')}");
  const held = text.indexOf('{heldPosition ? (', chart);
  assert.ok(chart < held && held < current && current < projection);
  const value = text.indexOf("t('Aktuálna hodnota')", held);
  const returns = text.indexOf("t('Celkový výsledok')", held);
  assert.ok(held < value && value < returns && returns < current);
});

test('missing current amounts remain dashes while zero dividends are displayed', () => {
  const missing = metricSections(null, null);
  assert.ok(missing.every((section) => section.rows.every((row) => row.every((cell) => cell[1] === '–'))));
  assert.equal(metricSections({ dividendRate: 0 }, null)[0].rows[0][0][1], '0.00 USD');
});

test('position summary is collapsed initially, toggles accessibly and resets on symbol change', () => {
  assert.ok(text.includes('[resultsExpanded, setResultsExpanded] = useState(false)'));
  const button = find(source, (node) => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(source) === 'Pressable'
    && node.openingElement.attributes.getText(source).includes('expanded: resultsExpanded'));
  assert.ok(button);
  const attributes = button.openingElement.attributes;
  assert.ok(attributes.getText(source).includes('accessibilityRole="button"'));
  const press = attributes.properties.find((property) => property.name?.getText(source) === 'onPress');
  let expanded = false;
  let haptics = 0;
  const callback = ts.transpileModule(`(${press.initializer.expression.getText(source)})`, {}).outputText;
  const toggle = vm.runInNewContext(callback, {
    selectionHaptic: () => { haptics++; },
    setResultsExpanded: (update) => { expanded = update(expanded); },
  });
  toggle();
  assert.equal(expanded, true);
  toggle();
  assert.equal(expanded, false);
  assert.equal(haptics, 2);
  assert.ok(button.getText(source).includes('formatMoney(currentValue)'));
  assert.ok(button.getText(source).includes('formatMoney(unrealized)'));
  assert.equal(button.getText(source).includes('formatPercent((unrealized / openCost) * 100)'), false);
  const summaryValue = find(button, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.getText(source).includes('style={styles.resultTotal}'));
  assert.ok(summaryValue.getText(source).includes('formatMoney(currentValue)'));
  assert.ok(summaryValue.getText(source).includes('formatMoney(unrealized)'));
  assert.ok(button.getText(source).includes("hideAmounts ? '•••••'"));
  assert.ok(text.includes('<AnimatedCollapse expanded={resultsExpanded}><View style={styles.resultGrid}>'));
  assert.equal(setup().state.ResultsExpanded, false);
});

test('expanded summary shows percentage return and three position details', () => {
  const details = find(source, (node) => ts.isJsxElement(node)
    && node.openingElement.attributes.getText(source) === 'style={styles.resultGrid}');
  assert.ok(details);
  const labels = [...details.getText(source).matchAll(/t\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['Priemerná nákupná cena', 'Investované · otvorená pozícia', 'Nerealizovaný výnos', 'Celkový výsledok']);
  assert.ok(details.getText(source).includes('formatPercent((unrealized / openCost) * 100)'));
  assert.ok(details.getText(source).includes('formatMoney(unrealized)'));
});
