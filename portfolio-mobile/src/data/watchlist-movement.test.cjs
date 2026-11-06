const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, 'quotes.ts'), 'utf8');
const source = ts.createSourceFile('quotes.ts', text, ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ['getExtendedMarket', 'isValidPrice'].includes(node.name?.text));
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(declarations.map((node) => node.getText(source)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, Date });
const getExtendedMarket = exportsObject.getExtendedMarket;
const quote = (time, price = 102) => ({
  meta: { currentTradingPeriod: { pre: { start: 100, end: 200 }, regular: { start: 200, end: 400 }, post: { start: 400, end: 500 } } },
  timestamp: [time], indicators: { quote: [{ close: [price] }] },
});

test('pre and after-market movements use the regular quote baseline and retain sign', () => {
  const pre = getExtendedMarket(quote(150), 100, 160);
  assert.equal(pre.session, 'pre');
  assert.equal(pre.change, 2);
  assert.equal(pre.changePercent, 2);
  const post = getExtendedMarket(quote(450, 98), 100, 460);
  assert.equal(post.session, 'post');
  assert.equal(post.change, -2);
  assert.equal(post.changePercent, -2);
});

test('extended movement rejects regular-session, missing, stale, future and invalid prices', () => {
  assert.equal(getExtendedMarket(quote(250), 100, 260), undefined);
  assert.equal(getExtendedMarket({}, 100, 160), undefined);
  assert.equal(getExtendedMarket(quote(170), 100, 160), undefined);
  assert.equal(getExtendedMarket(quote(150, null), 100, 160), undefined);
  assert.equal(getExtendedMarket(quote(150), 0, 160), undefined);
  const stale = quote(450);
  stale.meta.currentTradingPeriod.post.end = 5000;
  assert.equal(getExtendedMarket(stale, 100, 3000), undefined);
  const zero = getExtendedMarket(quote(150, 100), 100, 160);
  assert.equal(zero.change, 0);
});

test('watchlist switches period movement units and replaces the price with extended movement', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'watchlist.tsx'), 'utf8');
  assert.ok(screen.includes("valueMode === 'percent' ? change : absoluteChange"));
  assert.ok(screen.includes("valueMode === 'percent' ? extended.changePercent : extended.change"));
  assert.ok(screen.includes('getWatchlistMovement(allPoints'));
  assert.ok(screen.includes('valueMode={valueMode}'));
  assert.ok(screen.includes("(['percent', 'absolute'] as const).map"));
  assert.ok(screen.includes("accessibilityState={{ selected: valueMode === mode }}"));
  assert.ok(screen.includes('{extended ? <Text'));
  assert.ok(!screen.includes("`${t('Pre')}/${t('After')}:"));
  assert.match(screen, /periodChange: \{[\s\S]*?fontSize: 14/);
  assert.match(screen, /filterGroup: \{ flexDirection: 'row', alignItems: 'center', gap: 4/);
  assert.ok(screen.includes("periodExpanded: { width: '100%' }"));
  assert.ok(screen.includes('expanded && styles.periodExpanded'));
  assert.ok(screen.includes('onPress={() => { selectionHaptic(); setExpanded(true); }}'));
  assert.ok(text.includes("fetchChart(symbol, '1d', '1m', includeExtended)"));
  assert.ok(screen.includes('fetchLiveQuote(symbol, true)'));
});

const movementExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'watchlists.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: movementExports, Date });

test('portfolio watchlist copies unique open positions and excludes closed holdings', () => {
  const positions = [{ symbol: 'AAPL', shares: 2 }, { symbol: 'MSFT', shares: 0 }, { symbol: 'AAPL', shares: 1 }, { symbol: 'GOOGL', shares: 0.1 }];
  assert.deepEqual(Array.from(movementExports.getPortfolioWatchlistSymbols(positions)), ['AAPL', 'GOOGL']);
  assert.equal(positions.length, 4);
  assert.equal(movementExports.getPortfolioWatchlistSymbols([]).length, 0);
});

