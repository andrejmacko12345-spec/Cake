import { appStorage, onStorageScopeChange } from './app-storage';
import { useEffect, useState } from 'react';

export type EventPrefs = { earnings: boolean; dividends: boolean; news: boolean };

const KEY = 'event-preferences';
const listeners = new Set<(prefs: EventPrefs) => void>();
let current: EventPrefs = { earnings: true, dividends: false, news: false };
let loaded = false;
let generation = 0;
onStorageScopeChange(() => {
  generation++;
  loaded = false;
  current = { earnings: true, dividends: false, news: false };
});

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const started = generation;
  try {
    const raw = await appStorage.getItem(KEY);
    if (started !== generation) return;
    if (raw) current = { ...current, ...(JSON.parse(raw) as Partial<EventPrefs>) };
  } catch (error) {
    loaded = false;
    console.warn('Event preferences could not be loaded:', error);
  }
  listeners.forEach((listener) => listener(current));
}

export async function setEventPref(key: keyof EventPrefs, value: boolean) {
  current = { ...current, [key]: value };
  listeners.forEach((listener) => listener(current));
  await appStorage.setItem(KEY, JSON.stringify(current));
}

export function useEventPrefs() {
  const [prefs, setPrefs] = useState(current);
  useEffect(() => {
    listeners.add(setPrefs);
    void ensureLoaded().then(() => setPrefs(current));
    return () => { listeners.delete(setPrefs); };
  }, []);
  return prefs;
}
