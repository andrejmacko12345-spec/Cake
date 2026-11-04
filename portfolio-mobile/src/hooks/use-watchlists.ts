import { useEffect, useState } from 'react';
import { onStorageChange, useAppStorage } from '../data/app-storage';
import { parseWatchlists, WATCHLIST_KEY } from '../data/watchlists';
import type { Watchlist } from '../data/watchlists';

export function useWatchlists() {
  const storage = useAppStorage();
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const next = parseWatchlists(await storage.getItem(WATCHLIST_KEY));
        if (active && current === request) {
          setLists(next.lists);
          setError('');
        }
      } catch (failure) {
        console.warn('Projection watchlists failed:', failure);
        if (active && current === request) {
          setLists([]);
          setError(failure instanceof Error ? failure.message : 'Uložený zoznam nemá očakávaný formát.');
        }
      } finally {
        if (active && current === request) setLoading(false);
      }
    };
    const unsubscribe = onStorageChange(() => { void load(); });
    void load();
    return () => { active = false; unsubscribe(); };
  }, [storage]);
  return { lists, loading, error };
}
