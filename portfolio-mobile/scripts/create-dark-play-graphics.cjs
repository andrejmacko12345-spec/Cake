const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'store', 'assets', 'dark');
const PALETTES = {
  green: { accent: [178, 243, 109], hex: '#b2f36d', label: 'Green accent' },
  orange: { accent: [229, 155, 64], hex: '#e59b40', label: 'Original orange accent' },
};
const FOREGROUND = [243, 247, 251];
const BACKGROUND = '#171e2a';
const COPY = {
  sk: {
    kicker: 'INVESTIČNÝ PREHĽAD',
    tagline: 'Portfólio pod kontrolou',
    features: ['Evidencia', 'Analýza', 'Scenáre'],
  },
  en: {
    kicker: 'INVESTMENT OVERVIEW',
    tagline: 'Your portfolio at a glance',
    features: ['Tracking', 'Analysis', 'Scenarios'],
  },
};

function recolorLogoPixels(input, foreground, accent) {
  const background = [242, 227, 218];
  const sources = [[65, 45, 36], [221, 151, 66]];
  const output = new Uint8ClampedArray(input.length);
  for (let index = 0; index < input.length; index += 4) {
    let bestError = Infinity;
    let bestWeight = 0;
    let target = foreground;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      let numerator = 0;
      let denominator = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = source[channel] - background[channel];
        numerator += (input[index + channel] - background[channel]) * difference;
        denominator += difference * difference;
      }
      const weight = Math.max(0, Math.min(1, numerator / denominator));
      let error = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const estimate = background[channel] + weight * (source[channel] - background[channel]);
        error += (input[index + channel] - estimate) ** 2;
      }
      if (error < bestError) {
        bestError = error;
        bestWeight = weight;
        target = sourceIndex === 0 ? foreground : accent;
      }
    }
    output[index] = target[0];
    output[index + 1] = target[1];
    output[index + 2] = target[2];
    output[index + 3] = Math.round(input[index + 3] * bestWeight);
  }
  return output;
}

