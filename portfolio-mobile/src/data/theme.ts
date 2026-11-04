import { Platform } from 'react-native';
import { colors } from './portfolio';
import { appStorage } from './app-storage';
import { useMemo, useSyncExternalStore } from 'react';

type FileApi = typeof import('expo-file-system');

function themeFile() {
  // Lazy načítanie, aby prípadná chyba natívneho modulu nezhodila štart aplikácie.
  const fs = require('expo-file-system') as FileApi;
  return new fs.File(fs.Paths.document, STORAGE_NAME);
}

export type ThemeName = 'dark' | 'light';

const STORAGE_NAME = 'theme.txt';
const dark = { ...colors };
const light: typeof colors = {
  background: '#fff0d6',
  surface: '#fff7e6',
  surfaceRaised: '#f8e3bd',
  border: '#e3c28e',
  text: '#402c23',
  muted: '#6e5547',
  green: '#226336',
  red: '#a82d3b',
  cyan: '#105c6a',
  blue: '#1758b7',
  violet: '#4551bd',
};

let currentTheme: ThemeName = 'dark';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function getTheme() {
  return currentTheme;
}

export function applyTheme(name: ThemeName) {
  if (name === currentTheme) return;
  currentTheme = name;
  Object.assign(colors, name === 'light' ? light : dark);
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}

export function useThemedStyles<T>(createStyles: () => T): T {
  const theme = useTheme();
  return useMemo(createStyles, [createStyles, theme]);
}

// Synchrónne čítanie, aby bol motív známy ešte pred vytvorením štýlov.
export function readStoredTheme(): ThemeName {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem(STORAGE_NAME) === 'light' ? 'light' : 'dark';
    }
    const file = themeFile();
    return file.exists && file.textSync().trim() === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export async function storeTheme(name: ThemeName, backup = true) {
  if (backup) await appStorage.setItem('@portfolio-mobile/theme', name);
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_NAME, name);
  } else {
    const file = themeFile();
    if (!file.exists) file.create();
    file.writeSync(name);
  }
  applyTheme(name);
}
