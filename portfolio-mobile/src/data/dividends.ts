import type { Transaction } from '../hooks/use-positions';

export type DividendEvent = { date: string; amount: number };

export type DividendSeries = {
  symbol: string;
  currency: string;
  events: DividendEvent[];
};

export type DividendPayment = {
  symbol: string;
  date: string;
  perShare: number;
  shares: number;
  amountEUR: number;
};

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { currency?: string };
      events?: { dividends?: Record<string, { amount?: number; date?: number }> };
    }> | null;
  };
};

const cache = new Map<string, Promise<DividendSeries>>();

async function loadDividends(symbol: string): Promise<DividendSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + '?range=max&interval=1mo&events=div';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as ChartResponse;
    const result = data.chart?.result?.[0];
    const events = Object.values(result?.events?.dividends ?? {})
      .flatMap((item) => (
        typeof item.amount === 'number' && typeof item.date === 'number'
          ? [{ date: new Date(item.date * 1000).toISOString().slice(0, 10), amount: item.amount }]
          : []
      ))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { symbol, currency: result?.meta?.currency ?? 'USD', events };
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchDividendSeries(symbol: string) {
  let promise = cache.get(symbol);
  if (!promise) {
    promise = loadDividends(symbol).catch((error) => {
      cache.delete(symbol);
      throw error;
    });
    cache.set(symbol, promise);
  }
  return promise;
}

export function computeDividendPayments(
  transactions: Transaction[],
  series: DividendSeries[],
  fxBySymbol: Record<string, number>,
  eurUsd: number,
): DividendPayment[] {
  const payments: DividendPayment[] = [];
  for (const item of series) {
    const trades = transactions
      .filter((transaction) => transaction.symbol === item.symbol)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!trades.length) continue;
    const toEur = item.currency === 'EUR'
      ? 1
      : item.currency === 'USD' ? (fxBySymbol[item.symbol] ?? eurUsd) : null;
    if (toEur === null) continue;
    for (const event of item.events) {
      let shares = 0;
      for (const trade of trades) {
        if (trade.date.slice(0, 10) > event.date) break;
        shares += trade.type === 'BUY' ? trade.shares : -trade.shares;
      }
      if (shares <= 1e-8) continue;
      payments.push({
        symbol: item.symbol,
        date: event.date,
        perShare: event.amount,
        shares,
        amountEUR: event.amount * shares * toEur,
      });
    }
  }
  return payments.sort((a, b) => a.date.localeCompare(b.date));
}
