import { onBulkStorageChange, useAppStorage } from '../data/app-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { availableAssets, colors } from '../data/portfolio';
import { fetchLiveQuote, LiveQuote } from '../data/quotes';
import { isTransaction, isValidDate, sortedTransactions, validateLedger } from '../data/transaction-validation';
import { useLocale } from '../context/locale';

const STORAGE_KEY = '@portfolio-mobile/transactions-v1';
const LEGACY_STORAGE_KEY = '@portfolio-mobile/positions-v1';

export type Transaction = {
  id: string;
  symbol: string;
  name: string;
  type: 'BUY' | 'SELL';
  shares: number;
  price: number;
  currency: 'EUR' | 'USD';
  fxToEur: number;
  date: string;
  createdAt: string;
  dateEstimated?: boolean;
  toCash?: boolean;
};

export type Position = {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  averageCost: number;
  averageCostEUR: number;
  currentPrice: number;
  currency: 'EUR' | 'USD';
  fxToEur: number;
  updatedAt: string;
  color: string;
  hasMarketQuote: boolean;
  realizedProfitEUR: number;
  totalInvestedEUR: number;
  dailyChangePct: number;
  transactions: Transaction[];
};

export type TransactionInput = Omit<Transaction, 'id' | 'createdAt'>;

type StoredData = {
  transactions: Transaction[];
  quotes: Record<string, LiveQuote>;
};

type PositionsContextValue = {
  positions: Position[];
  transactions: Transaction[];
  loading: boolean;
  saveTransaction: (input: TransactionInput, id?: string, quote?: LiveQuote) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  deleteSymbolTransactions: (symbol: string) => Promise<void>;
  importTransactions: (items: Transaction[], mode: 'append' | 'replace') => Promise<void>;
  resetPortfolio: () => Promise<void>;
  refreshQuotes: () => Promise<{ updated: number; failed: string[] }>;
};

const PositionsContext = createContext<PositionsContextValue | null>(null);

function quoteFromStored(value: unknown): value is LiveQuote {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.symbol === 'string' &&
    typeof item.name === 'string' &&
    typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 &&
    (item.currency === 'EUR' || item.currency === 'USD') &&
    typeof item.fxToEur === 'number' && Number.isFinite(item.fxToEur) && item.fxToEur > 0 &&
    typeof item.change === 'number' &&
    typeof item.color === 'string' &&
    typeof item.updatedAt === 'string' &&
    typeof item.isMarketQuote === 'boolean'
  );
}

function buildPositions(transactions: Transaction[], quotes: Record<string, LiveQuote>): Position[] {
  const bySymbol = new Map<string, Transaction[]>();
  for (const transaction of sortedTransactions(transactions)) {
    bySymbol.set(transaction.symbol, [...(bySymbol.get(transaction.symbol) ?? []), transaction]);
  }

  return [...bySymbol.entries()].map(([symbol, history]) => {
    let shares = 0;
    let costEUR = 0;
    let realizedProfitEUR = 0;
    for (const transaction of history) {
      if (transaction.type === 'BUY') {
        shares += transaction.shares;
        costEUR += transaction.shares * transaction.price * transaction.fxToEur;
      } else {
        const averageCostEUR = shares > 0 ? costEUR / shares : 0;
        realizedProfitEUR += transaction.shares * (
          transaction.price * transaction.fxToEur - averageCostEUR
        );
        shares -= transaction.shares;
        costEUR = shares > 1e-8 ? costEUR - transaction.shares * averageCostEUR : 0;
        if (shares < 1e-8) shares = 0;
      }
    }

    const latestTransaction = history[history.length - 1];
    const quote = quotes[symbol];
    const totalInvestedEUR = history.reduce(
      (total, transaction) => total + (transaction.type === 'BUY' ? transaction.shares * transaction.price * transaction.fxToEur : 0),
      0,
    );
    const currency = quote?.currency ?? latestTransaction.currency;
    const fxToEur = quote?.fxToEur ?? latestTransaction.fxToEur;
    const averageCostEUR = shares > 0 ? costEUR / shares : 0;
    return {
      id: symbol,
      symbol,
      name: quote?.name ?? latestTransaction.name,
      shares,
      averageCost: fxToEur > 0 ? averageCostEUR / fxToEur : 0,
      averageCostEUR,
      currentPrice: quote?.price ?? latestTransaction.price,
      currency,
      fxToEur,
      updatedAt: quote?.updatedAt ?? latestTransaction.createdAt,
      color: quote?.color ?? availableAssets.find((asset) => asset.symbol === symbol)?.color ?? colors.violet,
      hasMarketQuote: quote?.isMarketQuote === true,
      realizedProfitEUR,
      totalInvestedEUR,
      dailyChangePct: quote?.change ?? 0,
      transactions: [...history].reverse(),
    };
  });
}

