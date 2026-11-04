import { FinancialQuarter } from './quarterly';

// Kľúč sa číta z lokálneho súboru .env (EXPO_PUBLIC_FMP_API_KEY), ktorý nie je v gite.
export async function getFmpKey() {
  return process.env.EXPO_PUBLIC_FMP_API_KEY?.trim() || null;
}

export type FmpQuarter = FinancialQuarter;

export type FmpQuarterly = {
  quarters: FmpQuarter[];
  error: string | null;
};

async function getArray<T>(url: string): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`FMP vrátilo HTTP ${response.status}.`);
    const data = await response.json() as unknown;
    if (!Array.isArray(data)) throw new Error('FMP nevrátilo platné finančné výkazy.');
    return data as T[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFmpQuarterly(symbol: string, apiKey: string): Promise<FmpQuarterly> {
  const base = 'https://financialmodelingprep.com/stable';
  const key = `apikey=${encodeURIComponent(apiKey)}`;
  const sym = `symbol=${encodeURIComponent(symbol)}`;
  const statements = await Promise.allSettled(
    (['Q1', 'Q2', 'Q3', 'Q4'] as const).map((period) =>
      getArray<{
        date?: string;
        fiscalYear?: string;
        period?: string;
        revenue?: number;
        epsdiluted?: number;
        eps?: number;
      }>(
        `${base}/income-statement?${sym}&period=${period}&limit=5&${key}`,
      ),
    ),
  );
  const available = statements.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!available.length) {
    const failure = statements.find((result) => result.status === 'rejected');
    throw failure?.status === 'rejected' ? failure.reason : new Error('FMP nevrátilo kvartálne výkazy.');
  }
  const failures = statements.filter((result) => result.status === 'rejected');
  const error = failures.length
    ? failures.map((result) => result.status === 'rejected' && result.reason instanceof Error
      ? result.reason.message
      : 'FMP nevrátilo kvartálny výkaz.').join(' ')
    : null;
  return {
    quarters: [...new Map(available.flatMap((row) => {
      const time = row.date ? Date.parse(`${row.date}T00:00:00Z`) / 1000 : NaN;
      const eps = row.epsdiluted ?? row.eps;
      if (!Number.isFinite(time) || !row.fiscalYear || !row.period
        || (typeof row.revenue !== 'number' && typeof eps !== 'number')) return [];
      const quarter = {
        time,
        fiscalYear: row.fiscalYear,
        period: row.period,
        revenue: typeof row.revenue === 'number' && Number.isFinite(row.revenue) ? row.revenue : null,
        eps: typeof eps === 'number' && Number.isFinite(eps) ? eps : null,
      };
      return [[time, quarter] as const];
    })).values()].sort((a, b) => a.time - b.time),
    error,
  };
}
