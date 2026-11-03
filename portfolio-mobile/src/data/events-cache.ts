import { CompanyEvents, fetchCompanyEvents } from './events';

export type EventsCacheSnapshot = {
  data: Record<string, CompanyEvents>;
  errors: Record<string, string>;
  loading: string[];
};

const data: Record<string, CompanyEvents> = {};
const errors: Record<string, string> = {};
const loading = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<(snapshot: EventsCacheSnapshot) => void>();

function snapshot(): EventsCacheSnapshot {
  return { data: { ...data }, errors: { ...errors }, loading: [...loading] };
}

function notify() {
  const current = snapshot();
  listeners.forEach((listener) => listener(current));
}

export function getEventsCacheSnapshot() {
  return snapshot();
}

export function subscribeToEventsCache(listener: (snapshot: EventsCacheSnapshot) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function preloadCompanyEvents(symbols: string[], force = false) {
  const requested = [...new Set(symbols)];
  let index = 0;
  const worker = async () => {
    while (index < requested.length) {
      const symbol = requested[index++];
      if ((!force && data[symbol]) || inFlight.has(symbol)) continue;
      loading.add(symbol);
      delete errors[symbol];
      notify();
      const request = fetchCompanyEvents(symbol, force)
        .then((company) => {
          data[symbol] = company;
          delete errors[symbol];
        })
        .catch((error: unknown) => {
          errors[symbol] = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          loading.delete(symbol);
          inFlight.delete(symbol);
          notify();
        });
      inFlight.set(symbol, request);
      await request;
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, requested.length) }, worker));
}
