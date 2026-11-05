import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';
import { selectionHaptic } from '../data/haptics';

type Slot = { x: number; y: number; width: number; height: number };

// Commit a dragged-to range once the finger rests on it this long, even before release.
export const RANGE_DWELL_MS = 450;

export function nearestRangeIndex(slots: Array<Slot | undefined>, x: number): number {
  let best = -1;
  let bestDistance = Infinity;
  slots.forEach((slot, index) => {
    if (!slot) return;
    const distance = Math.abs(slot.x + slot.width / 2 - x);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

type Props<T extends string> = {
  labels: readonly T[];
  selected: T;
  onChange: (label: T) => void;
  renderLabel?: (label: T) => ReactNode;
  style: StyleProp<ViewStyle>;
  buttonStyle: StyleProp<ViewStyle>;
  indicatorStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  selectedTextStyle: StyleProp<TextStyle>;
};

// Range buttons that can also be scrubbed: dragging only moves the highlight, and the
// (expensive) range change is committed on release or after the finger rests on a range.
export function RangeSwipeRow<T extends string>({
  labels, selected, onChange, renderLabel, style, buttonStyle, indicatorStyle, textStyle, selectedTextStyle,
}: Props<T>) {
  const rowRef = useRef<ComponentRef<typeof View>>(null);
  const buttonRefs = useRef<Array<ComponentRef<typeof View> | null>>([]);
  const slots = useRef<Array<Slot | undefined>>([]);
  const rowPageX = useRef(0);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [slotsReady, setSlotsReady] = useState(false);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const [indicatorBox, setIndicatorBox] = useState({ y: 0, height: 0 });
  const state = useRef({ labels, selected, onChange, preview });
  state.current = { labels, selected, onChange, preview };

  const snapTo = (index: number, animated: boolean) => {
    const slot = slots.current[index];
    if (!slot) return;
    if (animated) {
      Animated.parallel([
        Animated.spring(indicatorX, { toValue: slot.x, useNativeDriver: false, speed: 28, bounciness: 4 }),
        Animated.spring(indicatorWidth, { toValue: slot.width, useNativeDriver: false, speed: 28, bounciness: 4 }),
      ]).start();
    } else {
      indicatorX.setValue(slot.x);
      indicatorWidth.setValue(slot.width);
    }
  };

  // onLayout does not fire for pure position shifts on every platform, so re-measure buttons
  // relative to the row before relying on stored slots.
  const measureSlots = (animated = false, done?: (rowX: number) => void) => {
    const row = rowRef.current;
    if (!row?.measureInWindow) return done?.(NaN);
    row.measureInWindow((rowX, rowY) => {
      const buttons = buttonRefs.current.slice(0, state.current.labels.length);
      let pending = buttons.length;
      const complete = () => {
        if (state.current.preview === null) {
          const index = state.current.labels.indexOf(state.current.selected);
          const slot = slots.current[index];
          if (slot) setIndicatorBox((box) => (box.y === slot.y && box.height === slot.height ? box : { y: slot.y, height: slot.height }));
          snapTo(index, animated);
        }
        done?.(rowX);
      };
      if (!pending) return complete();
      buttons.forEach((button, index) => {
        if (!button?.measureInWindow) {
          if (--pending === 0) complete();
          return;
        }
        button.measureInWindow((x, y, width, height) => {
          if ([x, y, width, height].every(Number.isFinite)) {
            slots.current[index] = { x: x - rowX, y: y - rowY, width, height };
          }
          if (--pending === 0) complete();
        });
      });
    });
  };
  const measureRef = useRef(measureSlots);
  measureRef.current = measureSlots;

  const selectedIndex = labels.indexOf(selected);
  useEffect(() => {
    if (slotsReady && state.current.preview === null) measureRef.current(true);
    // snapTo only reads refs and stable animated values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, slotsReady]);

  useEffect(() => () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
  }, []);

  const panHandlers = useMemo(() => {
    const clearDwell = () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    };
    const commit = (label: T) => {
      clearDwell();
      if (label !== state.current.selected) state.current.onChange(label);
    };
    const follow = (pageX: number) => {
      const x = pageX - rowPageX.current;
      const index = nearestRangeIndex(slots.current, x);
      const slot = slots.current[index];
      const label = state.current.labels[index];
      if (!slot || label === undefined) return;
      const first = slots.current.find(Boolean)!;
      const last = [...slots.current].reverse().find(Boolean)!;
      const left = Math.min(Math.max(x - slot.width / 2, first.x), last.x + last.width - slot.width);
      indicatorX.setValue(left);
      indicatorWidth.setValue(slot.width);
      if (label !== state.current.preview) {
        state.current.preview = label;
        setPreview(label);
        selectionHaptic();
        clearDwell();
        dwellTimer.current = setTimeout(() => commit(label), RANGE_DWELL_MS);
      }
    };
    const finish = () => {
      const label = state.current.preview;
      state.current.preview = null;
      setPreview(null);
      if (label !== null) {
        snapTo(state.current.labels.indexOf(label), true);
        commit(label);
      } else {
        clearDwell();
      }
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const { pageX, locationX } = event.nativeEvent;
        rowPageX.current = pageX - locationX;
        state.current.preview = state.current.selected;
        measureRef.current(false, (x) => {
          if (Number.isFinite(x)) rowPageX.current = x;
          if (state.current.preview !== null) follow(pageX);
        });
      },
      onPanResponderMove: (event) => follow(event.nativeEvent.pageX),
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    }).panHandlers;
    // Handlers read the latest props through state.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onButtonLayout = (index: number) => (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    slots.current[index] = { x, y, width, height };
    if (index === state.current.labels.indexOf(state.current.selected) && state.current.preview === null) {
      setIndicatorBox({ y, height });
      snapTo(index, false);
    }
    if (slots.current.filter(Boolean).length === labels.length) setSlotsReady(true);
  };

  const active = preview ?? selected;
  return (
    <View ref={rowRef} {...panHandlers} onLayout={() => measureSlots()} style={style}>
      <Animated.View pointerEvents="none" style={[styles.indicator, indicatorStyle,
        { top: indicatorBox.y, height: indicatorBox.height, left: indicatorX, width: indicatorWidth,
          opacity: slotsReady ? 1 : 0 }]} />
      {labels.map((label, index) => (
        <Pressable
          key={label}
          ref={(node) => { buttonRefs.current[index] = node; }}
          accessibilityRole="button"
          accessibilityState={{ selected: label === selected }}
          onLayout={onButtonLayout(index)}
          onPress={() => {
            if (label !== selected) selectionHaptic();
            onChange(label);
          }}
          style={[buttonStyle, styles.button]}
        >
          <Text style={[textStyle, label === active && selectedTextStyle]}>{renderLabel ? renderLabel(label) : label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: { position: 'absolute', zIndex: 0 },
  button: { position: 'relative', zIndex: 1 },
});
