import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { colors } from './portfolio';

export type ThemeName = 'dark' | 'light';

const STORAGE_NAME = 'theme.txt';
const dark = { ...colors };
const light: typeof colors = {
  background: '#eef1f6',
  surface: '#ffffff',
  surfaceRaised: '#e6eaf2',
  border: '#d2d9e5',
  text: '#161c28',
  muted: '#5b6779',
  green: '#2f9e44',
  red: '#e0313a',
  cyan: '#0e8fa0',
  blue: '#1758b7',
  violet: '#4f5fe0',
};

let currentTheme: ThemeName = 'dark';

export function getTheme() {
  return currentTheme;
}

// Štýly sa vytvárajú pri štarte aplikácie, preto sa motív aplikuje pred načítaním obrazoviek.
export function applyTheme(name: ThemeName) {
  currentTheme = name;
  Object.assign(colors, name === 'light' ? light : dark);
}

// Synchrónne čítanie, aby bol motív známy ešte pred vytvorením štýlov.
export function readStoredTheme(): ThemeName {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem(STORAGE_NAME) === 'light' ? 'light' : 'dark';
    }
    const file = new File(Paths.document, STORAGE_NAME);
    return file.exists && file.textSync().trim() === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function storeTheme(name: ThemeName) {
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_NAME, name);
    return;
  }
  const file = new File(Paths.document, STORAGE_NAME);
  if (!file.exists) file.create();
  file.writeSync(name);
}
