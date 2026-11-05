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
const platform = { OS: 'web' };
const stored = new Map();
const storageWrites = [];
let storageFailure = null;
let memo = null;
let subscriber = null;
let changes = 0;
const originalLoad = Module._load;
let theme;
try {
  Module._load = function (id, ...args) {
    if (id === 'react-native') return { Platform: platform };
    if (id === 'react') return {
      useSyncExternalStore: (subscribe, snapshot) => {
        if (!subscriber) subscriber = subscribe(() => { changes++; });
        return snapshot();
      },
      useMemo: (factory, deps) => {
        if (!memo || deps.some((value, index) => memo.deps[index] !== value)) memo = { deps, value: factory() };
        return memo.value;
      },
    };
    if (id === './app-storage') return { appStorage: {
      setItem: async (key, value) => {
        if (storageFailure) throw storageFailure;
        storageWrites.push([key, value]);
      },
    } };
    return originalLoad.call(this, id, ...args);
  };
  theme = require('./theme.ts');
} finally {
  Module._load = originalLoad;
}
const { colors } = require('./portfolio.ts');
const dark = { ...colors };

function contrast(a, b) {
  const luminance = (hex) => {
    const values = hex.slice(1).match(/../g).map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('switching theme updates subscribed styles immediately without replacing component state', () => {
  let factoryCalls = 0;
  const createStyles = () => { factoryCalls++; return { card: { backgroundColor: colors.surface, color: colors.text } }; };
  const first = theme.useThemedStyles(createStyles);
  assert.equal(first.card.backgroundColor, dark.surface);
  theme.applyTheme('light');
  assert.equal(changes, 1);
  const second = theme.useThemedStyles(createStyles);
  assert.notStrictEqual(second, first);
  assert.equal(second.card.backgroundColor, '#fff7e6');
  assert.equal(colors.background, '#fff0d6');
  assert.equal(colors.text, '#402c23');
  assert.strictEqual(theme.useThemedStyles(createStyles), second);
  assert.equal(factoryCalls, 2);
  theme.applyTheme('light');
  assert.equal(changes, 1);
  for (const background of [colors.background, colors.surface, colors.surfaceRaised]) {
    for (const foreground of [colors.text, colors.muted, colors.green, colors.red, colors.cyan, colors.blue, colors.violet]) {
      assert.ok(contrast(background, foreground) >= 4.5, `${foreground} on ${background}`);
    }
    assert.notEqual(background, '#ffffff');
  }
  theme.applyTheme('dark');
  assert.deepEqual(colors, dark);
  assert.equal(changes, 2);
  subscriber();
});

test('theme preference persists locally before application; failures are explicit', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } });
  try {
    await theme.storeTheme('light');
    assert.equal(theme.getTheme(), 'light');
    assert.equal(theme.readStoredTheme(), 'light');
    assert.deepEqual(storageWrites, [['@portfolio-mobile/theme', 'light']]);
    storageFailure = new Error('Storage write failed');
    await assert.rejects(() => theme.storeTheme('dark'), /Storage write failed/);
    assert.equal(theme.getTheme(), 'light');
    storageFailure = null;
    await theme.storeTheme('dark');
    assert.equal(theme.getTheme(), 'dark');
    assert.equal(storageWrites.length, 2);
    assert.equal(stored.get('theme.txt'), 'dark');
  } finally {
    storageFailure = null;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('native theme storage applies immediately and file failures do not report success', async () => {
  platform.OS = 'android';
  let writeFailure = null;
  const load = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'expo-file-system') return {
      Paths: { document: 'document' },
      File: class {
        exists = true;
        textSync() { return stored.get('theme.txt') ?? 'dark'; }
        writeSync(value) {
          if (writeFailure) throw writeFailure;
          stored.set('theme.txt', value);
        }
      },
    };
    return load.call(this, id, ...args);
  };
  try {
    await theme.storeTheme('light');
    assert.equal(theme.getTheme(), 'light');
    assert.equal(theme.readStoredTheme(), 'light');
    writeFailure = new Error('Native file write failed');
    await assert.rejects(() => theme.storeTheme('dark'), /Native file write failed/);
    assert.equal(theme.getTheme(), 'light');
    writeFailure = null;
    await theme.storeTheme('dark');
    assert.equal(theme.getTheme(), 'dark');
  } finally {
    Module._load = load;
    platform.OS = 'web';
  }
});
