import { useThemedStyles } from '../data/theme';
import { selectionHaptic } from '../data/haptics';
import { useAppStorage } from '../data/app-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { PointerEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { FloatingAddButton, Header, Page, Surface } from '../components/finapp';
import { Asset, availableAssets, colors } from '../data/portfolio';
import {
  fetchHistoricalQuoteSeries,
  HistoricalQuoteSeries,
  fetchLiveQuote,
  LiveQuote,
} from '../data/quotes';
import { usePositions } from '../hooks/use-positions';
import { AssetLogo } from '../components/asset-logo';
import { AssetDiscoveryList } from '../components/asset-discovery-list';
import { MarketOverview } from '../components/market-overview';
import { useAssetSearch } from '../hooks/use-asset-search';
import { usePopupAnimation } from '../hooks/use-popup-animation';
import { useLocale } from '../context/locale';
import { AssetCategory, assetCategories, getFeaturedAssetBySymbol } from '../data/asset-discovery';

import { WATCHLIST_KEY as STORAGE_KEY, defaultWatchlists, isValidSymbol, parseWatchlists } from '../data/watchlists';
import type { Watchlist, WatchlistsState } from '../data/watchlists';
const periods = [
  { label: '1D', amount: 1, unit: 'day', interval: '5m' },
  { label: '1M', amount: 1, unit: 'month', interval: '1d' },
  { label: '3M', amount: 3, unit: 'month', interval: '1d' },
  { label: '6M', amount: 6, unit: 'month', interval: '1d' },
  { label: '1Y', amount: 12, unit: 'month', interval: '1d' },
  { label: '5Y', amount: 60, unit: 'month', interval: '1d' },
] as const;

