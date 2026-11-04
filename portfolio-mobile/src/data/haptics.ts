import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function selectionHaptic() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const feedback = Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
    : Haptics.selectionAsync();
  void feedback.catch((error: unknown) => console.warn('Selection haptics failed:', error));
}
