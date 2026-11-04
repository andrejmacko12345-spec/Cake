import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { BACKUP_KEYS, Backup, makeBackup, parseBackup } from './account-backup';

let owner: string | null = null;
const listeners = new Set<() => void>();
const scopeListeners = new Set<() => void>();
const deletedOwners = new Set<string>();
const pendingWrites = new Map<string | null, Set<Promise<void>>>();
const pausedOwners = new Set<string | null>();
const scopedKey = (key: string, userId = owner) => userId ? `@fincake/user/${userId}/${key}` : key;

export function setStorageOwner(userId: string | null) {
  owner = userId;
  scopeListeners.forEach((listener) => listener());
}

export function onStorageScopeChange(listener: () => void) {
  scopeListeners.add(listener);
  return () => { scopeListeners.delete(listener); };
}

export function onStorageChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function writeFor(userId: string | null, action: () => Promise<void>) {
  if (userId && deletedOwners.has(userId)) throw new Error('This account has been deleted.');
  if (pausedOwners.has(userId)) throw new Error('Account data is changing. Please try again.');
  const operation = action();
  let writes = pendingWrites.get(userId);
  if (!writes) { writes = new Set(); pendingWrites.set(userId, writes); }
  writes.add(operation);
  try { await operation; }
  finally {
    writes.delete(operation);
    if (!writes.size) pendingWrites.delete(userId);
  }
}

export function pauseAccountWrites(userId: string | null) {
  pausedOwners.add(userId);
  return () => { pausedOwners.delete(userId); };
}

export async function flushAccountWrites(userId: string | null) {
  let writes = pendingWrites.get(userId);
  while (writes?.size) {
    await Promise.all(writes);
    writes = pendingWrites.get(userId);
  }
}

function storageFor(userId: string | null) { return {
  getItem(key: string) {
    return AsyncStorage.getItem(scopedKey(key, userId));
  },
  async setItem(key: string, value: string) {
    await writeFor(userId, () => AsyncStorage.setItem(scopedKey(key, userId), value));
    if (owner === userId && BACKUP_KEYS.some((allowed) => allowed === key)) {
      listeners.forEach((listener) => listener());
    }
  },
  async removeItem(key: string) {
    await writeFor(userId, () => AsyncStorage.removeItem(scopedKey(key, userId)));
    if (owner === userId) listeners.forEach((listener) => listener());
  },
}; }

export function useAppStorage() {
  return useMemo(() => storageFor(owner), []);
}

export const appStorage = {
  getItem: (key: string, userId: string | null = owner) => storageFor(userId).getItem(key),
  setItem: (key: string, value: string) => storageFor(owner).setItem(key, value),
};

export async function readBackup(userId: string | null) {
  await flushAccountWrites(userId);
  const keys = BACKUP_KEYS.map((key) => scopedKey(key, userId));
  const pairs = await AsyncStorage.multiGet(keys);
  return makeBackup(pairs.map(([, value], index) => [BACKUP_KEYS[index], value]));
}

export async function restoreBackup(userId: string, input: Backup) {
  const backup = parseBackup(input);
  // One write replaces the complete account snapshot, including fields absent from the backup.
  await AsyncStorage.multiSet(BACKUP_KEYS.map((key) => [
    scopedKey(key, userId), backup.values[key] ?? defaultValue(key),
  ]));
}

export async function clearAccountData(userId: string) {
  deletedOwners.add(userId);
  const results = await Promise.allSettled(pendingWrites.get(userId) ?? []);
  for (const result of results) {
    if (result.status === 'rejected') console.warn('Pending account write failed during deletion:', result.reason);
  }
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(`@fincake/user/${userId}/`)));
}

function defaultValue(key: string): string {
  if (key.endsWith('/transactions-v1')) return '{"transactions":[],"quotes":{}}';
  if (key.endsWith('/watchlist')) return '{"lists":[{"id":"default","name":"Watchlist","symbols":[]}],"selectedId":"default"}';
  if (key.endsWith('/language')) return 'sk';
  if (key.endsWith('/theme')) return 'dark';
  if (key.endsWith('/hide-amounts')) return 'false';
  if (key === 'event-preferences') return '{"earnings":true,"dividends":false,"news":false}';
  if (key.endsWith('/compare-metrics')) return '{"version":6,"keys":[]}';
  return '[]';
}
