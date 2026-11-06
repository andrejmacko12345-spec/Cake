const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { fetchSecQuarterly } = require('../src/data/sec.ts');
const { yahooHistory, yahooSummary, displayed, complete, updateCoverage } = require('./refresh-financial-history.cjs');
const { parseEarningsConsensus } = require('../src/data/earnings-consensus.ts');
const { combineFinancialSources } = require('../src/data/quarterly.ts');
const root = path.join(__dirname, '..', 'src', 'data');
const DAY = 86400;
const constituentsUrl = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

function plain(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&minus;|&#8722;/g, '-').replace(/&amp;/g, '&').trim();
}

function amount(value) {
  const text = plain(value).replace(/[$,\s]/g, '');
  const match = /^([+-]?\d+(?:\.\d+)?)([MBT])?$/.exec(text);
  if (!match) return null;
  return Number(`${match[1]}e${({ M: 6, B: 9, T: 12 }[match[2]] ?? 0)}`);
}

function parseConsensusTable(html, now = Date.now(), limit = Infinity) {
  const table = /<table\b[^>]*id="earnings-history"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) throw new Error('Historical earnings table missing.');
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => plain(match[1]));
  const expected = ['Date', 'Quarter', 'Consensus Estimate', 'Reported EPS', 'Beat/Miss', 'GAAP EPS',
    'Revenue Estimate', 'Actual Revenue', 'Details'];
  if (JSON.stringify(headers) !== JSON.stringify(expected)) throw new Error('Historical earnings table schema changed.');
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]))
    .filter((cells) => cells.length === expected.length)
    .filter((cells) => {
      const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(plain(cells[0]));
      return date && Date.parse(`${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}T23:59:59Z`) <= now;
    }).slice(0, limit);
  return rows.flatMap((cells) => {
    if (cells.length !== expected.length) return [];
    const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(plain(cells[0]));
    if (!date) return [];
    const publishedAt = `${date[3]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}T23:59:59Z`;
    if (Date.parse(publishedAt) > now) return [];
    const epsEstimate = amount(cells[2]);
    const eps = amount(cells[3]);
    const beat = amount(cells[4]);
    const gaap = amount(cells[5]);
    const revenueEstimate = amount(cells[6]);
    const revenue = amount(cells[7]);
    const sourcePath = /href="(\/earnings\/reports\/[^"]+)"/.exec(cells[8])?.[1];
    if ([epsEstimate, eps, beat, revenueEstimate, revenue].some((value) => value === null) || !sourcePath) return [];
    if (revenue <= 0 || revenueEstimate <= 0) throw new Error('Non-positive reported revenue or consensus.');
    if (Math.abs(eps - epsEstimate - beat) > 0.011) throw new Error('EPS surprise does not match the published pair.');
    // Mixed pre-/post-split observations can still have an arithmetically correct surprise.
    const small = Math.min(Math.abs(eps), Math.abs(epsEstimate));
    const large = Math.max(Math.abs(eps), Math.abs(epsEstimate));
    if (small >= 0.1 && large / small >= 5) throw new Error('EPS pair needs manual split/methodology verification.');
    return [{
      source: `https://www.marketbeat.com${sourcePath}`,
      provider: 'MarketBeat historical earnings table',
      publishedAt, eps, epsEstimate, revenue, revenueEstimate,
      epsBasis: gaap === eps ? 'gaap' : 'adjusted',
    }];
  });
}

