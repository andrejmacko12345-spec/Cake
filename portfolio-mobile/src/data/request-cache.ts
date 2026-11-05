export function createRequestCache<T>(ttl: number, capacity = 128) {
  const values = new Map<string, { at: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = values.get(key);
    if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached.value);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(load).then((value) => {
      values.delete(key);
      values.set(key, { at: Date.now(), value });
      while (values.size > capacity) values.delete(values.keys().next().value!);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
