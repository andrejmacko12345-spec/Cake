import { useEffect, useRef, useState } from 'react';
import { Asset } from '../data/portfolio';
import { searchAssets } from '../data/quotes';

export function useAssetSearch(query: string) {
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

    setLoading(true);
    setError('');
    const timeout = setTimeout(() => {
      void searchAssets(normalizedQuery)
        .then((matches) => {
          if (requestId.current === currentRequestId) setResults(matches);
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
  }, [query]);

  return { results, loading, error };
}
