const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { publicDetailsErrors, listingErrors, buildErrors, renderPage } = require('../../scripts/prepare-play-store.cjs');
const { renderPolicyPage } = require('../../scripts/generate-public-policy.cjs');
const content = require('../../store/privacy-content.json');
const listing = require('../../store/listing.json');
const details = require('../../store/public-details.json');
const app = require('../../app.json').expo;
const eas = require('../../eas.json');
const valid = {
  operatorName: 'Fincake Test Operator', supportEmail: 'support@fincake.test',
  privacyUrl: 'https://fincake.test/privacy.html', deletionUrl: 'https://fincake.test/delete-account.html',
  hostingRegion: 'Test region', backupRetention: 'Test retention', logRetention: 'Test retention',
  policyReviewedOn: '2026-01-01', dataProviderRightsConfirmed: true,
};

test('Play artwork has exact required dimensions, PNG color format and icon size', () => {
  for (const [file, width, height, colorType] of [
    ['play-icon.png', 512, 512, 6],
    ['feature-graphic-sk.png', 1024, 500, 2],
    ['feature-graphic-en.png', 1024, 500, 2],
  ]) {
    const png = fs.readFileSync(path.resolve(__dirname, '../../store/assets', file));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[24], 8);
    assert.equal(png[25], colorType, `${file} alpha/color type`);
    if (file === 'play-icon.png') assert.ok(png.length <= 1024 * 1024);
  }
});

test('store metadata respects exact Google Play field lengths in both languages', () => {
  assert.deepEqual(listingErrors(listing), []);
  for (const [field, max] of Object.entries({ title: 30, shortDescription: 80, fullDescription: 4000, releaseNotes: 500 })) {
    const changed = structuredClone(listing);
    changed['sk-SK'][field] = 'a'.repeat(max);
    assert.deepEqual(listingErrors(changed), []);
    changed['sk-SK'][field] += 'a';
    assert.ok(listingErrors(changed).some((error) => error.includes(field)));
  }
});

test('store readiness rejects incomplete publisher, insecure links, missing rights and invalid retention dates', () => {
  assert.deepEqual(publicDetailsErrors(valid), []);
  const missingDetails = publicDetailsErrors({ ...details, policyReviewedOn: '' });
  assert.ok(missingDetails.some((error) => error.includes('policyReviewedOn')));
  assert.ok(missingDetails.some((error) => error.includes('distribution rights')));
  assert.match(details.logRetention, /retention periods vary/i);
  assert.equal(details.supportEmail, 'support@fincake.eu');
  for (const change of [
    { supportEmail: 'invalid' }, { operatorName: 'TODO' }, { privacyUrl: 'http://fincake.test/privacy' },
    { deletionUrl: 'https://user:password@fincake.test/delete' },
    { deletionUrl: valid.privacyUrl },
    { policyReviewedOn: '2099-01-01' }, { policyReviewedOn: '2026-02-31' }, { dataProviderRightsConfirmed: false },
  ]) assert.ok(publicDetailsErrors({ ...valid, ...change }).length, JSON.stringify(change));
});

test('support screen uses the Play support mailbox and opens a mail composer', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '../app/contact.tsx'), 'utf8');
  assert.match(screen, /details\.supportEmail/);
  assert.match(screen, /Linking\.openURL\(`mailto:\$\{details\.supportEmail\}`\)/);
  assert.doesNotMatch(screen, /hello@andrej\.dev/);
});

test('Android store profile uses signed AAB configuration and blocks build when Expo is not linked', () => {
  assert.equal(app.android.package, 'com.fincake.app');
  assert.equal(app.android.allowBackup, false);
  const buildProperties = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  assert.equal(buildProperties[1].android.targetSdkVersion, 36);
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'READ_EXTERNAL_STORAGE']) {
    assert.ok(app.android.blockedPermissions.includes(`android.permission.${permission}`));
  }
  assert.ok(app.android.blockedPermissions.includes('com.google.android.gms.permission.AD_ID'));
  const linked = { ...app, extra: { eas: { projectId: 'test-project' } } };
  assert.deepEqual(buildErrors(linked, eas), []);
  const invalid = structuredClone(eas);
  invalid.build.production.android.buildType = 'apk';
  assert.ok(buildErrors(linked, invalid).some((error) => error.includes('Bundle')));
  const oldTarget = structuredClone(linked);
  const oldBuildProperties = oldTarget.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  oldBuildProperties[1].android.targetSdkVersion = 35;
  assert.ok(buildErrors(oldTarget, eas).some((error) => error.includes('API level 36')));
});

