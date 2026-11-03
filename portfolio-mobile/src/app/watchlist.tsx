import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check, Plus, Search, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Header, Page, SortControl, Surface } from '../components/finapp';
import { Asset, availableAssets, colors } from '../data/portfolio';
import {
  fetchHistoricalQuoteSeries,
  HistoricalQuoteSeries,
  fetchLiveQuote,
  LiveQuote,
} from '../data/quotes';
import { usePositions } from '../hooks/use-positions';
import { AssetLogo } from '../components/asset-logo';
import { useAssetSearch } from '../hooks/use-asset-search';
import { useLocale } from '../context/locale';

const STORAGE_KEY = '@portfolio-mobile/watchlist';
const defaultSymbols = ['NVDA', 'AMZN'];
const periods = [
  { label: '1D', amount: 1, unit: 'day', interval: '5m' },
  { label: '1M', amount: 1, unit: 'month', interval: '1d' },
  { label: '3M', amount: 3, unit: 'month', interval: '1d' },
  { label: '6M', amount: 6, unit: 'month', interval: '1d' },
  { label: '1R', amount: 12, unit: 'month', interval: '1d' },
  { label: '5R', amount: 60, unit: 'month', interval: '1d' },
] as const;

function isValidSymbol(value: string) {
  return /^[A-Z0-9.^=-]{1,20}$/.test(value);
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
function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat('sk-SK', {
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
}: {
  asset: Asset;
  entry: WatchEntry | undefined;
  periodLabel: string;
  selectedPeriod: (typeof periods)[number]['label'];
  onRemove: () => void;
  onPress: () => void;
}) {
  const { t } = useLocale();
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Zobraziť detail ${asset.symbol}`}
      onPress={onPress}
      onLongPress={() =>
        Alert.alert(asset.symbol, t('Odstrániť z watchlistu?'), [
          { text: t('Zrušiť'), style: 'cancel' },
          { text: t('Odstrániť'), style: 'destructive', onPress: onRemove },
        ])}
      style={styles.assetCard}
    >
      <AssetLogo symbol={asset.symbol} color={asset.color} size={40} />
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
              : `${change > 0 ? '+' : ''}${change.toLocaleString('sk-SK', { maximumFractionDigits: 2 })} %`}
          </Text>
        </View>
        {entry?.loading && currentPrice === null ? (
          <ActivityIndicator size="small" color={colors.green} style={styles.priceLoading} />
        ) : (
          <Text style={styles.currentPrice}>
            {currentPrice === null ? '—' : formatPrice(currentPrice, currency)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
function showStorageError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  Alert.alert(`Chyba: ${action} watchlistu`, detail);
}

export default function WatchlistScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const [symbols, setSymbols] = useState<string[]>(defaultSymbols);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<(typeof periods)[number]['label']>('1D');
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'change'>('alphabetical');
  const [watchData, setWatchData] = useState<Record<string, WatchEntry>>({});
  const requestId = useRef(0);
  const { results: matchingAssets, loading: searching, error: searchError } = useAssetSearch(searchQuery);

  useEffect(() => {
    let active = true;
    const loadWatchlist = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
          const parsed: unknown = JSON.parse(saved);
          if (
            !Array.isArray(parsed) ||
            !parsed.every((symbol) => typeof symbol === 'string' && isValidSymbol(symbol))
          ) {
            throw new Error('Uložený zoznam nemá očakávaný formát.');
          }
          if (active) setSymbols(parsed);
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
      availableAssets.find((asset) => asset.symbol === symbol) ?? {
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
      if (changeA !== null && changeB !== null && changeA !== changeB) return changeB - changeA;
    }
    return a.name.localeCompare(b.name, 'sk');
  }), [assets, selectedPeriod, sortOrder, watchData]);
  const saveSymbols = async (nextSymbols: string[]) => {
    setSymbols(nextSymbols);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextSymbols));
    } catch (error) {
      showStorageError('uloženie', error);
    }
  };

  const addAsset = (symbol: string) => {
    void saveSymbols([...symbols, symbol]);
    setShowPicker(false);
    setSearchQuery('');
  };

  const removeAsset = (symbol: string) => {
    void saveSymbols(symbols.filter((item) => item !== symbol));
  };

  return (
    <Page>
      <Header
        title={t('Watchlist')}
        subtitle={t('Sledované akcie')}
        action={
          <Pressable
            accessibilityLabel={t('Pridať akciu')}
            accessibilityRole="button"
            onPress={() => setShowPicker(true)}
            style={styles.addButton}
          >
            <Plus size={19} color={colors.surface} />
          </Pressable>
        }
      />
      <View style={styles.summaryRow}>
        <View>
          <Text style={styles.summaryLabel}>{t('Sleduješ')}</Text>
          <Text style={styles.summaryValue}>{assets.length} {t('titulov')}</Text>
        </View>
      </View>

      {assets.length ? (
        <>
          <View style={styles.periodSelector}>
            {periods.map((item) => {
              const selected = selectedPeriod === item.label;
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedPeriod(item.label)}
                  style={[styles.periodButton, selected && styles.periodButtonSelected]}
                >
                  <Text style={[styles.periodText, selected && styles.periodTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <SortControl
            value={sortOrder}
            onChange={setSortOrder}
            options={[
              { key: 'change', label: 'Zmena %' },
              { key: 'alphabetical', label: 'A–Z' },
            ]}
          />
        </>
      ) : null}

      {loading ? (
        <Surface style={styles.loadingCard}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.loadingText}>{t('Načítavam watchlist…')}</Text>
        </Surface>
      ) : assets.length ? (
        <View style={styles.assetList}>
          {sortedAssets.map((asset) => (
            <WatchlistPriceCard
              key={asset.symbol}
              asset={asset}
              entry={watchData[asset.symbol]}
              periodLabel={selectedPeriod}
              selectedPeriod={selectedPeriod}
              onRemove={() => removeAsset(asset.symbol)}
              onPress={() => router.push({ pathname: '/position', params: { symbol: asset.symbol } })}
            />
          ))}
        </View>
      ) : (
        <Surface style={styles.emptyState}>
          <Search size={25} color={colors.muted} />
          <Text style={styles.emptyTitle}>{t('Zatiaľ nič nesleduješ')}</Text>
          <Text style={styles.emptyDescription}>{t('Pridaj akcie a maj ich ceny na jednom mieste.')}</Text>
          <Pressable onPress={() => setShowPicker(true)} style={styles.emptyButton}>
            <Text style={styles.emptyButtonText}>{t('Pridať prvú akciu')}</Text>
          </Pressable>
        </Surface>
      )}

      <Modal
        animationType="slide"
        transparent
        visible={showPicker}
        onRequestClose={() => {
          setShowPicker(false);
          setSearchQuery('');
        }}
      >
        <View style={styles.modalScrim}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setShowPicker(false);
              setSearchQuery('');
            }}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t('Pridať do watchlistu')}</Text>
                <Text style={styles.modalSubtitle}>{t('Vyber titul na sledovanie')}</Text>
              </View>
              <Pressable
                accessibilityLabel={t('Zavrieť')}
                onPress={() => {
                  setShowPicker(false);
                  setSearchQuery('');
                }}
                style={styles.closeButton}
              >
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.searchBox}>
              <Search size={17} color={colors.muted} />
              <TextInput
                accessibilityLabel="Hľadať akciu"
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
              {searchQuery.trim().length < 2 ? (
                <Text style={styles.noAssets}>{t('Začni písať aspoň 2 znaky názvu alebo symbolu akcie.')}</Text>
              ) : searching ? (
                <View style={styles.searchStatus}>
                  <ActivityIndicator size="small" color={colors.green} />
                  <Text style={styles.noAssets}>{t('Vyhľadávam akcie…')}</Text>
                </View>
              ) : searchError ? (
                <Text style={styles.noAssets}>{searchError}</Text>
              ) : matchingAssets.length ? matchingAssets.map((asset) => {
                const alreadyAdded = symbols.includes(asset.symbol);
                return (
                  <Pressable
                    key={asset.symbol}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: alreadyAdded }}
                    disabled={alreadyAdded}
                    onPress={() => addAsset(asset.symbol)}
                    style={[styles.optionRow, alreadyAdded && styles.optionRowDisabled]}
                  >
                    <View style={[styles.optionMark, { backgroundColor: asset.color }]} />
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionSymbol}>{asset.symbol}</Text>
                      <Text style={styles.optionName}>{asset.name}</Text>
                    </View>
                    {alreadyAdded
                      ? <Check size={17} color={colors.muted} />
                      : <Plus size={17} color={colors.green} />}
                  </Pressable>
                );
              }) : (
                <Text style={styles.noAssets}>{t('Nenašli sa žiadne akcie. Skús iný názov alebo symbol.')}</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  summaryIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  periodSelector: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 6,
  },
  periodButton: {
    flex: 1,
    minHeight: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodButtonSelected: {
    borderColor: colors.green,
    backgroundColor: colors.green,
  },
  periodText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  periodTextSelected: {
    color: colors.surface,
  },
  assetList: {
    gap: 2,
  },
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    minHeight: 62,
    gap: 10,
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
    fontSize: 16,
    fontWeight: '800',
  },
  assetName: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
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
    marginTop: 0,
    alignSelf: 'flex-start',
  },
  changeBlock: {
    alignItems: 'flex-end',
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
  emptyButton: {
    backgroundColor: colors.green,
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 15,
  },
  emptyButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
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
