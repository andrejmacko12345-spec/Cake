import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import StockCompare from '../components/stock-compare';
import StockProjections from '../components/stock-projections';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { useThemedStyles } from '../data/theme';
import { selectionHaptic } from '../data/haptics';

export default function AnalyseScreen() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLocale();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const [active, setActive] = useState(section === 'compare' ? 1 : 0);
  const activeRef = useRef(active);
  const initialOffset = useRef({ x: section === 'compare' ? windowWidth : 0, y: 0 });
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  const progress = useRef(new Animated.Value(active)).current;
  const feedbackIndex = useRef(active);
  useEffect(() => {
    if (section !== 'projections' && section !== 'compare') return;
    const index = section === 'compare' ? 1 : 0;
    activeRef.current = index;
    setActive(index);
    progress.setValue(index);
    feedbackIndex.current = index;
    pager.current?.scrollTo({ x: index * width, animated: false });
  }, [section]);
  useEffect(() => {
    pager.current?.scrollTo({ x: activeRef.current * width, animated: false });
  }, [width]);
  const select = (index: number) => {
    if (index !== activeRef.current) selectionHaptic();
    feedbackIndex.current = index;
    activeRef.current = index;
    setActive(index);
    pager.current?.scrollTo({ x: index * width, animated: true });
  };
  return (
    <View style={styles.root} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.top}>
        <Text style={styles.title}>{t('Analýza')}</Text>
        <View accessibilityRole="tablist" style={styles.tabs}>
          <Animated.View pointerEvents="none" style={[styles.highlight, {
            transform: [{ translateX: progress.interpolate({
              inputRange: [0, 1], outputRange: [0, 112], extrapolate: 'clamp',
            }) }],
          }]} />
          {['Projekcie', 'Porovnanie'].map((label, index) => (
            <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: active === index }}
              accessibilityLabel={t(label)} onPress={() => select(index)}
              style={styles.tab}>
              <Text style={[styles.label, active === index && styles.selectedLabel]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
      <ScrollView ref={pager} horizontal pagingEnabled directionalLockEnabled
        showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" scrollEventThrottle={16}
        contentOffset={initialOffset.current}
        onScroll={(event) => {
          progress.setValue(event.nativeEvent.contentOffset.x / width);
          const index = Math.max(0, Math.min(1, Math.round(event.nativeEvent.contentOffset.x / width)));
          if (index !== activeRef.current) {
            activeRef.current = index;
            setActive(index);
          }
        }}
        onMomentumScrollEnd={(event) => {
          const index = Math.max(0, Math.min(1, Math.round(event.nativeEvent.contentOffset.x / width)));
          if (index !== feedbackIndex.current) {
            selectionHaptic();
            feedbackIndex.current = index;
          }
        }} style={styles.pager}>
        <View style={{ width }} accessibilityElementsHidden={active !== 0}
          importantForAccessibility={active === 0 ? 'auto' : 'no-hide-descendants'}>
          <StockProjections embedded />
        </View>
        <View style={{ width }} accessibilityElementsHidden={active !== 1}
          importantForAccessibility={active === 1 ? 'auto' : 'no-hide-descendants'}>
          <StockCompare />
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 4, marginBottom: 4 },
  tabs: { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 22, padding: 3, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tab: { width: 112, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  highlight: { position: 'absolute', top: 3, left: 3, width: 112, height: 32, borderRadius: 18,
    backgroundColor: `${colors.green}18`, borderWidth: StyleSheet.hairlineWidth, borderColor: `${colors.green}45` },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectedLabel: { color: colors.green },
  pager: { flex: 1 },
});