test('public privacy and deletion pages are bilingual, escaped, explicit about drafts and usable without the app', () => {
  for (const deletion of [true, false]) {
    const html = renderPage(content, { ...valid, operatorName: '<script>bad()</script>' }, deletion, false);
    assert.match(html, /lang="sk"/);
    assert.match(html, /lang="en"/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /mailto:support%40fincake.test/);
    assert.match(html, deletion ? /For a question about personal data/ : /does not create user accounts/);
    assert.match(html, deletion ? /privacy\.html/ : /delete-account\.html/);
  }
  const draft = renderPage(content, details, true, true);
  assert.match(draft, /DRAFT/);
  assert.match(draft, /noindex,nofollow/);
  assert.match(draft, /mailto:support%40fincake\.eu/);
});

test('privacy screen renders disclosures and contact details in the selected language', () => {
  const originalLoad = Module._load;
  const originalTsx = require.extensions['.tsx'];
  let language = 'sk';
  const wrap = ({ children }) => React.createElement('div', null, children);
  try {
    require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, filename);
    Module._load = function (id, ...args) {
      if (id === 'react-native') return {
        View: wrap, Text: wrap, Pressable: wrap, Linking: { openURL: async () => {} },
        StyleSheet: { create: (styles) => styles },
      };
      if (id === 'expo-router') return { useRouter: () => ({ back: () => {} }) };
      if (id === 'lucide-react-native') return { ArrowLeft: wrap };
      if (id === '../components/finapp') return { Header: wrap, Page: wrap, Surface: wrap };
      if (id === '../context/locale') return { useLocale: () => ({ language, t: (key) => key }) };
      if (id === '../data/theme') return { useThemedStyles: (factory) => factory() };
      if (id === '../data/portfolio') return { colors: {} };
      return originalLoad.call(this, id, ...args);
    };
    const Screen = require('../app/legal.tsx').default;
    for (language of ['sk', 'en']) {
      const html = renderToStaticMarkup(React.createElement(Screen));
      for (const section of content[language].sections) assert.ok(html.includes(section.title));
      assert.ok(!html.includes(content[language].draft));
      assert.ok(html.includes(content[language].deletionTitle));
      assert.ok(html.includes('support@fincake.eu'));
      assert.doesNotMatch(html, /hello@andrej/);
    }
    const root = path.resolve(__dirname, '..');
    assert.match(fs.readFileSync(path.join(root, 'app', 'settings.tsx'), 'utf8'), /router\.push\('\/legal'\)/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8'), /AccountProvider/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'app', 'settings.tsx'), 'utf8'), /AccountPanel/);
    assert.equal(fs.existsSync(path.join(root, 'components', 'account-panel.tsx')), false);
    assert.doesNotMatch(fs.readFileSync(path.resolve(root, '../package.json'), 'utf8'), /@supabase\/supabase-js/);
  } finally {
    Module._load = originalLoad;
    if (originalTsx) require.extensions['.tsx'] = originalTsx;
    else delete require.extensions['.tsx'];
  }
});

test('public policy pages render bilingual, finalized disclosures and contact details', () => {
  for (const deletion of [true, false]) {
    const html = renderPolicyPage(content, details, deletion);
    assert.match(html, /lang="sk"/);
    assert.match(html, /lang="en"/);
    assert.match(html, /mailto:support@fincake\.eu/);
    assert.doesNotMatch(html, /DRAFT|NÁVRH|Zatiaľ nedoplnené|Not yet provided/);
    assert.match(html, deletion ? /Delete data on your device/ : /On-device data/);
    assert.match(html, deletion ? /privacy\.html/ : /delete-account\.html/);
  }
});
