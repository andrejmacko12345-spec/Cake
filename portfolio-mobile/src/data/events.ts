import { YAHOO_USER_AGENT, yahooQuoteSummary } from './fundamentals';
import { fetchFmpQuarterly, getFmpKey } from './fmp';
import { applyEarningsConsensus, combineFinancialSources, FinancialQuarter, FinancialSources, mergeQuarters, QuarterResult } from './quarterly';
import { fetchSecQuarterly } from './sec';
import { getFinancialHistory, saveFinancialHistory } from './earnings-history';
import { archivedRevenueConsensus, EarningsSummary, parseEarningsConsensus, parseUpcomingEarnings, UpcomingEarningsEstimates } from './earnings-consensus';
export type { QuarterResult } from './quarterly';

type Raw = { raw?: number } | undefined;

type SummaryResult = EarningsSummary & {
  price?: { shortName?: string; longName?: string; currency?: string };
  calendarEvents?: {
    earnings?: {
      earningsDate?: Raw[];
      earningsCallDate?: Raw[];
      isEarningsDateEstimate?: boolean;
    };
    exDividendDate?: Raw;
    dividendDate?: Raw;
  };
};

export type NewsItem = { title: string; publisher: string; link: string; time: number };

export type CompanyEvents = {
  symbol: string;
  name: string;
  financialDataIssue: 'incomplete-data' | null;
  nextEarnings: {
    date: number;
    estimate: boolean;
    label: string | null;
    estimates: UpcomingEarningsEstimates | null;
  } | null;
  lastReportDate: number | null;
  exDividend: number | null;
  dividendPay: number | null;
  dividendAmount: number | null;
  currency: string;
  quarters: QuarterResult[];
  news: NewsItem[];
};

type SeriesPoint = { time: number; value: number };

const DAY = 86400;
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; value: CompanyEvents }>();

function num(value: Raw) {
  return typeof value?.raw === 'number' && Number.isFinite(value.raw) ? value.raw : null;
}

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Zdroj dát vrátil HTTP ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTimeseries(symbol: string, history: boolean): Promise<{ revenue: SeriesPoint[]; eps: SeriesPoint[] }> {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=quarterlyTotalRevenue,quarterlyDilutedEPS&merge=false&period1=${now - (history ? 4 * 365 : 120) * DAY}&period2=${now}`;
  const data = await getJson<{
    timeseries?: { result?: Array<Record<string, unknown> & { meta: { type: string[] } }> };
  }>(url);
  const pick = (type: string): SeriesPoint[] => {
    const rows = (data.timeseries?.result?.flatMap((item) => item[type] ?? []) ?? []) as
      Array<{ asOfDate?: string; reportedValue?: { raw?: number }; periodType?: string }>;
    return rows
      .filter((row) => row.asOfDate && Number.isFinite(Date.parse(row.asOfDate))
        && num(row.reportedValue) !== null && (!row.periodType || row.periodType === '3M'))
      .map((row) => ({ time: Date.parse(`${row.asOfDate}T00:00:00Z`) / 1000, value: row.reportedValue!.raw as number }))
      .sort((a, b) => a.time - b.time);
  };
  return { revenue: pick('quarterlyTotalRevenue'), eps: pick('quarterlyDilutedEPS') };
}

async function fetchDividends(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + '?range=2y&interval=1mo&events=div';
  const data = await getJson<{
    chart?: { result?: Array<{ meta?: { currency?: string }; events?: { dividends?: Record<string, { amount: number; date: number }> } }> };
  }>(url);
  const result = data.chart?.result?.[0];
  const dividends = Object.values(result?.events?.dividends ?? {}).sort((a, b) => a.date - b.date);
  return { amount: dividends[dividends.length - 1]?.amount ?? null, currency: result?.meta?.currency ?? 'USD' };
}

async function fetchNews(symbol: string): Promise<NewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=4&quotesCount=0`;
  const data = await getJson<{
    news?: Array<{ title?: string; publisher?: string; link?: string; providerPublishTime?: number }>;
  }>(url);
  return (data.news ?? [])
    .filter((item) => item.title && item.link && item.providerPublishTime)
    .map((item) => ({
      title: item.title as string,
      publisher: item.publisher ?? '',
      link: item.link as string,
      time: item.providerPublishTime as number,
    }));
}

function nearest(series: SeriesPoint[], target: number, toleranceDays: number) {
  let best: SeriesPoint | undefined;
  for (const point of series) {
    const distance = Math.abs(point.time - target);
    if (distance <= toleranceDays * DAY && (!best || distance < Math.abs(best.time - target))) best = point;
  }
  return best;
}

function yahooQuarters(
  series: { revenue: SeriesPoint[]; eps: SeriesPoint[] },
): FinancialQuarter[] {
  const times = [...new Set([...series.revenue, ...series.eps].map((point) => point.time))];
  return times.map((time): FinancialQuarter => {
    return {
      time,
      fiscalYear: '',
      period: '',
      revenue: nearest(series.revenue, time, 12)?.value ?? null,
      eps: nearest(series.eps, time, 12)?.value ?? null,
    };
  });
}

