import AsyncStorage from '@react-native-async-storage/async-storage';
import bundled from './financial-history.json';
import { combineFinancialSources, FinancialQuarter, FinancialSources } from './quarterly';

type HistoryEntry = { updatedAt: string; backfilledAt?: string; sources: FinancialSources };
type HistorySnapshot = {
  version: 1;
  generatedAt: string;
  companies: Record<string, HistoryEntry>;
};
type StoredHistory = { checkedAt: number; snapshot: HistorySnapshot };

const MONTH = 30 * 86400000;
const SHARED_REFRESH = 3600000;
const STORAGE_KEY = '@portfolio-mobile/financial-history-v1';
const HISTORY_URL = 'https://raw.githubusercontent.com/andrejmacko12345-spec/cake/main/portfolio-mobile/src/data/financial-history.json';
const state: StoredHistory = { checkedAt: Date.parse(bundled.generatedAt), snapshot: parseHistorySnapshot(bundled) };
let loading: Promise<void> | null = null;
let refresh: Promise<void> | null = null;
let retryAt = 0;
let writes = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuarter(value: unknown): value is FinancialQuarter {
  if (!isRecord(value)) return false;
  return typeof value.time === 'number' && Number.isFinite(value.time) && value.time > 0
    && typeof value.period === 'string' && (value.period === '' || /^Q[1-4]$/.test(value.period))
    && typeof value.fiscalYear === 'string' && (value.fiscalYear === '' || /^\d{4}$/.test(value.fiscalYear))
    && [value.revenue, value.eps].every((field) => field === null || (typeof field === 'number' && Number.isFinite(field)))
    && [value.epsEstimate, value.revenueEstimate].every((field) =>
      field == null || (typeof field === 'number' && Number.isFinite(field)))
    && (value.epsBasis === undefined || value.epsBasis === 'adjusted' || value.epsBasis === 'gaap')
    && (value.epsEstimateComparable === undefined || typeof value.epsEstimateComparable === 'boolean')
    && (value.revenueCurrency === undefined || (typeof value.revenueCurrency === 'string' && /^[A-Z]{3}$/.test(value.revenueCurrency)))
    && [value.revenueEstimateCapturedAt, value.expectedReportAt].every((field) =>
      field === undefined || (typeof field === 'number' && Number.isFinite(field) && field > 0))
    && (value.reportedAt === undefined || (typeof value.reportedAt === 'number' && Number.isFinite(value.reportedAt)));
}

export function parseHistorySnapshot(value: unknown): HistorySnapshot {
  if (!isRecord(value) || value.version !== 1 || typeof value.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.generatedAt)) || !isRecord(value.companies)) {
    throw new Error('Neplatný formát historických finančných dát.');
  }
  const companies: Record<string, HistoryEntry> = {};
  for (const [symbol, entry] of Object.entries(value.companies)) {
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol) || !isRecord(entry)
      || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))
      || (entry.backfilledAt !== undefined && (typeof entry.backfilledAt !== 'string'
        || !Number.isFinite(Date.parse(entry.backfilledAt))))
      || !isRecord(entry.sources)) throw new Error(`Neplatná história pre ${symbol}.`);
    const sources: FinancialSources = {};
    for (const [source, rows] of Object.entries(entry.sources)) {
      if (!['sec', 'fmp', 'yahoo', 'yahoo-earnings', 'yahoo-forecast', 'reported-consensus'].includes(source)
        || !Array.isArray(rows) || !rows.every(isQuarter)) {
        throw new Error(`Neplatný zdroj historických dát pre ${symbol}.`);
      }
      sources[source] = source === 'yahoo-earnings'
        ? rows.map((row) => ({ ...row, revenueEstimate: null }))
        : rows;
    }
    companies[symbol] = { updatedAt: entry.updatedAt, backfilledAt: entry.backfilledAt ?? entry.updatedAt, sources };
  }
  return { version: 1, generatedAt: value.generatedAt, companies };
}

function mergeSnapshot(snapshot: HistorySnapshot) {
  for (const [symbol, entry] of Object.entries(snapshot.companies)) {
    const current = state.snapshot.companies[symbol];
    const isNewer = !current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt);
    state.snapshot.companies[symbol] = {
      updatedAt: isNewer ? entry.updatedAt : current.updatedAt,
      backfilledAt: [current?.backfilledAt ?? current?.updatedAt, entry.backfilledAt ?? entry.updatedAt]
        .filter((date): date is string => date !== undefined).sort().at(-1),
      sources: isNewer
        ? combineFinancialSources(current?.sources ?? {}, entry.sources)
        : combineFinancialSources(entry.sources, current.sources),
    };
  }
  if (snapshot.generatedAt > state.snapshot.generatedAt) state.snapshot.generatedAt = snapshot.generatedAt;
}

function persist() {
  const serialized = JSON.stringify(state);
  writes = writes.then(() => AsyncStorage.setItem(STORAGE_KEY, serialized)).catch((error: unknown) => {
    console.warn(`Financial history cache: ${error instanceof Error ? error.message : String(error)}`);
  });
  return writes;
}

async function hydrate() {
  if (!loading) {
    loading = (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const stored: unknown = JSON.parse(saved);
        if (!isRecord(stored) || typeof stored.checkedAt !== 'number' || !Number.isFinite(stored.checkedAt)) {
          throw new Error('Neplatná lokálna cache finančných dát.');
        }
        mergeSnapshot(parseHistorySnapshot(stored.snapshot));
        state.checkedAt = Math.max(state.checkedAt, Math.min(stored.checkedAt, Date.now()));
      } catch (error) {
        console.warn(`Financial history cache: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }
  await loading;
}

async function refreshSharedHistory() {
  if (Date.now() - state.checkedAt < SHARED_REFRESH || Date.now() < retryAt) return;
  if (!refresh) {
    refresh = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(HISTORY_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`Historické dáta: HTTP ${response.status}.`);
        mergeSnapshot(parseHistorySnapshot(await response.json()));
        state.checkedAt = Date.now();
        await persist();
      } catch (error) {
        retryAt = Date.now() + 60000;
        console.warn(`Financial history: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
        refresh = null;
      }
    })();
  }
  await refresh;
}

export async function getFinancialHistory(symbol: string) {
  await hydrate();
  await refreshSharedHistory();
  const entry = state.snapshot.companies[symbol.toUpperCase()];
  return {
    sources: entry?.sources ?? {},
    needsBackfill: !entry || Date.now() - Date.parse(entry.backfilledAt ?? entry.updatedAt) >= MONTH,
  };
}

export async function getLocalFinancialHistory(symbol: string) {
  await hydrate();
  return state.snapshot.companies[symbol.toUpperCase()]?.sources ?? {};
}

export async function saveFinancialHistory(symbol: string, sources: FinancialSources, backfilled: boolean) {
  await hydrate();
  const key = symbol.toUpperCase();
  const previous = state.snapshot.companies[key];
  state.snapshot.companies[key] = {
    updatedAt: backfilled ? new Date().toISOString() : previous?.updatedAt ?? '1970-01-01T00:00:00.000Z',
    backfilledAt: backfilled ? new Date().toISOString() : previous?.backfilledAt ?? previous?.updatedAt,
    sources: combineFinancialSources(previous?.sources ?? {}, sources),
  };
  await persist();
}