function PeriodSelector({ value, onChange }: {
  value: (typeof periods)[number]['label'];
  onChange: (value: (typeof periods)[number]['label']) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [expanded, setExpanded] = useState(false);
  const expansion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(expansion, {
      toValue: expanded ? 1 : 0, duration: 200, useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, expansion]);
  const selectedRef = useRef(value);
  const dragging = useRef(false);
  const moved = useRef(false);
  const select = useCallback((next: (typeof periods)[number]['label']) => {
    if (selectedRef.current === next) return;
    selectedRef.current = next;
    onChange(next);
    selectionHaptic();
  }, [onChange]);
  const selectAt = useCallback((pageX: number) => {
    ref.current?.measureInWindow((left, _top, width) => {
      if (width <= 0) return;
      const index = Math.max(0, Math.min(periods.length - 1, Math.floor((pageX - left) / width * periods.length)));
      select(periods[index].label);
    });
  }, [select]);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: (event) => selectAt(event.nativeEvent.pageX),
    onPanResponderMove: (event) => selectAt(event.nativeEvent.pageX),
    onPanResponderRelease: () => setExpanded(false),
    onPanResponderTerminate: () => setExpanded(false),
    onPanResponderTerminationRequest: () => false,
  }), [selectAt]);
  return (
    <Animated.View style={[styles.periodContainer, { flexGrow: expansion }]}>
    <Animated.View pointerEvents={expanded ? 'none' : 'auto'} aria-hidden={expanded} accessibilityElementsHidden={expanded}
      importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}
      style={[StyleSheet.absoluteFill, {
        opacity: expansion.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ translateY: expansion.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
      }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => setExpanded(true)} style={styles.periodCollapsed}>
      <Text style={styles.periodTextSelected}>{value}</Text>
      <ChevronDown size={14} color={colors.muted} />
    </Pressable>
    </Animated.View>
    <Animated.View pointerEvents={expanded ? 'auto' : 'none'} aria-hidden={!expanded} accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, {
        opacity: expansion,
        transform: [{ translateY: expansion.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
      }]}>
    <View ref={ref} style={styles.periodSelector} {...responder.panHandlers}
      onPointerDown={(event) => {
        moved.current = false;
        if (event.nativeEvent.pointerType === 'mouse') dragging.current = true;
      }}
      onPointerMove={(event) => {
        if (dragging.current && event.nativeEvent.pointerType === 'mouse') {
          moved.current = true;
          selectAt(event.nativeEvent.pageX);
        }
      }}
      onPointerUp={() => {
        dragging.current = false;
        if (moved.current) setExpanded(false);
      }}
      onPointerCancel={() => { dragging.current = false; }}>
      {periods.map((item) => (
        <Pressable key={item.label} accessibilityRole="button"
          accessibilityState={{ selected: value === item.label }} onPress={() => {
            select(item.label);
            setExpanded(false);
          }}
          style={[styles.periodButton, value === item.label && styles.periodButtonSelected]}>
          <Text numberOfLines={1} style={[styles.periodText, value === item.label && styles.periodTextSelected]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
    </Animated.View>
    </Animated.View>
  );
}


type WatchEntry = {
  quote: LiveQuote | null;
  history: HistoricalQuoteSeries | null;
  loading: boolean;
  error: string;
};

function emptyEntry(): WatchEntry {
  return { quote: null, history: null, loading: true, error: '' };
}

type PricePoint = { timestamp: number; price: number };

// 1D = posledný obchodný deň; základ je predošlé uzavretie (rovnaká logika ako v grafe portfólia).
function lastTradingDay(allPoints: PricePoint[]) {
  if (!allPoints.length) return { points: [] as PricePoint[], base: null as number | null };
  const dayOf = (point: PricePoint) => new Date(point.timestamp * 1000).toISOString().slice(0, 10);
  const latestDay = dayOf(allPoints[allPoints.length - 1]);
  const firstIndex = allPoints.findIndex((point) => dayOf(point) === latestDay);
  return {
    points: allPoints.slice(firstIndex),
    base: firstIndex > 0 ? allPoints[firstIndex - 1].price : allPoints[firstIndex].price,
  };
}

function getPeriodChange(
  entry: WatchEntry | undefined,
  periodLabel: (typeof periods)[number]['label'],
) {
  const allPoints = entry?.history?.points ?? [];
  if (periodLabel === '1D') {
    const { points, base } = lastTradingDay(allPoints);
    const current = points[points.length - 1]?.price ?? entry?.quote?.price ?? null;
    return current !== null && base !== null && base > 0 ? (current / base - 1) * 100 : null;
  }
  const currentPrice = entry?.quote?.price ?? allPoints[allPoints.length - 1]?.price ?? null;
  const startPrice = allPoints[0]?.price ?? null;
  return currentPrice !== null && startPrice !== null && startPrice > 0
    ? (currentPrice / startPrice - 1) * 100
    : null;
}
function formatPrice(price: number, currency: string, language: 'sk' | 'en') {
  return new Intl.NumberFormat(language === 'sk' ? 'sk-SK' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(price);
}

function WatchlistPriceCard({
  asset,
  entry,
  periodLabel,
  selectedPeriod,
  onRemove,
  onPress,
  last,
  editing,
}: {
  asset: Asset;
  entry: WatchEntry | undefined;
  periodLabel: string;
  selectedPeriod: (typeof periods)[number]['label'];
  onRemove: () => void;
  onPress: () => void;
  last: boolean;
  editing: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { t, language } = useLocale();
  const allPoints = entry?.history?.points ?? [];
  const points = selectedPeriod === '1D' ? lastTradingDay(allPoints).points : allPoints;
  const currentPrice = entry?.quote?.price ?? points[points.length - 1]?.price ?? null;
  const currency = entry?.quote?.currency ?? entry?.history?.currency ?? 'USD';
  const change = getPeriodChange(entry, selectedPeriod);
  const isPositive = (change ?? 0) >= 0;
  const min = Math.min(...points.map((point) => point.price));
  const max = Math.max(...points.map((point) => point.price));
  const spread = max - min || 1;
  const chartPath = points.map((point, index) => {
    const x = points.length > 1 ? index / (points.length - 1) * 160 : 80;
    const y = 35 - ((point.price - min) / spread) * 30;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const tone = change === null ? colors.muted : isPositive ? colors.green : colors.red;

  return (
    <View style={[styles.assetRow, !last && styles.assetCardDivider]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('Detail akcie')} ${asset.symbol}`}
      onPress={onPress}
      onLongPress={() =>
        Alert.alert(asset.symbol, t('Odstrániť z zoznamu sledovaných?'), [
          { text: t('Zrušiť'), style: 'cancel' },
          { text: t('Odstrániť'), style: 'destructive', onPress: onRemove },
        ])}
      style={[styles.assetCard, styles.assetMain]}
    >
      <AssetLogo symbol={asset.symbol} color={asset.color} size={42} />
      <View style={styles.assetCopy}>
        <Text style={styles.assetSymbol} numberOfLines={1}>{asset.symbol}</Text>
        <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
      </View>
      {chartPath ? (
        <Svg style={styles.sparkline} height={28} viewBox="0 0 160 40" preserveAspectRatio="none">
          <Path
            d={chartPath}
            fill="none"
            stroke={tone}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : <View style={styles.sparkline} />}
      <View style={styles.changeBlock}>
        <View style={[styles.changePill, { backgroundColor: tone }]}>
          <Text style={styles.periodChange}>
            {change === null
              ? entry?.loading ? '…' : '—'
              : `${change > 0 ? '+' : ''}${change.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`}
          </Text>
        </View>
        {entry?.loading && currentPrice === null ? (
          <ActivityIndicator size="small" color={colors.green} style={styles.priceLoading} />
        ) : (
          <Text style={styles.currentPrice}>
            {currentPrice === null ? '—' : formatPrice(currentPrice, currency, language)}
          </Text>
        )}
      </View>
    </Pressable>
    {editing ? <Pressable accessibilityRole="button"
      accessibilityLabel={`${t('Odstrániť')} ${asset.symbol}`}
      onPress={onRemove} style={styles.removeAssetButton}>
      <X size={18} color={colors.red} />
    </Pressable> : null}
    </View>
  );
}
export default function WatchlistScreen() {
  const styles = useThemedStyles(createStyles);
  const AsyncStorage = useAppStorage();
  const router = useRouter();
  const { t, errorText } = useLocale();
  function showStorageError(action: string, error: unknown) {
    console.warn(`Watchlist ${action} failed:`, error);
    Alert.alert(t('Chyba'), errorText(error instanceof Error ? error.message : String(error)));
  }
  const [watchlists, setWatchlists] = useState<WatchlistsState>(defaultWatchlists);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [showLists, setShowLists] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [listNameInput, setListNameInput] = useState('');
  const [confirmDeleteListId, setConfirmDeleteListId] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<(typeof periods)[number]['label']>('1D');
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'change'>('alphabetical');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [editingAssets, setEditingAssets] = useState(false);
  const [watchData, setWatchData] = useState<Record<string, WatchEntry>>({});
  const requestId = useRef(0);
  const swipeX = useRef(new Animated.Value(0)).current;
  const pointerStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const listNameInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const selectedWatchlist = watchlists.lists.find((list) => list.id === watchlists.selectedId) ?? watchlists.lists[0];
  const symbols = selectedWatchlist?.symbols ?? [];

  useEffect(() => {
    if (!showLists || editingListId === null) return;
    const timer = setTimeout(() => listNameInputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [editingListId, showLists]);

  useEffect(() => {
    let active = true;
    const loadWatchlist = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
          const next = parseWatchlists(saved);
          if (active) setWatchlists(next);
          if (Array.isArray(JSON.parse(saved))) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch (error) {
        showStorageError('načítanie', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadWatchlist();
    return () => {
      active = false;
    };
  }, []);

  const period = periods.find((item) => item.label === selectedPeriod) ?? periods[0];
  const loadWatchData = useCallback(async (silent = false) => {
    const currentRequestId = ++requestId.current;
    if (!symbols.length) {
      setWatchData({});
      return;
    }

    if (!silent) setWatchData(Object.fromEntries(symbols.map((symbol) => [symbol, emptyEntry()])));
    const startDate = new Date();
    if (period.unit === 'day') {
      startDate.setDate(startDate.getDate() - Math.max(period.amount, 5));
    } else {
      const dayOfMonth = startDate.getDate();
      startDate.setDate(1);
      startDate.setMonth(startDate.getMonth() - period.amount);
      startDate.setDate(Math.min(dayOfMonth, new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        0,
      ).getDate()));
    }
    const queryStart = startDate.toISOString().slice(0, 10);
    const entries = await Promise.all(symbols.map(async (symbol) => {
      const [quoteResult, historyResult] = await Promise.allSettled([
        fetchLiveQuote(symbol),
        fetchHistoricalQuoteSeries(symbol, queryStart, period.interval),
      ]);
      const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
      const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
      const error = [quoteResult, historyResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))[0] ?? '';
      return [symbol, { quote, history, loading: false, error }] as const;
    }));
    if (requestId.current === currentRequestId) {
      setWatchData(Object.fromEntries(entries));
    }
  }, [period.amount, period.interval, period.unit, symbols]);

  useEffect(() => {
    void loadWatchData();
    return () => {
      requestId.current += 1;
    };
  }, [loadWatchData]);

  useEffect(() => {
    const timer = setInterval(() => { void loadWatchData(true); }, 10000);
    return () => clearInterval(timer);
  }, [loadWatchData]);

  const assets = useMemo(
    () => symbols.map((symbol) =>
      availableAssets.find((asset) => asset.symbol === symbol) ?? getFeaturedAssetBySymbol(symbol) ?? {
        symbol,
        name: symbol,
        price: 0,
        change: 0,
        color: colors.violet,
      },
    ),
    [symbols],
  );
  const sortedAssets = useMemo(() => [...assets].sort((a, b) => {
    if (sortOrder === 'change') {
      const changeA = getPeriodChange(watchData[a.symbol], selectedPeriod);
      const changeB = getPeriodChange(watchData[b.symbol], selectedPeriod);
      if (changeA === null && changeB !== null) return 1;
      if (changeA !== null && changeB === null) return -1;
      if (changeA !== null && changeB !== null && changeA !== changeB) return sortDirection === 'asc' ? changeA - changeB : changeB - changeA;
    }
    return a.name.localeCompare(b.name, 'sk') * (sortOrder === 'alphabetical' && sortDirection === 'desc' ? -1 : 1);
  }), [assets, selectedPeriod, sortOrder, sortDirection, watchData]);
  const saveWatchlists = async (next: WatchlistsState) => {
    setWatchlists(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      showStorageError('uloženie', error);
    }
  };

  const selectWatchlist = (id: string) => {
    setWatchData({});
    void saveWatchlists({ ...watchlists, selectedId: id });
    setShowLists(false);
  };

  const swipeWatchlist = (direction: -1 | 1) => {
    const currentIndex = watchlists.lists.findIndex((list) => list.id === watchlists.selectedId);
    const next = watchlists.lists[currentIndex + direction];
    if (!next) return;
    setWatchData({});
    void saveWatchlists({ ...watchlists, selectedId: next.id });
  };

  const finishSwipe = (dx: number, velocityX = 0) => {
    const horizontalDistance = Math.abs(dx);
    const mostlyHorizontal = horizontalDistance >= 12;
    const quickShortSwipe = horizontalDistance >= 8 && Math.abs(velocityX) >= 0.18;
    const direction = mostlyHorizontal || quickShortSwipe
      ? dx < 0 ? 1 : -1
      : null;
    const currentIndex = watchlists.lists.findIndex((list) => list.id === watchlists.selectedId);
    if (direction === null || !watchlists.lists[currentIndex + direction]) {
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: false, speed: 22, bounciness: 5 }).start();
      return;
    }

    const outgoingX = direction === 1 ? -screenWidth : screenWidth;
    Animated.timing(swipeX, {
      toValue: outgoingX,
      duration: 130,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      swipeWatchlist(direction);
      swipeX.setValue(-outgoingX);
      requestAnimationFrame(() => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: false, speed: 18, bounciness: 3 }).start();
      });
    });
  };

  const pointerGestureHandlers = useMemo(() => ({
    onPointerDown: (event: PointerEvent) => {
      if (event.nativeEvent.pointerType === 'mouse' && !showLists && !showPicker) {
        pointerStart.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          time: event.timeStamp,
        };
      }
    },
    onPointerMove: (event: PointerEvent) => {
      const start = pointerStart.current;
      if (!start || event.nativeEvent.pointerType !== 'mouse') return;
      const dx = event.nativeEvent.pageX - start.x;
      const dy = event.nativeEvent.pageY - start.y;
      if (Math.abs(dx) > 3) {
        swipeX.setValue(dx * 0.9);
      }
    },
    onPointerUp: (event: PointerEvent) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (start && event.nativeEvent.pointerType === 'mouse') {
        const dx = event.nativeEvent.pageX - start.x;
        const elapsed = Math.max(event.timeStamp - start.time, 1);
        finishSwipe(dx, dx / elapsed);
      }
    },
    onPointerCancel: () => {
      pointerStart.current = null;
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: false, speed: 22, bounciness: 5 }).start();
    },
  }), [finishSwipe, showLists, showPicker, swipeX]);

  const swipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      !showLists && !showPicker &&
      Math.abs(gesture.dx) > 2 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 0.15,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => {
      swipeX.setValue(gesture.dx * 0.9);
    },
    onPanResponderRelease: (_, gesture) => finishSwipe(gesture.dx, gesture.vx),
    onPanResponderTerminate: () => {
      Animated.spring(swipeX, { toValue: 0, useNativeDriver: false, speed: 22, bounciness: 5 }).start();
    },
  }), [finishSwipe, showLists, showPicker, swipeX]);

  const beginCreateList = () => {
    setListNameInput('');
    setEditingListId('new');
  };

  const beginRenameList = (list: Watchlist) => {
    setListNameInput(list.name);
    setEditingListId(list.id);
  };

  const saveListName = () => {
    const name = listNameInput.trim();
    if (!name) return;
    if (editingListId === 'new') {
      const id = `list-${Date.now()}`;
      const nextList = { id, name, symbols: [] };
      setWatchData({});
      void saveWatchlists({
        selectedId: id,
        lists: [...watchlists.lists, nextList],
      });
    } else if (editingListId) {
      void saveWatchlists({
        ...watchlists,
        lists: watchlists.lists.map((list) => list.id === editingListId ? { ...list, name } : list),
      });
    }
    setEditingListId(null);
    setListNameInput('');
  };

  const deleteWatchlist = (list: Watchlist) => {
    if (watchlists.lists.length <= 1) return;
    setConfirmDeleteListId(list.id);
  };

  const confirmDeleteWatchlist = (list: Watchlist) => {
    const lists = watchlists.lists.filter((item) => item.id !== list.id);
    const selectedId = watchlists.selectedId === list.id ? lists[0].id : watchlists.selectedId;
    setWatchData({});
    setConfirmDeleteListId(null);
    void saveWatchlists({ selectedId, lists });
  };

  const addAsset = (symbol: string) => {
    void saveWatchlists({
      ...watchlists,
      lists: watchlists.lists.map((list) =>
        list.id === watchlists.selectedId ? { ...list, symbols: [...symbols, symbol] } : list,
      ),
    });
  };

  const removeAsset = (symbol: string) => {
    void saveWatchlists({
      ...watchlists,
      lists: watchlists.lists.map((list) =>
        list.id === watchlists.selectedId ? { ...list, symbols: symbols.filter((item) => item !== symbol) } : list,
      ),
    });
  };

  return (
    <Page
      floating={(
      <FloatingAddButton
        accessibilityLabel={t('Pridať akciu')}
        onPress={() => setShowPicker(true)}
      />
    )}
    >
      <Header
        compact
        title={selectedWatchlist?.name ?? t('Sledované')}
        titleExpanded={showLists}
        onTitlePress={() => {
          setEditingListId(null);
          setShowLists(true);
        }}
      />

      <MarketOverview />
      {assets.length ? <View style={styles.filterRow}>
        <PeriodSelector value={selectedPeriod} onChange={setSelectedPeriod} />
        <Pressable accessibilityRole="button"
          accessibilityLabel={`${t('Zoradiť')}: ${t(sortOrder === 'alphabetical' ? 'A–Z' : 'Zmena %')}`}
          onPress={() => {
            selectionHaptic();
            setSortOrder((current) => current === 'alphabetical' ? 'change' : 'alphabetical');
            setSortDirection(sortOrder === 'alphabetical' ? 'desc' : 'asc');
          }}
          style={styles.sortToggle}>
          <Text style={styles.sortText}>{t(sortOrder === 'alphabetical' ? 'A–Z' : 'Zmena %')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button"
          accessibilityLabel={t(sortDirection === 'asc' ? 'Vzostupne' : 'Zostupne')}
          onPress={() => { selectionHaptic(); setSortDirection((current) => current === 'asc' ? 'desc' : 'asc'); }}
          style={styles.sortDirection}>
          {sortDirection === 'asc' ? <ArrowUpWideNarrow size={16} color={colors.text} />
            : <ArrowDownWideNarrow size={16} color={colors.text} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: editingAssets }}
          onPress={() => setEditingAssets((current) => !current)}
          style={[styles.editAssetsButton, editingAssets && styles.periodButtonSelected]}>
          <Text style={styles.sortText}>{t('Upraviť')}</Text>
        </Pressable>
      </View> : null}
      <Animated.View {...(editingAssets ? {} : swipeResponder.panHandlers)} {...(editingAssets ? {} : pointerGestureHandlers)}
        style={{ transform: [{ translateX: swipeX }] }}>
      <View>

      {loading ? (
        <Surface style={styles.loadingCard}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.loadingText}>{t('Načítavam zoznam sledovaných…')}</Text>
        </Surface>
      ) : assets.length ? (
        <Surface style={styles.assetList}>
          {sortedAssets.map((asset, index) => (
            <WatchlistPriceCard
              key={asset.symbol}
              asset={asset}
              entry={watchData[asset.symbol]}
              periodLabel={selectedPeriod}
              selectedPeriod={selectedPeriod}
              onRemove={() => removeAsset(asset.symbol)}
              onPress={() => router.push({ pathname: '/position', params: { symbol: asset.symbol } })}
              last={index === sortedAssets.length - 1}
              editing={editingAssets}
            />
          ))}
        </Surface>
      ) : (
        <Surface style={styles.emptyState}>
          <Search size={25} color={colors.muted} />
          <Text style={styles.emptyTitle}>{t('Zatiaľ nič nesleduješ')}</Text>
          <Text style={styles.emptyDescription}>{t('Pridaj akcie a maj ich ceny na jednom mieste.')}</Text>
        </Surface>
      )}
      </View>
      </Animated.View>

      <Modal
        animationType="slide"
        transparent
        visible={showLists}
        onRequestClose={() => {
          setShowLists(false);
          setEditingListId(null);
        }}
      >
        <View style={styles.modalScrim}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setShowLists(false);
              setEditingListId(null);
            }}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t('Moje zoznamy sledovaných')}</Text>
                <Text style={styles.modalSubtitle}>{t('Vyber alebo uprav svoj zoznam akcií.')}</Text>
              </View>
              <Pressable
                accessibilityLabel={t('Zavrieť')}
                onPress={() => {
                  setShowLists(false);
                  setEditingListId(null);
                }}
                style={styles.closeButton}
              >
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            {editingListId !== null ? (
              <View style={styles.listEditor}>
                <TextInput
                  ref={listNameInputRef}
                  autoFocus
                  autoCorrect={false}
                  maxLength={32}
                  onChangeText={setListNameInput}
                  onSubmitEditing={saveListName}
                  placeholder={t('Názov zoznamu sledovaných')}
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  style={styles.searchInput}
                  value={listNameInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Uložiť')}
                  disabled={!listNameInput.trim()}
                  onPress={saveListName}
                  style={[styles.saveListButton, !listNameInput.trim() && styles.saveListButtonDisabled]}
                >
                  <Check size={18} color={colors.surface} />
                </Pressable>
                <Pressable
                  accessibilityLabel={t('Zrušiť')}
                  onPress={() => setEditingListId(null)}
                  style={styles.closeButton}
                >
                  <X size={17} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.searchResultsList}
            >
              {watchlists.lists.map((list) => {
                const selected = list.id === watchlists.selectedId;
                return (
                  <View key={list.id}>
                    <View style={[styles.watchlistOption, selected && styles.watchlistOptionSelected]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => selectWatchlist(list.id)}
                        style={styles.watchlistSelect}
                      >
                        <View style={styles.optionCopy}>
                          <Text style={styles.optionSymbol} numberOfLines={1}>{list.id === 'default' && list.name === 'Watchlist' ? t('Sledované') : list.name}</Text>
                          <Text style={styles.optionName}>
                            {list.symbols.length} {t('titulov')}
                          </Text>
                        </View>
                        {selected ? <Check size={17} color={colors.green} /> : null}
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('Premenovať')} ${list.name}`}
                        onPress={() => beginRenameList(list)}
                        style={styles.listActionButton}
                      >
                        <Pencil size={15} color={colors.muted} />
                      </Pressable>
                      {watchlists.lists.length > 1 ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t('Odstrániť')} ${list.name}`}
                          onPress={() => deleteWatchlist(list)}
                          style={styles.listActionButton}
                        >
                          <Trash2 size={15} color={colors.red} />
                        </Pressable>
                      ) : null}
                    </View>
                    {confirmDeleteListId === list.id ? (
                      <View style={styles.deleteConfirmation}>
                        <Text style={styles.deleteConfirmationText}>{t('Odstrániť tento zoznam sledovaných?')}</Text>
                        <Pressable onPress={() => setConfirmDeleteListId(null)} style={styles.deleteCancelButton}>
                          <Text style={styles.deleteCancelText}>{t('Zrušiť')}</Text>
                        </Pressable>
                        <Pressable onPress={() => confirmDeleteWatchlist(list)} style={styles.deleteConfirmButton}>
                          <Text style={styles.deleteConfirmText}>{t('Odstrániť')}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            {editingListId === null ? (
              <Pressable accessibilityRole="button" onPress={beginCreateList} style={styles.createListButton}>
                <Plus size={17} color={colors.green} />
                <Text style={styles.createListText}>{t('Vytvoriť zoznam sledovaných')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      {showPicker ? (
        <WatchlistPicker symbols={symbols} onSelect={addAsset} onClose={() => setShowPicker(false)} />
      ) : null}
    </Page>
  );
}

function WatchlistPicker({ symbols, onSelect, onClose }: {
  symbols: string[];
  onSelect: (symbol: string) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t, errorText } = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory | undefined>();
  const { results: matchingAssets, loading: searching, error: searchError } = useAssetSearch(searchQuery, category ?? 'all');
  const pickerAnimation = usePopupAnimation(true);
  const closePicker = () => pickerAnimation.close(onClose);

  return (
      <Modal
        animationType="none"
        transparent
        visible
        onRequestClose={closePicker}
      >
        <KeyboardAvoidingView
          style={[styles.modalScrim, { backgroundColor: 'transparent' }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.modalScrim, pickerAnimation.backdrop]} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closePicker}
          />
          <Animated.View style={[styles.modalSheet, pickerAnimation.sheet]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t('Pridať do zoznamu sledovaných')}</Text>
                <Text style={styles.modalSubtitle}>{t('Vyber titul na sledovanie')}</Text>
              </View>
              <Pressable
                accessibilityLabel={t('Zavrieť')}
                onPress={closePicker}
                style={styles.closeButton}
              >
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.searchBox}>
              <Search size={17} color={colors.muted} />
              <TextInput
                accessibilityLabel={t('Hľadať akciu')}
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setSearchQuery}
                placeholder={t('Názov alebo symbol akcie')}
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={styles.searchInput}
                value={searchQuery}
              />
              {searchQuery ? (
                <Pressable accessibilityLabel={t('Vymazať hľadanie')} onPress={() => setSearchQuery('')}>
                  <X size={16} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.searchResultsList}
            >
              <AssetDiscoveryList
                category={category}
                categories={assetCategories}
                onCategoryChange={setCategory}
                query={searchQuery}
                results={matchingAssets}
                loading={searching}
                error={searchError}
                selectedSymbols={symbols}
                action="add"
                onSelect={(asset) => pickerAnimation.close(() => {
                  onSelect(asset.symbol);
                  onClose();
                })}
              />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
  );
}

const createStyles = () => StyleSheet.create({
  periodSelector: {
    flex: 1,
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  periodContainer: { flexBasis: 72, height: 36, overflow: 'hidden', borderRadius: 10 },
  periodCollapsed: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface,
  },
  periodButton: {
    flex: 1,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  periodButtonSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  periodText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  periodTextSelected: {
    color: colors.text,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  sortToggle: {
    marginLeft: 'auto',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minWidth: 68, minHeight: 36, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.surface,
  },
  sortText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  sortDirection: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surface },
  editAssetsButton: { minWidth: 38, height: 36, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surface },
  assetRow: { flexDirection: 'row', alignItems: 'center' },
  removeAssetButton: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  assetList: {
    paddingVertical: 2,
    paddingHorizontal: 10,
    marginBottom: 14,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    minHeight: 58,
  },
  assetCardDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  assetMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 9,
  },
  searchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  optionRowDisabled: {
    opacity: 0.6,
  },
  listEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  saveListButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.green,
  },
  saveListButtonDisabled: { opacity: 0.45 },
  watchlistOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  watchlistOptionSelected: {
    backgroundColor: 'rgba(120,216,79,0.07)',
  },
  watchlistSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 10,
  },
  listActionButton: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 46,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  createListText: { color: colors.green, fontSize: 13, fontWeight: '800' },
  deleteConfirmation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,90,98,0.08)',
  },
  deleteConfirmationText: { flex: 1, color: colors.muted, fontSize: 10 },
  deleteCancelButton: { paddingHorizontal: 8, paddingVertical: 6 },
  deleteCancelText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  deleteConfirmButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.red },
  deleteConfirmText: { color: colors.surface, fontSize: 10, fontWeight: '800' },
  assetHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  assetMark: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  assetCopy: {
    flex: 1,
    minWidth: 0,
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 2.2,
    minWidth: 0,
    gap: 6,
    marginLeft: 5,
  },
  priceLabel: {
    color: colors.muted,
    fontSize: 7,
    fontWeight: '700',
  },
  currentPrice: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  priceLoading: {
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  changeBlock: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  changePill: {
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 78,
    alignItems: 'center',
  },
  periodChange: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sparkline: {
    width: 56,
    height: 28,
    marginHorizontal: 8,
  },
  removeButton: {
    padding: 4,
    marginLeft: 2,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
    marginLeft: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 13,
  },
  emptyDescription: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 7,
    marginBottom: 16,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 32,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchResultsList: {
    flexShrink: 1,
  },
  optionMark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  optionCopy: {
    flex: 1,
  },
  optionSymbol: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  optionName: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  noAssets: {
    color: colors.muted,
    fontSize: 13,
    paddingVertical: 20,
  },
});
