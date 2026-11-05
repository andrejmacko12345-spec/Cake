import { isValidSymbol } from './watchlists';

export function parseEventSymbols(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((symbol) => typeof symbol === 'string' && isValidSymbol(symbol))) {
    throw new Error('Invalid event stock selection.');
  }
  return [...new Set(value)];
}

export function resolveEventSymbols(portfolio: string[], watchlists: string[], selected: string[] | null) {
  const available = new Set([...portfolio, ...watchlists]);
  return [...new Set(selected === null ? portfolio : selected.filter((symbol) => available.has(symbol)))];
}

export function toggleEventSymbolGroup(portfolio: string[], selected: string[] | null, group: string[], automaticPortfolio = false) {
  const next = new Set(selected ?? portfolio);
  if (group.length && group.every((symbol) => next.has(symbol))) {
    group.forEach((symbol) => next.delete(symbol));
  } else {
    group.forEach((symbol) => next.add(symbol));
    if (automaticPortfolio && [...next].every((symbol) => portfolio.includes(symbol))) return null;
  }
  return [...next];
}
