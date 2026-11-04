import type { Transaction } from '../hooks/use-positions';

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.symbol === 'string' &&
    typeof item.name === 'string' &&
    (item.type === 'BUY' || item.type === 'SELL') &&
    typeof item.shares === 'number' && Number.isFinite(item.shares) && item.shares > 0 &&
    typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 &&
    (item.currency === 'EUR' || item.currency === 'USD') &&
    typeof item.fxToEur === 'number' && Number.isFinite(item.fxToEur) && item.fxToEur > 0 &&
    typeof item.date === 'string' && isValidDate(item.date) &&
    typeof item.createdAt === 'string' &&
    (item.dateEstimated === undefined || typeof item.dateEstimated === 'boolean')
  );
}

export function sortedTransactions(transactions: Transaction[]) {
  return [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function validateLedger(transactions: Transaction[]) {
  const quantities = new Map<string, number>();
  for (const transaction of sortedTransactions(transactions)) {
    const current = quantities.get(transaction.symbol) ?? 0;
    const next = current + (transaction.type === 'BUY' ? transaction.shares : -transaction.shares);
    if (next < -1e-8) {
      throw new Error(
        `Predaj ${transaction.symbol} z ${transaction.date} je vyšší než počet akcií, ktoré boli k tomuto dátumu nakúpené.`,
      );
    }
    quantities.set(transaction.symbol, Math.max(0, next));
  }
}
