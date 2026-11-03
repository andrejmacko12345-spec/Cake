import { YAHOO_USER_AGENT, yahooQuoteSummary } from './fundamentals';
import { fetchFmpQuarterly, FmpQuarterly, getFmpKey } from './fmp';

type Raw = { raw?: number } | undefined;

type SummaryResult = {
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
  earningsHistory?: {
    history?: Array<{
      quarter?: Raw;
      epsActual?: Raw;
    }>;
  };
  earnings?: {
    earningsChart?: {
      quarterly?: Array<{ date?: string }>;
      currentQuarterEstimateDate?: string;
      currentQuarterEstimateYear?: number;
    };
  };
};

export type QuarterResult = {
  label: string;
  periodEnd: string;
  epsActual: number | null;
  epsYoY: number | null;
  revenue: number | null;
  revenueYoY: number | null;
  revenueQoQ: number | null;
};

export type NewsItem = { title: string; publisher: string; link: string; time: number };

export type CompanyEvents = {
  symbol: string;
  name: string;
  financialDataIssue: 'missing-key' | 'plan-required' | 'provider-error' | null;
  nextEarnings: {
    date: number;
    estimate: boolean;
    label: string | null;
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

async function fetchTimeseries(symbol: string): Promise<{ revenue: SeriesPoint[]; eps: SeriesPoint[] }> {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=quarterlyTotalRevenue,quarterlyDilutedEPS&merge=false&period1=${now - 4 * 365 * DAY}&period2=${now}`;
  const data = await getJson<{
    timeseries?: { result?: Array<Record<string, unknown> & { meta: { type: string[] } }> };
  }>(url);
  const pick = (type: string): SeriesPoint[] => {
    const entry = data.timeseries?.result?.find((item) => item.meta.type[0] === type);
    const rows = (entry?.[type] ?? []) as Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>;
    return rows
      .filter((row) => row.asOfDate && typeof row.reportedValue?.raw === 'number')
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

function growth(current: number | null, previous: number | undefined) {
  return current !== null && previous !== undefined && previous > 0
    ? (current / previous - 1) * 100
    : null;
}

function fiscalLabel(date: string | undefined) {
  const match = date?.match(/^(\d)Q(\d{4})$/);
  return match ? `Q${match[1]} ${match[2]}` : null;
}

function buildQuarters(
  summary: SummaryResult,
  series: { revenue: SeriesPoint[]; eps: SeriesPoint[] },
): QuarterResult[] {
  const history = (summary.earningsHistory?.history ?? []).filter((item) => num(item.quarter) !== null);
  const chart = summary.earnings?.earningsChart?.quarterly ?? [];
  const aligned = chart.length === history.length;

  const quarters = history.map((item, index): QuarterResult => {
    const periodEnd = num(item.quarter) as number;
    const epsActual = num(item.epsActual);
    const revenuePoint = nearest(series.revenue, periodEnd, 12);
    const revenue = revenuePoint?.value ?? null;
    const epsPoint = nearest(series.eps, periodEnd, 12);
    const eps = epsActual ?? epsPoint?.value ?? null;
    return {
      label: (aligned ? fiscalLabel(chart[index].date) : null) ?? new Date(periodEnd * 1000).toISOString().slice(0, 10),
      periodEnd: new Date(periodEnd * 1000).toISOString().slice(0, 10),
      epsActual: eps,
      epsYoY: growth(eps, nearest(series.eps, periodEnd - 365 * DAY, 20)?.value),
      revenue,
      revenueYoY: growth(revenue, nearest(series.revenue, periodEnd - 365 * DAY, 20)?.value),
      revenueQoQ: growth(revenue, nearest(series.revenue, periodEnd - 91 * DAY, 20)?.value),
    };
  });
  return quarters.reverse();
}

// Fetch each fiscal quarter separately to stay within FMP's five-row free limit.
function applyFmp(fmp: FmpQuarterly): QuarterResult[] {
  const rows = fmp.quarters;
  return rows.map((row): QuarterResult => {
    const priorYear = rows.find((candidate) =>
      candidate.period === row.period && Number(candidate.fiscalYear) === Number(row.fiscalYear) - 1,
    );
    const previousQuarter = nearest(
      rows.flatMap((candidate) => candidate.revenue === null ? [] : [{ time: candidate.time, value: candidate.revenue }]),
      row.time - 91 * DAY,
      45,
    );
    return {
      label: `${row.period} ${row.fiscalYear}`,
      periodEnd: new Date(row.time * 1000).toISOString().slice(0, 10),
      epsActual: row.eps,
      epsYoY: growth(row.eps, priorYear?.eps ?? undefined),
      revenue: row.revenue,
      revenueYoY: growth(row.revenue, priorYear?.revenue ?? undefined),
      revenueQoQ: growth(row.revenue, previousQuarter?.value),
    };
  }).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export async function fetchCompanyEvents(symbol: string, force = false): Promise<CompanyEvents> {
  const cached = cache.get(symbol);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [summaryResult, seriesResult, dividendResult, newsResult, fmpResult] = await Promise.allSettled([
    yahooQuoteSummary<SummaryResult>(symbol, 'price,calendarEvents,earningsHistory,earnings'),
    fetchTimeseries(symbol),
    fetchDividends(symbol),
    fetchNews(symbol),
    getFmpKey().then((key) => key ? fetchFmpQuarterly(symbol, key) : null),
  ]);
  if (summaryResult.status === 'rejected') throw summaryResult.reason;
  const summary = summaryResult.value;
  if (!summary) throw new Error(`Údaje pre ${symbol} sa nepodarilo nájsť.`);

  const series = seriesResult.status === 'fulfilled' ? seriesResult.value : { revenue: [], eps: [] };
  let quarters = buildQuarters(summary, series);
  const now = Date.now() / 1000;
  const earnings = summary.calendarEvents?.earnings;
  const nextDate = num(earnings?.earningsDate?.[0]);
  const callDate = num(earnings?.earningsCallDate?.[0]);
  const chart = summary.earnings?.earningsChart;
  const nextLabel = chart?.currentQuarterEstimateDate && chart.currentQuarterEstimateYear
    ? fiscalLabel(`${chart.currentQuarterEstimateDate.replace('Q', '')}Q${chart.currentQuarterEstimateYear}`)
    : null;
  const upcoming = nextDate !== null && nextDate >= now - 12 * 3600;
  const latestPeriod = quarters[0] ? Date.parse(`${quarters[0].periodEnd}T00:00:00Z`) / 1000 : 0;
  const reportCandidates = [callDate, upcoming ? null : nextDate]
    .filter((value): value is number => value !== null && value > latestPeriod && value <= now);

  const reportedAt = reportCandidates.length ? Math.max(...reportCandidates) : null;

  let financialDataIssue: CompanyEvents['financialDataIssue'] = null;
  if (fmpResult.status === 'rejected') {
    const message = fmpResult.reason instanceof Error ? fmpResult.reason.message : String(fmpResult.reason);
    financialDataIssue = message.includes('HTTP 402') ? 'plan-required' : 'provider-error';
  } else if (fmpResult.value === null) {
    financialDataIssue = 'missing-key';
  } else {
    if (fmpResult.value.quarters.length) quarters = applyFmp(fmpResult.value);
    if (fmpResult.value.error) {
      financialDataIssue = fmpResult.value.error.includes('HTTP 402') ? 'plan-required' : 'provider-error';
    }
  }

  const value: CompanyEvents = {
    symbol,
    name: summary.price?.shortName ?? summary.price?.longName ?? symbol,
    financialDataIssue,
    nextEarnings: upcoming
      ? {
        date: nextDate as number,
        estimate: earnings?.isEarningsDateEstimate ?? true,
        label: nextLabel,
      }
      : null,
    lastReportDate: reportCandidates.length ? Math.max(...reportCandidates) : null,
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
