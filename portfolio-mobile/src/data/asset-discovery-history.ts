import { useEffect, useState } from 'react';
import { appStorage } from './app-storage';
import { Asset, availableAssets } from './portfolio';
import { assetCategories, DiscoveryVisit, getFeaturedAssetBySymbol } from './asset-discovery';

const KEY = '@portfolio-mobile/discovery-history-v1';
const MAX_ENTRIES = 80;
const listeners = new Set<(visits: DiscoveryVisit[]) => void>();
let current: DiscoveryVisit[] = [];
let loading: Promise<void> | null = null;
let loaded = false;
let writes = Promise.resolve();

export function parseDiscoveryHistory(raw: string | null): DiscoveryVisit[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1
    || !('entries' in parsed) || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) {
    throw new Error('Invalid asset discovery history.');
  }
  const seen = new Set<string>();
  return parsed.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('asset' in entry)
      || !entry.asset || typeof entry.asset !== 'object'
      || !('views' in entry) || typeof entry.views !== 'number' || !Number.isSafeInteger(entry.views) || entry.views < 0
      || !('lastViewedAt' in entry) || typeof entry.lastViewedAt !== 'number'
      || !Number.isFinite(entry.lastViewedAt) || entry.lastViewedAt < 0) {
      throw new Error('Invalid asset discovery visit.');
    }
    const asset = entry.asset;
    if (!('symbol' in asset) || typeof asset.symbol !== 'string' || !/^[A-Z0-9.^=-]{1,20}$/.test(asset.symbol)
      || seen.has(asset.symbol) || !('name' in asset) || typeof asset.name !== 'string' || !asset.name.trim()
      || asset.name.length > 200 || !('color' in asset) || typeof asset.color !== 'string'
      || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(asset.color)
      || !('category' in asset) || !assetCategories.some((category) => category === asset.category)) {
      throw new Error('Invalid asset discovery metadata.');
    }
    const category = assetCategories.find((category) => category === asset.category)!;
    seen.add(asset.symbol);
    return {
      asset: { symbol: asset.symbol, name: asset.name, color: asset.color, category, price: 0, change: 0 },
      views: entry.views,
      lastViewedAt: entry.lastViewedAt,
    };
  });
}

function publish() {
  listeners.forEach((listener) => listener(current));
}

async function ensureLoaded() {
  if (loaded) return;
  if (!loading) {
    loading = appStorage.getItem(KEY).then((raw) => {
      current = parseDiscoveryHistory(raw);
      loaded = true;
      publish();
    });
  }
  try {
    await loading;
  } finally {
    loading = null;
  }
}

function updateHistory(update: (visits: DiscoveryVisit[]) => DiscoveryVisit[]) {
  writes = writes.then(async () => {
    await ensureLoaded();
    const next = update(current);
    if (next === current) return;
    const bounded = [...next].sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, MAX_ENTRIES);
    await appStorage.setItem(KEY, JSON.stringify({ version: 1, entries: bounded }));
    current = bounded;
    publish();
  }).catch((error: unknown) => {
    console.warn('Asset discovery history could not be saved:', error);
  });
}

export function rememberDiscoveryAsset(asset: Asset) {
  if (!asset.category) {
    console.warn('Asset discovery requires a classified asset:', asset.symbol);
    return;
  }
  updateHistory((visits) => {
    const previous = visits.find((visit) => visit.asset.symbol === asset.symbol);
    return [
      { asset: { ...asset, price: 0, change: 0 }, views: previous?.views ?? 0, lastViewedAt: previous?.lastViewedAt ?? Date.now() },
      ...visits.filter((visit) => visit.asset.symbol !== asset.symbol),
    ];
  });
}

export function recordAssetView(symbol: string) {
  updateHistory((visits) => {
    const previous = visits.find((visit) => visit.asset.symbol === symbol);
    const knownStock = availableAssets.find((asset) => asset.symbol === symbol);
    const asset = previous?.asset ?? getFeaturedAssetBySymbol(symbol)
      ?? (knownStock ? { ...knownStock, category: 'stocks' as const } : undefined);
    if (!asset) return visits;
    return [
      { asset, views: (previous?.views ?? 0) + 1, lastViewedAt: Date.now() },
      ...visits.filter((visit) => visit.asset.symbol !== symbol),
    ];
  });
}

export function useDiscoveryVisits() {
  const [visits, setVisits] = useState(current);
  useEffect(() => {
    listeners.add(setVisits);
    void ensureLoaded().catch((error: unknown) => {
      console.warn('Asset discovery history could not be loaded:', error);
    });
    return () => { listeners.delete(setVisits); };
  }, []);
  return visits;
}
