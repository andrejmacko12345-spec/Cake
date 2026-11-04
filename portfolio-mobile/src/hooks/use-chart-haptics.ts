import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function useChartHaptics() {
  const lastIndex = useRef<number | null>(null);
  const lastFeedbackAt = useRef<number | null>(null);
  return useCallback((index: number | null) => {
    if (index === null) {
      lastIndex.current = null;
      lastFeedbackAt.current = null;
      return;
    }
    if (!Number.isInteger(index) || index < 0 || lastIndex.current === index) return;
    lastIndex.current = index;
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    const now = Date.now();
    if (lastFeedbackAt.current !== null && now - lastFeedbackAt.current < 40) return;
    lastFeedbackAt.current = now;
    const feedback = Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick)
      : Haptics.selectionAsync();
    void feedback.catch((error: unknown) => console.warn('Chart selection haptics failed:', error));
  }, []);
}