test('swiping is attached to the full screen and distinguishes scrolling and period gestures', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'watchlist.tsx'), 'utf8');
  assert.match(screen, /<View style=\{styles\.screenGestureArea\}[\s\S]*?swipeResponder\.panHandlers[\s\S]*?pointerGestureHandlers[\s\S]*?<Page/);
  assert.ok(screen.includes("screenGestureArea: { flex: 1 }"));
  assert.ok(screen.includes('!periodExpanded && !editingAssets'));
  assert.ok(screen.includes('Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2'));
  assert.ok(screen.includes('swipeContext.current.finishSwipe(gesture.dx, gesture.vx)'));
  assert.ok(!screen.includes('Animated.spring(swipeX'));
  assert.ok(screen.includes('onExpandedChange={setPeriodExpanded}'));
});

test('short deliberate swipes switch lists while taps and small drags do not', () => {
  const direction = movementExports.getWatchlistSwipeDirection;
  assert.equal(direction(-24, 0), 1);
  assert.equal(direction(24, 0), -1);
  assert.equal(direction(-12, -0.3), 1);
  assert.equal(direction(12, 0.3), -1);
  assert.equal(direction(0, 1), null);
  assert.equal(direction(10, 0.1), null);
  assert.equal(direction(20, 0.1), null);
});

test('index detail blocks watchlist responders and reports both open and close', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'watchlist.tsx'), 'utf8');
  const overview = fs.readFileSync(path.join(__dirname, '..', 'components', 'market-overview.tsx'), 'utf8');
  assert.ok(screen.includes('editingAssets || indexDetailOpen || Platform.OS'));
  assert.ok(screen.includes('enabled: !indexDetailOpen'));
  assert.ok(screen.includes('if (indexDetailOpen || swipeAnimating.current'));
  assert.ok(screen.includes('<MarketOverview onDetailOpenChange='));
  assert.ok(overview.includes('onDetailOpenChange?.(true)'));
  assert.ok(overview.includes('onDetailOpenChange?.(false)'));
});

test('adjacent pages track the finger and align exactly at the completed swipe without teleporting', () => {
  const offset = movementExports.getWatchlistDragOffset;
  const width = 296;
  assert.equal(offset(-80, width, 1, 3), -80);
  assert.equal(offset(80, width, 1, 3), 80);
  assert.equal(offset(-400, width, 1, 3), -width);
  assert.equal(offset(80, width, 0, 3), 12);
  assert.equal(offset(-80, width, 2, 3), -12);
  const gap = 12;
  const stride = width + gap;
  assert.equal(2 * stride - stride + offset(-stride, stride, 1, 3), 0);
  assert.equal(0 - stride + offset(stride, stride, 1, 3), 0);
  for (const dx of [-200, -80, 0, 80, 200]) {
    const drag = offset(dx, stride, 1, 3);
    const currentRight = drag + width;
    const nextLeft = stride + drag;
    assert.equal(nextLeft - currentRight, gap);
  }
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'watchlist.tsx'), 'utf8');
  assert.ok(screen.includes('nearbyLists.map((list, pageIndex)'));
  assert.ok(screen.includes('Animated.subtract(swipeX, pageStride)'));
  assert.ok(screen.includes('gap: WATCHLIST_PAGE_GAP'));
  assert.ok(screen.includes('const WATCHLIST_PAGE_GAP = 12'));
  assert.ok(screen.includes('direction === 1 ? -pageStride : pageStride'));
  assert.ok(screen.includes("swipeViewport: { overflow: 'hidden', borderRadius: 18 }"));
  assert.ok(screen.includes('useLayoutEffect(() =>'));
  assert.ok(screen.includes('nearbyLists.flatMap((list) => list?.symbols ?? [])'));
  assert.ok(!screen.includes('swipeX.setValue(-outgoingX'));
});

test('switching lists keeps period-specific data and shares fresh or pending requests', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'app', 'watchlist.tsx'), 'utf8');
  assert.ok(screen.includes('useRef(createRequestCache<WatchEntry>(10000))'));
  assert.ok(screen.includes('const key = `${selectedPeriod}|${symbol}`'));
  assert.ok(screen.includes('await watchRequests.current(key'));
  assert.ok(screen.includes('entry={watchData[`${selectedPeriod}|${asset.symbol}`] ?? emptyEntry()}'));
  assert.ok(!screen.includes('setWatchData({})'));
  assert.ok(screen.includes('quote: entry.quote ?? previous[key]?.quote ?? null'));
  assert.ok(screen.includes('history: entry.history ?? previous[key]?.history ?? null'));
});

