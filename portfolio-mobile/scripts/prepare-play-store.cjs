const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const unfinished = (value) => typeof value !== 'string' || !value.trim()
  || /\b(TODO|TBD|PLACEHOLDER)\b|example\.(com|org)|your[- ]?(name|domain|email)/i.test(value);

function publicDetailsErrors(details) {
  const errors = [];
  for (const field of ['operatorName', 'supportEmail', 'privacyUrl', 'deletionUrl',
    'hostingRegion', 'backupRetention', 'logRetention', 'policyReviewedOn']) {
    if (unfinished(details[field])) errors.push(`Complete store/public-details.json: ${field}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.supportEmail)) errors.push('Provide a valid support email.');
  for (const key of ['privacyUrl', 'deletionUrl']) {
    try {
      const url = new URL(details[key]);
      if (url.protocol !== 'https:' || url.username || url.password
        || !url.hostname.includes('.') || /^(localhost|127\.|192\.168\.|10\.)/.test(url.hostname)) throw new Error();
    } catch { errors.push(`${key} must be a public HTTPS URL without embedded credentials.`); }
  }
  if (details.privacyUrl && details.privacyUrl === details.deletionUrl) errors.push('Use a dedicated data request page.');
  const reviewed = Date.parse(details.policyReviewedOn);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(details.policyReviewedOn) || !Number.isFinite(reviewed)
    || new Date(reviewed).toISOString().slice(0, 10) !== details.policyReviewedOn
    || reviewed > Date.now()) errors.push('policyReviewedOn must be a valid review date, not in the future.');
  if (details.dataProviderRightsConfirmed !== true) errors.push('Confirm distribution rights for market data and logos before release.');
  return errors;
}

function listingErrors(listing) {
  const errors = [];
  for (const language of ['sk-SK', 'en-US']) {
    const entry = listing[language] ?? {};
    for (const [field, max] of Object.entries({ title: 30, shortDescription: 80, fullDescription: 4000, releaseNotes: 500 })) {
      if (unfinished(entry[field]) || [...entry[field]].length > max) errors.push(`${language}.${field} must have 1-${max} characters and no placeholders.`);
    }
  }
  return errors;
}

function buildErrors(config, eas) {
  const errors = [];
  if (config.android?.package !== 'com.fincake.app') errors.push('Android package must be com.fincake.app.');
  if (config.android?.allowBackup !== false) errors.push('Disable Android system backups for the disclosed local-data model.');
  const buildProperties = config.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')?.[1];
  const targetSdkVersion = buildProperties?.android?.targetSdkVersion ?? config.android?.targetSdkVersion;
  if (!Number.isInteger(targetSdkVersion) || targetSdkVersion < 36) {
    errors.push('New Google Play releases must target Android 16 (API level 36) or higher.');
  }
  const profile = eas.build?.production;
  if (profile?.distribution !== 'store' || profile?.android?.buildType !== 'app-bundle'
    || profile?.android?.autoIncrement !== true) errors.push('Configure a versioned production Android App Bundle.');
  if (!config.extra?.eas?.projectId) errors.push('Link the intended Expo project with: npx eas-cli@latest init');
  return errors;
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function renderPage(content, details, deletion, draft) {
  const languages = ['sk', 'en'].map((language) => {
    const copy = content[language];
    const sections = deletion ? copy.deletion : copy.sections;
    const fields = [
      [copy.operator, details.operatorName], [copy.contact, details.supportEmail],
      [copy.region, details.hostingRegion], [copy.backups, details.backupRetention],
      [copy.logs, details.logRetention], [copy.updated, details.policyReviewedOn],
    ];
    const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.supportEmail)
      ? `<p><a href="mailto:${escape(encodeURIComponent(details.supportEmail))}?subject=Fincake%20data%20request">${escape(copy.contact)}: ${escape(details.supportEmail)}</a></p>` : '';
    return `<section id="${language}" lang="${language}"><h1>Fincake — ${escape(deletion ? copy.deletionTitle : copy.privacyTitle)}</h1>
      ${draft ? `<p class="warning">${escape(copy.draft)}</p>` : ''}
      ${sections.map(({ title, body }) => `<h2>${escape(title)}</h2><p>${escape(body)}</p>`).join('\n')}
      <dl>${fields.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value || copy.missing)}</dd>`).join('')}</dl>
      ${mail}<p><a href="${deletion ? 'privacy.html' : 'delete-account.html'}">${escape(deletion ? copy.privacyTitle : copy.deletionTitle)}</a></p></section>`;
  });
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    ${draft ? '<meta name="robots" content="noindex,nofollow">' : ''}
    <title>Fincake — ${deletion ? 'Data deletion requests' : 'Privacy policy'}</title>
    <style>body{font:16px/1.65 system-ui,sans-serif;background:#fff7e6;color:#302d2b;margin:0}main{max-width:820px;margin:auto;padding:28px 20px}a{color:#1758b7}h1{font-size:26px}h2{font-size:19px;margin-top:28px}section{padding-bottom:36px;border-bottom:1px solid #ccc}dt{font-weight:700;margin-top:14px}dd{margin:0;white-space:pre-line}.warning{padding:16px;background:#ffe2dc;color:#821b1b}nav{display:flex;gap:20px}p,dd{overflow-wrap:anywhere}</style>
    </head><body><main><nav aria-label="Language"><a href="#sk">Slovenčina</a><a href="#en">English</a></nav>${languages.join('\n')}</main></body></html>`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--draft'].includes(arg)) || args.length > 1) {
    console.error('Use no option, --check, or --draft.'); process.exitCode = 1;
  } else {
    const details = read('store/public-details.json');
    const content = read('store/privacy-content.json');
    const draft = args.includes('--draft');
    const check = args.includes('--check');
    const errors = listingErrors(read('store/listing.json'));
    if (!draft) errors.push(...publicDetailsErrors(details));
    if (check) {
      const config = require('../app.config.js')({ config: read('app.json').expo });
      errors.push(...buildErrors(config, read('eas.json'), process.env));
    }
    if (errors.length) {
      console.error(`Store preparation blocked:\n- ${errors.join('\n- ')}`);
      process.exitCode = 1;
    } else if (check) {
      console.log('Local store configuration checked. Hosting, declarations, signing and device tests still require verification.');
    } else {
      const output = path.join(root, 'store', 'generated');
      fs.mkdirSync(output, { recursive: true });
      for (const [file, deletion] of [['privacy.html', false], ['delete-account.html', true]]) {
        fs.writeFileSync(path.join(output, file), renderPage(content, details, deletion, draft));
      }
      console.log(`${draft ? 'DRAFT ONLY, not publishable' : 'Pages prepared for deployment'}: ${output}`);
    }
  }
}

module.exports = { publicDetailsErrors, listingErrors, buildErrors, renderPage };
