const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function setup(platform = 'android') {
  const refs = [];
  const frames = new Map();
  let refIndex = 0;
  let frameId = 0;
  let cleanup;
  let previousDeps;
  let focusCount = 0;
  let focused = false;
  let keyboardVisible = false;
  let keyboardOpenCount = 0;
  let ignoreFocusRequests = 0;
  const keyboardListeners = new Set();
  const input = {
    isFocused: () => focused,
    focus: () => {
      focusCount++;
      if (focused) return;
      focused = true;
      if (ignoreFocusRequests > 0) {
        ignoreFocusRequests--;
        return;
      }
      keyboardVisible = true;
      keyboardOpenCount++;
      keyboardListeners.forEach((listener) => listener());
    },
    blur: () => {
      focused = false;
      keyboardVisible = false;
    },
  };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, 'use-modal-input-focus.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (id) => {
      if (id === 'react-native') {
        return {
          Platform: { OS: platform },
          Keyboard: {
            isVisible: () => keyboardVisible,
            addListener: (_event, listener) => {
              keyboardListeners.add(listener);
              return { remove: () => keyboardListeners.delete(listener) };
            },
          },
        };
      }
      assert.equal(id, 'react');
      return {
        useRef: (initial) => {
          const index = refIndex++;
          return refs[index] ?? (refs[index] = { current: initial });
        },
        useCallback: (callback) => callback,
        useEffect: (effect, deps) => {
          // The hook's cancelFocus callback has stable identity in React.
          const values = deps.slice(0, 2);
          if (!previousDeps || values.some((value, index) => value !== previousDeps[index])) {
            cleanup?.();
            cleanup = effect();
            previousDeps = values;
          }
        },
      };
    },
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    clearTimeout: (id) => frames.delete(id),
  });
  return {
    render: (visible, enabled = true) => {
      refIndex = 0;
      const hook = exports.useModalInputFocus(visible, enabled);
      hook.inputRef.current = input;
      return hook;
    },
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    unmount: () => cleanup?.(),
    dismissKeyboard: () => { keyboardVisible = false; },
    ignoreNextFocusRequests: (count) => { ignoreFocusRequests = count; },
    get listenerCount() { return keyboardListeners.size; },
    get focusCount() { return focusCount; },
    get keyboardVisible() { return keyboardVisible; },
    get keyboardOpenCount() { return keyboardOpenCount; },
    get pendingCount() { return frames.size; },
  };
}

test('focus waits for the modal onShow and the next frame', () => {
  const app = setup();
  const modal = app.render(true);
  app.flush();
  assert.equal(app.focusCount, 0);
  modal.onShow();
  assert.equal(app.focusCount, 0);
  app.flush();
  assert.equal(app.focusCount, 1);
});

test('reopening a mounted modal focuses again without duplicate requests', () => {
  const app = setup();
  app.render(true).onShow();
  app.flush();
  app.render(false);
  const reopened = app.render(true);
  reopened.onShow();
  reopened.onShow();
  assert.equal(app.pendingCount, 1);
  app.flush();
  assert.equal(app.focusCount, 2);
});

test('hidden modals and fixed-symbol transactions do not request focus', () => {
  const app = setup();
  app.render(false).onShow();
  app.render(true, false).onShow();
  app.flush();
  assert.equal(app.focusCount, 0);
});

test('closing, disabling or unmounting cancels pending focus', () => {
  for (const action of ['close', 'disable', 'unmount']) {
    const app = setup();
    app.render(true).onShow();
    if (action === 'close') app.render(false);
    if (action === 'disable') app.render(true, false);
    if (action === 'unmount') app.unmount();
    app.flush();
    assert.equal(app.focusCount, 0, action);
    assert.equal(app.pendingCount, 0, action);
  }
});

test('Android reopens the keyboard even when the input retains focus', () => {
  const app = setup();
  const modal = app.render(true);
  for (let i = 0; i < 5; i++) {
    modal.onShow();
    app.flush();
    assert.equal(app.keyboardVisible, true);
    app.dismissKeyboard();
  }
  assert.equal(app.keyboardOpenCount, 5);
});

test('closing a mounted modal releases focus before the next opening', () => {
  const app = setup();
  for (let i = 0; i < 5; i++) {
    app.render(true).onShow();
    app.flush();
    assert.equal(app.keyboardVisible, true);
    app.render(false);
    assert.equal(app.keyboardVisible, false);
  }
  assert.equal(app.keyboardOpenCount, 5);
});

test('Android retries until the keyboard actually appears, then stops', () => {
  const app = setup();
  app.ignoreNextFocusRequests(2);
  app.render(true).onShow();
  app.flush();
  assert.equal(app.keyboardVisible, false);
  assert.equal(app.pendingCount, 1);
  app.flush();
  assert.equal(app.keyboardVisible, false);
  app.flush();
  assert.equal(app.keyboardVisible, true);
  assert.equal(app.focusCount, 3);
  assert.equal(app.pendingCount, 0);
  assert.equal(app.listenerCount, 0);
});

test('retries stop once the keyboard is shown and never exceed the limit', () => {
  const shown = setup();
  shown.render(true).onShow();
  shown.flush();
  assert.equal(shown.keyboardVisible, true);
  assert.equal(shown.pendingCount, 0);

  const stuck = setup();
  stuck.ignoreNextFocusRequests(10);
  stuck.render(true).onShow();
  for (let i = 0; i < 8; i++) stuck.flush();
  assert.equal(stuck.focusCount, 5);
  assert.equal(stuck.pendingCount, 0);
  assert.equal(stuck.listenerCount, 0);
});

test('web onShow preserves existing autofocus without dismissing the keyboard', () => {
  const app = setup('web');
  const modal = app.render(true);
  modal.inputRef.current.focus();
  modal.onShow();
  assert.equal(app.keyboardVisible, true);
  app.flush();
  assert.equal(app.keyboardOpenCount, 1);
});
