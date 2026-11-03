import { useCallback, useRef, useState } from 'react';
import type { ComponentRef, ReactNode, RefObject } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Platform,
  ScrollView,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PanResponderInstance, ViewProps, ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { ChevronDown, Plus } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Asset, colors, formatMoney, formatPercent } from '../data/portfolio';
import { getTheme } from '../data/theme';
import type { Position } from '../hooks/use-positions';
import { positionCostEUR, positionValueEUR, usePositions } from '../hooks/use-positions';
import { AssetLogo } from './asset-logo';
import { useLocale } from '../context/locale';

export function Page({
  children,
  scrollRef,
  floating,
  onScrollViewLayout,
  animateOnFocus = false,
  gestureHandlers,
  pointerGestureHandlers,
}: {
  children: ReactNode;
  scrollRef?: RefObject<ComponentRef<typeof ScrollView> | null>;
  floating?: ReactNode;
  onScrollViewLayout?: (height: number) => void;
  animateOnFocus?: boolean;
  gestureHandlers?: PanResponderInstance['panHandlers'];
  pointerGestureHandlers?: Pick<ViewProps, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>;
}) {
  const entrance = useRef(new Animated.Value(animateOnFocus ? 0 : 1)).current;
  const entranceOffset = useRef(new Animated.Value(animateOnFocus ? 10 : 0)).current;

  useFocusEffect(useCallback(() => {
    if (!animateOnFocus) return undefined;
    entrance.setValue(0);
    entranceOffset.setValue(10);
    const animation = Animated.parallel([
      Animated.timing(entrance, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(entranceOffset, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [animateOnFocus, entrance, entranceOffset]));

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={getTheme() === 'light' ? 'dark-content' : 'light-content'} />
      <View style={styles.gestureLayer} {...gestureHandlers} {...pointerGestureHandlers}>
      <ScrollView
        ref={scrollRef}
        onLayout={onScrollViewLayout ? (event) => onScrollViewLayout(event.nativeEvent.layout.height) : undefined}
        contentContainerStyle={[styles.page, floating ? styles.pageWithFloating : undefined]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          style={animateOnFocus ? {
            opacity: entrance,
            transform: [{ translateY: entranceOffset }],
          } : undefined}
        >
          {children}
        </Animated.View>
      </ScrollView>
      </View>
      {floating ? <View pointerEvents="box-none" style={styles.floating}>{floating}</View> : null}
    </SafeAreaView>
  );
}

export function FloatingAddButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.floatingAddButton}
    >
      <Plus size={23} color={colors.surface} />
    </Pressable>
  );
}

export function SortControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (key: T) => void;
}) {
  const { t } = useLocale();
  return (
    <View style={styles.sortControl}>
      <Text style={styles.sortLabel}>{t('Zoradiť')}</Text>
      <View style={styles.sortOptions}>
        {options.map((option) => {
          const selected = value === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.key)}
              style={[styles.sortButton, selected && styles.sortButtonSelected]}
            >
              <Text style={[styles.sortButtonText, selected && styles.sortButtonTextSelected]}>{t(option.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Header({
  title,
  subtitle,
  action,
  brand,
  compact,
  onTitlePress,
  titleExpanded,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  brand?: boolean;
  compact?: boolean;
  onTitlePress?: () => void;
  titleExpanded?: boolean;
}) {
  const { t } = useLocale();
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerCopy}>
        {brand ? (
          <View style={styles.brandLine}>
            <Image source={require('../../assets/icon.png')} style={styles.brandIcon} />
            <Text style={styles.brandName}>Fincake</Text>
          </View>
        ) : null}
        {subtitle ? <Text style={styles.eyebrow}>{t(subtitle)}</Text> : null}
        {onTitlePress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Vybrať watchlist')}
            accessibilityState={{ expanded: titleExpanded }}
            onPress={onTitlePress}
            style={styles.headerTitleButton}
          >
            <Text style={styles.headerTitle} numberOfLines={1}>{t(title)}</Text>
            <ChevronDown size={16} color={colors.green} />
          </Pressable>
        ) : <Text style={styles.headerTitle}>{t(title)}</Text>}
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{t(title)}</Text>
      {action}
    </View>
  );
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function DemoNotice({ label }: { label: string }) {
  const { t } = useLocale();
  return (
    <View style={styles.demoNotice}>
      <View style={styles.demoDot} />
      <Text style={styles.demoText}>{t(label)}</Text>
    </View>
  );
}

export function ChangeLabel({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <Text style={[styles.change, { color: positive ? colors.green : colors.red }]}>
      {formatPercent(value)}
    </Text>
  );
}

export function PortfolioChart({
  values,
  color = colors.green,
  selectedIndex,
  onSelectPoint,
}: {
  values: number[];
  color?: string;
  selectedIndex?: number;
  onSelectPoint?: (index: number) => void;
}) {
  const [chartWidth, setChartWidth] = useState(320);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => ({
    x: 8 + (index / Math.max(values.length - 1, 1)) * 304,
    y: 112 - ((value - min) / range) * 92,
  }));
  const path = points.reduce((result, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${result} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  const fillPath = `${path} L 312 126 L 8 126 Z`;
  const activeIndex = selectedIndex === undefined
    ? points.length - 1
    : Math.max(0, Math.min(points.length - 1, selectedIndex));
  const activePoint = points[activeIndex];
  const selectNearestPoint = (event: { nativeEvent: { locationX: number } }) => {
    if (!onSelectPoint || points.length < 2) return;
    const chartX = event.nativeEvent.locationX * 320 / Math.max(1, chartWidth);
    const ratio = Math.max(0, Math.min(1, (chartX - 8) / 304));
    onSelectPoint(Math.round(ratio * (points.length - 1)));
  };

  return (
    <View
      style={styles.chartWrap}
      onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => Boolean(onSelectPoint && points.length > 1)}
      onMoveShouldSetResponder={() => Boolean(onSelectPoint && points.length > 1)}
      onResponderGrant={selectNearestPoint}
      onResponderMove={selectNearestPoint}
      accessibilityLabel={onSelectPoint ? 'Potiahnutím po grafe vyber konkrétny bod projekcie.' : undefined}
    >
      <Svg width="100%" height={160} viewBox="0 0 320 132" preserveAspectRatio="none">
        <Line x1="8" y1="126" x2="312" y2="126" stroke={colors.border} strokeWidth="1" />
        <Path d={fillPath} fill={color} fillOpacity={0.09} />
        <Path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        {onSelectPoint && activePoint ? (
          <>
            <Line
              x1={activePoint.x}
              y1="8"
              x2={activePoint.x}
              y2="126"
              stroke={color}
              strokeOpacity="0.55"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <Circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="6"
              fill={color}
              stroke={colors.surface}
              strokeWidth="2"
            />
          </>
        ) : points.length > 0 ? (
          <Circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill={color}
          />
        ) : null}
      </Svg>
    </View>
  );
}

export function AllocationChart({
  values,
  size = 172,
}: {
  values: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      {values.map((item) => {
        const length = (item.value / total) * circumference;
        const currentOffset = offset;
        offset += length;
        return (
          <Circle
            key={item.label}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={item.color}
            strokeWidth="26"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-currentOffset}
            transform="rotate(-90 80 80)"
          />
        );
      })}
      <Circle cx="80" cy="80" r="52" fill={colors.surface} />
    </Svg>
  );
}

export function LegendRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

export function PerformanceBars({ values }: { values: number[] }) {
  const years = ['2020', '2021', '2022', '2023', '2024'];
  return (
    <View style={styles.barsWrap}>
      <Svg width="100%" height={145} viewBox="0 0 300 145">
        <Line x1="0" y1="100" x2="300" y2="100" stroke={colors.muted} strokeWidth="1.5" />
        {values.map((value, index) => {
          const height = Math.abs(value) * 3;
          const positive = value >= 0;
          return (
            <Rect
              key={years[index]}
              x={index * 58 + 8}
              y={positive ? 100 - height : 100}
              width="38"
              height={height}
              rx="3"
              fill={positive ? colors.green : colors.red}
            />
          );
        })}
      </Svg>
      <View style={styles.barYears}>
        {years.map((year) => <Text key={year} style={styles.barYear}>{year}</Text>)}
      </View>
    </View>
  );
}

export function MoneyPair({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <View style={styles.moneyPair}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={[styles.moneyValue, color ? { color } : null]}>{formatMoney(value)}</Text>
    </View>
  );
}

export function AssetRow({
  asset,
  action,
  onPress,
}: {
  asset: Asset;
  action?: ReactNode;
  onPress?: () => void;
}) {
  const { t } = useLocale();
  const content = (
    <>
      <AssetLogo symbol={asset.symbol} color={asset.color} />
      <View style={styles.assetIdentity}>
        <Text style={styles.assetSymbol}>{asset.symbol}</Text>
        <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
      </View>
      <View style={styles.assetNumbers}>
        {asset.price > 0 ? (
          <>
            <Text style={styles.assetValue}>{formatMoney(asset.price)}</Text>
            <ChangeLabel value={asset.change} />
          </>
        ) : (
          <Text style={styles.assetName}>{t('Cena pri nákupe')}</Text>
        )}
      </View>
      {action}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={styles.assetRow}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.assetRow}>{content}</View>
  );
}

export function PositionRow({
  position,
  performance,
  onPress,
  hideAmounts = false,
  spark,
}: {
  spark?: number[];
  position: Position;
  performance?: { gainEUR: number; returnPercent: number };
  onPress: () => void;
  hideAmounts?: boolean;
}) {
  const marketValue = positionValueEUR(position);
  const cost = positionCostEUR(position);
  const unrealized = marketValue - cost;
  const result = performance?.gainEUR ??
    (position.shares > 0 ? unrealized : marketValue - cost + position.realizedProfitEUR);
  const returnPercent = performance?.returnPercent ??
    (position.shares > 0
      ? (cost > 0 ? (unrealized / cost) * 100 : 0)
      : position.totalInvestedEUR > 0 ? (result / position.totalInvestedEUR) * 100 : 0);
  const money = (value: number) => (hideAmounts ? '•••••' : formatMoney(value));
  const tone = result >= 0 ? colors.green : colors.red;
  let sparkPath = '';
  if (spark && spark.length > 1) {
    const lo = Math.min(...spark);
    const spread = Math.max(...spark) - lo || 1;
    sparkPath = spark
      .map((price, index) => `${index === 0 ? 'M' : 'L'} ${(index / (spark.length - 1)) * 160} ${35 - ((price - lo) / spread) * 30}`)
      .join(' ');
  }
  return (
    <Pressable
      accessibilityLabel={`Zobraziť graf a pohyby ${position.symbol}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.assetRow}
    >
      <AssetLogo symbol={position.symbol} color={position.color} size={42} />
      <View style={styles.assetIdentity}>
        <Text style={styles.assetSymbol}>{position.symbol}</Text>
        <Text style={styles.assetName} numberOfLines={1}>
          {position.shares > 0
            ? `${hideAmounts ? '•••' : position.shares.toLocaleString('sk-SK')} ks`
            : `Predaná · ${position.transactions.length} pohybov`}
        </Text>
      </View>
      {sparkPath ? (
        <Svg style={styles.rowSpark} height={28} viewBox="0 0 160 40" preserveAspectRatio="none">
          <Path d={sparkPath} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
      <View style={styles.assetNumbers}>
        <Text style={styles.rowValue}>
          {position.shares > 0
            ? money(marketValue)
            : performance ? money(result) : money(position.realizedProfitEUR)}
        </Text>
        <Text style={[styles.rowGain, { color: tone }]}>
          {formatPercent(returnPercent)}
          {position.shares > 0 || performance
            ? hideAmounts ? '' : ` · ${result >= 0 ? '+' : ''}${formatMoney(result)}`
            : ''}
        </Text>      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  sortControl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sortLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  sortOptions: { flexDirection: 'row', gap: 5, padding: 3, borderRadius: 11, backgroundColor: colors.surface },
  sortButton: { minWidth: 62, alignItems: 'center', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  sortButtonSelected: { backgroundColor: colors.green },
  sortButtonText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  sortButtonTextSelected: { color: colors.surface },
  rowSpark: { width: 56, height: 28, marginHorizontal: 8 },
  rowPill: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, minWidth: 78, alignItems: 'center' },
  rowPillText: { color: colors.background, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowGain: { fontSize: 11, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] },
  rowValue: { color: colors.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  floating: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    alignItems: 'flex-end',
  },
  floatingAddButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  page: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 28,
  },
  pageWithFloating: { paddingBottom: 88 },
  gestureLayer: { flex: 1 },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCompact: { minHeight: 38, marginBottom: 8 },
  headerCopy: {
    flex: 1,
  },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  brandIcon: { width: 15, height: 15, borderRadius: 5 },
  brandName: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  eyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headerTitleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 5,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 23,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  surface: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
  },
  demoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  demoDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#f6c453',
    marginRight: 7,
  },
  demoText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  change: {
    fontSize: 13,
    fontWeight: '800',
  },
  chartWrap: {
    marginTop: 10,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: -4,
  },
  chartLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 13,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 9,
  },
  legendLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  legendValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  barsWrap: {
    height: 168,
    position: 'relative',
    marginTop: 8,
  },
  barYears: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 2,
  },
  barYear: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },
  barBaseline: {
    position: 'absolute',
    top: 100,
    height: 1,
    left: 0,
    right: 0,
    backgroundColor: colors.muted,
  },
  moneyPair: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  moneyLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  moneyValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  assetIdentity: {
    flex: 1,
  },
  assetSymbol: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  assetName: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  assetNumbers: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  assetValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
});