export function positionValueEUR(position: Position) {
  return position.shares * position.currentPrice * position.fxToEur;
}

export function positionCostEUR(position: Position) {
  return position.shares * position.averageCostEUR;
}

export function PositionsProvider({ children }: { children: ReactNode }) {
  const AsyncStorage = useAppStorage();
  const { t, errorText } = useLocale();
  const localeRef = useRef({ t, errorText });
  useEffect(() => { localeRef.current = { t, errorText }; }, [t, errorText]);
  function reportStorageError(action: string, error: unknown) {
    console.warn(`Transactions ${action} failed:`, error);
    Alert.alert(localeRef.current.t('Chyba'), localeRef.current.errorText(error instanceof Error ? error.message : String(error)));
  }
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (!active || current !== request) return;
        if (saved === null) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (!active || current !== request) return;
          if (legacy === null) return;
          const parsedLegacy: unknown = JSON.parse(legacy);
          if (
            !Array.isArray(parsedLegacy) ||
            !parsedLegacy.every((value) => {
              if (!value || typeof value !== 'object') return false;
              const item = value as Record<string, unknown>;
              return (
                typeof item.symbol === 'string' &&
                typeof item.name === 'string' &&
                typeof item.shares === 'number' && item.shares > 0 &&
                typeof item.averageCost === 'number' && item.averageCost > 0 &&
                typeof item.currentPrice === 'number' && item.currentPrice > 0 &&
                (item.currency === 'EUR' || item.currency === 'USD') &&
                typeof item.fxToEur === 'number' && item.fxToEur > 0 &&
                typeof item.updatedAt === 'string'
              );
            })
          ) {
            throw new Error('Staršie uložené pozície majú neplatný formát. Pôvodné dáta zostali zachované.');
          }
          const migratedTransactions: Transaction[] = parsedLegacy.map((value) => {
            const item = value as Record<string, unknown>;
            return {
              id: `${String(item.symbol)}-migrated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              symbol: String(item.symbol),
              name: String(item.name),
              type: 'BUY',
              shares: Number(item.shares),
              price: Number(item.averageCost),
              currency: item.currency as 'EUR' | 'USD',
              fxToEur: typeof item.averageCostEUR === 'number' && item.averageCostEUR > 0
                ? Number(item.averageCostEUR) / Number(item.averageCost)
                : Number(item.fxToEur),
              date: isValidDate(String(item.updatedAt).slice(0, 10))
                ? String(item.updatedAt).slice(0, 10)
                : new Date().toISOString().slice(0, 10),
              createdAt: String(item.updatedAt),
              dateEstimated: true,
            };
          });
          const migratedQuotes = Object.fromEntries(parsedLegacy.map((value) => {
            const item = value as Record<string, unknown>;
            return [String(item.symbol), {
              symbol: String(item.symbol),
              name: String(item.name),
              price: Number(item.currentPrice),
              currency: item.currency as 'EUR' | 'USD',
              fxToEur: Number(item.fxToEur),
              change: 0,
              color: typeof item.color === 'string' ? item.color : colors.violet,
              updatedAt: String(item.updatedAt),
              isMarketQuote: item.hasMarketQuote === true,
            } satisfies LiveQuote];
          }));
          validateLedger(migratedTransactions);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
            transactions: migratedTransactions,
            quotes: migratedQuotes,
          }));
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
          if (active && current === request) {
            setTransactions(migratedTransactions);
            setQuotes(migratedQuotes);
          }
          return;
        }
        const parsed: unknown = JSON.parse(saved);
        if (
          !parsed || typeof parsed !== 'object' ||
          !Array.isArray((parsed as StoredData).transactions) ||
          !(parsed as StoredData).transactions.every(isTransaction) ||
          !((parsed as StoredData).quotes && typeof (parsed as StoredData).quotes === 'object')
        ) {
          throw new Error('Uložené transakcie majú neplatný formát. Dáta neboli prepísané.');
        }
        const stored = parsed as StoredData;
        const validQuotes = Object.fromEntries(
          Object.entries(stored.quotes).filter(([, quote]) => quoteFromStored(quote)),
        );
        validateLedger(stored.transactions);
        if (active && current === request) {
          setTransactions(stored.transactions);
          setQuotes(validQuotes);
        }
      } catch (error) {
        if (active && current === request) reportStorageError('načítaní', error);
      } finally {
        if (active && current === request) setLoading(false);
      }
    };
    const unsubscribe = onBulkStorageChange(() => { void load(); });
    void load();
    return () => {
      active = false;
      request += 1;
      unsubscribe();
    };
  }, []);

  const persist = async (nextTransactions: Transaction[], nextQuotes: Record<string, LiveQuote>) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: nextTransactions,
      quotes: nextQuotes,
    }));
    setTransactions(nextTransactions);
    setQuotes(nextQuotes);
  };

  const saveTransaction = async (input: TransactionInput, id?: string, quote?: LiveQuote) => {
    const existing = id ? transactions.find((transaction) => transaction.id === id) : undefined;
    if (id && !existing) throw new Error('Upravovanú transakciu sa nepodarilo nájsť.');
    const nextTransaction: Transaction = {
      ...input,
      id: existing?.id ?? `${input.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...(existing?.dateEstimated && existing.date === input.date ? { dateEstimated: true } : {}),
    };
    const nextTransactions = existing
      ? transactions.map((transaction) => transaction.id === id ? nextTransaction : transaction)
      : [...transactions, nextTransaction];
    validateLedger(nextTransactions);
    const nextQuotes = quote ? { ...quotes, [input.symbol]: quote } : quotes;
    await persist(nextTransactions, nextQuotes);
  };

  const deleteTransaction = async (id: string) => {
    const nextTransactions = transactions.filter((transaction) => transaction.id !== id);
    validateLedger(nextTransactions);
    await persist(nextTransactions, quotes);
  };

  const deleteSymbolTransactions = async (symbol: string) => {
    const nextTransactions = transactions.filter((transaction) => transaction.symbol !== symbol);
    validateLedger(nextTransactions);
    await persist(nextTransactions, quotes);
  };

  const importTransactions = async (items: Transaction[], mode: 'append' | 'replace') => {
    const nextTransactions = mode === 'replace' ? items : [...transactions, ...items];
    validateLedger(nextTransactions);
    await persist(nextTransactions, mode === 'replace' ? {} : quotes);
  };

  const resetPortfolio = async () => {
    await persist([], {});
  };

  const positions = useMemo(() => buildPositions(transactions, quotes), [transactions, quotes]);

  const refreshQuotes = async () => {
    const symbols = [...new Set(positions.filter((position) => position.shares > 0).map((position) => position.symbol))];
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => ({ symbol, quote: await fetchLiveQuote(symbol) })),
    );
    const nextQuotes = { ...quotes };
    const failed: string[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === 'fulfilled') nextQuotes[result.value.symbol] = result.value.quote;
      else failed.push(symbols[index]);
    }
    const updated = results.length - failed.length;
    if (updated > 0) await persist(transactions, nextQuotes);
    return { updated, failed };
  };

  const refreshRef = useRef(refreshQuotes);
  refreshRef.current = refreshQuotes;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!loading) refreshRef.current().catch(() => undefined);
    }, 10000);
    return () => clearInterval(timer);
  }, [loading]);

  const value = useMemo(
    () => ({
      positions,
      transactions,
      loading,
      saveTransaction,
      deleteTransaction,
      deleteSymbolTransactions,
      importTransactions,
      resetPortfolio,
      refreshQuotes,
    }),
    [positions, transactions, loading, quotes],
  );

  return <PositionsContext.Provider value={value}>{children}</PositionsContext.Provider>;
}

export function usePositions() {
  const value = useContext(PositionsContext);
  if (!value) throw new Error('usePositions musí byť použité vnútri PositionsProvider.');
  return value;
}
