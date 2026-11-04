const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const platform = { OS: 'android' };
const calls = [];
let failure = null;
const feedback = (type) => {
  calls.push(type);
  return failure ? Promise.reject(failure) : Promise.resolve();
};
const originalLoad = Module._load;
let useChartHaptics;
let selectionHaptic;
try {
  Module._load = function (id, ...args) {
    if (id === 'react') return { useRef: (value) => ({ current: value }), useCallback: (callback) => callback };
    if (id === 'react-native') return { Platform: platform };
    if (id === 'expo-haptics') return {
      AndroidHaptics: { Segment_Frequent_Tick: 'tick', Keyboard_Tap: 'tap' },
      performAndroidHapticsAsync: (type) => feedback(type),
      selectionAsync: () => feedback('selection'),
    };
    return originalLoad.call(this, id, ...args);
  };
  ({ useChartHaptics } = require('./use-chart-haptics.ts'));
  ({ selectionHaptic } = require('../data/haptics.ts'));
} finally {
  Module._load = originalLoad;
}

test('chart feedback deduplicates selected points, limits pulse frequency and resets after touch end', (context) => {
  platform.OS = 'android';
  calls.length = 0;
  let now = 100;
  context.mock.method(Date, 'now', () => now);
  const select = useChartHaptics();
  select(0);
  select(0);
  now += 20;
  select(1);
  now += 20;
  select(2);
  assert.deepEqual(calls, ['tick', 'tick']);
  now += 100;
  select(2);
  assert.equal(calls.length, 2);
  select(null);
  select(2);
  assert.equal(calls.length, 3);
  select(-1);
  select(NaN);
  select(1.5);
  assert.equal(calls.length, 3);
});

test('iOS uses selection feedback, web does not vibrate and each chart tracks its own gesture', () => {
  calls.length = 0;
  platform.OS = 'ios';
  useChartHaptics()(4);
  useChartHaptics()(4);
  assert.deepEqual(calls, ['selection', 'selection']);
  platform.OS = 'web';
  const select = useChartHaptics();
  select(0);
  select(1);
  assert.equal(calls.length, 2);
});

test('unavailable device feedback is reported without interrupting chart selection', async (context) => {
  platform.OS = 'android';
  failure = new Error('Device feedback unavailable');
  const warnings = [];
  context.mock.method(console, 'warn', (...args) => warnings.push(args));
  try {
    assert.doesNotThrow(() => useChartHaptics()(0));
    await Promise.resolve();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1], failure);
  } finally {
    failure = null;
  }
});

test('sort taps give one native selection pulse per tap and do not vibrate on web', () => {
  calls.length = 0;
  platform.OS = 'android';
  selectionHaptic();
  selectionHaptic();
  assert.deepEqual(calls, ['tap', 'tap']);
  platform.OS = 'ios';
  selectionHaptic();
  assert.deepEqual(calls, ['tap', 'tap', 'selection']);
  platform.OS = 'web';
  selectionHaptic();
  assert.equal(calls.length, 3);
});
