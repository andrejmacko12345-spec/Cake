import { useCallback, useEffect, useRef } from 'react';

export function useFrameSelection(onSelect: (index: number | null) => void) {
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const pending = useRef<number | null>(null);
  const selected = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback((index: number | null) => {
    pending.current = index;
    if (index === null) {
      cancel();
      selected.current = null;
      callback.current(null);
      return;
    }
    if (frame.current !== null || index === selected.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current === selected.current) return;
      selected.current = pending.current;
      callback.current(pending.current);
    });
  }, [cancel]);
}
