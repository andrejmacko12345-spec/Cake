const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const escape = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function renderPolicyPage(content, details, deletion) {
  const sections = (language) => {
    const copy = content[language];
    const entries = deletion ? copy.deletion : copy.sections;
    return `<section id="${language}" lang="${language}">
      <h1>Fincake — ${escape(deletion ? copy.deletionTitle : copy.privacyTitle)}</h1>
      <p><strong>${escape(copy.operator)}:</strong> ${escape(details.operatorName)}<br>
      <strong>${escape(copy.contact)}:</strong> <a href="mailto:${escape(details.supportEmail)}">${escape(details.supportEmail)}</a></p>
      ${entries.map(({ title, body }) => `<h2>${escape(title)}</h2><p>${escape(body)}</p>`).join('\n')}
      <p><a href="${deletion ? 'privacy.html' : 'delete-account.html'}">${escape(deletion ? copy.privacyTitle : copy.deletionTitle)}</a></p>
    </section>`;
  };
  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Fincake privacy policy and data handling information.">
  <title>Fincake — ${deletion ? 'Data deletion' : 'Privacy policy'}</title>
  <style>
    body{font:16px/1.65 system-ui,sans-serif;background:#fff7e6;color:#302d2b;margin:0}
    main{max-width:820px;margin:auto;padding:28px 20px}
    nav{display:flex;gap:20px;margin-bottom:24px}
    a{color:#1758b7}h1{font-size:26px}h2{font-size:19px;margin-top:28px}
    section{padding-bottom:36px;border-bottom:1px solid #ccc}
    p{overflow-wrap:anywhere}
  </style>
</head>
<body>
  <main>
    <nav aria-label="Language"><a href="#sk">Slovenčina</a><a href="#en">English</a></nav>
    ${sections('sk')}
    ${sections('en')}
  </main>
</body>
</html>
`;
}

function generateSite(output, content, details) {
  if (!details.operatorName || !details.supportEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.supportEmail)) {
    throw new Error('Public policy requires a named operator and valid support email.');
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'privacy.html'), renderPolicyPage(content, details, false));
  fs.writeFileSync(path.join(output, 'delete-account.html'), renderPolicyPage(content, details, true));
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=privacy.html"><a href="privacy.html">Fincake privacy policy</a>');
}

if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(root, '_site'));
  generateSite(
    output,
    JSON.parse(fs.readFileSync(path.join(root, 'store', 'privacy-content.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'store', 'public-details.json'), 'utf8')),
  );
  console.log(`Public Fincake policy pages generated in ${output}`);
}

module.exports = { renderPolicyPage, generateSite };
