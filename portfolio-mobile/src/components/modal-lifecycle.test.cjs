const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function parse(relative) {
  const file = path.resolve(__dirname, relative);
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}

function declaration(source, name) {
  const node = find(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node;
}

function conditionalComponent(source, name, condition) {
  const conditional = find(source, (node) =>
    ts.isConditionalExpression(node) && node.condition.getText(source) === condition);
  assert.ok(conditional, `${name} must only be mounted while open`);
  assert.equal(conditional.whenFalse.kind, ts.SyntaxKind.NullKeyword);
  const element = ts.isParenthesizedExpression(conditional.whenTrue)
    ? conditional.whenTrue.expression : conditional.whenTrue;
  assert.ok(ts.isJsxSelfClosingElement(element));
  assert.equal(element.tagName.getText(source), name);
}

test('transaction form is removed while hidden and forwards all purchase/edit props on every opening', () => {
  const source = parse('transaction-modal.tsx');
  const wrapper = declaration(source, 'TransactionModal');
  const { outputText } = ts.transpileModule(wrapper.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  });
  const exports = {};
  const TransactionForm = () => {};
  vm.runInNewContext(outputText, {
    exports,
    TransactionForm,
    React: { createElement: (type, props) => ({ type, props }) },
  });
  const props = { visible: false, initialType: 'SELL', transaction: { symbol: 'AAPL' }, onClose() {}, onSave() {} };
  for (let i = 0; i < 5; i++) {
    assert.equal(exports.TransactionModal(props), null);
    const openProps = { ...props, visible: true };
    const form = exports.TransactionModal(openProps);
    assert.equal(form.type, TransactionForm);
    assert.deepEqual(Object.keys(form.props), Object.keys(openProps));
    for (const key of Object.keys(openProps)) assert.equal(form.props[key], openProps[key]);
  }
});

test('watchlist picker starts with browseable categories and keeps duplicate assets disabled', () => {
  conditionalComponent(parse('../app/index.tsx'), 'StockSearchModal', 'searchVisible');
  const searchModal = declaration(parse('stock-search-modal.tsx'), 'StockSearchModal').getText();
  assert.match(searchModal, /<AssetDiscoveryList/);
  assert.match(searchModal, /categories=\{assetCategories\}/);
  assert.doesNotMatch(searchModal, /autoFocus/);
  const source = parse('../app/watchlist.tsx');
  conditionalComponent(source, 'WatchlistPicker', 'showPicker');
  const picker = declaration(source, 'WatchlistPicker');
  const text = picker.getText(source);
  assert.match(text, /usePopupAnimation\(true\)/);
  assert.match(text, /useState\(''\)/);
  assert.match(text, /useState<AssetCategory \| undefined>\(\)/);
  assert.match(searchModal, /useState<AssetCategory \| undefined>\(\)/);
  assert.match(text, /<AssetDiscoveryList/);
  assert.match(text, /categories=\{assetCategories\}/);
  assert.match(text, /selectedSymbols=\{symbols\}/);
  assert.match(text, /onSelect\(asset\.symbol\)/);
  assert.match(text, /onClose\(\)/);
  assert.doesNotMatch(source.getText(source).slice(0, picker.pos), /useModalInputFocus\(showPicker\)/);
});

test('transaction entrance uses the same JS sheet animation as the working search', () => {
  const form = declaration(parse('transaction-modal.tsx'), 'TransactionForm').getText();
  assert.match(form, /usePopupAnimation\(true\)/);
  assert.match(form, /animationType="none"/);
  assert.match(form, /onShow=\{\(\) => \{ focusSymbolInput\(\); focusSharesInput\(\); \}\}/);
  assert.match(form, /useModalInputFocus\(visible, !fixedSymbol\)/);
  assert.match(form, /useModalInputFocus\(visible, fixedSymbol && !isEditing\)/);
  assert.match(form, /setShowAssetResults\(false\)/);
  assert.doesNotMatch(form, /AssetDiscoveryList/);
  assert.match(form, /ref=\{sharesInputRef\}/);
  assert.match(form, /animation\.close\(onClosed\)/);
});

test('position edit and add overlay the visible history and retain it on save, cancel or back', () => {
  const source = parse('../app/position.tsx');
  const handler = (name) => {
    const node = find(source, (node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
    assert.ok(node?.initializer, name);
    return node.initializer.getText(source);
  };
  const historyModal = find(source, (node) => ts.isJsxOpeningElement(node)
    && node.tagName.getText(source) === 'Modal'
    && node.attributes.properties.some((attribute) => attribute.name?.getText(source) === 'visible'
      && attribute.initializer?.getText(source).includes('movementsOpen')));
  assert.ok(historyModal);
  const visible = historyModal.attributes.properties.find((attribute) => attribute.name?.getText(source) === 'visible')
    .initializer.expression.getText(source);
  assert.equal(visible, 'movementsOpen');
  const form = find(source, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'TransactionModal');
  let parent = form.parent;
  while (parent && !(ts.isJsxElement(parent) && parent.openingElement === historyModal)) parent = parent.parent;
  assert.ok(parent, 'editor must be presented inside the history modal, not over the stock detail');
  const close = form.attributes.properties.find((attribute) => attribute.name?.getText(source) === 'onClose')
    .initializer.expression.getText(source);
  const compile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const action of ['editTransaction', 'addTransaction']) {
    const state = { movementsOpen: true, formVisible: false, editing: undefined, type: undefined };
    const context = {
      setMovementsOpen: (value) => { state.movementsOpen = value; },
      setFormVisible: (value) => { state.formVisible = value; },
      setEditingTransaction: (value) => { state.editing = value; },
      setInitialType: (value) => { state.type = value; },
      selectionHaptic: () => {},
    };
    const open = vm.runInNewContext(compile(`(${handler(action)})`), context);
    const onClose = vm.runInNewContext(compile(`(${close})`), context);
    for (const outcome of ['save', 'cancel', 'android-back']) {
      open(action === 'editTransaction' ? { id: 'trade-1', symbol: 'AAPL' } : 'BUY');
      assert.equal(state.formVisible, true, outcome);
      assert.equal(state.movementsOpen, true, 'history context must remain open');
      assert.equal(vm.runInNewContext(visible, state), true, 'history must remain visible behind the editor');
      onClose();
      assert.equal(state.formVisible, false);
      assert.equal(vm.runInNewContext(visible, state), true, `history returns after ${outcome}`);
    }
  }
});