function matchPeriods(rows, statements, alternativeStatements = []) {
  return rows.map((row) => {
    const reported = Date.parse(row.publishedAt) / 1000;
    const candidates = statements.filter((quarter) => quarter.time < reported
      && reported - quarter.time <= 120 * DAY && quarter.revenue !== null)
      .sort((a, b) => b.time - a.time);
    let quarter = candidates[0];
    let validationSource = 'sec';
    const matchesRevenue = (candidate) => candidate && Math.abs(row.revenue - candidate.revenue)
      / Math.max(Math.abs(candidate.revenue), 1) <= 0.02;
    if (!matchesRevenue(quarter)) {
      const alternative = alternativeStatements.filter((candidate) => candidate.time < reported
        && reported - candidate.time <= 120 * DAY && candidate.revenue !== null)
        .sort((a, b) => b.time - a.time)[0];
      // Only the latest independently reported period is eligible; never hunt older quarters for a matching value.
      if (matchesRevenue(alternative) && (!quarter || alternative.time >= quarter.time - 14 * DAY)) {
        quarter = alternative;
        validationSource = 'yahoo';
      }
    }
    if (!quarter) throw new Error(`No reported period for ${row.publishedAt}.`);
    // Rounded revenue in the consensus table must agree with the independent statement.
    const relative = Math.abs(row.revenue - quarter.revenue) / Math.max(Math.abs(quarter.revenue), 1);
    if (relative > 0.02) throw new Error(`Revenue/period mismatch at ${row.publishedAt}.`);
    return { ...row, periodEnd: new Date(quarter.time * 1000).toISOString().slice(0, 10), validationSource };
  });
}

