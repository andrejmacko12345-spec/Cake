export const WATCHLIST_KEY = '@portfolio-mobile/watchlist';
export type Watchlist = { id: string; name: string; symbols: string[] };
export type WatchlistsState = { selectedId: string; lists: Watchlist[] };
export const defaultWatchlists: WatchlistsState = {
  selectedId: 'default',
  lists: [{ id: 'default', name: 'Watchlist', symbols: [] }],
};
export const isValidSymbol = (value: string) => /^[A-Z0-9.^=-]{1,20}$/.test(value);

export function moveWatchlist(state: WatchlistsState, id: string, direction: -1 | 1): WatchlistsState {
  const index = state.lists.findIndex((list) => list.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.lists.length) return state;
  const lists = [...state.lists];
  [lists[index], lists[target]] = [lists[target], lists[index]];
  return { ...state, lists };
}

export function getWatchlistSwipeDirection(dx: number, velocityX: number): -1 | 1 | null {
  const distance = Math.abs(dx);
  return distance >= 24 || (distance >= 12 && Math.abs(velocityX) >= 0.25) ? dx < 0 ? 1 : -1 : null;
}

export function getWatchlistDragOffset(dx: number, width: number, index: number, count: number) {
  const atEdge = dx > 0 ? index <= 0 : index >= count - 1;
  return Math.max(-width, Math.min(width, atEdge ? dx * 0.15 : dx));
}

export function getPortfolioWatchlistSymbols(positions: ReadonlyArray<{ symbol: string; shares: number }>) {
  return [...new Set(positions.filter((position) => position.shares > 0).map((position) => position.symbol))];
}

type PricePoint = { timestamp: number; price: number };

export function lastTradingDay(allPoints: PricePoint[]) {
  if (!allPoints.length) return { points: [] as PricePoint[], base: null as number | null };
  const dayOf = (point: PricePoint) => new Date(point.timestamp * 1000).toISOString().slice(0, 10);
  const latestDay = dayOf(allPoints[allPoints.length - 1]);
  const firstIndex = allPoints.findIndex((point) => dayOf(point) === latestDay);
  return {
    points: allPoints.slice(firstIndex),
    base: firstIndex > 0 ? allPoints[firstIndex - 1].price : allPoints[firstIndex].price,
  };
}

export function getWatchlistMovement(allPoints: PricePoint[], quotePrice: number | null, daily: boolean) {
  const day = daily ? lastTradingDay(allPoints) : null;
  const points = day?.points ?? allPoints;
  const current = daily ? points[points.length - 1]?.price ?? quotePrice
    : quotePrice ?? points[points.length - 1]?.price ?? null;
  const base = day ? day.base : allPoints[0]?.price ?? null;
  if (current === null || base === null || !Number.isFinite(current) || !Number.isFinite(base) || base <= 0) {
    return { absolute: null, percent: null };
  }
  const absolute = current - base;
  return { absolute, percent: absolute / base * 100 };
}

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
