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

function validatePair(row) {
  if (![row.eps, row.epsEstimate, row.revenue, row.revenueEstimate].every(Number.isFinite)) {
    throw new Error('Missing comparable actual/estimate pair.');
  }
  if (row.revenue <= 0 || row.revenueEstimate <= 0) throw new Error('Non-positive reported revenue or consensus.');
  const small = Math.min(Math.abs(row.eps), Math.abs(row.epsEstimate));
  const large = Math.max(Math.abs(row.eps), Math.abs(row.epsEstimate));
  // Mixed pre-/post-split observations can still have an arithmetically correct surprise.
  if (small >= 0.1 && large / small >= 5) throw new Error('EPS pair needs manual split/methodology verification.');
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
    validatePair({ eps, epsEstimate, revenue, revenueEstimate });
    if (Math.abs(eps - epsEstimate - beat) > 0.011) throw new Error('EPS surprise does not match the published pair.');
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
      const alternatives = alternativeStatements.filter((candidate) => candidate.time < reported
        && reported - candidate.time <= 120 * DAY && candidate.revenue !== null)
        .sort((a, b) => b.time - a.time);
      // Only the latest independently reported period is eligible; never hunt older quarters for a matching value.
      const latest = alternatives[0];
      const alternative = alternatives.find((candidate) => latest
        && latest.time - candidate.time <= 14 * DAY && matchesRevenue(candidate)) ?? latest;
      if (matchesRevenue(alternative) && (!quarter || alternative.time >= quarter.time - 14 * DAY)) {
        quarter = alternative;
        validationSource = alternative.validationSource ?? 'yahoo';
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

function importOfflineTables(capture, snapshot, consensus) {
  const capturedAt = Date.parse(capture.capturedAt);
  if (!Number.isFinite(capturedAt) || !Array.isArray(capture.results)
    || !Array.isArray(capture.supplements ?? [])
    || new Set(capture.results.map((table) => table.symbol)).size !== capture.results.length) {
    throw new Error('Invalid offline table capture.');
  }
  const report = [];
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  for (const table of capture.results) {
    const symbol = table.symbol;
    const previous = snapshot.companies[symbol];
    if (!previous) throw new Error(`Offline import cannot add an unknown company: ${symbol}.`);
    const result = { symbol, imported: [], rejected: [], complete: complete(previous.sources) };
    report.push(result);
    if (result.complete) continue;
    if (consensus[symbol]?.some((row) => row.epsEstimateComparable === false)) {
      result.rejected.push('Reviewed non-comparable EPS requires manual review.');
      continue;
    }
    const tableUrl = /^https:\/\/www\.marketbeat\.com\/stocks\/(?:NYSE|NASDAQ)\/([A-Z0-9.-]+)\/earnings\/$/.exec(table.url ?? '');
    if (table.status !== 200 || !Array.isArray(table.headers) || !Array.isArray(table.rows)
      || tableUrl?.[1].replace(/\./g, '-') !== symbol) {
      result.rejected.push('Public historical table unavailable or invalid.');
      continue;
    }
    const needed = displayed(previous.sources).filter((row) =>
      !Number.isFinite(row.revenueBeat) || !Number.isFinite(row.epsBeat) || row.revenueBeatProvisional);
    const pastRows = table.rows.filter((row) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row.cells?.[0])
      && Date.parse(row.cells[0]) <= capturedAt).slice(0, 6);
    const alternatives = ['yahoo', 'yahoo-earnings'].flatMap((source) =>
      (previous.sources[source] ?? []).map((quarter) => ({ ...quarter, validationSource: source })));
    const store = (pair) => {
      if (!needed.some((quarter) => quarter.periodEnd === pair.periodEnd)
        || consensus[symbol]?.some((entry) => entry.periodEnd === pair.periodEnd)) return;
      validatePair(pair);
      const time = Date.parse(`${pair.periodEnd}T00:00:00Z`) / 1000;
      if (!Number.isFinite(time) || new Date(time * 1000).toISOString().slice(0, 10) !== pair.periodEnd) {
        throw new Error('Invalid supplemental period end.');
      }
      if (consensus[symbol]?.some((entry) => Math.abs(Date.parse(entry.periodEnd) / 1000 - time) <= 14 * DAY)) return;
      const duplicate = alternatives.find((quarter) => Math.abs(quarter.time - time) <= 14 * DAY
        && (previous.sources.sec ?? []).some((statement) => statement.revenue > 0
          && statement.revenue === quarter.revenue && Math.abs(statement.time - time) > 14 * DAY
          && Math.abs(statement.time - time) <= 31 * DAY));
      if (duplicate) throw new Error(`Fiscal/calendar duplicate requires date review at ${pair.periodEnd}.`);
      const published = Date.parse(pair.publishedAt);
      if (!Number.isFinite(published) || published > capturedAt || published / 1000 <= time
        || published / 1000 - time > 120 * DAY) {
        throw new Error(`No verified publication date for ${pair.periodEnd}.`);
      }
      const independent = matchPeriods([pair], previous.sources.sec ?? [], alternatives)[0];
      if (Math.abs(Date.parse(independent.periodEnd) / 1000 - time) > 14 * DAY) {
        throw new Error(`Supplemental period mismatch at ${pair.periodEnd}.`);
      }
      pair = { ...pair, validationSource: independent.validationSource };
      previous.sources = combineFinancialSources(previous.sources, { 'reported-consensus': [{
        time, fiscalYear: '', period: '', revenue: pair.revenue, revenueEstimate: pair.revenueEstimate,
        eps: pair.eps, epsEstimate: pair.epsEstimate, epsBasis: pair.epsBasis, reportedAt: published / 1000,
      }] });
      previous.updatedAt = capture.capturedAt;
      consensus[symbol] = [...(consensus[symbol] ?? []), pair]
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      result.imported.push(pair.periodEnd);
    };
    for (const supplemental of (capture.supplements ?? []).filter((entry) => entry.symbol === symbol)) {
      for (const row of supplemental.rows) {
        if (!needed.some((quarter) => quarter.periodEnd === row.periodEnd)
          || consensus[symbol]?.some((entry) => entry.periodEnd === row.periodEnd)) continue;
        try {
          const seekingAlpha = supplemental.source === `https://seekingalpha.com/symbol/${symbol.replace('-', '.')}/earnings/eps-surprise-summary?period=quarterly`;
          const investing = supplemental.provider === 'Investing.com earnings history'
            && /^https:\/\/www\.investing\.com\/equities\/[a-z0-9.-]+-earnings$/.test(supplemental.source)
            && supplemental.title?.includes(`(${symbol === 'NVO' ? 'NOVOb' : symbol})`);
          if ((!seekingAlpha && !investing)
            || !Number.isFinite(Date.parse(supplemental.observedAt))
            || Date.parse(supplemental.observedAt) > capturedAt) throw new Error('Invalid supplemental source or observation date.');
          validatePair(row);
          const time = Date.parse(`${row.periodEnd}T00:00:00Z`) / 1000;
          const fiscal = /^F(Q[1-4] \d{4})/.exec(row.periodLabel ?? '')?.[1];
          const publication = pastRows.find((entry) => fiscal && entry.cells[1] === fiscal);
          const knownReport = (previous.sources['yahoo-earnings'] ?? []).find((quarter) =>
            Math.abs(quarter.time - time) <= 14 * DAY && quarter.reportedAt);
          const publishedAt = row.publishedAt ?? (publication
            ? (() => {
              const [month, day, year] = publication.cells[0].split('/');
              return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T23:59:59Z`;
            })()
            : knownReport ? new Date(knownReport.reportedAt * 1000).toISOString() : null);
          const epsActuals = Object.values(previous.sources).flat()
            .filter((quarter) => Math.abs(quarter.time - time) <= 14 * DAY);
          const reviewedBasis = ['gaap', 'adjusted'].includes(row.epsBasis)
            && /^https:\/\/[^/]+\/.+/.test(row.methodologySource ?? '') ? row.epsBasis : null;
          const epsBasis = seekingAlpha ? 'adjusted' : reviewedBasis
            ?? (epsActuals.some((quarter) => quarter.epsBasis === 'adjusted' && Math.abs(quarter.eps - row.eps) < 0.011) ? 'adjusted'
            : ['sec', 'yahoo'].some((source) => (previous.sources[source] ?? []).some((quarter) =>
              Math.abs(quarter.time - time) <= 14 * DAY && quarter.eps !== null
              && Math.abs(quarter.eps - row.eps) < 0.011)) ? 'gaap' : null);
          if (!epsBasis) throw new Error(`EPS methodology requires review at ${row.periodEnd}.`);
          store({
            ...row, source: supplemental.source, tableSource: supplemental.source,
            provider: supplemental.provider, observedAt: supplemental.observedAt, publishedAt, epsBasis,
            publicationSource: row.publishedAt ? supplemental.source
              : publication?.report ? `https://www.marketbeat.com${publication.report}` : 'Yahoo earnings reportedAt',
          });
        } catch (error) {
          result.rejected.push(error.message);
        }
      }
    }
    for (const row of pastRows) {
      try {
        const html = `<table id="earnings-history"><tr>${table.headers.map((value) => `<th>${escape(value)}</th>`).join('')}</tr>`
          + `<tr>${row.cells.map((value, index) => `<td>${index === 8 && row.report
            ? `<a href="${escape(row.report)}">Report</a>` : escape(value)}</td>`).join('')}</tr></table>`;
        const pairs = parseConsensusTable(html, capturedAt);
        if (pairs.length !== 1) throw new Error(`Missing comparable actual/estimate pair at ${row.cells[0]}.`);
        const pair = matchPeriods(pairs, previous.sources.sec ?? [], alternatives)[0];
        store({ ...pair, tableSource: table.url, observedAt: capture.capturedAt });
      } catch (error) {
        result.rejected.push(error.message);
      }
    }
    result.complete = complete(previous.sources);
    result.missing = displayed(previous.sources).filter((row) =>
      !Number.isFinite(row.revenueBeat) || !Number.isFinite(row.epsBeat) || row.revenueBeatProvisional)
      .map((row) => row.periodEnd);
    if (!result.complete && !result.rejected.length) {
      result.rejected.push('The six displayed reports are not all covered by the available source rows.');
    }
  }
  if (report.some((entry) => entry.imported.length)) snapshot.generatedAt = capture.capturedAt;
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const offlineArg = args.find((argument) => argument.startsWith('--offline-tables='));
  if (offlineArg) {
    if (args.length !== 1) throw new Error('Offline tables cannot be combined with network import options.');
    const capture = JSON.parse(fs.readFileSync(offlineArg.slice('--offline-tables='.length), 'utf8'));
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'financial-history.json'), 'utf8'));
    const consensus = JSON.parse(fs.readFileSync(path.join(root, 'reported-consensus.json'), 'utf8'));
    const report = importOfflineTables(capture, snapshot, consensus);
    if (report.some((entry) => entry.imported.length)) {
      const coveragePath = path.join(root, 'sp500-earnings-coverage.json');
      const coverage = updateCoverage(snapshot, JSON.parse(fs.readFileSync(coveragePath, 'utf8')));
      for (const [filename, value] of [
        ['reported-consensus.json', consensus], ['financial-history.json', snapshot], ['sp500-earnings-coverage.json', coverage],
      ]) fs.writeFileSync(path.join(root, filename), `${JSON.stringify(value, null, 2)}\n`);
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.some((entry) => !entry.complete)) process.exitCode = 1;
    return;
  }
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
module.exports = { amount, parseConsensusTable, matchPeriods, displayed, parseConstituents, complete, importOfflineTables };
