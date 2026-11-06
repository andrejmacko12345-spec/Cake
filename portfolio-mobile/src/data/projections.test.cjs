const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

let summary;
const source = ts.transpileModule(fs.readFileSync(require.resolve('./projections.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
new Function('require', 'exports', source)((id) => {
  assert.equal(id, './fundamentals');
  return { yahooQuoteSummary: async () => summary, YAHOO_USER_AGENT: 'test' };
}, exportsObject);
const { parseProjectionNumber, projectStock, fetchProjectionBase, projectionDefaults, historicalAveragePE, revenueGrowthEstimate } = exportsObject;
test('editable defaults use historical growth and P/E bounds exactly 25 percent below and above reality', () => {
  assert.deepEqual(projectionDefaults({ revenueGrowth: 12.5, incomeGrowth: 20, currentPE: 7, averagePE: 40 }), {
    revenueGrowth: '12.5', incomeGrowth: '20', peLow: '30', peHigh: '50',
  });
  assert.deepEqual(projectionDefaults({}), { revenueGrowth: '', incomeGrowth: '', peLow: '', peHigh: '' });
  assert.deepEqual(projectionDefaults({ currentPE: 7 }), { revenueGrowth: '', incomeGrowth: '', peLow: '', peHigh: '' });
});
test('projections stays navigable while its bottom-tab item is hidden', () => {
  const layout = fs.readFileSync(require.resolve('../app/_layout.tsx'), 'utf8');
  const screen = layout.match(/<Tabs\.Screen name="projections" options=\{\{([\s\S]*?)\}\} \/>/);
  assert.ok(screen, 'Projections route must be registered');
  assert.doesNotMatch(screen[1], /href:\s*null|hidden:\s*true/);
  assert.match(screen[1], /tabBarItemStyle:\s*\{\s*display:\s*'none'/);
});
const base = {
  symbol: 'TEST', name: 'Test', price: 50, shares: 10, currency: 'USD',
  revenue: 1000, netIncome: 100, periodEnd: '2026-09-30', period: 'TTM',
};
const input = { revenueGrowth: 10, incomeGrowth: 20, peLow: 10, peHigh: 20 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('three-year projections compound each annual assumption, EPS, P/E bounds and annualized returns', () => {
  const years = projectStock(base, [input, { ...input, incomeGrowth: 10 }, { ...input, incomeGrowth: -10 }]);
  close(years[0].revenue, 1100);
  close(years[0].netIncome, 120);
  close(years[0].eps, 12);
  close(years[0].margin, 120 / 1100);
  close(years[0].priceLow, 120);
  close(years[0].priceHigh, 240);
  close(years[0].cagrLow, 1.4);
  close(years[1].netIncome, 132);
  close(years[1].cagrHigh, (264 / 50) ** 0.5 - 1);
  close(years[2].netIncome, 118.8);
  close(years[2].priceLow, 118.8);
  close(years[2].cagrLow, (118.8 / 50) ** (1 / 3) - 1);
  const changedRevenue = projectStock(base, [{ ...input, revenueGrowth: 50 }])[0];
  assert.equal(changedRevenue.priceLow, years[0].priceLow);
  assert.notEqual(changedRevenue.margin, years[0].margin);
});

test('decimal comma and signed numbers work; blank, malformed and non-finite inputs do not become zero', () => {
  for (const [value, expected] of [[' 12,5 ', 12.5], ['-10', -10], ['+0', 0], ['.5', 0.5]]) {
    assert.equal(parseProjectionNumber(value), expected);
  }
  for (const value of ['', ' ', '-', '1,2.3', 'NaN', 'Infinity', '1e300', '10%']) {
    assert.equal(parseProjectionNumber(value), null);
  }
});

test('invalid assumptions and bases fail explicitly; loss and zero earnings never fabricate P/E valuations', () => {
  for (const change of [{ revenueGrowth: -100 }, { incomeGrowth: -101 }, { peLow: 0 },
    { peLow: -1 }, { peHigh: 9 }, { incomeGrowth: NaN }, { peHigh: Infinity }]) {
    assert.throws(() => projectStock(base, [{ ...input, ...change }]));
  }
  for (const change of [{ price: 0 }, { shares: 0 }, { revenue: -1 }, { netIncome: Infinity }]) {
    assert.throws(() => projectStock({ ...base, ...change }, [input]));
  }
  for (const netIncome of [0, -100]) {
    const result = projectStock({ ...base, netIncome }, [input])[0];
    assert.equal(result.priceLow, null);
    assert.equal(result.priceHigh, null);
    assert.equal(result.cagrLow, null);
    assert.equal(result.cagrHigh, null);
  }
  assert.equal(projectStock(base, [{ ...input, incomeGrowth: -100 }])[0].eps, 0);
  assert.throws(() => projectStock({ ...base, netIncome: Number.MAX_VALUE }, [input]));
  close(projectStock(base, [{ ...input, peLow: 1 }])[0].cagrLow, -0.76);
});

const date = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
const older = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const row = (value, asOfDate = date, currencyCode = 'USD') => ({
  asOfDate, currencyCode, reportedValue: { raw: value },
});
const quote = () => ({
  price: { regularMarketPrice: { raw: 50 }, currency: 'USD', shortName: 'Test' },
  defaultKeyStatistics: { sharesOutstanding: { raw: 10 } },
  financialData: { financialCurrency: 'USD' },
});

test('revenue defaults blend quarterly YoY 50%, TTM YoY 30% and three-year CAGR 20%', () => {
  const today = new Date('2026-11-04T00:00:00Z');
  const anchor = '2026-09-30';
  const quarterly = [row(140, anchor), row(100, '2025-09-30')];
  const trailing = [row(520, anchor), row(400, '2025-09-30')];
  const annual = [row(100 * 1.15 ** 3, '2025-12-31'), row(100, '2022-12-31')];
  const estimate = (q = quarterly, t = trailing, a = annual) =>
    revenueGrowthEstimate(q, t, a, 'USD', anchor, today);
  close(estimate(), 32);
  close(estimate([], trailing, []), 30);
  close(estimate(quarterly, [], annual), (40 * 0.5 + 15 * 0.2) / 0.7);
  close(estimate([], [], annual), 15);
  close(estimate([row(80, anchor), row(100, '2025-09-30')], [], []), -20);
  assert.equal(estimate([], [], []), null);
  assert.equal(estimate([row(140, anchor), row(0, '2025-09-30')], [], []), null);
  assert.equal(estimate([row(140, anchor), row(100, '2025-09-30', 'EUR')], [], []), null);
  assert.equal(estimate([row(140, anchor), row(100, '2025-06-30')], [], []), null);
  assert.equal(estimate([], [], [row(130, '2025-12-31'), row(100, '2024-12-31')]), null);
  assert.equal(revenueGrowthEstimate(quarterly, trailing, annual, 'USD', anchor,
    new Date('2028-11-04T00:00:00Z')), null);
  close(estimate([...quarterly, row(999, '2027-09-30')]), 32);
  close(estimate([...quarterly].reverse()), 32);
});

test('source pairs TTM revenue and common net income by date, falling back only to a complete annual period', async () => {
  const originalFetch = global.fetch;
  summary = quote();
  let result = [
    { trailingTotalRevenue: [row(1000), row(800, older)] },
    { trailingNetIncomeCommonStockholders: [row(100)] },
  ];
  global.fetch = async (url) => {
    if (url.includes('/chart/')) return { ok: true, json: async () => ({ chart: { result: [{
      meta: { currency: 'USD' }, timestamp: [], indicators: { quote: [{ close: [] }] },
    }] } }) };
    assert.match(url, /trailingNetIncomeCommonStockholders/);
    assert.match(url, /quarterlyTotalRevenue/);
    return { ok: true, json: async () => ({ timeseries: { result: [...result,
      { trailingDilutedEPS: [row(10)] },
      { annualDilutedAverageShares: [row(10, older)] },
    ] } }) };
  };
  try {
    const actual = await fetchProjectionBase('TEST');
    assert.equal(actual.period, 'TTM');
    assert.equal(actual.periodEnd, date);
    assert.equal(actual.netIncome, 100);
    assert.equal(actual.shares, 10);
    assert.equal(actual.revenueGrowth, null);
    assert.equal(actual.incomeGrowth, null);
    assert.equal(actual.currentPE, 5);
    const priorDate = new Date(`${date}T00:00:00Z`);
    priorDate.setUTCFullYear(priorDate.getUTCFullYear() - 1);
    const prior = priorDate.toISOString().slice(0, 10);
    result = [
      { trailingTotalRevenue: [row(1000), row(800, prior)] },
      { trailingNetIncomeCommonStockholders: [row(100), row(80, prior)] },
    ];
    const defaults = await fetchProjectionBase('TEST');
    close(defaults.revenueGrowth, 25);
    close(defaults.incomeGrowth, 25);
    result[1].trailingNetIncomeCommonStockholders[1] = row(-80, prior);
    assert.equal((await fetchProjectionBase('TEST')).incomeGrowth, null);
    result[0].trailingTotalRevenue[1] = row(800, prior, 'EUR');
    assert.equal((await fetchProjectionBase('TEST')).revenueGrowth, null);
    const annualDate = (offset) => {
      const value = new Date(`${date}T00:00:00Z`);
      value.setUTCFullYear(value.getUTCFullYear() - offset);
      return value.toISOString().slice(0, 10);
    };
    result = [
      { trailingTotalRevenue: [row(1000)] },
      { trailingNetIncomeCommonStockholders: [row(100)] },
      { annualTotalRevenue: [row(1320, annualDate(0)), row(1200, annualDate(1)),
        row(1000, annualDate(2)), row(800, annualDate(3)), row(1, annualDate(4))] },
      { annualNetIncomeCommonStockholders: [row(150, annualDate(0)), row(100, annualDate(1)),
        row(80, annualDate(2)), row(100, annualDate(3))] },
    ];
    const averages = await fetchProjectionBase('TEST');
    close(averages.revenueGrowth, ((1320 / 800) ** (1 / 3) - 1) * 100);
    close(averages.incomeGrowth, (50 + 25 - 20) / 3);
    result.push({ quarterlyTotalRevenue: [row(140), row(100, prior)] });
    result[0].trailingTotalRevenue.push(row(1000 / 1.3, prior));
    const weighted = await fetchProjectionBase('TEST');
    close(weighted.revenueGrowth, 40 * 0.5 + 30 * 0.3
      + ((1320 / 800) ** (1 / 3) - 1) * 100 * 0.2);
    close(weighted.incomeGrowth, averages.incomeGrowth);
    result = [
      { trailingTotalRevenue: [row(1000)] },
      { trailingNetIncomeCommonStockholders: [row(50, older)] },
      { annualTotalRevenue: [row(800, older)] },
      { annualNetIncomeCommonStockholders: [row(0, older)] },
    ];
    const annual = await fetchProjectionBase('TEST');
    assert.equal(annual.period, 'annual');
    assert.equal(annual.netIncome, 0);
    assert.equal(annual.revenue, 800);
  } finally { global.fetch = originalFetch; }
});

test('source rejects missing, stale, future, mismatched and cross-currency fundamentals and HTTP failures', async () => {
  const originalFetch = global.fetch;
  let result;
  global.fetch = async () => ({ ok: true, json: async () => ({ timeseries: { result } }) });
  try {
    for (const rows of [
      [],
      [{ trailingTotalRevenue: [row(1000)] }, { trailingNetIncomeCommonStockholders: [row(100, older)] }],
      [{ trailingTotalRevenue: [row(1000, older)] }, { trailingNetIncomeCommonStockholders: [row(100, older)] }],
      [{ trailingTotalRevenue: [row(1000, '2099-01-01')] }, { trailingNetIncomeCommonStockholders: [row(100, '2099-01-01')] }],
      [{ trailingTotalRevenue: [row(1000, date, 'EUR')] }, { trailingNetIncomeCommonStockholders: [row(100, date, 'EUR')] }],
      [{ trailingTotalRevenue: [row(1000)] }, { trailingNetIncomeCommonStockholders: [row(100, date, 'EUR')] }],
    ]) {
      summary = quote();
      result = rows;
      await assert.rejects(fetchProjectionBase('TEST'));
    }
    summary = quote();
    result = [{ trailingTotalRevenue: [row(1000)] }, { trailingNetIncomeCommonStockholders: [row(100)] }];
    await assert.rejects(fetchProjectionBase('TEST'), /zisk na akciu/);
    summary = quote();
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(fetchProjectionBase('TEST'), /HTTP 429/);
  } finally { global.fetch = originalFetch; }
});

test('three-year P/E uses each historical quarter-end price and matching trailing EPS, never todays price', () => {
  const earnings = Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 11 + index * 3, 28)).toISOString().slice(0, 10), eps: 5 + index,
  }));
  const prices = earnings.map((entry, index) => ({ date: entry.date, price: entry.eps * (20 + index) }));
  const today = new Date('2026-11-04T00:00:00Z');
  close(historicalAveragePE(earnings, prices, today), 25.5);
  assert.equal(historicalAveragePE(earnings.slice(-4), prices, today), null);
  assert.equal(historicalAveragePE(earnings.map((row) => ({ ...row, eps: -1 })), prices, today), null);
  assert.equal(historicalAveragePE(earnings, prices.map((row) => ({ ...row, date: '2099-01-01' })), today), null);
  // Dividends must not adjust prices; the source uses chart close, never adjclose.
  assert.doesNotMatch(source, /adjclose/);
});

