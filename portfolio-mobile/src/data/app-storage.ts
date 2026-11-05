import AsyncStorage from '@react-native-async-storage/async-storage';

const listeners = new Set<() => void>();
const bulkListeners = new Set<() => void>();

const localStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, value);
    listeners.forEach((listener) => listener());
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    listeners.forEach((listener) => listener());
  },
};

export function useAppStorage() {
  return localStorage;
}

export function onStorageChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function onBulkStorageChange(listener: () => void) {
  bulkListeners.add(listener);
  return () => { bulkListeners.delete(listener); };
}

export async function setItems(items: [string, string][]) {
  await AsyncStorage.multiSet(items);
  listeners.forEach((listener) => listener());
  bulkListeners.forEach((listener) => listener());
}

export const appStorage = {
  getItem: localStorage.getItem,
  setItem: localStorage.setItem,
};
