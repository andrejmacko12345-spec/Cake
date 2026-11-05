const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};
const { translateText, translateError, localizedError } = require('./translations.ts');
const root = path.resolve(__dirname, '..');
const parse = (file) => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const visit = (node, callback) => { callback(node); ts.forEachChild(node, (child) => visit(child, callback)); };
const locale = parse(path.join(root, 'context', 'locale.tsx'));
const translations = {};
const duplicateKeys = [];
visit(locale, (node) => {
  if (!ts.isVariableDeclaration(node) || node.name.getText(locale) !== 'englishTranslations') return;
  for (const property of node.initializer.properties) {
    const key = property.name.text;
    if (Object.hasOwn(translations, key)) duplicateKeys.push(key);
    translations[key] = property.initializer.text;
  }
});

function screens(directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? screens(file) : file.endsWith('.tsx') ? [file] : [];
  });
}

test('translation dictionary is complete, unique and English values contain no Slovak diacritics', () => {
  assert.deepEqual(duplicateKeys, []);
  assert.ok(Object.keys(translations).length > 400);
  for (const [key, value] of Object.entries(translations)) {
    assert.ok(key.trim() && typeof value === 'string' && value.trim(), key);
    assert.doesNotMatch(value, /[čďľňôŕšťž]/i, key);
    assert.equal(translateText(key, 'en', translations), value);
    assert.equal(translateText(key, 'sk', translations), key);
  }
});

test('every literal translation key has an English entry or is an explicit financial invariant', () => {
  const invariants = new Set(['S&P 500']);
  const missing = [];
  for (const file of screens()) visit(parse(file), (node) => {
    if (ts.isCallExpression(node) && (node.expression.getText() === 't' ||
        ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't') &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const key = node.arguments[0].text;
      if (!Object.hasOwn(translations, key) && !invariants.has(key)) missing.push(`${path.relative(root, file)}: ${key}`);
    }
  });
  assert.deepEqual(missing, []);
});

test('all screens use translated JSX text rather than hardcoded prose', () => {
  const invariants = new Set(['Fincake', 'EPS']);
  const hardcoded = [];
  for (const file of screens()) visit(parse(file), (node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim().replace(/\s+/g, ' ');
      if (/[A-Za-z\u00c0-\u017e]{2}/.test(text) && !invariants.has(text)) {
        hardcoded.push(`${path.relative(root, file)}: ${text}`);
      }
    }
  });
  assert.deepEqual(hardcoded, []);
});

test('navigation titles and accessibility labels are translated', () => {
  const untranslated = [];
  visit(parse(path.join(root, 'app', '_layout.tsx')), (node) => {
    if (ts.isPropertyAssignment(node) && ['title', 'tabBarAccessibilityLabel'].includes(node.name.getText()) &&
        ts.isStringLiteral(node.initializer)) untranslated.push(node.initializer.text);
  });
  assert.deepEqual(untranslated, []);
});

test('legacy route data is translated too, while proper names stay unchanged', () => {
  const invariants = new Set(['Email', 'GitHub']);
  const fields = new Set(['title', 'text', 'summary', 'description', 'period', 'label']);
  for (const name of ['about', 'contact', 'experience', 'projects']) {
    visit(parse(path.join(root, 'app', `${name}.tsx`)), (node) => {
      if (ts.isPropertyAssignment(node) && fields.has(node.name.getText()) &&
          ts.isStringLiteral(node.initializer) && /[A-Za-z\u00c0-\u017e]/.test(node.initializer.text)) {
        const key = node.initializer.text;
        assert.ok(Object.hasOwn(translations, key) || invariants.has(key), `${name}: ${key}`);
      }
    });
  }
  assert.equal(translateText('AAPL', 'sk', translations), 'AAPL');
  assert.equal(translateText('Apple Inc.', 'en', translations), 'Apple Inc.');
});

test('financial and history labels select one language without bilingual fallbacks', () => {
  for (const [sk, en] of [
    ['Čisté vklady', 'Net deposits'],
    ['Výhľad', 'Forecast'],
    ['Sledované', 'Watchlist'],
    ['Nerealizovaný výsledok', 'Unrealized result'],
  ]) {
    assert.equal(translateText(sk, 'sk', translations), sk);
    assert.equal(translateText(sk, 'en', translations), en);
    assert.equal(translateText(en, 'sk', translations), sk);
  }
  assert.equal(fs.existsSync(path.join(root, 'context', 'account.tsx')), false);
});

test('validation messages survive language changes and preserve actionable CSV and ledger details', () => {
  const validation = 'Zadaj počet akcií väčší ako nula.';
  const english = translateText(validation, 'en', translations);
  assert.equal(translateError(english, 'sk', translations), validation);
  assert.equal(translateError(validation, 'en', translations), english);
  assert.equal(localizedError('Riadok 7: neplatný dátum „2026-99-01“.', 'en'), 'Row 7: invalid date „2026-99-01“.');
  assert.equal(localizedError('Riadok 3: nepodporovaná mena „GBP“.', 'en'), 'Row 3: unsupported currency „GBP“.');
  const oversell = 'Predaj AAPL z 2026-01-02 je vyšší než počet akcií, ktoré boli k tomuto dátumu nakúpené.';
  assert.equal(localizedError(oversell, 'sk'), oversell);
  assert.equal(localizedError(oversell, 'en'), 'The sale of AAPL on 2026-01-02 exceeds the shares held on that date.');
  assert.equal(localizedError('Chýba história MSFT.', 'en'), 'Missing history for MSFT.');
  assert.equal(localizedError('Zdroj cien vrátil HTTP 429.', 'en'), 'The data source returned HTTP 429.');
});

test('network and unknown provider errors never leak the other language', () => {
  assert.match(localizedError('HTTP 429', 'sk'), /HTTP 429/);
  assert.match(localizedError('Request rate limit exceeded', 'sk'), /Príliš veľa pokusov/);
  assert.match(localizedError('Unknown provider exception', 'sk'), /^Operácia zlyhala/);
  assert.match(localizedError('Neznáma chyba poskytovateľa', 'en'), /^The operation failed/);
  assert.equal(translateText('toString', 'en', translations), 'toString');
});