function bannerHtml(language, palette, mark) {
  const copy = COPY[language];
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1024px;height:500px;overflow:hidden}
body{font-family:Arial,sans-serif;background:#101722;color:#f7f8fb}
.glow{position:absolute;width:700px;height:700px;left:-125px;top:-105px;border-radius:50%;
background:radial-gradient(circle,${palette.hex}17 0%,transparent 65%)}
.curve{position:absolute;right:-84px;bottom:-260px;width:540px;height:540px;border:1px solid #ffffff0d;border-radius:50%}
.curve:after{content:'';position:absolute;inset:50px;border:1px solid #ffffff0a;border-radius:50%}
.tile{position:absolute;left:80px;top:118px;width:264px;height:264px;overflow:hidden;border-radius:66px;
background:linear-gradient(145deg,#283647,#192331);border:1px solid #465365;box-shadow:0 28px 55px #0007}
.tile img{position:absolute;width:408px;height:408px;left:-72px;top:-72px}
.copy{position:absolute;left:405px;top:114px;right:35px}
.kicker{color:${palette.hex};font-size:12px;letter-spacing:2.3px;font-weight:700}
.name{margin-top:16px;font-size:77px;line-height:1;font-weight:800;letter-spacing:-2.5px}
.tagline{margin-top:18px;font-size:27px;line-height:1.15;color:#e4e9f1;white-space:nowrap}
.rule{width:45px;height:3px;border-radius:3px;background:${palette.hex};margin-top:30px}
.features{margin-top:19px;color:#aab7c8;font-size:16px;letter-spacing:.1px}
.features span{color:${palette.hex};padding:0 12px}
</style><div class="glow"></div><div class="curve"></div><div class="tile"><img alt="" src="${mark}"></div>
<div class="copy"><div class="kicker">${copy.kicker}</div><div class="name">Fincake</div>
<div class="tagline">${copy.tagline}</div><div class="rule"></div>
<div class="features">${copy.features.join('<span>/</span>')}</div></div></html>`;
}

async function main() {
  const { chromium } = require(process.env.CAPTURE_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const source = (await fs.readFile(path.join(ROOT, 'assets', 'icon.png'))).toString('base64');
    const processor = await browser.newPage();
    await processor.setContent('<!doctype html><html><body></body></html>');
    await processor.addScriptTag({ content: recolorLogoPixels.toString() });
    const previews = [];
    for (const [name, palette] of Object.entries(PALETTES)) {
      const data = await processor.evaluate(async ({ source, foreground, accent, background }) => {
        const original = new Image();
        original.src = `data:image/png;base64,${source}`;
        await original.decode();
        if (original.width !== 1024 || original.height !== 1024) throw new Error('Unexpected source icon dimensions.');
        const canvas = document.createElement('canvas');
        canvas.width = original.width;
        canvas.height = original.height;
        const context = canvas.getContext('2d');
        context.drawImage(original, 0, 0);
        for (const [x, y, expected] of [
          [0, 0, [242, 227, 218]],
          [512, 350, [65, 45, 36]],
          [690, 500, [221, 152, 67]],
        ]) {
          const sample = context.getImageData(x, y, 1, 1).data;
          if (expected.some((value, channel) => Math.abs(sample[channel] - value) > 5)) {
            throw new Error('Source logo colors changed; review the dark color mapping.');
          }
        }
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        pixels.data.set(recolorLogoPixels(pixels.data, foreground, accent));
        context.putImageData(pixels, 0, 0);
        const mark = canvas.toDataURL('image/png');
        const appIcon = document.createElement('canvas');
        appIcon.width = 1024;
        appIcon.height = 1024;
        const appContext = appIcon.getContext('2d');
        appContext.fillStyle = background;
        appContext.fillRect(0, 0, 1024, 1024);
        appContext.drawImage(canvas, 0, 0);
        const monochrome = document.createElement('canvas');
        monochrome.width = 1024;
        monochrome.height = 1024;
        const monochromeContext = monochrome.getContext('2d');
        monochromeContext.drawImage(canvas, 0, 0);
        monochromeContext.globalCompositeOperation = 'source-in';
        monochromeContext.fillStyle = '#ffffff';
        monochromeContext.fillRect(0, 0, 1024, 1024);
        const icon = document.createElement('canvas');
        icon.width = 512;
        icon.height = 512;
        const iconContext = icon.getContext('2d');
        iconContext.fillStyle = background;
        iconContext.fillRect(0, 0, 512, 512);
        iconContext.drawImage(canvas, 0, 0, 512, 512);
        return { mark, icon: icon.toDataURL('image/png'), appIcon: appIcon.toDataURL('image/png'),
          monochrome: monochrome.toDataURL('image/png') };
      }, { source, foreground: FOREGROUND, accent: palette.accent, background: BACKGROUND });
      const directory = path.join(OUTPUT, name);
      await fs.mkdir(directory, { recursive: true });
      const icon = Buffer.from(data.icon.split(',')[1], 'base64');
      assert.ok(icon.length <= 1024 * 1024, `${name} icon exceeds Google Play's 1 MB limit.`);
      await fs.writeFile(path.join(directory, 'play-icon.png'), icon);
      if (name === 'green') {
        for (const [filename, image] of [
          ['icon-green.png', data.appIcon],
          ['android-icon-green-foreground.png', data.mark],
          ['android-icon-green-monochrome.png', data.monochrome],
        ]) {
          await fs.writeFile(path.join(ROOT, 'assets', filename), Buffer.from(image.split(',')[1], 'base64'));
        }
      }
      const banners = {};
      for (const language of ['sk', 'en']) {
        const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
        await page.setContent(bannerHtml(language, palette, data.mark));
        await page.locator('img').evaluate((image) => image.decode());
        await page.evaluate(() => document.fonts.ready);
        const banner = await page.screenshot({ animations: 'disabled' });
        assert.ok(banner.length <= 15 * 1024 * 1024, `${name}/${language} banner is too large.`);
        await fs.writeFile(path.join(directory, `feature-graphic-${language}.png`), banner);
        banners[language] = banner;
        await page.close();
      }
      previews.push({ name, label: palette.label, icon, banner: banners.sk });
      console.log(`Created ${name} icon and SK/EN graphics.`);
    }
    const preview = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
    const rows = previews.map(({ label, icon, banner }) => `<section><h2>${label}</h2><div class="row">
<img class="icon" src="data:image/png;base64,${icon.toString('base64')}">
<img class="banner" src="data:image/png;base64,${banner.toString('base64')}"></div></section>`).join('');
    await preview.setContent(`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#0e151f;color:#f7f8fb;font:20px Arial,sans-serif}
section{padding:21px 30px 12px}h2{font-size:18px;margin:0 0 12px;color:#bbc8d8}
.row{display:flex;align-items:center;gap:26px}.icon{width:230px;height:230px;border-radius:34px}
.banner{width:864px;height:422px}section{height:500px}.row img{object-fit:contain}
</style>${rows}`);
    await preview.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await preview.screenshot({ path: path.join(OUTPUT, 'preview.png') });
    await preview.close();
  } finally {
    await browser.close();
  }
}

module.exports = { recolorLogoPixels, bannerHtml, PALETTES, COPY };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