function parseConstituents(html) {
  const table = /<table\b[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (table === undefined) throw new Error('S&P 500 constituent table missing.');
  const members = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((match) => {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plain(cell[1]));
    if (cells.length !== 8) return [];
    const symbol = cells[0].replace(/\./g, '-');
    if (!/^[A-Z0-9-]{1,20}$/.test(symbol)) throw new Error('Invalid constituent symbol.');
    return [{ symbol, name: cells[1], sector: cells[2], industry: cells[3] }];
  });
  if (members.length < 490 || members.length > 510 || new Set(members.map((member) => member.symbol)).size !== members.length) {
    throw new Error('Unexpected S&P 500 membership count.');
  }
  return members;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((argument) => argument.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) throw new Error('Invalid import limit.');
  const fullIndex = args.includes('--sp500');
  const symbols = args.filter((argument) => argument !== limitArg && argument !== '--sp500');
  let members = [];
  if (fullIndex) {
    const response = await fetch(constituentsUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Constituents HTTP ${response.status}`);
    members = parseConstituents(await response.text());
    symbols.push(...members.map((member) => member.symbol).filter((symbol) => !symbols.includes(symbol)));
  }
  if (!symbols.length || symbols.some((symbol) => !/^[A-Z0-9.-]{1,20}$/.test(symbol))) {
    throw new Error('Supply explicit company tickers.');
  }
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'financial-history.json'), 'utf8'));
  const consensus = JSON.parse(fs.readFileSync(path.join(root, 'reported-consensus.json'), 'utf8'));
  const universe = JSON.parse(fs.readFileSync(path.join(root, 'financial-universe.json'), 'utf8'));
  const accepted = [];
  const rejected = [];
  const retained = [];
  const coveragePath = path.join(root, 'sp500-earnings-coverage.json');
  const save = () => {
    if (accepted.length) {
      snapshot.generatedAt = new Date().toISOString();
      for (const [filename, value] of [
        ['reported-consensus.json', consensus], ['financial-history.json', snapshot], ['financial-universe.json', universe],
      ]) fs.writeFileSync(path.join(root, filename), `${JSON.stringify(value, null, 2)}\n`);
    }
    if (fullIndex) fs.writeFileSync(coveragePath, `${JSON.stringify(updateCoverage(
      { ...snapshot, generatedAt: new Date().toISOString() },
      { membershipSource: constituentsUrl, requiredReports: 6, members },
      rejected,
    ), null, 2)}\n`);
  };
  for (const symbol of symbols) {
    if (accepted.length >= limit) break;
    try {
      const previous = snapshot.companies[symbol];
      if (previous && complete(previous.sources)) {
        retained.push(symbol);
        console.log(`${symbol}: retained complete existing reports`);
        continue;
      }
      if (previous && !fullIndex) throw new Error('Already in the snapshot; use --sp500 to complete missing comparisons.');
      if (consensus[symbol]?.some((row) => row.epsEstimateComparable === false)) {
        throw new Error('Reviewed non-comparable EPS must not be overwritten by automated consensus.');
      }
      // These reports may use FFO rather than EPS. Require a separate methodology review.
      if (members.find((member) => member.symbol === symbol)?.industry.includes('REIT')
        || ['WELL', 'PLD', 'EQIX', 'AMT', 'SPG', 'DLR', 'PSA', 'O'].includes(symbol)) {
        throw new Error('REIT: FFO/EPS methodology requires manual review.');
      }
      let html;
      let tableUrl;
      for (const exchange of ['NASDAQ', 'NYSE']) {
        const url = `https://www.marketbeat.com/stocks/${exchange}/${symbol}/earnings/`;
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`MarketBeat HTTP ${response.status}`);
        const body = await response.text();
        if (body.includes('id="earnings-history"')) { html = body; tableUrl = response.url; break; }
      }
      if (!html) throw new Error('Public historical earnings table unavailable.');
      const pairs = parseConsensusTable(html, Date.now(), 6);
      if (pairs.length !== 6) throw new Error(`Only ${pairs.length}/6 complete historical pairs.`);
      const sec = await fetchSecQuarterly(symbol);
      const yahoo = await yahooHistory(symbol);
      const matched = matchPeriods(pairs, sec, yahoo);
      if (new Set(matched.map((row) => row.periodEnd)).size !== 6) throw new Error('Multiple reports map to the same period.');
      // Detect suspicious split scales across neighboring rows as well as within a pair.
      for (let index = 1; index < matched.length; index++) {
        const a = Math.abs(matched[index - 1].eps);
        const b = Math.abs(matched[index].eps);
        if (Math.min(a, b) >= 0.1 && Math.max(a, b) / Math.min(a, b) >= 5) {
          throw new Error('EPS history needs manual split or exceptional-item verification.');
        }
      }
      const earnings = parseEarningsConsensus(await yahooSummary(symbol));
      const sources = combineFinancialSources(previous?.sources ?? {}, {
        sec, yahoo, 'yahoo-earnings': earnings.map((row) => ({ ...row, revenueEstimate: null })),
        'reported-consensus': matched.map((row) => ({
          time: Date.parse(`${row.periodEnd}T00:00:00Z`) / 1000,
          fiscalYear: '', period: '', revenue: row.revenue, revenueEstimate: row.revenueEstimate,
          eps: row.eps, epsEstimate: row.epsEstimate, epsBasis: row.epsBasis,
          reportedAt: Date.parse(row.publishedAt) / 1000,
        })),
      });
      const quarters = displayed(sources);
      if (quarters.length !== 6 || quarters.some((row) => !Number.isFinite(row.revenueBeat) || !Number.isFinite(row.epsBeat))) {
        throw new Error('The actual six displayed reports do not all contain both beats.');
      }
      const now = new Date().toISOString();
      snapshot.companies[symbol] = { updatedAt: now, backfilledAt: now, sources };
      const imported = matched.map((row) => ({ ...row, tableSource: tableUrl }));
      consensus[symbol] = [...imported, ...(consensus[symbol] ?? [])
        .filter((row) => !imported.some((entry) => entry.periodEnd === row.periodEnd))]
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      if (!universe.includes(symbol)) universe.push(symbol);
      accepted.push(symbol);
      console.log(`${symbol}: accepted 6/6 revenue and EPS beats`);
    } catch (error) {
      rejected.push({ symbol, reason: error.message });
      console.error(`${symbol}: NOT imported: ${error.message}`);
    }
    if (fullIndex) save();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  save();
  console.log(JSON.stringify({ accepted, retained, rejected }, null, 2));
  if (rejected.length) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { amount, parseConsensusTable, matchPeriods, displayed, parseConstituents, complete };
