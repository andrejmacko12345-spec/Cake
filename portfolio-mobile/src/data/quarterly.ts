export type FinancialQuarter = {
  time: number;
  fiscalYear: string;
  period: string;
  revenue: number | null;
  eps: number | null;
  reportedAt?: number;
  epsEstimate?: number | null;
  epsEstimateComparable?: boolean;
  revenueEstimate?: number | null;
  revenueCurrency?: string;
  revenueEstimateCapturedAt?: number;
  expectedReportAt?: number;
  epsBasis?: 'adjusted' | 'gaap';
};

export type QuarterResult = {
  label: string;
  periodEnd: string;
  epsActual: number | null;
  epsYoY: number | null;
  revenue: number | null;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  revenueBeat: number | null;
  epsBeat: number | null;
  revenueBeatProvisional?: boolean;
};

export type FinancialSources = Record<string, FinancialQuarter[]>;

export function earningsOutcome(quarter: Pick<QuarterResult, 'revenueBeat' | 'epsBeat'>): 'beat' | 'miss' | 'neutral' {
  const { revenueBeat, epsBeat } = quarter;
  if ((revenueBeat != null && revenueBeat < 0) || (epsBeat != null && epsBeat < 0)) return 'miss';
  return revenueBeat != null && revenueBeat > 0 && epsBeat != null && epsBeat > 0 ? 'beat' : 'neutral';
}

const DAY = 86400;

export function calendarQuarterLabel(time: number) {
  const date = new Date(time * 1000);
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

export function combineFinancialSources(older: FinancialSources, newer: FinancialSources): FinancialSources {
  const result: FinancialSources = { ...older };
  for (const [source, rows] of Object.entries(newer)) {
    const combined = [...(older[source] ?? [])];
    for (const row of rows) {
      const previous = nearest(combined, row.time);
      if (previous) {
        const merged = {
          ...previous,
          ...row,
          revenue: row.revenue ?? previous.revenue,
          eps: row.eps ?? previous.eps,
          period: row.period || previous.period,
          fiscalYear: row.fiscalYear || previous.fiscalYear,
          epsEstimate: row.epsEstimate ?? previous.epsEstimate,
          revenueEstimate: row.revenueEstimate ?? previous.revenueEstimate,
          epsBasis: row.epsBasis ?? previous.epsBasis,
        };
        combined[combined.indexOf(previous)] = merged;
      } else {
        combined.push(row);
      }
    }
    result[source] = combined.sort((a, b) => b.time - a.time);
  }
  return result;
}

export function growth(current: number | null, previous: number | null | undefined) {
  return current !== null && previous != null && previous !== 0
    ? (current - previous) / Math.abs(previous) * 100
    : null;
}

function nearest(rows: FinancialQuarter[], time: number) {
  return rows.filter((row) => Math.abs(row.time - time) <= 14 * DAY)
    .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
}

// Keep each growth comparison within one source, especially reported vs adjusted EPS.
export function mergeQuarters(sources: FinancialQuarter[][], now = Date.now() / 1000): QuarterResult[] {
  sources = sources.map((source) => source.filter((row) =>
    Number.isFinite(row.time) && row.time <= now
    && (row.reportedAt === undefined || row.reportedAt <= now)
    && (row.revenue !== null || row.eps !== null)));
  const periods: FinancialQuarter[] = [];
  for (const source of sources) {
    for (const row of source) {
      if (!nearest(periods, row.time)) periods.push(row);
    }
  }
  return periods.sort((a, b) => b.time - a.time).map((period) => {
    const metric = (field: 'revenue' | 'eps') => {
      for (const source of sources) {
        const row = nearest(source, period.time);
        const value = row?.[field];
        if (row && value != null && Number.isFinite(value)) {
          const previousYear = nearest(source, row.time - 365 * DAY);
          const previousQuarter = nearest(source, row.time - 91 * DAY);
          return {
            value,
            yoy: growth(value, previousYear?.[field]),
            qoq: growth(value, previousQuarter?.[field]),
          };
        }
      }
      return { value: null, yoy: null, qoq: null };
    };
    const revenue = metric('revenue');
    const eps = metric('eps');
    return {
      label: calendarQuarterLabel(period.time),
      periodEnd: new Date(period.time * 1000).toISOString().slice(0, 10),
      revenue: revenue.value,
      revenueYoY: revenue.yoy,
      revenueQoQ: revenue.qoq,
      epsActual: eps.value,
      epsYoY: eps.yoy,
      revenueBeat: null,
      epsBeat: null,
    };
  });
}

export function applyEarningsConsensus(quarters: QuarterResult[], consensus: FinancialQuarter[][]): QuarterResult[] {
  const reported = consensus.map((source) => source.filter((row) => row.time <= Date.now() / 1000
    && (row.reportedAt === undefined || row.reportedAt <= Date.now() / 1000)));
  return quarters.map((quarter) => {
    const time = Date.parse(`${quarter.periodEnd}T00:00:00Z`) / 1000;
    const matches = reported.map((source) => nearest(source, time));
    const eps = matches.find((row) => row?.epsBasis && row.eps !== null);
    const revenue = matches.find((row) => row?.revenue !== null && row?.revenueEstimate != null);
    return {
      ...quarter,
      epsActual: eps?.eps ?? null,
      epsBeat: eps?.eps != null && eps.epsEstimate != null && eps.epsEstimateComparable !== false
        ? eps.eps - eps.epsEstimate : null,
      revenueBeat: revenue?.revenue != null && revenue.revenueEstimate != null
        ? revenue.revenue - revenue.revenueEstimate : null,
      revenueBeatProvisional: revenue?.revenueEstimateCapturedAt !== undefined,
    };
  });
}