test('watchlist order can be changed without mutating symbols or selection and survives storage', () => {
  const state = { selectedId: 'b', lists: [
    { id: 'a', name: 'A', symbols: ['AAPL'] },
    { id: 'b', name: 'B', symbols: ['MSFT'] },
    { id: 'c', name: 'C', symbols: [] },
  ] };
  const moved = movementExports.moveWatchlist(state, 'b', -1);
  assert.deepEqual(Array.from(moved.lists, (list) => list.id), ['b', 'a', 'c']);
  assert.equal(moved.selectedId, 'b');
  assert.deepEqual(state.lists.map((list) => list.id), ['a', 'b', 'c']);
  assert.equal(moved.lists[0].symbols, state.lists[1].symbols);
  const saved = movementExports.parseWatchlists(JSON.stringify(moved));
  assert.deepEqual(Array.from(saved.lists, (list) => list.id), ['b', 'a', 'c']);
  assert.deepEqual(Array.from(movementExports.moveWatchlist(moved, 'b', 1).lists, (list) => list.id), ['a', 'b', 'c']);
  assert.equal(movementExports.moveWatchlist(state, 'a', -1), state);
  assert.equal(movementExports.moveWatchlist(state, 'c', 1), state);
  assert.equal(movementExports.moveWatchlist(state, 'missing', 1), state);
});

test('period percent and absolute amounts share the same baseline and current quote', () => {
  const points = [
    { timestamp: 86400, price: 100 },
    { timestamp: 172800, price: 105 },
    { timestamp: 172860, price: 110 },
  ];
  const daily = movementExports.getWatchlistMovement(points, 120, true);
  assert.equal(daily.absolute, 10);
  assert.equal(daily.percent, 10);
  const monthly = movementExports.getWatchlistMovement(points, 120, false);
  assert.equal(monthly.absolute, 20);
  assert.equal(monthly.percent, 20);
  assert.equal(movementExports.getWatchlistMovement(points, 90, false).absolute, -10);
  assert.equal(movementExports.getWatchlistMovement(points, 100, false).absolute, 0);
  assert.equal(movementExports.getWatchlistMovement([], 100, true).absolute, null);
  assert.equal(movementExports.getWatchlistMovement([{ timestamp: 86400, price: 0 }], 100, false).absolute, null);
});

test('extended quote requests preserve the regular price and remain opt-in for other screens', async () => {
  const now = Math.floor(Date.now() / 1000);
  const requests = [];
  const result = {
    meta: {
      currency: 'EUR', regularMarketPrice: 100, previousClose: 95,
      currentTradingPeriod: { post: { start: now - 60, end: now + 60 } },
    },
    timestamp: [now - 10],
    indicators: { quote: [{ close: [102] }] },
  };
  const moduleExports = {};
  vm.runInNewContext(ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports: moduleExports, Date, URL, AbortController, setTimeout, clearTimeout,
    require: (id) => {
      if (id === 'react-native') return { Platform: { OS: 'android' } };
      if (id === './request-cache') return { createRequestCache: () => (_key, load) => load() };
      if (id === './portfolio') return { availableAssets: [], colors: { violet: '#000' } };
      if (id === './asset-discovery') return {};
      throw new Error(`Unexpected dependency: ${id}`);
    },
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({ chart: { result: [result] } }) };
    },
  });
  const extended = await moduleExports.fetchLiveQuote('TEST', true);
  assert.equal(extended.price, 100);
  assert.equal(extended.extendedMarket.change, 2);
  assert.ok(requests[0].includes('includePrePost=true'));
  const regular = await moduleExports.fetchLiveQuote('TEST');
  assert.equal(regular.price, 100);
  assert.equal(regular.extendedMarket, undefined);
  assert.ok(!requests[1].includes('includePrePost'));
  delete result.meta.regularMarketPrice;
  await assert.rejects(moduleExports.fetchLiveQuote('TEST', true), /aktuálna cena/);
});
