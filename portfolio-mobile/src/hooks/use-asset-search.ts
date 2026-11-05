import { useEffect, useRef, useState } from 'react';
import { Asset } from '../data/portfolio';
import { AssetCategory, filterAssetsByCategory } from '../data/asset-discovery';
import { searchAssets } from '../data/quotes';

export function useAssetSearch(query: string, category?: AssetCategory | 'all') {
  const [results, setResults] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const currentRequestId = ++requestId.current;
    if (normalizedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    setResults([]);
    setLoading(true);
    setError('');
    const timeout = setTimeout(() => {
      void searchAssets(normalizedQuery)
        .then((matches) => {
          if (requestId.current === currentRequestId) {
            setResults(category === 'all'
              ? matches
              : category
              ? filterAssetsByCategory(matches, category)
              : matches.filter((asset) => asset.category !== 'indexes'));
          }
        })
        .catch((reason: unknown) => {
          if (requestId.current !== currentRequestId) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (requestId.current === currentRequestId) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeout);
      requestId.current += 1;
    };
  }, [query, category]);

  return { results, loading, error };
}
