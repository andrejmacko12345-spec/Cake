import { useThemedStyles } from '../data/theme';
import { selectionHaptic } from '../data/haptics';
import { useAppStorage } from '../data/app-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PointerEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ArrowDown, ArrowUp, ArrowDownWideNarrow, ArrowUpWideNarrow, Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react-native';
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
import { createRequestCache } from '../data/request-cache';
import { AssetLogo } from '../components/asset-logo';
import { AssetDiscoveryList } from '../components/asset-discovery-list';
import { MarketOverview } from '../components/market-overview';
import { useAssetSearch } from '../hooks/use-asset-search';
import { usePopupAnimation } from '../hooks/use-popup-animation';
import { useLocale } from '../context/locale';
import { AssetCategory, assetCategories, getFeaturedAssetBySymbol } from '../data/asset-discovery';

import { WATCHLIST_KEY as STORAGE_KEY, defaultWatchlists, getPortfolioWatchlistSymbols, getWatchlistDragOffset, getWatchlistMovement, getWatchlistSwipeDirection, isValidSymbol, lastTradingDay, moveWatchlist, parseWatchlists } from '../data/watchlists';
import type { Watchlist, WatchlistsState } from '../data/watchlists';
const WATCHLIST_PAGE_GAP = 12;
const periods = [
  { label: '1D', amount: 1, unit: 'day', interval: '5m' },
  { label: '1M', amount: 1, unit: 'month', interval: '1d' },
  { label: '3M', amount: 3, unit: 'month', interval: '1d' },
  { label: '6M', amount: 6, unit: 'month', interval: '1d' },
  { label: '1Y', amount: 12, unit: 'month', interval: '1d' },
  { label: '5Y', amount: 60, unit: 'month', interval: '1d' },
] as const;

