import type { Transaction } from '../hooks/use-positions';
import type { HistoricalQuoteSeries } from './quotes';
import { weightedAnnualReturn } from './performance';

export type ForecastBasis = 'all' | 'smoothed' | 'market';

// Total returns with reinvested dividends, USD: https://www.slickcharts.com/sp500/returns
export const marketReturns = [
  15.79, 5.49, -37, 26.46, 15.06, 2.11, 16, 32.39, 13.69, 1.38,
  11.96, 21.83, -4.38, 31.49, 18.4, 28.71, -18.11, 26.29, 25.02, 17.88,
] as const;
export const marketPeriod = { firstYear: 2006, lastYear: 2025 };

export function marketAnnualReturn(year = new Date().getUTCFullYear()) {
  if (marketPeriod.lastYear !== year - 1) {
    throw new Error('Údaje S&P 500 treba aktualizovať o posledný dokončený rok.');
  }
  return (Math.exp(marketReturns.reduce((sum, rate) => sum + Math.log1p(rate / 100), 0) / marketReturns.length) - 1) * 100;
}

export function smoothAnnualReturns(returns: number[], marketRate: number) {
  if (!Number.isFinite(marketRate) || marketRate <= -100
    || returns.some((rate) => !Number.isFinite(rate) || rate <= -100)) {
    throw new Error('Neplatné ročné výnosy pre vyhladený model.');
  }
  if (!returns.length) return marketRate;
  const sorted = returns.map((rate) => Math.log1p(rate / 100)).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const weight = returns.length / (returns.length + 3);
  return Math.expm1(median * weight + Math.log1p(marketRate / 100) * (1 - weight)) * 100;
}

export function completedPortfolioYears(transactions: Transaction[], currentYear: number) {
  if (!transactions.length) return [];
  const firstDate = transactions.reduce((min, item) => item.date < min ? item.date : min, transactions[0].date);
  const firstYear = Number(firstDate.slice(0, 4)) + (firstDate.endsWith('-01-01') ? 0 : 1);
  return Array.from({ length: Math.max(0, currentYear - firstYear) }, (_, index) => firstYear + index);
}

export function portfolioYearReturns(
  transactions: Transaction[],
  series: Map<string, HistoricalQuoteSeries>,
  currentYear: number,
) {
  const priceAt = (symbol: string, date: string) => {
    const time = Date.parse(`${date}T00:00:00Z`) / 1000;
    const point = series.get(symbol)?.points.findLast((item) => item.timestamp <= time);
    if (!point || time - point.timestamp > 10 * 86400) {
      throw new Error(`Chýba historická cena ${symbol} k ${date}.`);
    }
    return point.price;
  };
  const valueAt = (date: string) => {
    const shares = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.date >= date) continue;
      shares.set(transaction.symbol, (shares.get(transaction.symbol) ?? 0)
        + (transaction.type === 'BUY' ? transaction.shares : -transaction.shares));
    }
    let value = 0;
    for (const [symbol, quantity] of shares) {
      if (quantity <= 1e-8) continue;
      const history = series.get(symbol);
      if (!history) throw new Error(`Chýba história ${symbol}.`);
      value += quantity * priceAt(symbol, date) / (history.currency === 'USD' ? priceAt('EURUSD=X', date) : 1);
    }
    return value;
  };
  return completedPortfolioYears(transactions, currentYear).flatMap((year) => {
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;
    const startValue = valueAt(start);
    const flows = transactions.filter((item) => item.date >= start && item.date < end);
    if (startValue <= 0 && !flows.length) return [];
    const opening: Transaction = {
      id: `opening-${year}`, symbol: 'PORTFOLIO', name: 'Portfolio', type: 'BUY',
      shares: 1, price: startValue, currency: 'EUR', fxToEur: 1, date: start, createdAt: `${start}T00:00:00Z`,
    };
    const rate = weightedAnnualReturn(startValue > 0 ? [opening, ...flows] : flows, valueAt(end), end);
    if (rate === null) throw new Error(`Ročný výnos za ${year} sa nepodarilo vypočítať.`);
    return [rate];
  });
}

export async function smoothedPortfolioReturn(transactions: Transaction[], currentYear = new Date().getUTCFullYear()) {
  const marketRate = marketAnnualReturn(currentYear);
  const years = completedPortfolioYears(transactions, currentYear);
  if (!years.length) return { rate: marketRate, years: 0 };
  const { fetchHistoricalQuoteSeries } = await import('./quotes');
  const start = new Date(Date.UTC(years[0], 0, 1) - 10 * 86400000).toISOString().slice(0, 10);
  const symbols = [...new Set(transactions.filter((item) => item.date < `${currentYear}-01-01`).map((item) => item.symbol))];
  const histories = await Promise.all(symbols.map((symbol) => fetchHistoricalQuoteSeries(symbol, start, '1d')));
  if (histories.some((history) => history.currency === 'USD')) {
    histories.push(await fetchHistoricalQuoteSeries('EURUSD=X', start, '1d'));
  }
  const returns = portfolioYearReturns(transactions, new Map(histories.map((history) => [history.symbol, history])), currentYear);
  return { rate: smoothAnnualReturns(returns, marketRate), years: returns.length };
}
