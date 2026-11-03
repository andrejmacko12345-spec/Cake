import AsyncStorage from '@react-native-async-storage/async-storage';
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
      earningsAverage?: Raw;
      revenueAverage?: Raw;
    };
    exDividendDate?: Raw;
    dividendDate?: Raw;
  };
  earningsHistory?: {
    history?: Array<{
      quarter?: Raw;
      epsActual?: Raw;
      epsEstimate?: Raw;
      surprisePercent?: Raw;
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
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  epsYoY: number | null;
  revenue: number | null;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
};

export type NewsItem = { title: string; publisher: string; link: string; time: number };

export type CompanyEvents = {
  symbol: string;
  name: string;
  nextEarnings: {
    date: number;
    estimate: boolean;
    label: string | null;
    epsEstimate: number | null;
    revenueEstimate: number | null;
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
const CACHE_MS = 10 * 60 * 1000;
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
    const epsEstimate = num(item.epsEstimate);
    const revenuePoint = nearest(series.revenue, periodEnd, 12);
    const revenue = revenuePoint?.value ?? null;
    const epsPoint = nearest(series.eps, periodEnd, 12);
    const eps = epsActual ?? epsPoint?.value ?? null;
    const surprise = epsActual !== null && epsEstimate !== null && epsEstimate !== 0
      ? ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100
      : num(item.surprisePercent) !== null ? (num(item.surprisePercent) as number) * 100 : null;
    return {
      label: (aligned ? fiscalLabel(chart[index].date) : null) ?? new Date(periodEnd * 1000).toISOString().slice(0, 10),
      periodEnd: new Date(periodEnd * 1000).toISOString().slice(0, 10),
      epsActual: eps,
      epsEstimate,
      epsSurprisePct: surprise,
      epsYoY: growth(eps, nearest(series.eps, periodEnd - 365 * DAY, 20)?.value),
      revenue,
      revenueYoY: growth(revenue, nearest(series.revenue, periodEnd - 365 * DAY, 20)?.value),
      revenueQoQ: growth(revenue, nearest(series.revenue, periodEnd - 91 * DAY, 20)?.value),
      revenueEstimate: null,
      revenueSurprisePct: null,
    };
  });
  return quarters.reverse();
}

// FMP má dlhšiu históriu tržieb aj historické odhady analytikov, preto má prednosť pred Yahoo.
function applyFmp(quarters: QuarterResult[], fmp: FmpQuarterly) {
  for (const quarter of quarters) {
    const periodEnd = Date.parse(`${quarter.periodEnd}T00:00:00Z`) / 1000;
    const revenue = nearest(fmp.revenue, periodEnd, 15)?.value ?? quarter.revenue;
    quarter.revenue = revenue;
    quarter.revenueYoY = growth(revenue, nearest(fmp.revenue, periodEnd - 365 * DAY, 20)?.value) ?? quarter.revenueYoY;
    quarter.revenueQoQ = growth(revenue, nearest(fmp.revenue, periodEnd - 91 * DAY, 20)?.value) ?? quarter.revenueQoQ;
    const estimate = nearest(fmp.revenueEstimate, periodEnd, 15)?.value;
    if (estimate !== undefined && estimate > 0) {
      quarter.revenueEstimate = estimate;
      quarter.revenueSurprisePct = revenue !== null ? ((revenue - estimate) / estimate) * 100 : null;
    }
  }
}

type SavedEstimate = { date: number; estimate: number };

// Yahoo nedáva odhad tržieb pre už zverejnené štvrťroky, preto si odhad pamätáme z obdobia pred reportom.
async function syncRevenueEstimates(symbol: string, upcoming: { date: number; estimate: number | null } | null) {
  const key = `revenue-estimates:${symbol}`;
  let saved: SavedEstimate[] = [];
  try {
    saved = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as SavedEstimate[];
  } catch {
    saved = [];
  }
  if (upcoming && upcoming.estimate !== null) {
    const next = { date: upcoming.date, estimate: upcoming.estimate };
    saved = [...saved.filter((item) => Math.abs(item.date - next.date) > 20 * DAY), next].slice(-6);
    await AsyncStorage.setItem(key, JSON.stringify(saved)).catch(() => undefined);
  }
  return saved;
}

export async function fetchCompanyEvents(symbol: string, force = false): Promise<CompanyEvents> {
  const cached = cache.get(symbol);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [summaryResult, seriesResult, dividendResult, newsResult] = await Promise.allSettled([
    yahooQuoteSummary<SummaryResult>(symbol, 'price,calendarEvents,earningsHistory,earnings'),
    fetchTimeseries(symbol),
    fetchDividends(symbol),
    fetchNews(symbol),
  ]);
  if (summaryResult.status === 'rejected') throw summaryResult.reason;
  const summary = summaryResult.value;
  if (!summary) throw new Error(`Údaje pre ${symbol} sa nepodarilo nájsť.`);

  const series = seriesResult.status === 'fulfilled' ? seriesResult.value : { revenue: [], eps: [] };
  const quarters = buildQuarters(summary, series);
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

  const savedEstimates = await syncRevenueEstimates(
    symbol,
    upcoming ? { date: nextDate as number, estimate: num(earnings?.revenueAverage) } : null,
  );
  const reportedAt = reportCandidates.length ? Math.max(...reportCandidates) : null;
  if (quarters[0] && reportedAt !== null) {
    const match = savedEstimates
      .filter((item) => item.date > latestPeriod && item.date <= reportedAt + 5 * DAY)
      .sort((a, b) => Math.abs(a.date - reportedAt) - Math.abs(b.date - reportedAt))[0];
    if (match) {
      quarters[0].revenueEstimate = match.estimate;
      if (quarters[0].revenue !== null && match.estimate > 0) {
        quarters[0].revenueSurprisePct = ((quarters[0].revenue - match.estimate) / match.estimate) * 100;
      }
    }
  }

  const fmpKey = await getFmpKey();
  if (fmpKey) {
    const fmp = await fetchFmpQuarterly(symbol, fmpKey).catch(() => null);
    if (fmp) applyFmp(quarters, fmp);
  }

  const value: CompanyEvents = {
    symbol,
    name: summary.price?.shortName ?? summary.price?.longName ?? symbol,
    nextEarnings: upcoming
      ? {
        date: nextDate as number,
        estimate: earnings?.isEarningsDateEstimate ?? true,
        label: nextLabel,
        epsEstimate: num(earnings?.earningsAverage),
        revenueEstimate: num(earnings?.revenueAverage),
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
