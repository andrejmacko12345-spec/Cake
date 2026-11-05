const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { recolorLogoPixels, bannerHtml, PALETTES, COPY } = require('./create-dark-play-graphics.cjs');

test('dark logo keeps the original mark geometry, including partially covered edges', () => {
  const source = new Uint8ClampedArray([
    242, 227, 218, 255,
    65, 45, 36, 255,
    221, 151, 66, 255,
    154, 136, 127, 255,
  ]);
  const pixels = recolorLogoPixels(source, [243, 247, 251], PALETTES.green.accent);
  assert.equal(pixels[3], 0);
  assert.deepEqual([...pixels.slice(4, 8)], [243, 247, 251, 255]);
  assert.deepEqual([...pixels.slice(8, 12)], [...PALETTES.green.accent, 255]);
  assert.ok(pixels[15] >= 125 && pixels[15] <= 130);
});

test('feature graphics retain the brand and localized copy', () => {
  for (const language of ['sk', 'en']) {
    const html = bannerHtml(language, PALETTES.green, 'data:image/png;base64,AA==');
    assert.ok(html.includes('Fincake'));
    assert.ok(html.includes(COPY[language].tagline));
  }
});

test('dark alternatives meet Google Play image dimensions and size limits', () => {
  const directory = path.resolve(__dirname, '..', 'store', 'assets', 'dark');
  for (const variant of Object.keys(PALETTES)) {
    for (const [name, width, height, limit, colorType] of [
      ['play-icon.png', 512, 512, 1024 * 1024, 6],
      ['feature-graphic-sk.png', 1024, 500, 15 * 1024 * 1024, 2],
      ['feature-graphic-en.png', 1024, 500, 15 * 1024 * 1024, 2],
    ]) {
      const image = fs.readFileSync(path.join(directory, variant, name));
      assert.equal(image.subarray(1, 4).toString(), 'PNG');
      assert.equal(image.readUInt32BE(16), width);
      assert.equal(image.readUInt32BE(20), height);
      assert.equal(image[25], colorType);
      assert.ok(image.length <= limit);
    }
  }
});

test('build configuration uses the green icon and matching adaptive layers', () => {
  const root = path.resolve(__dirname, '..');
  const { expo } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.equal(expo.icon, './assets/icon-green.png');
  assert.equal(expo.web.favicon, expo.icon);
  assert.deepEqual(expo.android.adaptiveIcon, {
    backgroundColor: '#171e2a',
    foregroundImage: './assets/android-icon-green-foreground.png',
    monochromeImage: './assets/android-icon-green-monochrome.png',
  });
  for (const filename of [expo.icon, expo.android.adaptiveIcon.foregroundImage, expo.android.adaptiveIcon.monochromeImage]) {
    const image = fs.readFileSync(path.resolve(root, filename));
    assert.equal(image.readUInt32BE(16), 1024);
    assert.equal(image.readUInt32BE(20), 1024);
    assert.equal(image[25], 6);
  }
});
