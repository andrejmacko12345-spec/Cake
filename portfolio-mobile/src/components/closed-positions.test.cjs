const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

test('comparison search overlays metric rows below the measured header', () => {
  const text = fs.readFileSync(path.join(__dirname, 'stock-compare.tsx'), 'utf8');
  assert.match(text, /inlineSearch: \{ position: 'absolute', left: 0, zIndex: 10, backgroundColor: colors.surface/);
  assert.ok(text.includes('top: tableHeaderHeight'));
  assert.ok(text.includes('if (!showSearch && !Keyboard.isVisible()) setViewportHeight(height)'));
  assert.ok(text.includes('if (showSearch) Keyboard.dismiss()'));
});

test('projection dropdown enables nested Android scrolling inside the page', () => {
  const text = fs.readFileSync(path.join(__dirname, 'stock-projections.tsx'), 'utf8');
  const source = ts.createSourceFile('stock-projections.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let menu;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'ScrollView'
      && node.attributes.getText(source).includes('styles.menuList')) menu = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(menu);
  assert.ok(menu.attributes.properties.some((prop) => prop.name?.getText(source) === 'nestedScrollEnabled'));
  assert.match(text, /menuList: \{ maxHeight: 260 \}/);
  assert.match(text, /dropdownOverlay: \{ position: 'absolute', left: 0, right: 0, zIndex: 10 \}/);
  assert.ok(text.includes('setDropdownTop(y + height)'));
});

test('all requested dropdowns share the same animation component', () => {
  for (const [file, binding] of [
    ['..\\app\\index.tsx', 'closedExpanded'],
    ['..\\app\\position.tsx', 'resultsExpanded'],
    ['..\\app\\events.tsx', 'expanded'],
    ['market-overview.tsx', 'expanded'],
    ['stock-projections.tsx', 'portfolioOpen || watchlistsOpen'],
  ]) {
    const text = fs.readFileSync(path.join(__dirname, ...file.split('\\')), 'utf8');
    assert.ok(text.includes(`<AnimatedCollapse expanded={${binding}}>`), file);
    assert.ok(text.includes('selectionHaptic();'), file);
  }
});

test('closed positions trigger selection haptics on opening and closing', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.tsx'), 'utf8');
  const source = ts.createSourceFile('index.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.getText(source).includes('expanded: closedExpanded')) {
      handler = node.attributes.properties.find((prop) => prop.name?.getText(source) === 'onPress').initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler);
  let expanded = false;
  let haptics = 0;
  const toggle = vm.runInNewContext(ts.transpileModule(`(${handler.getText(source)})`, {}).outputText, {
    selectionHaptic: () => { haptics++; },
    setClosedExpanded: (update) => { expanded = update(expanded); },
  });
  toggle();
  assert.equal(expanded, true);
  assert.equal(haptics, 1);
  toggle();
  assert.equal(expanded, false);
  assert.equal(haptics, 2);
});

test('closed positions animate height and opacity in both directions with reduced-motion support', () => {
  const text = fs.readFileSync(path.join(__dirname, 'animated-collapse.tsx'), 'utf8');
  const source = ts.createSourceFile('index.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('Animated.timing(progress')) {
      effect = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  for (const reduceMotion of [false, true]) {
    for (const closedExpanded of [true, false]) {
      let config;
      let started = false;
      let stopped = false;
      const easing = (value) => value;
      const run = vm.runInNewContext(ts.transpileModule(`(${effect.getText(source)})`, {}).outputText, {
        reduceMotion, expanded: closedExpanded, progress: {},
        Easing: { cubic: easing, inOut: (curve) => {
          assert.equal(curve, easing);
          return easing;
        } },
        Animated: { timing: (_, options) => {
          config = options;
          return { start: () => { started = true; }, stop: () => { stopped = true; } };
        } },
      });
      const cleanup = run();
      assert.equal(config.toValue, closedExpanded ? 1 : 0);
      assert.equal(config.duration, reduceMotion ? 0 : closedExpanded ? 360 : 300);
      assert.equal(config.easing, easing);
      assert.equal(config.isInteraction, false);
      assert.equal(config.useNativeDriver, false);
      assert.equal(started, true);
      cleanup();
      assert.equal(stopped, true);
    }
  }
  assert.ok(text.includes('outputRange: [0, height]'));
  assert.ok(text.includes('opacity: progress'));
  assert.ok(text.includes("importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}"));
});
