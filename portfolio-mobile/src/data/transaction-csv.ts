import type { Transaction } from '../hooks/use-positions';

export const CSV_HEADER = [
  'Symbol', 'Date', 'Quantity', 'Price', 'Price Currency',
  'Fees Percentage', 'Fees Amount', 'Fees Currency', 'To Cash',
];

export function transactionCsvTemplate() {
  return [
    CSV_HEADER.join(','),
    'AAPL,2025-01-15,2,200,USD,0,0,EUR,FALSE',
    'AAPL,2025-02-20,-1,220,USD,0,0,EUR,TRUE',
    'SAP,2025-03-10,1.5,250,EUR,0,0,EUR,FALSE',
  ].join('\n') + '\n';
}

export type ImportRow = {
  line: number;
  symbol: string;
  date: string;
  quantity: number;
  price: number;
  currency: 'EUR' | 'USD';
  toCash: boolean;
};

function splitCsv(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Prázdna mena ceny znamená cenu v EUR (základná mena pôvodnej aplikácie).
export function parseTransactionCsv(input: string): ImportRow[] {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const table = splitCsv(text, delimiter);
  if (!table.length) throw new Error('Súbor je prázdny.');

  const header = table[0].map((name) => name.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name.toLowerCase());
  const indexes = {
    symbol: column('Symbol'),
    date: column('Date'),
    quantity: column('Quantity'),
    price: column('Price'),
    currency: column('Price Currency'),
    toCash: column('To Cash'),
  };
  if (indexes.symbol < 0 || indexes.date < 0 || indexes.quantity < 0 || indexes.price < 0) {
    throw new Error('Súbor nemá očakávané stĺpce Symbol, Date, Quantity a Price.');
  }

  const rows: ImportRow[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index];
    const line = index + 1;
    const symbol = (cells[indexes.symbol] ?? '').trim().toUpperCase();
    const date = (cells[indexes.date] ?? '').trim();
    const quantity = Number((cells[indexes.quantity] ?? '').trim().replace(',', '.'));
    const price = Number((cells[indexes.price] ?? '').trim().replace(',', '.'));
    const currencyText = (indexes.currency >= 0 ? cells[indexes.currency] ?? '' : '').trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error(`Riadok ${line}: neplatný symbol „${symbol}“.`);
    if (!isValidDate(date)) throw new Error(`Riadok ${line}: neplatný dátum „${date}“.`);
    if (!Number.isFinite(quantity) || quantity === 0) throw new Error(`Riadok ${line}: neplatné množstvo.`);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Riadok ${line}: neplatná cena.`);
    if (currencyText && currencyText !== 'EUR' && currencyText !== 'USD') {
      throw new Error(`Riadok ${line}: nepodporovaná mena „${currencyText}“.`);
    }
    rows.push({
      line,
      symbol,
      date,
      quantity,
      price,
      currency: currencyText === 'USD' ? 'USD' : 'EUR',
      toCash: indexes.toCash >= 0 && (cells[indexes.toCash] ?? '').trim().toUpperCase() === 'TRUE',
    });
  }
  if (!rows.length) throw new Error('Súbor neobsahuje žiadne transakcie.');
  return rows;
}

export function rowsToTransactions(
  rows: ImportRow[],
  fxToEurOn: (date: string) => number,
  nameFor: (symbol: string) => string,
): Transaction[] {
  const base = Date.now();
  return rows.map((row, index) => ({
    id: `${row.symbol}-import-${base}-${index}`,
    symbol: row.symbol,
    name: nameFor(row.symbol),
    type: row.quantity > 0 ? 'BUY' : 'SELL',
    shares: Math.abs(row.quantity),
    price: row.price,
    currency: row.currency,
    fxToEur: row.currency === 'EUR' ? 1 : fxToEurOn(row.date),
    date: row.date,
    // Zachová poradie riadkov zo súboru pri transakciách v ten istý deň.
    createdAt: new Date(base + index).toISOString(),
    ...(row.toCash ? { toCash: true } : {}),
  }));
}

// Zdrojové exporty môžu predávať o zlomok viac, než sa nakúpilo (splity, zaokrúhlenie); predaj sa upraví na dostupný počet.
export function reconcileOversells(existing: Transaction[], incoming: Transaction[]) {
  const held = new Map<string, number>();
  const adjusted = new Set<string>();
  const dropped = new Set<string>();
  const incomingIds = new Set(incoming.map((item) => item.id));
  const ordered = [...existing, ...incoming].sort((a, b) => a.date.localeCompare(b.date)
    || a.createdAt.localeCompare(b.createdAt));
  const result: Transaction[] = [];
  for (const transaction of ordered) {
    const current = held.get(transaction.symbol) ?? 0;
    if (transaction.type === 'BUY') {
      held.set(transaction.symbol, current + transaction.shares);
      result.push(transaction);
    } else if (transaction.shares <= current + 1e-8 || !incomingIds.has(transaction.id)) {
      held.set(transaction.symbol, Math.max(0, current - transaction.shares));
      result.push(transaction);
    } else if (current > 1e-8) {
      held.set(transaction.symbol, 0);
      adjusted.add(transaction.id);
      result.push({ ...transaction, shares: current });
    } else {
      dropped.add(transaction.id);
    }
  }
  return {
    transactions: result.filter((item) => incomingIds.has(item.id)),
    adjusted: adjusted.size,
    dropped: dropped.size,
  };
}

function formatNumber(value: number) {
  return value.toFixed(6);
}

export function transactionsToCsv(transactions: Transaction[]) {
  const sorted = [...transactions].sort((a, b) => a.symbol.localeCompare(b.symbol)
    || a.date.localeCompare(b.date)
    || a.createdAt.localeCompare(b.createdAt));
  const lines = sorted.map((transaction) => [
    transaction.symbol,
    transaction.date,
    formatNumber(transaction.type === 'BUY' ? transaction.shares : -transaction.shares),
    formatNumber(transaction.price),
    transaction.currency,
    formatNumber(0),
    formatNumber(0),
    'EUR',
    transaction.toCash ? 'TRUE' : 'FALSE',
  ].join(','));
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n';
}
