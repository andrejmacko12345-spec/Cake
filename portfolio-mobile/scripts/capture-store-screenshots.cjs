const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'store', 'assets', 'screenshots');
const SIZE = { width: 440, height: 900 };
const HOLDINGS = { AAPL: 40, MSFT: 20, NVDA: 80, AMZN: 35, GOOG: 40, KO: 60 };
const COPY = {
  sk: [
    ['portfolio', 'Tvoje investície.\nJasný prehľad.', 'Hodnota portfólia, výnosy a všetky pozície.'],
    ['events', 'Dôležité udalosti.\nNa jednom mieste.', 'Výsledky firiem a dividendy tvojich akcií.'],
    ['watchlist', 'Sleduj firmy,\nktorým veríš.', 'Vlastné zoznamy. Ceny a vývoj na dosah.'],
    ['projections', 'Tvoje predpoklady.\nTvoje scenáre.', 'Modeluj rast, ocenenie a výnos na 3 roky.'],
    ['compare', 'Porovnaj čísla.\nNájdi rozdiely.', 'Rast, marže a ocenenie firiem vedľa seba.'],
    ['forecast', 'Pozri sa\nna dlhší horizont.', 'Preskúmaj modelový vývoj svojho portfólia.'],
  ],
  en: [
    ['portfolio', 'Your investments.\nA clearer picture.', 'Portfolio value, returns and every holding.'],
    ['events', 'Key events.\nAll in one place.', 'Company earnings and your stock dividends.'],
    ['watchlist', 'Follow companies\nyou believe in.', 'Your own lists. Prices and trends at a glance.'],
    ['projections', 'Your assumptions.\nYour scenarios.', 'Model growth, valuation and 3-year returns.'],
    ['compare', 'Compare numbers.\nSee the difference.', 'Growth, margins and valuations side by side.'],
    ['forecast', 'Look at the\nbigger picture.', 'Explore a long-term portfolio scenario.'],
  ],
};

function captureFeatures(value) {
  const available = COPY.en.map(([feature]) => feature);
  if (!value) return new Set(available);
  const requested = value.split(',').map((feature) => feature.trim());
  assert.ok(requested.every((feature) => available.includes(feature)), 'Invalid capture feature.');
  return new Set(requested);
}

