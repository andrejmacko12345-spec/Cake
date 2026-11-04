import { calendarQuarterLabel, combineFinancialSources, FinancialQuarter, growth } from './quarterly';

type Value = { raw?: number } | number | undefined;
type EarningsPoint = {
  date?: string;
  periodEndDate?: Value;
  reportedDate?: Value;
  actual?: Value;
  estimate?: Value;
};
export type EarningsSummary = {
  calendarEvents?: { earnings?: { earningsDate?: Value[] } };
  earningsHistory?: {
    defaultMethodology?: string;
    history?: { quarter?: Value; epsActual?: Value; epsEstimate?: Value }[];
  };
  earnings?: {
    defaultMethodology?: string;
    financialCurrency?: string;
    earningsChart?: {
      quarterly?: EarningsPoint[];
      currentPeriodEndDate?: Value;
      currentQuarterActual?: Value;
      currentQuarterEstimate?: Value;
    };
    financialsChart?: { quarterly?: { date?: string; revenue?: Value }[] };
  };
  earningsTrend?: {
    trend?: {
      period?: string;
      endDate?: string;
      revenueEstimate?: { avg?: Value; revenueCurrency?: string; yearAgoRevenue?: Value; growth?: Value };
      earningsEstimate?: { avg?: Value; earningsCurrency?: string; yearAgoEps?: Value; growth?: Value };
    }[];
  };
};

