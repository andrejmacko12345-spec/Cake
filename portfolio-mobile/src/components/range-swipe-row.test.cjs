const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function setup() {
  const source = fs.readFileSync(path.join(__dirname, 'range-swipe-row.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const timers = new Map();
  let timerId = 0;
  let haptics = 0;
  const refs = [];
  const states = [];
  let refIndex = 0;
  let stateIndex = 0;
  let tree;
  const animated = () => ({ value: 0, setValue(value) { this.value = value; } });
  const element = (type, props) => ({ type, props: props ?? {} });
  const module = { exports: {} };
  const stub = (id) => {
    if (id === 'react') return {
      useRef: (initial) => {
        const index = refIndex++;
        return refs[index] ?? (refs[index] = { current: initial });
      },
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (next) => { states[index] = next; }];
      },
      useMemo: (factory) => {
        const index = refIndex++;
        if (!refs[index]) refs[index] = { current: factory() };
        return refs[index].current;
      },
      useEffect: () => {},
    };
    if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (id === 'react-native') return {
      Animated: { Value: function Value() { return animated(); }, View: 'AnimatedView', parallel: () => ({ start() {} }), spring: () => ({}) },
      PanResponder: { create: (config) => ({ panHandlers: config }) },
      Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value) => value },
    };
    if (id === '../data/haptics') return { selectionHaptic: () => { haptics++; } };
    throw new Error(id);
  };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', outputText)(stub, module, module.exports,
    (callback) => { timers.set(++timerId, callback); return timerId; }, (id) => timers.delete(id));
  const changes = [];
  const props = { labels: ['1D', '1M', '1Y'], selected: '1D', onChange: (label) => changes.push(label),
    textStyle: 'text', selectedTextStyle: 'selected' };
  const render = () => {
    refIndex = 0;
    stateIndex = 0;
    tree = module.exports.RangeSwipeRow(props);
    return tree;
  };
  render();
  const buttons = tree.props.children[1];
  [0, 40, 80].forEach((x, index) => buttons[index].props.onLayout({ nativeEvent: { layout: { x, y: 0, width: 30, height: 20 } } }));
  return {
    exports: module.exports, changes, render, props,
    handlers: () => render().props,
    runTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); },
    get haptics() { return haptics; },
  };
}

test('picks the button whose centre is nearest to the finger', () => {
  const { nearestRangeIndex } = setup().exports;
  const slots = [{ x: 0, width: 30 }, { x: 40, width: 30 }, { x: 80, width: 40 }];
  assert.equal(nearestRangeIndex(slots, -20), 0);
  assert.equal(nearestRangeIndex(slots, 52), 1);
  assert.equal(nearestRangeIndex(slots, 500), 2);
  assert.equal(nearestRangeIndex([undefined, { x: 10, width: 10 }], 0), 1);
  assert.equal(nearestRangeIndex([], 0), -1);
});

test('dragging only previews ranges and commits once on release', () => {
  const app = setup();
  const row = app.handlers();
  assert.equal(row.onMoveShouldSetPanResponderCapture({}, { dx: 2, dy: 20 }), false);
  assert.equal(row.onMoveShouldSetPanResponderCapture({}, { dx: 20, dy: 3 }), true);
  row.onPanResponderGrant({ nativeEvent: { pageX: 115, locationX: 15 } });
  row.onPanResponderMove({ nativeEvent: { pageX: 155 } });
  row.onPanResponderMove({ nativeEvent: { pageX: 195 } });
  assert.deepEqual(app.changes, []);
  assert.equal(app.haptics, 2);
  const preview = app.render().props.children[1][2].props.children;
  assert.equal(preview.props.style[1], 'selected');
  row.onPanResponderRelease();
  assert.deepEqual(app.changes, ['1Y']);
  app.runTimers();
  assert.deepEqual(app.changes, ['1Y']);
});

test('resting on a range commits it before release without loading every passed range', () => {
  const app = setup();
  const row = app.handlers();
  row.onPanResponderGrant({ nativeEvent: { pageX: 115, locationX: 15 } });
  row.onPanResponderMove({ nativeEvent: { pageX: 155 } });
  row.onPanResponderMove({ nativeEvent: { pageX: 195 } });
  app.runTimers();
  assert.deepEqual(app.changes, ['1Y']);
});