// Only the intercepted browser bundle changes; native and production sources do not.
function enableCaptureTransport(bundle) {
  let count = 0;
  const result = bundle.replace(
    /if \(Platform\.default\.OS === 'web'\) \{\s*throw new Error\('(Historické kotácie nie sú dostupné v prehliadači\. Otvor aplikáciu v Expo Go na mobile\.|Historické ceny nie sú dostupné v prehliadači\. Otvor aplikáciu v Expo Go na mobile\.|Webový prehliadač blokuje priame kotácie\. Live ceny načítaj v mobilnej aplikácii Expo Go\.)'\);\s*\}/g,
    () => { count += 1; return ''; },
  );
  assert.equal(count, 3, 'Quote transport changed: review capture-only bundle interception.');
  return result;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function publicSourceUrl(value) {
  const url = new URL(value);
  url.searchParams.delete('crumb');
  return url.toString();
}

function artwork(language, index, image) {
  const [feature, title, subtitle] = COPY[language][index];
  const accent = ['#b2f36d', '#70dded', '#b2f36d', '#b9a2ff', '#70dded', '#b9a2ff'][index];
  const disclaimer = index >= 3 && index !== 4
    ? language === 'sk' ? 'Modelový scenár, nie záruka výnosu.' : 'Hypothetical scenario, not a guaranteed return.'
    : language === 'sk' ? 'Ukážkové portfólio · Reálne trhové dáta' : 'Sample portfolio · Real market data';
  return `<!doctype html><html lang="${language}"><meta charset="utf-8">
<style>
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
body{font-family:Arial,sans-serif;background:#101722;color:#f7f8fb}
.glow{position:absolute;width:950px;height:950px;right:-420px;top:200px;border-radius:50%;
background:radial-gradient(circle,${accent}20,transparent 67%)}
.brand{position:absolute;left:76px;top:66px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700;letter-spacing:-1px}
.mark{display:flex;gap:5px;align-items:flex-end;height:28px}.mark i{display:block;width:8px;background:${accent};border-radius:3px}
.mark i:nth-child(1){height:13px}.mark i:nth-child(2){height:21px}.mark i:nth-child(3){height:28px}
h1{position:absolute;left:74px;right:54px;top:132px;margin:0;font-size:76px;line-height:1.04;font-weight:800;letter-spacing:-3px}
h1 span{color:${accent}}
.subtitle{position:absolute;left:78px;top:310px;margin:0;font-size:26px;color:#bac6d8;letter-spacing:-.3px}
.phone{position:absolute;left:168px;top:382px;width:744px;height:1496px;border-radius:48px;padding:8px;
background:#455162;border:2px solid #536071;box-shadow:0 36px 80px #0008}
.phone img{display:block;width:724px;height:1480.91px;border-radius:38px;object-fit:fill}
.foot{position:absolute;left:78px;right:78px;bottom:7px;color:#96a5b8;font-size:18px;text-align:center}
</style><div class="glow"></div><div class="brand"><div class="mark"><i></i><i></i><i></i></div>fincake</div>
<h1>${title.split('\n').map((line, lineIndex) => lineIndex ? `<span>${escapeHtml(line)}</span>` : escapeHtml(line)).join('<br>')}</h1>
<p class="subtitle">${escapeHtml(subtitle)}</p>
<div class="phone"><img alt="${feature}" src="data:image/png;base64,${image.toString('base64')}"></div>
<div class="foot">${disclaimer}</div></html>`;
}

async function main() {
  const { chromium } = require(process.env.CAPTURE_PLAYWRIGHT || 'playwright');
  const url = process.env.CAPTURE_APP_URL || 'http://localhost:8081';
  const features = captureFeatures(process.env.CAPTURE_FEATURES);
  const partial = features.size < COPY.en.length;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 3, locale: 'en-US' });
  const responses = new Map();
  const sources = new Map();
  const failures = [];
  const now = new Date();
  const fetchPublic = (url) => {
    if (!responses.has(url)) {
      responses.set(url, context.request.get(url, { timeout: 45000 }).then(async (response) => {
        const body = await response.body();
        sources.set(url, { status: response.status(), retrievedAt: new Date().toISOString() });
        return { status: response.status(), headers: response.headers(), body };
      }));
    }
    return responses.get(url);
  };
  const chart = async (symbol, query) => {
    const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    const response = await fetchPublic(target);
    assert.equal(response.status, 200, `Market data failed: ${symbol}`);
    const result = JSON.parse(response.body).chart?.result?.[0];
    assert.ok(result?.meta && result.timestamp?.length, `Missing market data: ${symbol}`);
    return result;
  };
  try {
    await fs.mkdir(path.join(OUTPUT, 'raw', 'sk'), { recursive: true });
    await fs.mkdir(path.join(OUTPUT, 'raw', 'en'), { recursive: true });
    let previousManifest;
    let demo;
    if (partial) {
      previousManifest = JSON.parse(await fs.readFile(path.join(OUTPUT, 'manifest.json'), 'utf8'));
      assert.equal(previousManifest.images?.length, 12, 'A complete existing screenshot set is required.');
      demo = JSON.parse(await fs.readFile(path.join(OUTPUT, 'demo-portfolio.json'), 'utf8'));
    } else {
      const purchaseDate = '2025-01-06';
      const period1 = Date.parse(`${purchaseDate}T00:00:00Z`) / 1000;
      const historicalQuery = `period1=${period1}&period2=${period1 + 4 * 86400}&interval=1d`;
      const fxNow = (await chart('EURUSD=X', 'range=1d&interval=1m')).meta.regularMarketPrice;
      const fxThen = (await chart('EURUSD=X', historicalQuery)).indicators.quote[0].close.find((value) => value > 0);
      assert.ok(fxNow > 0 && fxThen > 0);
      const transactions = [];
      const quotes = {};
      for (const [symbol, shares] of Object.entries(HOLDINGS)) {
        const current = await chart(symbol, 'range=1d&interval=1m');
        const historical = await chart(symbol, historicalQuery);
        const price = historical.indicators.quote[0].close.find((value) => value > 0);
        assert.ok(price > 0);
        const meta = current.meta;
        assert.equal(meta.currency, 'USD');
        const previous = meta.chartPreviousClose ?? meta.previousClose;
        assert.ok(meta.regularMarketPrice > 0 && previous > 0);
        const name = meta.longName ?? meta.shortName;
        transactions.push({
          id: `store-demo-${symbol}`, symbol, name, type: 'BUY', shares, price,
          currency: 'USD', fxToEur: 1 / fxThen, date: purchaseDate,
          createdAt: `${purchaseDate}T21:00:00.000Z`,
        });
        quotes[symbol] = {
          symbol, name, price: meta.regularMarketPrice, currency: 'USD', fxToEur: 1 / fxNow,
          change: (meta.regularMarketPrice / previous - 1) * 100, color: '#78d84f',
          updatedAt: new Date(meta.regularMarketTime * 1000).toISOString(), isMarketQuote: true,
        };
      }
      demo = { transactions, quotes };
      await fs.writeFile(path.join(OUTPUT, 'demo-portfolio.json'), JSON.stringify(demo, null, 2) + '\n');
    }
    await context.route('**/*', async (route) => {
      const target = route.request().url();
      try {
        const parsed = new URL(target);
        if (parsed.hostname.endsWith('.yahoo.com')) {
          const response = await fetchPublic(target);
          await route.fulfill({
            status: response.status, body: response.body,
            headers: { 'content-type': response.headers['content-type'] || 'application/json',
              'access-control-allow-origin': '*' },
          });
        } else if (target.includes('/entry.bundle?')) {
          const response = await route.fetch();
          await route.fulfill({ response, body: enableCaptureTransport(await response.text()) });
        } else {
          await route.continue();
        }
      } catch (error) {
        failures.push({ url: target.split('?')[0], error: error.message });
        await route.abort('failed');
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push({ error: error.message }));
    const results = [];
    await context.addInitScript(({ demo }) => {
        const language = new URL(location.href).searchParams.get('captureLanguage') === 'en' ? 'en' : 'sk';
        localStorage.setItem('@portfolio-mobile/transactions-v1', JSON.stringify(demo));
        localStorage.setItem('@portfolio-mobile/language', language);
        localStorage.setItem('@portfolio-mobile/theme', 'dark');
        localStorage.setItem('@portfolio-mobile/hide-amounts', 'false');
        localStorage.setItem('@portfolio-mobile/watchlist', JSON.stringify({
          selectedId: 'default', lists: [{
            id: 'default', name: 'Watchlist', symbols: ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META'],
          }],
        }));
        localStorage.setItem('@portfolio-mobile/compare-symbols', JSON.stringify(['MSFT', 'META', 'GOOG']));
        localStorage.setItem('event-preferences', JSON.stringify({
          earnings: true, dividends: true, news: false, symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'KO'],
        }));
      }, { demo });
    for (const language of ['sk', 'en']) {
      await page.goto(`${url}?captureLanguage=${language}`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.addStyleTag({ content: '#error-toast { display: none !important; }' });
      if (features.has('portfolio')) {
        await page.getByRole('button', { name: '1Y', exact: true }).click();
        await page.waitForTimeout(6000);
      }
      for (let index = 0; index < COPY[language].length; index += 1) {
        const feature = COPY[language][index][0];
        if (!features.has(feature) && !(feature === 'projections' && features.has('compare'))) continue;
        if (feature === 'events') {
          await page.getByRole('tab', { name: language === 'sk' ? 'Udalosti' : 'Events', exact: true }).click();
          await page.waitForTimeout(6000);
          await page.getByText(language === 'sk' ? 'Udalosti' : 'Events', { exact: true }).scrollIntoViewIfNeeded();
        }
        if (feature === 'watchlist') {
          await page.getByRole('tab', { name: language === 'sk' ? 'Sledované' : 'Watchlist', exact: true }).click();
        }
        if (feature === 'projections') {
          await page.getByRole('tab', { name: language === 'sk' ? 'Analýza' : 'Analyse', exact: true }).click();
          await page.getByRole('button', { name: language === 'sk' ? 'Z môjho portfólia' : 'From my portfolio', exact: true }).click();
          await page.getByRole('button', { name: language === 'sk' ? 'Vybrať akciu MSFT' : 'Select stock MSFT', exact: true }).click();
          const input = page.getByRole('textbox', { name: language === 'sk' ? 'Rast tržieb' : 'Revenue growth', exact: true });
          await input.waitFor({ state: 'visible' });
          await page.waitForFunction(() => [...document.querySelectorAll('input')].some((input) =>
            input.getAttribute('aria-label') === 'Dolné P/E' && !input.disabled
            || input.getAttribute('aria-label') === 'Low P/E' && !input.disabled), { timeout: 90000 });
          for (const [label, value] of [
            [language === 'sk' ? 'Rast tržieb' : 'Revenue growth', '10'],
            [language === 'sk' ? 'Rast čistého zisku' : 'Net income growth', '12'],
            [language === 'sk' ? 'Dolné P/E' : 'Low P/E', '24'],
            [language === 'sk' ? 'Horné P/E' : 'High P/E', '34'],
          ]) await page.getByRole('textbox', { name: label, exact: true }).fill(value);
          await page.getByRole('textbox', { name: language === 'sk' ? 'Horné P/E' : 'High P/E', exact: true }).blur();
        }
        if (feature === 'compare') await page.getByRole('tab', { name: language === 'sk' ? 'Porovnanie' : 'Compare', exact: true }).click();
        if (feature === 'forecast') await page.getByRole('tab', { name: language === 'sk' ? 'Výhľad' : 'Forecast', exact: true }).click();
        if (!features.has(feature)) continue;
        await page.waitForTimeout(6000);
        if (feature === 'projections' || feature === 'compare') {
          const label = feature === 'compare' ? 'P/S TTM' : language === 'sk' ? 'Horné CAGR' : 'High CAGR';
          const bottom = await page.getByText(label, { exact: true }).first()
            .evaluate((element) => element.parentElement.parentElement.getBoundingClientRect().bottom);
          const nav = await page.getByRole('tab', { name: language === 'sk' ? 'Výhľad' : 'Forecast', exact: true }).boundingBox();
          const gap = nav.y - bottom;
          assert.ok(gap >= 0 && gap <= 70, `${language}/${feature}: table/navigation gap is ${gap}px.`);
        }
        const image = await page.screenshot({ animations: 'disabled' });
        assert.ok(image.length > 100000, `${language}/${feature}: the screen appears empty.`);
        await fs.writeFile(path.join(OUTPUT, 'raw', language, `${feature}.png`), image);
        const art = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
        await art.setContent(artwork(language, index, image));
        await art.locator('img').waitFor();
        await art.locator('img').evaluate((image) => image.decode());
        const colors = await art.locator('img').evaluate((image) => {
          const canvas = document.createElement('canvas');
          canvas.width = 100;
          canvas.height = 140;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight * 0.7, 0, 0, 100, 140);
          const pixels = context.getImageData(0, 0, 100, 140).data;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 4) {
            colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
          }
          return colors.size;
        });
        assert.ok(colors > 100, `${language}/${feature}: missing visible screen content.`);
        await art.evaluate(() => document.fonts.ready);
        const directory = path.join(OUTPUT, language === 'sk' ? 'sk-SK' : 'en-US');
        await fs.mkdir(directory, { recursive: true });
        const filename = `${String(index + 1).padStart(2, '0')}-${feature}.png`;
        await art.screenshot({ path: path.join(directory, filename) });
        await art.close();
        results.push({ language, feature, file: path.relative(OUTPUT, path.join(directory, filename)),
          width: 1080, height: 1920, capturedAt: new Date().toISOString() });
        console.log(`Captured ${language}/${feature}`);
      }
    }
    const images = [
      ...(previousManifest?.images ?? [])
        .filter((image) => !features.has(image.feature))
        .map((image) => ({ ...image, capturedAt: image.capturedAt ?? previousManifest.capturedAt })),
      ...results,
    ].sort((a, b) => a.language.localeCompare(b.language)
      || COPY.en.findIndex(([feature]) => feature === a.feature) - COPY.en.findIndex(([feature]) => feature === b.feature));
    assert.equal(images.length, 12, 'Screenshot set is incomplete.');
    for (const language of ['sk', 'en']) {
      const directory = language === 'sk' ? 'sk-SK' : 'en-US';
      const thumbnails = await Promise.all(images.filter((image) => image.language === language)
        .map(async (image) => `<img src="data:image/png;base64,${(await fs.readFile(path.join(OUTPUT, image.file))).toString('base64')}">`));
      const sheet = await browser.newPage({ viewport: { width: 1620, height: 1920 }, deviceScaleFactor: 1 });
      await sheet.setContent(`<style>html,body{margin:0;background:#101722}body{display:grid;grid-template-columns:repeat(3,540px)}img{width:540px;height:960px}</style>${thumbnails.join('')}`);
      await sheet.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
      await sheet.screenshot({ path: path.join(OUTPUT, `preview-${directory}.png`) });
      await sheet.close();
    }
    assert.deepEqual(failures, [], 'Capture encountered browser/transport errors.');
    await fs.writeFile(path.join(OUTPUT, 'manifest.json'), JSON.stringify({
      capturedAt: now.toISOString(), renderer: 'Current Expo web UI, mobile viewport; not an Android AAB capture',
      transport: 'Public Yahoo responses via Playwright HTTP; three browser-only quote guards removed in intercepted bundle only.',
      portfolio: 'Fictional quantities; real historical purchase closes and FX, real current quotes and FX.',
      projectionAssumptions: { symbol: 'MSFT', revenueGrowth: 10, incomeGrowth: 12, peLow: 24, peHigh: 34 },
      sources: [...(previousManifest?.sources ?? []),
        ...[...sources].map(([url, value]) => ({ url: publicSourceUrl(url), ...value }))], images, failures,
    }, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}

module.exports = { captureFeatures, enableCaptureTransport, escapeHtml, publicSourceUrl, artwork, COPY };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