function num(value: Value) {
  const raw = typeof value === 'number' ? value : value?.raw;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function parseEarningsConsensus(summary: EarningsSummary, now = Date.now() / 1000): FinancialQuarter[] {
  const chart = summary.earnings?.earningsChart;
  const basis = (methodology: string | undefined) =>
    methodology === 'nongaap' ? 'adjusted' : methodology === 'gaap' ? 'gaap' : undefined;
  const chartBasis = basis(summary.earnings?.defaultMethodology ?? summary.earningsHistory?.defaultMethodology);
  const historyBasis = basis(summary.earningsHistory?.defaultMethodology ?? summary.earnings?.defaultMethodology);
  const make = (
    time: number, eps: number | null, estimate: number | null,
    epsBasis: FinancialQuarter['epsBasis'] = chartBasis,
  ): FinancialQuarter => ({
    time, fiscalYear: '', period: '', revenue: null, eps, epsEstimate: estimate, epsBasis,
  });
  let rows = (summary.earningsHistory?.history ?? []).flatMap((point) => {
    const time = num(point.quarter);
    return time !== null && time <= now && num(point.epsActual) !== null
      ? [make(time, num(point.epsActual), num(point.epsEstimate), historyBasis)] : [];
  });
  const chartRows = (chart?.quarterly ?? []).flatMap((point) => {
    const time = num(point.periodEndDate);
    if (time === null || time > now || num(point.actual) === null) return [];
    const row = make(time, num(point.actual), num(point.estimate));
    const reportedAt = num(point.reportedDate);
    if (reportedAt !== null) row.reportedAt = reportedAt;
    return [row];
  });
  rows = combineFinancialSources({ earnings: rows }, { earnings: chartRows }).earnings;
  const currentTime = num(chart?.currentPeriodEndDate);
  if (currentTime !== null && currentTime <= now && num(chart?.currentQuarterActual) !== null) {
    rows = combineFinancialSources({ earnings: rows }, {
      earnings: [make(currentTime, num(chart?.currentQuarterActual), num(chart?.currentQuarterEstimate))],
    }).earnings;
  }
  for (const row of rows) {
    const calendarDate = new Date(row.time * 1000);
    const dateLabel = `${Math.floor(calendarDate.getUTCMonth() / 3) + 1}Q${calendarDate.getUTCFullYear()}`;
    const point = chart?.quarterly?.find((point) => num(point.periodEndDate) === row.time);
    const revenue = summary.earnings?.financialsChart?.quarterly
      ?.find((entry) => entry.date === (point?.date ?? dateLabel));
    row.revenue = num(revenue?.revenue);
    row.revenueCurrency = summary.earnings?.financialCurrency;
    // earningsTrend is a rolling forecast, not an archived pre-release consensus.
    // Do not turn its 0q/+1q values into historical revenue surprises.
  }
  return rows.filter((row) => row.reportedAt === undefined || row.reportedAt <= now);
}

const DAY = 86400;
const startOfDay = (time: number) => Math.floor(time / DAY) * DAY;

function upcomingTrend(
  summary: EarningsSummary, knownActuals: FinancialQuarter[] = [], now = Date.now() / 1000,
) {
  const actuals = [...knownActuals, ...parseEarningsConsensus(summary, now)]
    .filter((row) => row.time <= now && (row.revenue !== null || row.eps !== null));
  const latest = Math.max(0, ...actuals.map((row) => row.time));
  const expectedReportAt = num(summary.calendarEvents?.earnings?.earningsDate?.[0]);
  if (expectedReportAt === null || expectedReportAt <= now || latest === 0) return null;
  const candidates = (summary.earningsTrend?.trend ?? []).flatMap((trend) => {
    if (!['0q', '+1q'].includes(trend.period ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(trend.endDate ?? '')) return [];
    const time = Date.parse(`${trend.endDate}T00:00:00Z`) / 1000;
    if (!Number.isFinite(time) || new Date(time * 1000).toISOString().slice(0, 10) !== trend.endDate
      || time - latest < 60 * DAY || time - latest > 120 * DAY
      || expectedReportAt < time || expectedReportAt - time > 120 * DAY) return [];
    return [{ time, trend, expectedReportAt }];
  });
  return candidates.sort((a, b) => a.time - b.time)[0] ?? null;
}

export type UpcomingEarningsEstimates = {
  label: string;
  periodEnd: string;
  revenue: number | null;
  revenueYoY: number | null;
  revenueCurrency: string | null;
  eps: number | null;
  epsYoY: number | null;
  epsCurrency: string | null;
};

export function parseUpcomingEarnings(
  summary: EarningsSummary, knownActuals: FinancialQuarter[] = [], now = Date.now() / 1000,
): UpcomingEarningsEstimates | null {
  const candidate = upcomingTrend(summary, knownActuals, now);
  if (!candidate) return null;
  const revenue = candidate.trend.revenueEstimate;
  const eps = candidate.trend.earningsEstimate;
  const currency = (value: string | undefined) => value !== undefined && /^[A-Z]{3}$/.test(value) ? value : null;
  const revenueCurrency = currency(revenue?.revenueCurrency);
  const epsCurrency = currency(eps?.earningsCurrency);
  const revenueActual = revenueCurrency ? num(revenue?.avg) : null;
  const epsActual = epsCurrency ? num(eps?.avg) : null;
  const yoy = (estimate: number | null, previous: Value, rate: Value) => {
    if (estimate === null) return null;
    const base = num(previous);
    if (base !== null) return growth(estimate, base);
    const value = num(rate);
    return value === null ? null : value * 100;
  };
  return {
    label: calendarQuarterLabel(candidate.time),
    periodEnd: new Date(candidate.time * 1000).toISOString().slice(0, 10),
    revenue: revenueActual,
    revenueYoY: yoy(revenueActual, revenue?.yearAgoRevenue, revenue?.growth),
    revenueCurrency,
    eps: epsActual,
    epsYoY: yoy(epsActual, eps?.yearAgoEps, eps?.growth),
    epsCurrency,
  };
}

export function captureRevenueForecast(
  summary: EarningsSummary, knownActuals: FinancialQuarter[] = [], now = Date.now() / 1000,
): FinancialQuarter[] {
  const candidate = upcomingTrend(summary, knownActuals, now);
  // Archiving stops before the report day; displaying today's live estimates does not.
  if (!candidate || startOfDay(candidate.expectedReportAt) <= now) return [];
  const revenueEstimate = num(candidate.trend.revenueEstimate?.avg);
  const revenueCurrency = candidate.trend.revenueEstimate?.revenueCurrency;
  if (revenueEstimate === null || revenueEstimate <= 0 || !/^[A-Z]{3}$/.test(revenueCurrency ?? '')) return [];
  return [{
    time: candidate.time, fiscalYear: '', period: '', revenue: null, eps: null, revenueEstimate,
    revenueCurrency, revenueEstimateCapturedAt: now, expectedReportAt: candidate.expectedReportAt,
  }];
}

export function archivedRevenueConsensus(
  forecasts: FinancialQuarter[], actuals: FinancialQuarter[], now = Date.now() / 1000,
): FinancialQuarter[] {
  return actuals.flatMap((actual) => {
    const reportedAt = actual.reportedAt;
    if (actual.time > now || reportedAt === undefined || reportedAt > now
      || actual.revenue === null || !Number.isFinite(actual.revenue)) return [];
    const forecast = forecasts.find((row) => Math.abs(row.time - actual.time) <= 14 * DAY
      && row.revenueEstimateCapturedAt !== undefined && row.expectedReportAt !== undefined
      && row.revenueEstimateCapturedAt < startOfDay(row.expectedReportAt)
      && row.revenueEstimateCapturedAt < startOfDay(reportedAt)
      && row.revenueEstimateCapturedAt >= row.expectedReportAt - 120 * DAY
      && Math.abs(reportedAt - row.expectedReportAt) <= 14 * DAY
      && row.revenueCurrency !== undefined && row.revenueCurrency === actual.revenueCurrency
      && row.revenueEstimate != null && Number.isFinite(row.revenueEstimate) && row.revenueEstimate > 0);
    return forecast ? [{
      ...actual, eps: null, epsEstimate: null,
      revenueEstimate: forecast.revenueEstimate,
      revenueEstimateCapturedAt: forecast.revenueEstimateCapturedAt,
    }] : [];
  });
}
