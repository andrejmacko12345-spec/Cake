const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('Analyse mounts both panels and supports button and swipe selection without replacing panel state', () => {
  const originalLoad = Module._load;
  const originalTsx = require.extensions['.tsx'];
  const originalState = React.useState;
  const originalRef = React.useRef;
  const buttons = [];
  const panels = [];
  const changes = [];
  const scrolls = [];
  const progressValues = [];
  let haptics = 0;
  let scroll;
  let stateIndex = 0;
  let refIndex = 0;
  const wrap = ({ children }) => React.createElement('div', null, children);
  try {
    React.useState = (initial) => {
      const index = stateIndex++;
      return [initial, (value) => changes.push([index, value])];
    };
    React.useRef = (initial) => {
      const index = refIndex++;
      return { current: index === 2 ? { scrollTo: (options) => scrolls.push(options) } : initial };
    };
    require.extensions['.tsx'] = (module, filename) => {
      module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText, filename);
    };
    Module._load = function (id, ...args) {
      if (id === 'react-native') return {
        Animated: { View: wrap, Value: class {
          setValue(value) { progressValues.push(value); }
          interpolate(config) {
            assert.deepEqual(config.outputRange, [0, 112]);
            return 0;
          }
        } },
        View: (props) => {
          if (typeof props.accessibilityElementsHidden === 'boolean') panels.push(props);
          return wrap(props);
        },
        Text: wrap,
        Pressable: (props) => { buttons.push(props); return wrap(props); },
        ScrollView: (props) => { scroll = props; return wrap(props); },
        StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ width: 360 }),
      };
      if (id === 'react-native-safe-area-context') return { SafeAreaView: wrap };
      if (id === 'expo-router') return { useLocalSearchParams: () => ({}) };
      if (id === '../components/stock-compare') return { __esModule: true, default: () => React.createElement('div', null, 'compare-panel') };
      if (id === '../components/stock-projections') return { __esModule: true, default: ({ embedded }) => {
        assert.equal(embedded, true);
        return React.createElement('div', null, 'projection-panel');
      } };
      if (id === '../context/locale') return { useLocale: () => ({ t: (key) => key }) };
      if (id === '../data/theme') return { useThemedStyles: (factory) => factory() };
      if (id === '../data/portfolio') return { colors: {} };
      if (id === '../data/haptics') return { selectionHaptic: () => { haptics++; } };
      return originalLoad.call(this, id, ...args);
    };
    const Screen = require('../app/compare.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Screen));
    assert.match(html, /compare-panel/);
    assert.match(html, /projection-panel/);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].accessibilityLabel, 'Projekcie');
    assert.equal(buttons[0].accessibilityState.selected, true);
    assert.equal(buttons[1].accessibilityLabel, 'Porovnanie');
    assert.ok(html.indexOf('projection-panel') < html.indexOf('compare-panel'));
    assert.deepEqual(panels.map((panel) => panel.style), [
      { width: 360, height: '100%' },
      { width: 360, height: '100%' },
    ]);
    assert.deepEqual(scroll.contentOffset, { x: 0, y: 0 });
    assert.equal(scroll.horizontal, true);
    assert.equal(scroll.pagingEnabled, true);
    buttons[1].onPress();
    assert.deepEqual(scrolls.pop(), { x: 360, animated: true });
    assert.deepEqual(changes.pop(), [1, 1]);
    assert.equal(haptics, 1);
    scroll.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 360 } } });
    assert.equal(haptics, 1, 'button animation must not vibrate twice');
    scroll.onScroll({ nativeEvent: { contentOffset: { x: 180 } } });
    assert.equal(progressValues.at(-1), 0.5, 'highlight follows fractional swipe position');
    scroll.onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
    assert.deepEqual(changes.pop(), [1, 0]);
    scroll.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } });
    assert.equal(haptics, 2, 'completed swipe vibrates once');
    scroll.onScroll({ nativeEvent: { contentOffset: { x: 360 } } });
    assert.deepEqual(changes.pop(), [1, 1]);
    buttons[0].onPress();
    assert.deepEqual(scrolls.pop(), { x: 0, animated: true });
    assert.deepEqual(changes.pop(), [1, 0]);
  } finally {
    React.useState = originalState;
    React.useRef = originalRef;
    Module._load = originalLoad;
    if (originalTsx) require.extensions['.tsx'] = originalTsx;
    else delete require.extensions['.tsx'];
  }
});
