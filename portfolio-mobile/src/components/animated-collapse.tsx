import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

export function AnimatedCollapse({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      changed = true;
      setReduceMotion(enabled);
    });
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active && !changed) setReduceMotion(enabled);
    }).catch((error: unknown) => console.warn('Reduced motion setting unavailable:', error));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: reduceMotion ? 0 : expanded ? 360 : 300,
      easing: Easing.inOut(Easing.cubic),
      isInteraction: false,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, reduceMotion, progress]);
  return (
    <Animated.View
      style={[styles.clip, { height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), opacity: progress }]}
      pointerEvents={expanded ? 'auto' : 'none'}
      aria-hidden={!expanded}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
    >
      <View style={styles.content} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
});
