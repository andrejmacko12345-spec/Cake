const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function setup() {
  const frames = new Map();
  const selections = [];
  const refs = [];
  let refIndex = 0;
  let nextFrame = 0;
  let cleanup;
  const exports = {};
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'use-frame-selection.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.equal(name, 'react');
      return {
        useRef: (value) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
        useCallback: (callback) => callback,
        useEffect: (effect) => { if (!cleanup) cleanup = effect(); },
      };
    },
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const render = (callback = (index) => selections.push(index)) => {
    refIndex = 0;
    return exports.useFrameSelection(callback);
  };
  return {
    select: render(), render, selections,
    flush: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    unmount: () => cleanup(),
    get pending() { return frames.size; },
  };
}

test('a burst of 1000 move events commits only the latest point in one frame', () => {
  const app = setup();
  for (let i = 0; i < 1000; i++) app.select(i);
  assert.equal(app.pending, 1);
  assert.deepEqual(app.selections, []);
  app.flush();
  assert.deepEqual(app.selections, [999]);
});

test('fast direction reversals use the newest point, including returning to the selected point', () => {
  const app = setup();
  app.select(2);
  app.flush();
  app.select(8);
  app.select(4);
  app.select(2);
  app.flush();
  assert.deepEqual(app.selections, [2]);
  app.select(9);
  app.select(1);
  app.flush();
  assert.deepEqual(app.selections, [2, 1]);
  app.select(1);
  assert.equal(app.pending, 0);
});

test('release cancels queued movement immediately and allows selecting the same point next time', () => {
  const app = setup();
  app.select(3);
  app.flush();
  app.select(9);
  app.select(null);
  assert.equal(app.pending, 0);
  app.flush();
  assert.deepEqual(app.selections, [3, null]);
  app.select(3);
  app.flush();
  assert.deepEqual(app.selections, [3, null, 3]);
});

test('pending selection uses the latest callback and does not run after unmount', () => {
  const app = setup();
  const updates = [];
  app.select(4);
  app.render((index) => updates.push(index));
  app.flush();
  assert.deepEqual(updates, [4]);
  app.select(7);
  app.unmount();
  app.flush();
  assert.deepEqual(updates, [4]);
});

test('portfolio geometry is cached independently from touch selection', () => {
  const filename = path.resolve(__dirname, '..', 'app', 'index.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let geometry;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) &&
        node.name.elements.some((element) => element.name.getText(source) === 'areaPath')) geometry = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(geometry);
  assert.equal(geometry.expression.getText(source), 'useMemo');
  assert.equal(geometry.arguments[1].getText(source), '[history]');
  const { outputText } = ts.transpileModule(`const geometry = ${geometry.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  let previous;
  let cached;
  let computations = 0;
  const context = vm.createContext({
    history: [],
    useMemo: (factory, [history]) => {
      if (previous !== history) { computations++; previous = history; cached = factory(); }
      return cached;
    },
  });
  const calculate = () => vm.runInContext(`(()=>{${outputText}\nreturn geometry;})()`, context);
  assert.equal(calculate().path, '');
  context.history = [{ value: 100, date: '2026-01-01' }, { value: 110, date: '2026-01-02' }];
  const first = calculate();
  for (let i = 0; i < 100; i++) assert.equal(calculate(), first);
  assert.equal(computations, 2);
  assert.equal(first.points[0].x, 8);
  assert.equal(first.points[1].x, 304);
  assert.match(first.path, /^M 8 .+ L 304 /);
  assert.ok(first.points.every((point) => Number.isFinite(point.y)));
});
