import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_STORAGE = 'fmp-api-key';
let cachedKey: string | null | undefined;

export async function getFmpKey() {
  if (cachedKey === undefined) {
    cachedKey = (await AsyncStorage.getItem(KEY_STORAGE).catch(() => null))?.trim() || null;
  }
  return cachedKey;
}

export async function setFmpKey(key: string) {
  const value = key.trim();
  cachedKey = value || null;
  if (value) await AsyncStorage.setItem(KEY_STORAGE, value);
  else await AsyncStorage.removeItem(KEY_STORAGE);
}

export type FmpPoint = { time: number; value: number };

export type FmpQuarterly = {
  revenue: FmpPoint[];
  revenueEstimate: FmpPoint[];
};

async function getArray<T>(url: string): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`FMP vrátilo HTTP ${response.status}.`);
    const data = await response.json() as unknown;
    return Array.isArray(data) ? data as T[] : [];
  } finally {
    clearTimeout(timeout);
  }
}

function toPoints<T extends { date?: string }>(rows: T[], pick: (row: T) => unknown): FmpPoint[] {
  return rows
    .flatMap((row) => {
      const value = pick(row);
      const time = row.date ? Date.parse(`${row.date}T00:00:00Z`) / 1000 : NaN;
      return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(time) ? [{ time, value }] : [];
    })
    .sort((a, b) => a.time - b.time);
}

export async function fetchFmpQuarterly(symbol: string, apiKey: string): Promise<FmpQuarterly> {
  const base = 'https://financialmodelingprep.com/stable';
  const key = `apikey=${encodeURIComponent(apiKey)}`;
  const sym = `symbol=${encodeURIComponent(symbol)}`;
  const [income, estimates] = await Promise.allSettled([
    getArray<{ date?: string; revenue?: number }>(`${base}/income-statement?${sym}&period=quarter&limit=12&${key}`),
    getArray<{ date?: string; revenueAvg?: number }>(`${base}/analyst-estimates?${sym}&period=quarter&page=0&limit=24&${key}`),
  ]);
  if (income.status === 'rejected' && estimates.status === 'rejected') throw income.reason;
  return {
    revenue: income.status === 'fulfilled' ? toPoints(income.value, (row) => row.revenue) : [],
    revenueEstimate: estimates.status === 'fulfilled' ? toPoints(estimates.value, (row) => row.revenueAvg) : [],
  };
}