function PeriodSelector({ value, onChange, onExpandedChange }: {
  value: (typeof periods)[number]['label'];
  onChange: (value: (typeof periods)[number]['label']) => void;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [expanded, setExpanded] = useState(false);
  const expansion = useRef(new Animated.Value(0)).current;
  useEffect(() => { onExpandedChange(expanded); }, [expanded, onExpandedChange]);
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
    <>
    <View style={styles.periodSlot} />
    <Animated.View style={[styles.periodContainer, expanded && styles.periodExpanded]}>
    <Animated.View pointerEvents={expanded ? 'none' : 'auto'} aria-hidden={expanded} accessibilityElementsHidden={expanded}
      importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}
      style={[StyleSheet.absoluteFill, {
        opacity: expansion.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ translateY: expansion.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
      }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => { selectionHaptic(); setExpanded(true); }} style={styles.periodCollapsed}>
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
    </>
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

function getPeriodChange(
  entry: WatchEntry | undefined,
  periodLabel: (typeof periods)[number]['label'],
) {
  return getWatchlistMovement(entry?.history?.points ?? [], entry?.quote?.price ?? null, periodLabel === '1D').percent;
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
  valueMode,
}: {
  asset: Asset;
  entry: WatchEntry | undefined;
  periodLabel: string;
  selectedPeriod: (typeof periods)[number]['label'];
  onRemove: () => void;
  onPress: () => void;
  last: boolean;
  editing: boolean;
  valueMode: 'percent' | 'absolute';
}) {
  const styles = useThemedStyles(createStyles);
  const { t, language } = useLocale();
  const allPoints = entry?.history?.points ?? [];
  const points = selectedPeriod === '1D' ? lastTradingDay(allPoints).points : allPoints;
  const currency = entry?.quote?.currency ?? entry?.history?.currency ?? 'USD';
  const { percent: change, absolute: absoluteChange } = getWatchlistMovement(allPoints, entry?.quote?.price ?? null, selectedPeriod === '1D');
  const sessionQuote = entry?.quote?.extendedMarket;
  const extended = sessionQuote && Date.now() < sessionQuote.sessionEndsAt ? sessionQuote : undefined;
  const formatMovement = (value: number | null, percent: boolean) => value === null ? '—'
    : `${value > 0 ? '+' : ''}${percent
      ? `${value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
      : formatPrice(value, currency, language)}`;
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
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.periodChange}>
            {entry?.loading && change === null ? '…' : formatMovement(valueMode === 'percent' ? change : absoluteChange, valueMode === 'percent')}
          </Text>
        </View>
        {extended ? <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.currentPrice, { color: extended.change >= 0 ? colors.green : colors.red }]}>
          {`${t(extended.session === 'pre' ? 'Pre' : 'After')}: ${formatMovement(valueMode === 'percent' ? extended.changePercent : extended.change, valueMode === 'percent')}`}
        </Text> : null}
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
  const [valueMode, setValueMode] = useState<'percent' | 'absolute'>('percent');
  const [periodExpanded, setPeriodExpanded] = useState(false);
  const [indexDetailOpen, setIndexDetailOpen] = useState(false);
  const { positions, loading: portfolioLoading } = usePositions();
  const [creatingPortfolioList, setCreatingPortfolioList] = useState(false);
  const portfolioSymbols = getPortfolioWatchlistSymbols(positions);
  const [watchData, setWatchData] = useState<Record<string, WatchEntry>>({});
  const watchRequests = useRef(createRequestCache<WatchEntry>(10000));
  const swipeX = useRef(new Animated.Value(0)).current;
  const [pageWidth, setPageWidth] = useState(0);
  const pageStride = pageWidth + WATCHLIST_PAGE_GAP;
  const pointerStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeAnimating = useRef(false);
  const listNameInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const selectedWatchlist = watchlists.lists.find((list) => list.id === watchlists.selectedId) ?? watchlists.lists[0];
  const symbols = selectedWatchlist?.symbols ?? [];
  const selectedIndex = watchlists.lists.findIndex((list) => list.id === watchlists.selectedId);
  const nearbyLists = useMemo(() => [-1, 0, 1].map((offset) => watchlists.lists[selectedIndex + offset]), [watchlists.lists, selectedIndex]);
  const nearbySymbols = useMemo(() => [...new Set(nearbyLists.flatMap((list) => list?.symbols ?? []))], [nearbyLists]);

  useLayoutEffect(() => {
    swipeX.setValue(0);
    swipeAnimating.current = false;
  }, [watchlists.selectedId, pageWidth, swipeX]);

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
  const loadWatchData = useCallback(async () => {
    if (!nearbySymbols.length) return;
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
    const entries = await Promise.all(nearbySymbols.map(async (symbol) => {
      const key = `${selectedPeriod}|${symbol}`;
      const entry = await watchRequests.current(key, async () => {
        const [quoteResult, historyResult] = await Promise.allSettled([
          fetchLiveQuote(symbol, true),
          fetchHistoricalQuoteSeries(symbol, queryStart, period.interval),
        ]);
        const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
        const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
        const error = [quoteResult, historyResult]
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))[0] ?? '';
        return { quote, history, loading: false, error };
      });
      return [key, entry] as const;
    }));
    setWatchData((previous) => ({
      ...previous,
      ...Object.fromEntries(entries.map(([key, entry]) => [key, {
        ...entry,
        quote: entry.quote ?? previous[key]?.quote ?? null,
        history: entry.history ?? previous[key]?.history ?? null,
      }])),
    }));
  }, [period.amount, period.interval, period.unit, selectedPeriod, nearbySymbols]);

  useEffect(() => {
    void loadWatchData();
  }, [loadWatchData]);

  useEffect(() => {
    const timer = setInterval(() => { void loadWatchData(); }, 10000);
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
  const pageAssets = useMemo(() => nearbyLists.map((list) => (list?.symbols ?? []).map((symbol) =>
    availableAssets.find((asset) => asset.symbol === symbol) ?? getFeaturedAssetBySymbol(symbol) ?? {
      symbol, name: symbol, price: 0, change: 0, color: colors.violet,
    },
  ).sort((a, b) => {
    if (sortOrder === 'change') {
      const changeA = getPeriodChange(watchData[`${selectedPeriod}|${a.symbol}`], selectedPeriod);
      const changeB = getPeriodChange(watchData[`${selectedPeriod}|${b.symbol}`], selectedPeriod);
      if (changeA === null && changeB !== null) return 1;
      if (changeA !== null && changeB === null) return -1;
      if (changeA !== null && changeB !== null && changeA !== changeB) return sortDirection === 'asc' ? changeA - changeB : changeB - changeA;
    }
    return a.name.localeCompare(b.name, 'sk') * (sortOrder === 'alphabetical' && sortDirection === 'desc' ? -1 : 1);
  })), [nearbyLists, selectedPeriod, sortOrder, sortDirection, watchData]);
  const saveWatchlists = async (next: WatchlistsState) => {
    setWatchlists(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      showStorageError('uloženie', error);
    }
  };

  const selectWatchlist = (id: string) => {
    void saveWatchlists({ ...watchlists, selectedId: id });
    setShowLists(false);
  };

  const swipeWatchlist = (direction: -1 | 1) => {
    const currentIndex = watchlists.lists.findIndex((list) => list.id === watchlists.selectedId);
    const next = watchlists.lists[currentIndex + direction];
    if (!next) return;
    selectionHaptic();
    void saveWatchlists({ ...watchlists, selectedId: next.id });
  };

  const finishSwipe = (dx: number, velocityX = 0) => {
    if (indexDetailOpen || swipeAnimating.current || pageWidth <= 0) return;
    const direction = getWatchlistSwipeDirection(dx, velocityX);
    const currentIndex = watchlists.lists.findIndex((list) => list.id === watchlists.selectedId);
    if (direction === null || !watchlists.lists[currentIndex + direction]) {
      Animated.timing(swipeX, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      return;
    }

    const outgoingX = direction === 1 ? -pageStride : pageStride;
    swipeAnimating.current = true;
    Animated.timing(swipeX, {
      toValue: outgoingX,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) { swipeAnimating.current = false; return; }
      swipeWatchlist(direction);
    });
  };

  const pointerGestureHandlers = useMemo(() => ({
    onPointerDown: (event: PointerEvent) => {
      if (event.nativeEvent.pointerType === 'mouse' && !indexDetailOpen && !showLists && !showPicker && !swipeAnimating.current && watchlists.lists.length > 1) {
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
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        pointerStart.current = null;
        swipeX.setValue(0);
      } else if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        swipeX.setValue(getDragOffset(dx));
      }
    },
    onPointerUp: (event: PointerEvent) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (start && event.nativeEvent.pointerType === 'mouse') {
        const dx = event.nativeEvent.pageX - start.x;
        const dy = event.nativeEvent.pageY - start.y;
        const elapsed = Math.max(event.timeStamp - start.time, 1);
        finishSwipe(Math.abs(dx) > Math.abs(dy) * 1.2 ? dx : 0, dx / elapsed);
      }
    },
    onPointerCancel: () => {
      pointerStart.current = null;
      Animated.timing(swipeX, { toValue: 0, duration: 120, useNativeDriver: false }).start();
    },
  }), [finishSwipe, showLists, showPicker, swipeX]);

  const swipeContext = useRef({ enabled: false, finishSwipe });
  swipeContext.current = {
    enabled: !indexDetailOpen && !showLists && !showPicker && !periodExpanded && !editingAssets && watchlists.lists.length > 1,
    finishSwipe,
  };
  const dragContext = useRef({ pageWidth, selectedIndex, count: watchlists.lists.length });
  dragContext.current = { pageWidth, selectedIndex, count: watchlists.lists.length };
  function getDragOffset(dx: number) {
    const { pageWidth: width, selectedIndex: index, count } = dragContext.current;
    return getWatchlistDragOffset(dx, width + WATCHLIST_PAGE_GAP, index, count);
  }
  const swipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      swipeContext.current.enabled && !swipeAnimating.current &&
      Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => {
      if (!swipeAnimating.current) swipeX.setValue(getDragOffset(gesture.dx));
    },
    onPanResponderRelease: (_, gesture) => swipeContext.current.finishSwipe(gesture.dx, gesture.vx),
    onPanResponderTerminate: () => {
      Animated.timing(swipeX, { toValue: 0, duration: 120, useNativeDriver: false }).start();
    },
  }), [swipeX]);

  const beginCreateList = () => {
    setListNameInput('');
    setEditingListId('new');
  };

  const createPortfolioList = async () => {
    if (creatingPortfolioList || portfolioLoading || loading) return;
    if (!portfolioSymbols.length) {
      Alert.alert(t('Portfólio'), t('Portfólio neobsahuje žiadne otvorené pozície.'));
      return;
    }
    setCreatingPortfolioList(true);
    selectionHaptic();
    const id = `portfolio-${Date.now()}`;
    const baseName = t('Portfólio');
    let name = baseName;
    let suffix = 2;
    while (watchlists.lists.some((list) => list.name === name)) name = `${baseName} ${suffix++}`;
    const next = {
      selectedId: id,
      lists: [...watchlists.lists, { id, name, symbols: portfolioSymbols }],
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setWatchlists(next);
      setShowLists(false);
    } catch (error) {
      showStorageError('vytvorenie z portfólia', error);
    } finally {
      setCreatingPortfolioList(false);
    }
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
    <View style={styles.screenGestureArea}
      {...(editingAssets || indexDetailOpen || Platform.OS === 'web' ? {} : swipeResponder.panHandlers)}
      {...(editingAssets || indexDetailOpen || Platform.OS !== 'web' ? {} : pointerGestureHandlers)}>
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

      <MarketOverview onDetailOpenChange={(open) => {
        pointerStart.current = null;
        swipeX.stopAnimation();
        swipeX.setValue(0);
        swipeAnimating.current = false;
        setIndexDetailOpen(open);
      }} />
      {assets.length ? <View style={styles.filterGroup} onPointerDown={(event) => event.stopPropagation()}>
        <PeriodSelector value={selectedPeriod} onChange={setSelectedPeriod} onExpandedChange={setPeriodExpanded} />
        <View style={styles.valueModeGroup}>
          {(['percent', 'absolute'] as const).map((mode) => (
            <Pressable key={mode} accessibilityRole="button"
              accessibilityState={{ selected: valueMode === mode }}
              accessibilityLabel={`${t('Zobrazenie pohybu')}: ${t(mode === 'percent' ? 'Percentá' : 'Absolútne hodnoty')}`}
              onPress={() => { selectionHaptic(); setValueMode(mode); }}
              style={[styles.valueModeButton, valueMode === mode && styles.periodButtonSelected]}>
              <Text style={styles.sortText}>{mode === 'percent' ? '%' : t('Suma')}</Text>
            </Pressable>
          ))}
        </View>
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
          accessibilityLabel={t('Upraviť')}
          onPress={() => setEditingAssets((current) => !current)}
          style={[styles.editAssetsButton, editingAssets && styles.periodButtonSelected]}>
          <Pencil size={14} color={colors.text} />
        </Pressable>
      </View> : null}
      <View style={styles.swipeViewport} onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
      <Animated.View style={[styles.swipeTrack, { width: pageWidth * 3 + WATCHLIST_PAGE_GAP * 2, transform: [{ translateX: Animated.subtract(swipeX, pageStride) }] }]}>
      {nearbyLists.map((list, pageIndex) => {
        const sortedAssets = pageAssets[pageIndex];
        return <View key={pageIndex} style={{ width: pageWidth }}
          pointerEvents={pageIndex === 1 ? 'auto' : 'none'}
          accessibilityElementsHidden={pageIndex !== 1}
          importantForAccessibility={pageIndex === 1 ? 'auto' : 'no-hide-descendants'}>

      {!list ? null : loading ? (
        <Surface style={styles.loadingCard}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.loadingText}>{t('Načítavam zoznam sledovaných…')}</Text>
        </Surface>
      ) : sortedAssets.length ? (
        <Surface style={styles.assetList}>
          {sortedAssets.map((asset, index) => (
            <WatchlistPriceCard
              key={asset.symbol}
              asset={asset}
              entry={watchData[`${selectedPeriod}|${asset.symbol}`] ?? emptyEntry()}
              periodLabel={selectedPeriod}
              selectedPeriod={selectedPeriod}
              onRemove={() => removeAsset(asset.symbol)}
              onPress={() => router.push({ pathname: '/position', params: { symbol: asset.symbol } })}
              last={index === sortedAssets.length - 1}
              editing={editingAssets && pageIndex === 1}
              valueMode={valueMode}
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
      </View>;
      })}
      </Animated.View>
      </View>

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
              {watchlists.lists.map((list, listIndex) => {
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
                      {watchlists.lists.length > 1 ? <View>
                        {([-1, 1] as const).map((direction) => {
                          const disabled = direction === -1 ? listIndex === 0 : listIndex === watchlists.lists.length - 1;
                          return <Pressable key={direction} accessibilityRole="button"
                            accessibilityLabel={`${t(direction === -1 ? 'Posunúť vyššie' : 'Posunúť nižšie')} ${list.name}`}
                            accessibilityState={{ disabled }} disabled={disabled}
                            onPress={() => { selectionHaptic(); void saveWatchlists(moveWatchlist(watchlists, list.id, direction)); }}
                            style={[styles.reorderButton, disabled && styles.reorderButtonDisabled]}>
                            {direction === -1 ? <ArrowUp size={14} color={colors.muted} /> : <ArrowDown size={14} color={colors.muted} />}
                          </Pressable>;
                        })}
                      </View> : null}
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
              <>
              <Pressable accessibilityRole="button"
                disabled={portfolioLoading || loading || creatingPortfolioList}
                accessibilityState={{ disabled: portfolioLoading || loading || creatingPortfolioList }}
                onPress={() => void createPortfolioList()} style={styles.createListButton}>
                {creatingPortfolioList ? <ActivityIndicator size="small" color={colors.green} /> : <Plus size={17} color={colors.green} />}
                <Text style={styles.createListText}>{t('Vytvoriť z portfólia')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={beginCreateList} style={styles.createListButton}>
                <Plus size={17} color={colors.green} />
                <Text style={styles.createListText}>{t('Vytvoriť zoznam sledovaných')}</Text>
              </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {showPicker ? (
        <WatchlistPicker symbols={symbols} onSelect={addAsset} onClose={() => setShowPicker(false)} />
      ) : null}
    </Page>
    </View>
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
  screenGestureArea: { flex: 1 },
  swipeViewport: { overflow: 'hidden', borderRadius: 18 },
  swipeTrack: { flexDirection: 'row', alignItems: 'flex-start', gap: WATCHLIST_PAGE_GAP },
  reorderButton: { width: 32, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  reorderButtonDisabled: { opacity: 0.3 },
  periodSelector: {
    flex: 1,
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  periodSlot: { width: 52, height: 36 },
  periodContainer: { position: 'absolute', top: 0, left: 0, width: 52, height: 36, overflow: 'hidden', borderRadius: 10, zIndex: 2, backgroundColor: colors.surface },
  periodExpanded: { width: '100%' },
  periodCollapsed: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 36, paddingHorizontal: 7, borderRadius: 10, backgroundColor: colors.surface,
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
  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, position: 'relative' },
  valueModeGroup: { marginLeft: 'auto', flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: colors.surface },
  valueModeButton: { minWidth: 30, minHeight: 30, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sortToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.surface,
  },
  sortText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  sortDirection: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surface },
  editAssetsButton: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surface },
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
  changeBlock: {
    alignItems: 'flex-end',
    marginRight: 8,
    maxWidth: '42%',
    flexShrink: 1,
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