test('Google class-specific shares cannot distort EPS or P/E; historical average drives bounds and prices', async () => {
  const originalFetch = global.fetch;
  const earnings = Array.from({ length: 12 }, (_, index) => {
    const time = new Date();
    time.setUTCMonth(time.getUTCMonth() - 34 + index * 3, 1);
    return { date: time.toISOString().slice(0, 10), eps: 5 };
  });
  summary = quote();
  summary.defaultKeyStatistics.sharesOutstanding.raw = 5; // Only one class; consolidated denominator is 20.
  global.fetch = async (url) => {
    if (url.includes('/chart/')) return { ok: true, json: async () => ({ chart: { result: [{
      meta: { currency: 'USD' }, timestamp: earnings.map((row) => Date.parse(row.date) / 1000),
      indicators: { quote: [{ close: earnings.map(() => 125) }] },
    }] } }) };
    return { ok: true, json: async () => ({ timeseries: { result: [
      { trailingTotalRevenue: [row(1000)] }, { trailingNetIncomeCommonStockholders: [row(100)] },
      { trailingDilutedEPS: [...earnings.map((entry) => row(5, entry.date)), row(5)] },
    ] } }) };
  };
  try {
    const actual = await fetchProjectionBase('GOOGL');
    assert.equal(actual.shares, 20);
    assert.equal(actual.currentPE, 10);
    assert.equal(actual.averagePE, 25);
    assert.deepEqual(projectionDefaults(actual), { revenueGrowth: '', incomeGrowth: '', peLow: '18.75', peHigh: '31.25' });
    const year = projectStock(actual, [{ ...input, incomeGrowth: 0, peLow: 18.75, peHigh: 31.25 }])[0];
    assert.equal(year.eps, 5);
    assert.equal(year.priceLow, 93.75);
    assert.equal(year.priceHigh, 156.25);
  } finally { global.fetch = originalFetch; }
});