export async function fetchCompanyEvents(symbol: string, force = false): Promise<CompanyEvents> {
  const cached = cache.get(symbol);
  if (!force && cached && Date.now() - cached.at < (cached.value.financialDataIssue ? 60000 : CACHE_MS)) return cached.value;

  const history = await getFinancialHistory(symbol);
  const [summaryResult, seriesResult, dividendResult, newsResult, fmpResult, secResult] = await Promise.allSettled([
    yahooQuoteSummary<SummaryResult>(symbol, 'price,calendarEvents,earningsHistory,earnings,earningsTrend'),
    fetchTimeseries(symbol, history.needsBackfill),
    fetchDividends(symbol),
    fetchNews(symbol),
    history.needsBackfill ? getFmpKey().then((key) => key ? fetchFmpQuarterly(symbol, key) : null) : Promise.resolve(null),
    history.needsBackfill ? fetchSecQuarterly(symbol) : Promise.resolve([]),
  ]);
  for (const [provider, result] of [['Yahoo financials', seriesResult], ['FMP', fmpResult], ['SEC', secResult]] as const) {
    if (result.status === 'rejected') {
      console.warn(`${symbol}: ${provider}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }
  if (fmpResult.status === 'fulfilled' && fmpResult.value?.error) {
    console.warn(`${symbol}: ${fmpResult.value.error}`);
  }
  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value ?? {} : {};

  const series = seriesResult.status === 'fulfilled' ? seriesResult.value : { revenue: [], eps: [] };
  const sec = secResult.status === 'fulfilled' ? secResult.value : [];
  const fmp = fmpResult.status === 'fulfilled' ? fmpResult.value?.quarters ?? [] : [];
  const yahoo = yahooQuarters(series);
  const yahooEarnings = parseEarningsConsensus(summary);
  const freshSources: FinancialSources = {};
  for (const [source, rows] of Object.entries({ sec, fmp, yahoo, 'yahoo-earnings': yahooEarnings })) {
    if (rows.length) freshSources[source] = rows;
  }
  const sources = combineFinancialSources(history.sources, freshSources);
  const quarters = applyEarningsConsensus(
    mergeQuarters(['sec', 'fmp', 'yahoo', 'yahoo-earnings'].map((source) => sources[source] ?? [])),
    [sources['reported-consensus'] ?? [],
      archivedRevenueConsensus(sources['yahoo-forecast'] ?? [], sources['yahoo-earnings'] ?? []),
      sources['yahoo-earnings'] ?? []],
  );
  if (Object.keys(freshSources).length) {
    const backfilled = history.needsBackfill && (sec.length > 0 || fmp.length > 0
      || (secResult.status === 'fulfilled' && yahoo.length > 0));
    await saveFinancialHistory(symbol, freshSources, backfilled);
  }
  if (!quarters.length && !Object.keys(summary).length) {
    throw new Error(`Údaje pre ${symbol} sa nepodarilo nájsť.`);
  }
  if (summaryResult.status === 'rejected') {
    console.warn(`${symbol}: Yahoo summary: ${summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason)}`);
  }
  const now = Date.now() / 1000;
  const earnings = summary.calendarEvents?.earnings;
  const nextDate = num(earnings?.earningsDate?.[0]);
  const callDate = num(earnings?.earningsCallDate?.[0]);
  const upcoming = nextDate !== null && nextDate > now;
  const upcomingEstimates = upcoming ? parseUpcomingEarnings(summary, Object.values(sources).flat(), now) : null;
  const latestPeriod = quarters[0] ? Date.parse(`${quarters[0].periodEnd}T00:00:00Z`) / 1000 : 0;
  const reportCandidates = [callDate, upcoming ? null : nextDate]
    .filter((value): value is number => value !== null && value > latestPeriod && value <= now);

  const filedAt = sources.sec?.find((row) => Math.abs(row.time - latestPeriod) <= 14 * DAY)?.reportedAt;
  const financialDataIssue = !quarters.length || quarters.slice(0, 6)
    .some((row) => row.revenue === null || row.epsActual === null || row.revenueYoY === null
      || row.revenueBeat === null || row.epsBeat === null)
    ? 'incomplete-data' : null;

  const value: CompanyEvents = {
    symbol,
    name: summary.price?.shortName ?? summary.price?.longName ?? symbol,
    financialDataIssue,
    nextEarnings: upcoming
      ? {
        date: nextDate as number,
        estimate: earnings?.isEarningsDateEstimate ?? true,
        label: upcomingEstimates?.label ?? null,
        estimates: upcomingEstimates,
      }
      : null,
    lastReportDate: reportCandidates.length ? Math.max(...reportCandidates) : filedAt ?? null,
    exDividend: num(summary.calendarEvents?.exDividendDate),
    dividendPay: num(summary.calendarEvents?.dividendDate),
    dividendAmount: dividendResult.status === 'fulfilled' ? dividendResult.value.amount : null,
    currency: dividendResult.status === 'fulfilled' ? dividendResult.value.currency : summary.price?.currency ?? 'USD',
    quarters,
    news: newsResult.status === 'fulfilled' ? newsResult.value : [],
  };
  cache.set(symbol, { at: Date.now(), value });
  return value;
}
