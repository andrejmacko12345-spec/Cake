import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type EventPrefs = { earnings: boolean; dividends: boolean; news: boolean };

const KEY = 'event-preferences';
const listeners = new Set<(prefs: EventPrefs) => void>();
let current: EventPrefs = { earnings: true, dividends: false, news: false };
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) current = { ...current, ...(JSON.parse(raw) as Partial<EventPrefs>) };
  } catch {
    // ostanú predvolené hodnoty
  }
  listeners.forEach((listener) => listener(current));
}

export async function setEventPref(key: keyof EventPrefs, value: boolean) {
  current = { ...current, [key]: value };
  listeners.forEach((listener) => listener(current));
  await AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
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
