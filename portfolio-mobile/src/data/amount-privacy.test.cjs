const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    let source = fs.readFileSync(filename, 'utf8');
    if (filename.endsWith(`${require('node:path').sep}analytics.tsx`)) source += '\nexport { FundamentalsTable };';
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    module._compile(outputText, filename);
  };
}
let hidden = false;
let language = 'en';
const wrap = ({ children }) => React.createElement('div', null, children);
const text = ({ children }) => React.createElement('span', null, children);
const header = ({ title }) => React.createElement('h2', null, title);
const transaction = {
  id: 'test', symbol: 'AAPL', name: 'Apple', type: 'BUY', shares: 10, price: 100,
  currency: 'EUR', fxToEur: 1, date: '2025-01-02', createdAt: '2025-01-02T12:00:00Z',
};
const position = {
  ...transaction, currentPrice: 120, averageCost: 100, averageCostEUR: 100,
  totalInvestedEUR: 1000, realizedProfitEUR: 50, transactions: [transaction],
};
const source = fs.readFileSync(require.resolve('../context/locale.tsx'), 'utf8');
const ast = ts.createSourceFile('locale.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const translations = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'englishTranslations') {
    for (const property of node.initializer.properties) translations[property.name.text] = property.initializer.text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const { translateText, translateError } = require('./translations.ts');
const native = {
  View: wrap, Text: text, ScrollView: wrap, Pressable: wrap, Modal: () => null, ActivityIndicator: () => null,
  StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ width: 400, height: 800 }),
  Platform: { OS: 'android' },
  Animated: { Value: class { interpolate() { return 0; } }, View: wrap },
  PanResponder: { create: () => ({ panHandlers: {} }) },
};
const originalLoad = Module._load;
let AnalyticsScreen;
let ForecastScreen;
let PositionScreen;
let FundamentalsTable;
let visibility;
try {
  Module._load = function (id, ...args) {
    if (id === 'react-native') return native;
    if (id === 'react-native-svg') return { __esModule: true, default: wrap, Circle: wrap, Line: wrap, Path: wrap, Rect: wrap, Text: text };
    if (id === 'lucide-react-native') return new Proxy({}, { get: () => () => null });
    if (id === 'expo-haptics') return {};
    if (id === 'expo-router') return {
      useRouter: () => ({ canGoBack: () => true }),
      useLocalSearchParams: () => ({ symbol: 'AAPL' }),
    };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: wrap };
    if (id === '../components/asset-logo') return { AssetLogo: () => null };
    if (id === '../components/transaction-modal') return { TransactionModal: () => null };
    if (id === '../data/events') return {};
    if (id === '../components/finapp') return { Header: header, SectionTitle: header, Page: wrap, Surface: wrap, PortfolioChart: () => null };
    if (id === '../components/table-column') return { ...originalLoad.call(this, id, ...args), TableColumn: wrap };
    if (id === '../context/locale' || id === './locale') return { useLocale: () => ({
      language, t: (key) => translateText(key, language, translations),
      errorText: (message) => translateError(message, language, translations),
    }) };
    if (id === '../context/amount-visibility') return { useAmountVisibility: () => ({ hideAmounts: hidden }) };
    if (id === '../data/app-storage') return { useAppStorage: () => ({ getItem: async () => 'false' }) };
    if (id === '../hooks/use-positions') return {
      usePositions: () => ({ positions: [position], transactions: [transaction], loading: false }),
      positionValueEUR: (item) => item.shares * item.currentPrice * item.fxToEur,
      positionCostEUR: (item) => item.shares * item.averageCostEUR,
    };
    if (id === '../data/quotes' || id === './quotes' || id === '../data/fundamentals') return {};
    return originalLoad.call(this, id, ...args);
  };
  const analytics = require('../app/analytics.tsx');
  AnalyticsScreen = analytics.default;
  FundamentalsTable = analytics.FundamentalsTable;
  ForecastScreen = require('../app/forecast.tsx').default;
  PositionScreen = require('../app/position.tsx').default;
  visibility = require('../context/amount-visibility.tsx');
} finally {
  Module._load = originalLoad;
}

