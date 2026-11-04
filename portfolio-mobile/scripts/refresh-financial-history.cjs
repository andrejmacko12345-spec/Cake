const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(outputText, filename);
};

const { fetchSecQuarterly } = require('../src/data/sec.ts');
const { fetchFmpQuarterly } = require('../src/data/fmp.ts');
const { applyEarningsConsensus, combineFinancialSources, mergeQuarters } = require('../src/data/quarterly.ts');
const { archivedRevenueConsensus, captureRevenueForecast, parseEarningsConsensus } = require('../src/data/earnings-consensus.ts');
const universe = require('../src/data/financial-universe.json');
const releases = require('../src/data/reported-releases.json');
const reportedConsensus = require('../src/data/reported-consensus.json');
const destination = path.join(path.dirname(require.resolve('../package.json')), 'src', 'data', 'financial-history.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let yahooSession;

async function yahooSummary(symbol) {
  if (!yahooSession) {
    yahooSession = (async () => {
      const response = await fetch('https://fc.yahoo.com', { signal: AbortSignal.timeout(20000) });
      const cookie = response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
      const headers = { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' };
      const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers, signal: AbortSignal.timeout(20000),
      });
      if (!crumbResponse.ok) throw new Error(`Yahoo consensus token HTTP ${crumbResponse.status}`);
      const crumb = (await crumbResponse.text()).trim();
      if (!crumb || crumb.includes('<')) throw new Error('Invalid Yahoo consensus token');
      return { headers, crumb };
    })().catch((error) => { yahooSession = undefined; throw error; });
  }
  const { headers, crumb } = await yahooSession;
  const response = await fetch(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=earningsHistory,earnings,earningsTrend,calendarEvents&crumb=${encodeURIComponent(crumb)}`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) {
    if (response.status === 401) yahooSession = undefined;
    throw new Error(`Yahoo consensus HTTP ${response.status}`);
  }
  const data = await response.json();
  const summary = data.quoteSummary?.result?.[0];
  if (!summary) throw new Error('Yahoo did not return historical consensus');
  return summary;
}

async function yahooHistory(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const response = await fetch(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=quarterlyTotalRevenue,quarterlyDilutedEPS,annualTotalRevenue&period1=${now - 4 * 366 * 86400}&period2=${now}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const data = await response.json();
  if (data.timeseries?.error) throw new Error(`Yahoo: ${JSON.stringify(data.timeseries.error)}`);
  const rows = new Map();
  const annuals = (data.timeseries?.result ?? []).flatMap((result) => result.annualTotalRevenue ?? [])
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.asOfDate));
  for (const result of data.timeseries?.result ?? []) {
    for (const [type, field] of [['quarterlyTotalRevenue', 'revenue'], ['quarterlyDilutedEPS', 'eps']]) {
      for (const point of result[type] ?? []) {
        const time = Date.parse(`${point.asOfDate}T00:00:00Z`) / 1000;
        if (!Number.isFinite(time) || !Number.isFinite(point.reportedValue?.raw)
          || (point.periodType && point.periodType !== '3M')) continue;
        const row = rows.get(time) ?? { time, fiscalYear: '', period: '', revenue: null, eps: null };
        row[field] = point.reportedValue.raw;
        rows.set(time, row);
      }
      for (const row of rows.values()) {
        const anchor = [...annuals].sort((a, b) => Math.abs(Date.parse(a.asOfDate) / 1000 - row.time)
          - Math.abs(Date.parse(b.asOfDate) / 1000 - row.time))[0];
        if (!anchor) continue;
        const offset = Math.round((row.time - Date.parse(anchor.asOfDate) / 1000) / (365.25 / 4 * 86400));
        const ordinal = Number(anchor.asOfDate.slice(0, 4)) * 4 + 3 + offset;
        row.period = `Q${ordinal % 4 + 1}`;
        row.fiscalYear = String(Math.floor(ordinal / 4));
      }
    }
  }
  return [...rows.values()];
}

async function main() {
  const previous = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8'))
    : { version: 1, companies: {} };
  const companies = { ...previous.companies };
  const earningsOnly = process.argv.includes('--earnings-only');
  const requested = process.argv.slice(2).filter((argument) => argument !== '--earnings-only');
  const symbols = requested.length ? requested : universe;
  let refreshed = 0;
  let failures = 0;
  const pendingReview = [];
  for (const symbol of symbols) {
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error(`Invalid symbol: ${symbol}`);
    const sources = {};
    for (const [source, load] of [
      ...(!earningsOnly || !companies[symbol] ? [['sec', () => fetchSecQuarterly(symbol)]] : []),
      ['yahoo', () => yahooHistory(symbol)],
      ['yahoo-earnings', async () => {
        const summary = await yahooSummary(symbol);
        const actuals = parseEarningsConsensus(summary);
        const known = Object.values(companies[symbol]?.sources ?? {}).flat();
        const forecasts = captureRevenueForecast(summary, [...known, ...(sources.yahoo ?? [])]);
        if (forecasts.length) sources['yahoo-forecast'] = forecasts;
        console.log(`${symbol}: ${forecasts.length ? 'archived pre-report revenue estimate' : 'no eligible pre-report estimate'}`);
        return actuals;
      }],
      ...(!earningsOnly && process.env.FMP_API_KEY ? [['fmp', () => fetchFmpQuarterly(symbol, process.env.FMP_API_KEY)
        .then((result) => {
          if (result.error) console.warn(`${symbol}: ${result.error}`);
          return result.quarters;
        })]] : []),
    ]) {
      try {
        const rows = await load();
        if (rows.length) sources[source] = rows;
      } catch (error) {
        console.error(`${symbol} ${source}: ${error.message}`);
      }
      await sleep(250);
    }
    const release = releases[symbol];
    const consensus = reportedConsensus[symbol === 'GOOG' ? 'GOOGL' : symbol];
    if (consensus) {
      sources['reported-consensus'] = consensus
        .filter((entry) => Date.parse(entry.publishedAt) <= Date.now())
        .map((entry) => ({
          time: Date.parse(`${entry.periodEnd}T00:00:00Z`) / 1000,
          fiscalYear: '', period: '', revenue: entry.revenue, revenueEstimate: entry.revenueEstimate,
          eps: entry.eps, epsEstimate: entry.epsEstimate, epsBasis: entry.epsBasis,
          epsEstimateComparable: entry.epsEstimateComparable,
          reportedAt: Date.parse(entry.publishedAt) / 1000,
        }));
    }
    if (release && Date.parse(release.publishedAt) <= Date.now()) {
      const quarters = release.quarters.map((row) => ({
        time: Date.parse(`${row.periodEnd}T00:00:00Z`) / 1000,
        fiscalYear: row.fiscalYear,
        period: row.period,
        revenue: row.revenue,
        eps: row.eps,
        reportedAt: Date.parse(release.publishedAt) / 1000,
      }));
      // Reviewed GAAP releases bridge the delay before SEC companyfacts updates.
      sources.sec = combineFinancialSources({ sec: quarters }, { sec: sources.sec ?? [] }).sec;
    }
    if (!Object.keys(sources).length) {
      failures++;
      console.error(`${symbol}: no new data; retaining previous snapshot`);
      continue;
    }
    const combined = combineFinancialSources(companies[symbol]?.sources ?? {}, sources);
    if (combined['yahoo-earnings']) {
      combined['yahoo-earnings'] = combined['yahoo-earnings'].map((row) => ({ ...row, revenueEstimate: null }));
    }
    companies[symbol] = {
      updatedAt: new Date().toISOString(),
      backfilledAt: earningsOnly && companies[symbol]
        ? companies[symbol].backfilledAt ?? companies[symbol].updatedAt : new Date().toISOString(),
      sources: combined,
    };
    const quarters = applyEarningsConsensus(
      mergeQuarters(['sec', 'fmp', 'yahoo', 'yahoo-earnings'].map((source) => combined[source] ?? [])),
      [combined['reported-consensus'] ?? [],
        archivedRevenueConsensus(combined['yahoo-forecast'] ?? [], combined['yahoo-earnings'] ?? []),
        combined['yahoo-earnings'] ?? []],
    ).slice(0, 6);
    for (const row of quarters.filter((row) => row.revenueBeatProvisional)) {
      pendingReview.push(`| ${symbol} | ${row.periodEnd} | ${row.revenueBeat} | https://finance.yahoo.com/quote/${symbol}/analysis/ |`);
    }
    console.log(`${symbol}: ${mergeQuarters(Object.values(combined)).length} quarters; latest 6 revenue beat `
      + `${quarters.filter((row) => row.revenueBeat !== null).length}/${quarters.length}; EPS beat `
      + `${quarters.filter((row) => row.epsBeat !== null).length}/${quarters.length}`);
    refreshed++;
  }
  if (!refreshed) throw new Error('No symbols refreshed; refusing to publish an empty update.');
  const snapshot = { version: 1, generatedAt: new Date().toISOString(), companies };
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.renameSync(temporary, destination);
  const review = '\n## Revenue beats awaiting manual verification\n\n'
    + (pendingReview.length ? '| Symbol | Period end | Provisional beat | Yahoo |\n| --- | --- | --- | --- |\n'
      + pendingReview.join('\n') : 'No provisional revenue beats in the latest six reports.');
  console.log(review);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${review}\n`);
  console.log(`Saved ${Object.keys(companies).length} symbols; ${failures} failed.`);
  if (failures) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { yahooHistory, yahooSummary };
