import { useEffect, useRef } from 'react';
import { Animated, Easing, Keyboard, Platform } from 'react-native';

export function usePopupAnimation(visible: boolean) {
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  useEffect(() => {
    closing.current = false;
    if (!visible) {
      progress.setValue(0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 440,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [visible, progress]);
  return {
    close: (onClosed: () => void) => {
      if (closing.current) return;
      closing.current = true;
      Keyboard.dismiss();
      progress.stopAnimation();
      Animated.timing(progress, {
        toValue: 0,
        duration: 320,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) onClosed();
      });
    },
    backdrop: { opacity: progress },
    sheet: {
      opacity: progress,
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }],
    },
  };
}
