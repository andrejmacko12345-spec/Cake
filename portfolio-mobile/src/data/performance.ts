import type { Transaction } from '../hooks/use-positions';
import { fetchHistoricalQuoteSeries } from './quotes';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

export function weightedAnnualReturn(
  transactions: Transaction[],
  terminalValue: number,
  terminalDate = new Date().toISOString().slice(0, 10),
) {
  if (!transactions.length) return null;
  const startTime = Math.min(...transactions.map((transaction) =>
    new Date(`${transaction.date}T00:00:00.000Z`).getTime()));
  const endTime = new Date(`${terminalDate}T00:00:00.000Z`).getTime();
  if (endTime <= startTime) return null;

  const cashFlows = transactions.map((transaction) => ({
    time: new Date(`${transaction.date}T00:00:00.000Z`).getTime(),
    amount: (transaction.type === 'BUY' ? -1 : 1) *
      transaction.shares * transaction.price * transaction.fxToEur,
  }));
  cashFlows.push({ time: endTime, amount: terminalValue });
  return solveAnnualRate(cashFlows, startTime);
}

function solveAnnualRate(cashFlows: { time: number; amount: number }[], startTime: number) {
  if (!cashFlows.some((flow) => flow.amount < 0) || !cashFlows.some((flow) => flow.amount > 0)) return null;
  const valueAt = (rate: number) => cashFlows.reduce((sum, flow) => {
    const years = (flow.time - startTime) / YEAR_MS;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
  const totalFlows = cashFlows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  let low = -0.9999;
  let high = 1;
  let lowValue = valueAt(low);
  let highValue = valueAt(high);
  while (lowValue * highValue > 0 && high < 1000) {
    high = high * 2 + 1;
    highValue = valueAt(high);
  }
  if (lowValue * highValue > 0) return null;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = valueAt(middle);
    if (Math.abs(middleValue) <= Math.max(1, totalFlows) * 1e-10) return middle * 100;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return ((low + high) / 2) * 100;
}

export type ReturnBasis = 'all' | '1Y' | '3Y' | '5Y';

export const returnBasisYears: Record<Exclude<ReturnBasis, 'all'>, number> = { '1Y': 1, '3Y': 3, '5Y': 5 };

function latestPrice(points: { timestamp: number; price: number }[], timestamp: number) {
  let result: number | undefined;
  for (const point of points) {
    if (point.timestamp <= timestamp) result = point.price;
    else break;
  }
  return result;
}

// Anualizovaný výnos za posledných N rokov: hodnota držaných akcií na začiatku okna sa berie ako vklad.
export async function windowedAnnualReturn(
  transactions: Transaction[],
  terminalValue: number,
  years: number,
): Promise<number | null> {
  if (!transactions.length) return null;
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate()));
  const startDate = start.toISOString().slice(0, 10);
  const firstDate = transactions.reduce((min, item) => (item.date < min ? item.date : min), transactions[0].date);
  if (firstDate >= startDate) return null;

  const quantities = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.date > startDate) continue;
    quantities.set(
      transaction.symbol,
      (quantities.get(transaction.symbol) ?? 0) + (transaction.type === 'BUY' ? transaction.shares : -transaction.shares),
    );
  }
  const queryStart = new Date(start.getTime() - 10 * DAY_MS).toISOString().slice(0, 10);
  const startTimestamp = start.getTime() / 1000;
  let startValue = 0;
  let fx: { timestamp: number; price: number }[] | null = null;
  for (const [symbol, shares] of quantities) {
    if (shares <= 1e-8) continue;
    const series = await fetchHistoricalQuoteSeries(symbol, queryStart, '1d');
    const price = latestPrice(series.points, startTimestamp);
    if (price === undefined) return null;
    let rate = 1;
    if (series.currency === 'USD') {
      fx ??= (await fetchHistoricalQuoteSeries('EURUSD=X', queryStart, '1d')).points;
      const usdPerEur = latestPrice(fx, startTimestamp);
      if (usdPerEur === undefined) return null;
      rate = 1 / usdPerEur;
    }
    startValue += shares * price * rate;
  }
  if (startValue <= 0) return null;

  const startTime = start.getTime();
  const cashFlows = [{ time: startTime, amount: -startValue }];
  for (const transaction of transactions) {
    if (transaction.date <= startDate) continue;
    cashFlows.push({
      time: new Date(`${transaction.date}T00:00:00.000Z`).getTime(),
      amount: (transaction.type === 'BUY' ? -1 : 1) * transaction.shares * transaction.price * transaction.fxToEur,
    });
  }
  cashFlows.push({ time: Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()), amount: terminalValue });
  return solveAnnualRate(cashFlows, startTime);
}