test('compact projection table renders 4 shared inputs and all 3 years in Slovak and English without horizontal scrolling', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Module = require('node:module');
  const originalLoad = Module._load;
  const originalState = React.useState;
  const originalTsx = require.extensions['.tsx'];
  const wrap = ({ children }) => React.createElement('div', null, children);
  const text = ({ children }) => React.createElement('span', null, children);
  let inputs = [];
  let buttons = [];
  let updates = [];
  let keyboardDismissals = 0;
  let rowHeights = [];
  let sectionGaps = [];
  let columnTones = [];
  const translations = {};
  const localeSource = fs.readFileSync(require.resolve('../context/locale.tsx'), 'utf8');
  const ast = ts.createSourceFile('locale.tsx', localeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'englishTranslations') {
      for (const property of node.initializer.properties) translations[property.name.text] = property.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  let language;
  let Screen;
  try {
    require.extensions['.tsx'] = (module, filename) => {
      const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      });
      module._compile(outputText, filename);
    };
    Module._load = function (id, ...args) {
      if (id === 'react-native') return {
        View: (props) => {
          if (Array.isArray(props.style) && props.style[1]?.minHeight) rowHeights.push(props.style[1].minHeight);
          if (Array.isArray(props.style) && props.style[2]?.marginTop) sectionGaps.push(props.style[2].marginTop);
          return wrap(props);
        }, Text: text, ScrollView: wrap, Modal: wrap,
        Pressable: (props) => { buttons.push(props); return wrap(props); },
        KeyboardAvoidingView: wrap,
        Keyboard: { dismiss: () => { keyboardDismissals++; } },
        TextInput: (props) => {
          inputs.push(props);
          return React.createElement('input', { defaultValue: props.value, 'aria-label': props.accessibilityLabel });
        },
        ActivityIndicator: () => null, StyleSheet: { create: (styles) => styles }, Platform: { OS: 'android' },
      };
      if (id === 'expo-router') return { router: {} };
      if (id === './animated-collapse') return { AnimatedCollapse: ({ expanded, children }) => expanded ? wrap({ children }) : null };
      if (id === 'lucide-react-native') return { ArrowLeft: () => null, Search: () => null,
        ChevronDown: () => null, X: () => null, BriefcaseBusiness: () => null, Check: () => null, Bookmark: () => null, Info: () => null };
      if (id === '../components/finapp') return {
        Page: wrap, Surface: wrap, Header: ({ title }) => React.createElement('h1', null, title),
      };
      if (id === '../components/stock-search-modal') return { StockSearchModal: () => null };
      if (id === '../components/table-column') return { TableColumn: (props) => {
        columnTones.push(props.tone);
        return wrap(props);
      } };
      if (id === '../data/theme') return { useThemedStyles: (factory) => factory() };
      if (id === '../data/portfolio') return { colors: {} };
      if (id === '../data/haptics') return { selectionHaptic: () => {} };
      if (id === '../hooks/use-positions') return { usePositions: () => ({
        positions: [{ symbol: 'AAPL', shares: 2 }, { symbol: 'MSFT', shares: 1 }, { symbol: 'CLOSED', shares: 0 },
          ...Array.from({ length: 15 }, (_, index) => ({ symbol: `STOCK${index}`, shares: 1 }))],
      }) };
      if (id === '../hooks/use-asset-search') return { useAssetSearch: () => ({ results: [], loading: false, error: '' }) };
      if (id === '../hooks/use-watchlists') return { useWatchlists: () => ({
        lists: [{ id: 'one', name: 'Growth Picks', symbols: ['NVDA', 'AMD'] },
          { id: 'two', name: 'Income Picks', symbols: ['KO', 'NVDA'] },
          { id: 'empty', name: 'Empty Picks', symbols: [] }], loading: false, error: '',
      }) };
      if (id === '../data/projections') return exportsObject;
      if (id === '../context/locale') return { useLocale: () => ({
        language, t: (key) => language === 'en' ? translations[key] ?? key : key, errorText: (key) => key,
      }) };
      return originalLoad.call(this, id, ...args);
    };
    Screen = require('../components/stock-projections.tsx').default;
    for (language of ['sk', 'en']) {
      let index = 0;
      inputs = [];
      buttons = [];
      updates = [];
      keyboardDismissals = 0;
      sectionGaps = [];
      columnTones = [];
      const states = ['TEST', false, base, false, '', 0, {
        revenueGrowth: '10', incomeGrowth: '20', peLow: '10', peHigh: '20',
      }, '', 500, false, 160, false, false, 'portfolio'];
      React.useState = () => {
        const stateIndex = index++;
        const [value] = originalState(states[stateIndex]);
        return [value, (next) => updates.push([stateIndex, next])];
      };
      const html = renderToStaticMarkup(React.createElement(Screen));
      assert.ok(html.includes(language === 'sk' ? '50,00' : '50.00'));
      assert.match(html, /USD/);
      assert.deepEqual(sectionGaps, [6, 6, 6]);
      for (const tone of ['cyan', 'violet', 'blue', 'slate']) {
        assert.ok(columnTones.filter((value) => value === tone).length >= 8);
      }
      assert.equal((html.match(/<input/g) ?? []).length, 5);
      assert.doesNotMatch(html, /AAPL|MSFT/);
      assert.doesNotMatch(html, /CLOSED/);
      const info = buttons.find((button) => button.accessibilityLabel === (language === 'sk' ? 'Ako predvypĺňame hodnoty' : 'How default values are calculated'));
      assert.ok(info);
      info.onPress();
      assert.ok(updates.some(([index, next]) => index === 12 && next === true));
      updates = [];
      const clear = buttons.find((button) => button.accessibilityLabel === (language === 'sk' ? 'Zrušiť výber akcie' : 'Clear stock selection'));
      assert.ok(clear);
      clear.onPress();
      for (const [stateIndex, value] of [[0, ''], [2, null], [3, false], [4, ''], [1, false], [9, false], [11, false]]) {
        assert.ok(updates.some(([index, next]) => index === stateIndex && next === value));
      }
      assert.deepEqual(updates.find(([index]) => index === 6)[1], {
        revenueGrowth: '', incomeGrowth: '', peLow: '', peHigh: '',
      });
      updates = [];
      const dropdown = buttons.find((button) => button.accessibilityLabel === (language === 'sk' ? 'Z môjho portfólia' : 'From my portfolio'));
      assert.ok(dropdown);
      dropdown.onPress();
      assert.equal(updates.find(([stateIndex]) => stateIndex === 9)[1](false), true);
      assert.ok(updates.some(([stateIndex, value]) => stateIndex === 13 && value === 'portfolio'));
      updates = [];
      states[9] = true;
      index = 0;
      buttons = [];
      inputs = [];
      const openHtml = renderToStaticMarkup(React.createElement(Screen));
      assert.match(openHtml, /AAPL/);
      assert.match(openHtml, /MSFT/);
      for (let stock = 0; stock < 15; stock++) assert.ok(openHtml.includes(`STOCK${stock}`));
      assert.doesNotMatch(openHtml, /CLOSED/);
      states[9] = false;
      states[11] = true;
      states[13] = 'watchlists';
      index = 0;
      buttons = [];
      const watchedHtml = renderToStaticMarkup(React.createElement(Screen));
      for (const label of ['Growth Picks', 'Income Picks', 'Empty Picks', 'AMD', 'KO']) assert.ok(watchedHtml.includes(label));
      assert.equal(buttons.filter((button) => button.accessibilityLabel?.endsWith(' NVDA')).length, 2);
      buttons.find((button) => button.accessibilityLabel?.endsWith(' AMD')).onPress();
      assert.ok(updates.some(([stateIndex, value]) => stateIndex === 0 && value === 'AMD'));
      assert.ok(updates.some(([stateIndex, value]) => stateIndex === 11 && value === false));
      states[9] = true;
      states[11] = false;
      states[13] = 'portfolio';
      index = 0;
      buttons = [];
      inputs = [];
      renderToStaticMarkup(React.createElement(Screen));
      assert.equal(inputs[0].showSoftInputOnFocus, true);
      inputs[0].onFocus();
      assert.ok(updates.some(([stateIndex, value]) => stateIndex === 1 && value === true));
      updates = [];
      keyboardDismissals = 0;
      const apple = buttons.find((button) => button.accessibilityLabel?.endsWith(' AAPL'));
      assert.ok(apple);
      apple.onPress();
      assert.equal(keyboardDismissals, 1);
      assert.deepEqual(updates.find(([stateIndex]) => stateIndex === 0), [0, 'AAPL']);
      assert.deepEqual(updates.find(([stateIndex]) => stateIndex === 2), [2, null]);
      assert.deepEqual(updates.find(([stateIndex]) => stateIndex === 6), [6, {
        revenueGrowth: '', incomeGrowth: '', peLow: '', peHigh: '',
      }]);
      assert.ok(html.includes(language === 'sk' ? '120,00' : '120.00'));
      assert.ok(html.includes(language === 'sk' ? '140,00%' : '140.00%'));
      assert.ok(html.includes(language === 'sk' ? '172,80' : '172.80'));
      for (const label of language === 'sk' ? ['O 1 rok', 'O 2 roky', 'O 3 roky'] : ['In 1 year', 'In 2 years', 'In 3 years']) {
        assert.ok(html.includes(label));
      }
      const screenSource = fs.readFileSync(require.resolve('../components/stock-projections.tsx'), 'utf8');
      assert.doesNotMatch(screenSource, /borderLeftWidth/);
      assert.match(screenSource, /borderWidth: 2, borderColor: '#444444'/);
      assert.match(fs.readFileSync(require.resolve('../components/stock-compare.tsx'), 'utf8'),
        /tableCard: \{[^}]*borderWidth: 2,[^}]*borderColor: '#444444'/);
      assert.equal((screenSource.match(/<ScrollView/g) ?? []).length, 1, 'Only the dropdown has its own scrolling');
      assert.ok(html.includes(language === 'sk' ? 'Rast čistého zisku' : 'Net income growth'));
      assert.ok(html.includes(language === 'sk' ? 'Horné CAGR' : 'High CAGR'));
      assert.doesNotMatch(html, /Projection Test|Base period|Východiskové obdobie|Source: Yahoo|Zdroj: Yahoo|Model drží|The model keeps|Values in|Hodnoty v mene|2026-09-30/);
      if (language === 'en') assert.doesNotMatch(html, /[čďľňôŕšťž]/i);
      states[0] = '';
      states[2] = null;
      index = 0;
      inputs = [];
      const emptyHtml = renderToStaticMarkup(React.createElement(Screen));
      assert.ok(emptyHtml.includes(language === 'sk' ? 'Horné CAGR' : 'High CAGR'));
      assert.ok(emptyHtml.includes(language === 'sk' ? 'O 3 roky' : 'In 3 years'));
      assert.equal(inputs.length, 5);
      assert.ok(inputs.slice(1).every((input) => input.editable === false));
      assert.ok((emptyHtml.match(/—/g) ?? []).length >= 24);
      assert.doesNotMatch(emptyHtml, /USD/);
      for (const viewport of [480, 560, 700]) {
        states[8] = viewport;
        index = 0;
        rowHeights = [];
        renderToStaticMarkup(React.createElement(Screen));
        assert.equal(rowHeights.length, 9);
        const tableHeight = rowHeights.reduce((sum, height) => sum + height, 0);
        assert.ok(tableHeight + 18 + states[10] + 16 + 28 + 8 <= viewport,
          `Table must stay above navigation at available height ${viewport}`);
        assert.ok(rowHeights.every((height) => height >= 26));
      }
    }
  } finally {
    React.useState = originalState;
    Module._load = originalLoad;
    if (originalTsx) require.extensions['.tsx'] = originalTsx;
    else delete require.extensions['.tsx'];
  }
});
