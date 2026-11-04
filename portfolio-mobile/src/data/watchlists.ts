export const WATCHLIST_KEY = '@portfolio-mobile/watchlist';
export type Watchlist = { id: string; name: string; symbols: string[] };
export type WatchlistsState = { selectedId: string; lists: Watchlist[] };
export const defaultWatchlists: WatchlistsState = {
  selectedId: 'default',
  lists: [{ id: 'default', name: 'Watchlist', symbols: ['NVDA', 'AMZN'] }],
};
export const isValidSymbol = (value: string) => /^[A-Z0-9.^=-]{1,20}$/.test(value);

export function parseWatchlists(saved: string | null): WatchlistsState {
  if (saved === null) return defaultWatchlists;
  const parsed: unknown = JSON.parse(saved);
  if (Array.isArray(parsed) && parsed.every((symbol) => typeof symbol === 'string' && isValidSymbol(symbol))) {
    return { selectedId: 'default', lists: [{ id: 'default', name: 'Watchlist', symbols: parsed }] };
  }
  if (typeof parsed !== 'object' || parsed === null || !('lists' in parsed)
    || !Array.isArray(parsed.lists) || !parsed.lists.length) {
    throw new Error('Uložený zoznam nemá očakávaný formát.');
  }
  const lists = parsed.lists.map((list: unknown): Watchlist => {
    if (typeof list !== 'object' || list === null
      || !('id' in list) || typeof list.id !== 'string'
      || !('name' in list) || typeof list.name !== 'string'
      || !('symbols' in list) || !Array.isArray(list.symbols)
      || !list.symbols.every((symbol: unknown) => typeof symbol === 'string' && isValidSymbol(symbol))) {
      throw new Error('Uložený zoznam nemá očakávaný formát.');
    }
    return { id: list.id, name: list.name, symbols: list.symbols };
  });
  const selectedId = 'selectedId' in parsed && typeof parsed.selectedId === 'string'
    && lists.some((list) => list.id === parsed.selectedId) ? parsed.selectedId : lists[0].id;
  return { selectedId, lists };
}
