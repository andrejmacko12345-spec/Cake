import { isTransaction, validateLedger } from './transaction-validation';

export const BACKUP_KEYS = [
  '@portfolio-mobile/transactions-v1',
  '@portfolio-mobile/watchlist',
  '@portfolio-mobile/language',
  '@portfolio-mobile/compare-symbols',
  '@portfolio-mobile/compare-metrics',
  '@portfolio-mobile/hide-amounts',
  '@portfolio-mobile/theme',
  'event-preferences',
] as const;

export type Backup = { version: 1; values: Record<string, string> };

export function parseBackup(input: unknown): Backup {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1
    || !('values' in input) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    throw new Error('Unsupported or invalid account backup.');
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values)) {
    if (!BACKUP_KEYS.some((allowed) => allowed === key) || typeof value !== 'string') {
      throw new Error('Invalid account backup field.');
    }
    if (key === '@portfolio-mobile/language') {
      if (value !== 'sk' && value !== 'en') throw new Error('Invalid backup language.');
    } else if (key === '@portfolio-mobile/theme') {
      if (value !== 'dark' && value !== 'light') throw new Error('Invalid backup theme.');
    } else if (key === '@portfolio-mobile/hide-amounts') {
      if (value !== 'true' && value !== 'false') throw new Error('Invalid backup visibility.');
    } else {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid backup data.');
      if (key === '@portfolio-mobile/transactions-v1') {
        if (!('transactions' in parsed) || !Array.isArray(parsed.transactions)
          || !parsed.transactions.every(isTransaction)) throw new Error('Invalid transaction backup.');
        validateLedger(parsed.transactions);
      }
    }
    values[key] = value;
  }
  return { version: 1, values };
}

export function makeBackup(pairs: readonly (readonly [string, string | null])[]): Backup {
  const values: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (!BACKUP_KEYS.some((allowed) => allowed === key) || value === null) continue;
    if (key === '@portfolio-mobile/transactions-v1') {
      const stored = JSON.parse(value);
      values[key] = JSON.stringify({ transactions: stored.transactions, quotes: {} });
    } else {
      values[key] = value;
    }
  }
  return parseBackup({ version: 1, values });
}