test('shared privacy context masks amounts before the stored preference is available', () => {
  function Consumer() {
    return React.createElement('span', null, visibility.useAmountVisibility().hideAmounts ? 'hidden' : 'shown');
  }
  const view = renderToStaticMarkup(React.createElement(visibility.AmountVisibilityProvider, null, React.createElement(Consumer)));
  assert.equal(view, '<span>hidden</span>');
});

for (const locale of ['sk', 'en']) {
  test(`fundamental estimate rows are translated with loaded data (${locale})`, () => {
    language = locale;
    const metrics = {
      currentPE: 20, peThisYear: 18, peNextYear: 16,
      epsGrowthTTM: 0.1, epsGrowthThisYear: 0.2, epsGrowthNextYear: 0.3,
      revenueGrowthTTM: 0.1, revenueGrowthThisYear: 0.2, revenueGrowthNextYear: 0.3,
    };
    const output = renderToStaticMarkup(React.createElement(FundamentalsTable, { portfolio: metrics, market: metrics, language: locale }));
    assert.ok(output.includes(locale === 'en' ? 'Forward P/E' : 'Odhad P/E'));
    if (locale === 'en') assert.doesNotMatch(output, /Odhad|[čďľňôŕšťž]/i);
  });

  test(`analytics hides all monetary returns but retains percentage summaries (${locale})`, () => {
    language = locale;
    hidden = false;
    const visible = renderToStaticMarkup(React.createElement(AnalyticsScreen));
    for (const amount of [250, 200, 50]) {
      assert.match(visible, new RegExp(locale === 'sk' ? `${amount}\\s*€` : `€${amount}`));
    }
    hidden = true;
    const privateView = renderToStaticMarkup(React.createElement(AnalyticsScreen));
    assert.doesNotMatch(privateView, /€/);
    assert.match(privateView, /•••••/);
    assert.match(privateView, /%/);
    if (locale === 'en') assert.doesNotMatch(privateView, /[čďľňôŕšťž]/i);
  });

  test(`forecast replaces balances and cash gains with cumulative percentage returns (${locale})`, () => {
    language = locale;
    hidden = false;
    assert.match(renderToStaticMarkup(React.createElement(ForecastScreen)), /€/);
    hidden = true;
    const privateView = renderToStaticMarkup(React.createElement(ForecastScreen));
    assert.doesNotMatch(privateView, /€/);
    assert.match(privateView, /%/);
    assert.ok(privateView.includes(translateText('za celé obdobie', locale, translations)));
    assert.ok(privateView.includes(translateText('Projekcia výnosu', locale, translations)));
    if (locale === 'en') assert.doesNotMatch(privateView, /[čďľňôŕšťž]/i);
  });

  test(`stock detail masks personal balances, cost and results but keeps market prices and percentages (${locale})`, () => {
    language = locale;
    hidden = false;
    const visible = renderToStaticMarkup(React.createElement(PositionScreen));
    for (const label of ['Aktuálna hodnota', 'Investované · otvorená pozícia', 'Nerealizovaný výnos', 'Celkový výsledok']) {
      const translated = translateText(label, locale, translations);
      assert.ok(visible.includes(translated), translated);
      const segment = visible.slice(visible.indexOf(translated));
      assert.match(segment, /€/, translated);
    }
    hidden = true;
    const privateView = renderToStaticMarkup(React.createElement(PositionScreen));
    for (const label of ['Aktuálna hodnota', 'Investované · otvorená pozícia', 'Priemerná nákupná cena', 'Nerealizovaný výnos', 'Celkový výsledok']) {
      const translated = translateText(label, locale, translations);
      const segment = privateView.slice(privateView.indexOf(translated));
      assert.match(segment, /^.*?<\/span><span>•••••<\/span>/, translated);
    }
    assert.match(privateView, /120 EUR/);
    assert.match(visible, /20,00 %/);
    assert.doesNotMatch(privateView, /20,00 %/);
    assert.doesNotMatch(privateView, /1[,\s\u00a0]?[02]00\s*€|250\s*€|200\s*€/);
  });
}
