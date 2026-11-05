const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { captureFeatures, enableCaptureTransport, escapeHtml, publicSourceUrl, artwork, COPY } = require('./capture-store-screenshots.cjs');

test('capture can select valid features without modifying the remaining screenshots', () => {
  assert.deepEqual([...captureFeatures('projections,compare')], ['projections', 'compare']);
  assert.equal(captureFeatures().size, 6);
  assert.throws(() => captureFeatures('projections,unknown'), /Invalid capture feature/);
});

test('capture transport changes only the three known browser quote guards and fails closed', () => {
  const messages = [
    'Historické kotácie nie sú dostupné v prehliadači. Otvor aplikáciu v Expo Go na mobile.',
    'Historické ceny nie sú dostupné v prehliadači. Otvor aplikáciu v Expo Go na mobile.',
    'Webový prehliadač blokuje priame kotácie. Live ceny načítaj v mobilnej aplikácii Expo Go.',
  ];
  const guards = messages.map((message) => `if (Platform.default.OS === 'web') { throw new Error('${message}'); }`).join('\n');
  const unrelated = "if (Platform.default.OS === 'web') { keepExistingBehavior(); }";
  assert.equal(enableCaptureTransport(`${guards}\n${unrelated}`).trim(), unrelated);
  assert.throws(() => enableCaptureTransport('changed bundle'), /Quote transport changed/);
});

test('both localizations cover the same six features in the same order', () => {
  assert.deepEqual(COPY.sk.map(([feature]) => feature), [
    'portfolio', 'events', 'watchlist', 'projections', 'compare', 'forecast',
  ]);
  assert.deepEqual(COPY.en.map(([feature]) => feature), COPY.sk.map(([feature]) => feature));
  assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.ok(artwork('en', 3, Buffer.from('png')).includes('Hypothetical scenario, not a guaranteed return.'));
});

test('public provenance never includes the Yahoo session crumb', () => {
  const url = publicSourceUrl('https://query2.finance.yahoo.com/test?modules=price&crumb=private-token');
  assert.equal(url, 'https://query2.finance.yahoo.com/test?modules=price');
});

test('all localized artwork omits visible screenshot numbering', () => {
  for (const language of ['sk', 'en']) {
    COPY[language].forEach((_, index) => {
      const html = artwork(language, index, Buffer.from('png'));
      assert.doesNotMatch(html, /class="count"|\.count\s*\{|0[1-6]\s*\/\s*06/);
    });
  }
});

test('delivered assets include twelve portrait PNGs at exactly 1080 x 1920', () => {
  const directory = path.resolve(__dirname, '..', 'store', 'assets', 'screenshots');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.images.length, 12);
  assert.deepEqual(manifest.failures, []);
  for (const language of ['sk', 'en']) {
    assert.deepEqual(manifest.images.filter((image) => image.language === language).map((image) => image.feature),
      COPY[language].map(([feature]) => feature));
  }
  for (const image of manifest.images) {
    const bytes = fs.readFileSync(path.join(directory, ...image.file.split(/[\\/]/)));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), 1080);
    assert.equal(bytes.readUInt32BE(20), 1920);
    assert.equal(bytes[25], 2, 'Store artwork must be RGB, without alpha.');
    assert.ok(bytes.length < 8 * 1024 * 1024);
  }
  assert.ok(manifest.sources.every(({ url }) => !new URL(url).searchParams.has('crumb')));
});
