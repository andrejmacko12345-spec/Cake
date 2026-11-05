import { appStorage, onBulkStorageChange } from './app-storage';
import { useEffect, useState } from 'react';
import { parseEventSymbols } from './event-symbols';

export type EventPrefs = { earnings: boolean; dividends: boolean; news: boolean; symbols: string[] | null };

const KEY = 'event-preferences';
const listeners = new Set<(prefs: EventPrefs) => void>();
let current: EventPrefs = { earnings: true, dividends: false, news: false, symbols: null };
let loaded = false;
let loading: Promise<void> | null = null;
let loadGeneration = 0;
onBulkStorageChange(() => {
  const generation = ++loadGeneration;
  loaded = false;
  loading = null;
  current = { earnings: true, dividends: false, news: false, symbols: null };
  void ensureLoaded(generation).catch(() => {});
});

async function ensureLoaded(generation = loadGeneration) {
  if (loaded) return;
  if (loading) return loading;
  const request = loadPreferences(generation);
  loading = request;
  try {
    await request;
  } finally {
    if (loading === request) loading = null;
  }
}

async function loadPreferences(generation: number) {
  try {
    const raw = await appStorage.getItem(KEY);
    if (generation !== loadGeneration) return;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid event preferences.');
      const next = { ...current };
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'earnings' || key === 'dividends' || key === 'news') {
          if (typeof value !== 'boolean') throw new Error('Invalid event preferences.');
          next[key] = value;
        }
      }
      next.symbols = parseEventSymbols('symbols' in parsed ? parsed.symbols : undefined);
      current = next;
    }
    loaded = true;
  } catch (error) {
    if (generation !== loadGeneration) return;
    loaded = false;
    console.warn('Event preferences could not be loaded:', error);
    throw error;
  }
  if (generation === loadGeneration) listeners.forEach((listener) => listener(current));
}

export async function setEventPref(key: 'earnings' | 'dividends' | 'news', value: boolean) {
  await ensureLoaded();
  const next = { ...current, [key]: value };
  await appStorage.setItem(KEY, JSON.stringify(next));
  current = next;
  listeners.forEach((listener) => listener(current));
}

export async function setEventSymbols(symbols: string[] | null) {
  await ensureLoaded();
  const next = { ...current, symbols: parseEventSymbols(symbols) };
  await appStorage.setItem(KEY, JSON.stringify(next));
  current = next;
  listeners.forEach((listener) => listener(current));
}

export function useEventPrefs() {
  const [prefs, setPrefs] = useState(current);
  useEffect(() => {
    listeners.add(setPrefs);
    void ensureLoaded().then(() => setPrefs(current)).catch(() => {});
    return () => { listeners.delete(setPrefs); };
  }, []);
  return prefs;
}
