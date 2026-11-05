import { useThemedStyles } from '../data/theme';
import { selectionHaptic } from '../data/haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ArrowLeft, Minus, Pencil, Plus, TrendingDown, TrendingUp } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AssetLogo } from '../components/asset-logo';
import { TableColumn } from '../components/table-column';
import { TransactionModal } from '../components/transaction-modal';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { Asset, availableAssets, colors, formatMoney, formatPercent } from '../data/portfolio';
import { fetchLiveQuote, LiveQuote } from '../data/quotes';
import { fetchHistoricalQuoteSeries, HistoricalQuotePoint } from '../data/quotes';
import { useLocale } from '../context/locale';
import { useAmountVisibility } from '../context/amount-visibility';
import { useChartHaptics } from '../hooks/use-chart-haptics';
import { RangeSwipeRow } from '../components/range-swipe-row';
import { getFeaturedAssetBySymbol } from '../data/asset-discovery';
import { recordAssetView } from '../data/asset-discovery-history';
import { fetchKeyStats, fetchStockEstimates, KeyStats, StockEstimates } from '../data/fundamentals';
import { CompanyEvents, fetchCompanyEvents, getLocalCompanyReports } from '../data/events';
import {
  Position,
  positionCostEUR,
  positionValueEUR,
  Transaction,
  TransactionInput,
  usePositions,
} from '../hooks/use-positions';

const ranges = [
  { label: '1D', days: 1, interval: '5m' },
  { label: '1T', days: 7, interval: '5m' },
  { label: '1M', days: 30, interval: '1d' },
  { label: '3M', days: 90, interval: '1d' },
  { label: '6M', days: 180, interval: '1d' },
  { label: '1Y', days: 365, interval: '1d' },
  { label: '3Y', days: 1095, interval: '1wk' },
  { label: '5Y', days: 1825, interval: '1wk' },
  { label: 'Všetko', days: null, interval: '1wk' },
] as const;

type RangeLabel = (typeof ranges)[number]['label'];
const rangeLabels = ranges.map((item) => item.label);

type PricePoint = HistoricalQuotePoint & { date: string };

function formatBigNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)} T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)} M`;
  return value.toFixed(0);
}

function formatTransactionCount(count: number, language: 'sk' | 'en') {
  if (language === 'en') return `${count} ${count === 1 ? 'transaction' : 'transactions'}`;
  const noun = count === 1 ? 'transakcia' : count >= 2 && count <= 4 ? 'transakcie' : 'transakcií';
  return `${count} ${noun}`;
}

function createAssetPosition(asset: Asset, quote: LiveQuote | null): Position {
  return {
    id: asset.symbol,
    symbol: asset.symbol,
    name: quote?.name ?? asset.name,
    shares: 0,
    averageCost: 0,
    averageCostEUR: 0,
    currentPrice: quote?.price ?? asset.price,
    currency: quote?.currency ?? 'USD',
    fxToEur: quote?.fxToEur ?? 1,
    updatedAt: quote?.updatedAt ?? '',
    color: asset.color,
    hasMarketQuote: quote?.isMarketQuote ?? false,
    realizedProfitEUR: 0,
    totalInvestedEUR: 0,
    dailyChangePct: quote?.change ?? 0,
    transactions: [],
  };
}

function getStartDate(range: RangeLabel, position: Position | undefined) {
  const selected = ranges.find((item) => item.label === range) ?? ranges[2];
  if (selected.days === null) {
    const earliestTransaction = position?.transactions
      .map((transaction) => transaction.date)
      .sort()[0];
    if (earliestTransaction) return earliestTransaction;
    const fallback = new Date();
    fallback.setUTCFullYear(fallback.getUTCFullYear() - 5);
    return fallback.toISOString().slice(0, 10);
  }
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - selected.days);
  return start.toISOString().slice(0, 10);
}

function StockChart({
  position,
  range,
  onRangeChange,
}: {
  position: Position;
  range: RangeLabel;
  onRangeChange: (range: RangeLabel) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t, language, errorText } = useLocale();
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const [baseline, setBaseline] = useState<number | null>(null);
  const startDate = getStartDate(range, position);
  const rangeConfig = ranges.find((item) => item.label === range) ?? ranges[2];

  useEffect(() => {
    let active = true;
    const fetchStart = new Date(`${startDate}T00:00:00.000Z`);
    fetchStart.setUTCDate(fetchStart.getUTCDate() - 7);
    setLoading(true);
    setError('');
    setSelectedIndex(null);
    fetchHistoricalQuoteSeries(position.symbol, fetchStart.toISOString().slice(0, 10), rangeConfig.interval)
      .then((series) => {
        const toDate = (point: { timestamp: number }) => new Date(point.timestamp * 1000).toISOString().slice(0, 10);
        let base: number | null = null;
        let selectedPoints = series.points;
        if (range === '1D') {
          // Posledný obchodný deň; základ je predošlé uzavretie.
          const latestDate = series.points.length ? toDate(series.points[series.points.length - 1]) : '';
          selectedPoints = series.points.filter((point) => toDate(point) === latestDate);
          const before = series.points.filter((point) => toDate(point) < latestDate);
          base = before.length ? before[before.length - 1].price : null;
        } else {
          selectedPoints = series.points.filter(
            (point) => point.timestamp * 1000 >= new Date(`${startDate}T00:00:00.000Z`).getTime(),
          );
        }
        const points = selectedPoints.map((point) => ({ ...point, date: toDate(point) }));
        if (!points.length) throw new Error('Pre vybrané obdobie nie sú dostupné historické ceny.');
        if (active) {
          setBaseline(base);
          setHistory(points);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setHistory([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [position.symbol, startDate, range, rangeConfig.interval]);

  const selectedPoint = selectedIndex !== null
    ? history[Math.min(selectedIndex, history.length - 1)]
    : history[history.length - 1];
  const firstPrice = (range === '1D' ? baseline : null) ?? history[0]?.price ?? 0;
  const priceChange = selectedPoint ? selectedPoint.price - firstPrice : 0;
  const priceChangePercent = firstPrice > 0 ? priceChange / firstPrice * 100 : 0;
  const prices = history.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const priceRange = max - min || Math.max(max * 0.02, 0.01);
  const chartPoints = history.map((point, index) => ({
    x: history.length === 1 ? 160 : 8 + index / (history.length - 1) * 296,
    y: 120 - (point.price - min) / priceRange * 96,
  }));
  const path = chartPoints.reduce((result, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    return `${result} L ${point.x} ${point.y}`;
  }, '');
  const selectedChartPoint = chartPoints[selectedIndex ?? chartPoints.length - 1];
  const labels = history.length > 1
    ? [history[0], history[Math.floor(history.length / 2)], history[history.length - 1]]
    : [];
  const chartHaptics = useChartHaptics();
  const selectPoint = (locationX: number) => {
    if (!history.length || chartWidth <= 0) return;
    const index = Math.round(Math.max(0, Math.min(1, locationX / chartWidth)) * (history.length - 1));
    chartHaptics(index);
    setSelectedIndex(index);
  };
  const endSelection = () => {
    chartHaptics(null);
    setSelectedIndex(null);
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      history.length > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
    onPanResponderGrant: (event) => selectPoint(event.nativeEvent.locationX),
    onPanResponderMove: (event) => selectPoint(event.nativeEvent.locationX),
    onPanResponderRelease: endSelection,
    onPanResponderTerminate: endSelection,
  }), [chartWidth, history.length, chartHaptics]);
  const timeLabel = (point: { timestamp: number }) =>
    new Date(point.timestamp * 1000).toLocaleTimeString(language === 'sk' ? 'sk-SK' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Surface style={styles.chartCard}>
      <View style={styles.chartHeading}>
        <View>
          <Text style={styles.chartEyebrow}>
            {selectedPoint
              ? range === '1D' ? `${dateLabel(selectedPoint.date)} · ${timeLabel(selectedPoint)}` : dateLabel(selectedPoint.date)
              : t('Historický vývoj')}
          </Text>
          <Text style={styles.chartPrice}>
            {selectedPoint
              ? `${selectedPoint.price.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} ${position.currency}`
              : `${position.currentPrice.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} ${position.currency}`}
          </Text>
        </View>
        <View style={styles.chartChange}>
          <View style={styles.chartChangeRow}>
            {priceChange >= 0
              ? <TrendingUp size={14} color={colors.green} />
              : <TrendingDown size={14} color={colors.red} />}
            <Text style={[styles.chartChangeText, { color: priceChange >= 0 ? colors.green : colors.red }]}>
              {formatPercent(priceChangePercent)}
            </Text>
          </View>
          <Text style={[styles.chartChangeAmount, { color: priceChange >= 0 ? colors.green : colors.red }]}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} {position.currency}
          </Text>
        </View>
      </View>

      <View
        {...panResponder.panHandlers}
        onTouchStart={(event) => {
          if (!history.length) return;
          const index = Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / chartWidth)) * (history.length - 1));
          setSelectedIndex(index);
        }}
        onTouchEnd={() => setSelectedIndex(null)}
        onTouchCancel={() => setSelectedIndex(null)}
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        style={styles.chartWrap}
      >
        <Svg width="100%" height={215} viewBox="0 0 320 140" preserveAspectRatio="none">
          <Line x1="8" y1="124" x2="312" y2="124" stroke={colors.border} strokeWidth="1" />
          {path ? <Path d={path} fill="none" stroke={colors.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {selectedIndex !== null && selectedChartPoint ? (
            <>
              <Line x1={selectedChartPoint.x} y1="10" x2={selectedChartPoint.x} y2="124" stroke={colors.muted} strokeWidth="1" strokeDasharray="3 4" />
              <Circle cx={selectedChartPoint.x} cy={selectedChartPoint.y} r="5" fill={colors.green} stroke={colors.background} strokeWidth="2" />
            </>
          ) : null}
        </Svg>
        {loading ? (
          <View style={styles.chartOverlay}><ActivityIndicator color={colors.green} /></View>
        ) : null}
        {error ? <Text style={styles.chartError}>{errorText(error)}</Text> : null}
      </View>
      <View style={styles.chartLabels}>
        {labels.length
          ? labels.map((point, index) => (
              <Text
                key={`${point.timestamp}-${index}`}
                numberOfLines={1}
                style={[styles.chartLabel, { textAlign: index === 0 ? 'left' : index === labels.length - 1 ? 'right' : 'center' }]}
              >
                {range === '1D' ? timeLabel(point) : dateLabel(point.date)}
              </Text>
            ))
          : <Text style={styles.chartHint}>{t('Potiahni prstom po grafe pre zobrazenie ceny v daný deň.')}</Text>}
      </View>
      <RangeSwipeRow
        labels={rangeLabels}
        selected={range}
        onChange={onRangeChange}
        renderLabel={(label) => t(label)}
        style={styles.rangeRow}
        buttonStyle={styles.rangeButton}
        indicatorStyle={styles.rangeButtonSelected}
        textStyle={styles.rangeText}
        selectedTextStyle={styles.rangeTextSelected}
      />
    </Surface>
  );
}

function TransactionList({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit: (transaction: Transaction) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { hideAmounts } = useAmountVisibility();
  const { t, language } = useLocale();
  return (
    <View style={styles.transactionList}>
      {transactions.map((transaction) => {
        const isBuy = transaction.type === 'BUY';
        const total = transaction.shares * transaction.price;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isBuy ? t('Upraviť nákup z') : t('Upraviť predaj z')} ${transaction.date}`}
            key={transaction.id}
            onPress={() => onEdit(transaction)}
            style={({ pressed }) => [styles.transactionItem, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.transactionTopLine}>
              <View style={styles.transactionType}>
                <View style={[styles.transactionIcon, { backgroundColor: isBuy ? `${colors.green}18` : `${colors.red}18` }]}>
                  {isBuy ? <Plus size={19} color={colors.green} /> : <Minus size={19} color={colors.red} />}
                </View>
                <Text style={styles.transactionName}>{isBuy ? t('Nákup') : t('Predaj')}</Text>
              </View>
              <Text style={[styles.transactionAmount, { color: isBuy ? colors.text : colors.red }]}>
                {hideAmounts ? '•••••' : formatMoney(total * transaction.fxToEur)}
              </Text>
            </View>
            <View style={styles.transactionBottomLine}>
              <Text style={styles.transactionMeta}>
                {new Date(`${transaction.date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
              <View style={styles.transactionPriceLine}>
                <Text style={styles.transactionMeta}>
                  {hideAmounts ? '•••••' : `${transaction.shares.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')} × ${transaction.price.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} ${transaction.currency}`}
                </Text>
                <Pencil size={13} color={colors.muted} />
              </View>
            </View>
            {transaction.dateEstimated ? <Text style={styles.transactionMeta}>{t('Odhadovaný dátum')}</Text> : null}
          </Pressable>
        );
      })}
      {!transactions.length ? <Text style={styles.emptyTable}>{t('Zatiaľ nemáš zaznamenané žiadne pohyby.')}</Text> : null}
    </View>
  );
}

export default function PositionDetailScreen() {
  const styles = useThemedStyles(createStyles);
  const { hideAmounts } = useAmountVisibility();
  const { symbol: symbolParam } = useLocalSearchParams<{ symbol: string }>();
  const symbol = Array.isArray(symbolParam) ? symbolParam[0] : symbolParam;
  const router = useRouter();
  const { positions, loading, saveTransaction, deleteTransaction } = usePositions();
  const { t, language, errorText } = useLocale();
  const heldPosition = positions.find((item) => item.symbol === symbol);
  const isHeld = Boolean(heldPosition);
  // Memoized so the quote effect does not refetch (and flicker the name) on every render.
  const asset = useMemo(() => availableAssets.find((item) => item.symbol === symbol) ?? getFeaturedAssetBySymbol(symbol) ?? (
    symbol && /^[A-Z0-9.^=-]{1,20}$/.test(symbol)
      ? { symbol, name: symbol, price: 0, change: 0, color: colors.violet }
      : undefined
  ), [symbol]);
  const hasAsset = Boolean(asset);
  useEffect(() => {
    if (symbol && hasAsset) recordAssetView(symbol);
  }, [symbol, hasAsset]);
  const [marketQuote, setMarketQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [range, setRange] = useState<RangeLabel>('1D');
  const [formVisible, setFormVisible] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [stats, setStats] = useState<KeyStats | null>(null);
  const [estimates, setEstimates] = useState<StockEstimates | null>(null);
  const [metricsError, setMetricsError] = useState('');
  const [events, setEvents] = useState<Pick<CompanyEvents, 'quarters' | 'financialDataIssue'> | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [estimatesLoading, setEstimatesLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setStatsLoading(true);
    setEstimatesLoading(true);
    setReportsLoading(true);
    setStats(null);
    setEstimates(null);
    setMetricsError('');
    setEvents(null);
    setReportsError('');
    let liveReportsLoaded = false;
    const message = (error: unknown) => error instanceof Error ? error.message : String(error);
    const metricsFailure = (error: unknown) => {
      console.warn('Position metrics could not be loaded:', error);
      if (active) setMetricsError((previous) => [previous, message(error)].filter(Boolean).join(' '));
    };
    void fetchKeyStats(symbol).then((value) => { if (active) setStats(value); })
      .catch(metricsFailure).finally(() => { if (active) setStatsLoading(false); });
    void fetchStockEstimates(symbol).then((value) => { if (active) setEstimates(value); })
      .catch(metricsFailure).finally(() => { if (active) setEstimatesLoading(false); });
    void getLocalCompanyReports(symbol).then((value) => {
      if (active && !liveReportsLoaded && value.quarters.length) {
        setEvents(value);
        setReportsLoading(false);
      }
    }).catch((error: unknown) => {
      console.warn('Local company reports could not be loaded:', error);
      if (active) setReportsError(message(error));
    });
    void fetchCompanyEvents(symbol).then((value) => {
      liveReportsLoaded = true;
      if (active) { setEvents(value); setReportsError(''); }
    }).catch((error: unknown) => {
      console.warn('Company reports could not be refreshed:', error);
      if (active) setReportsError(message(error));
    }).finally(() => { if (active) setReportsLoading(false); });
    return () => { active = false; };
  }, [symbol]);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [initialType, setInitialType] = useState<'BUY' | 'SELL'>('BUY');

  useEffect(() => {
    if (isHeld || !symbol || !hasAsset) return;
    let active = true;
    setMarketQuote(null);
    setQuoteError('');
    fetchLiveQuote(symbol)
      .then((quote) => {
        if (active) setMarketQuote(quote);
      })
      .catch((error: unknown) => {
        if (active) setQuoteError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [hasAsset, isHeld, symbol]);

  const position = heldPosition ?? (asset ? createAssetPosition(asset, marketQuote) : undefined);
  const currentValue = position ? positionValueEUR(position) : 0;
  const openCost = position ? positionCostEUR(position) : 0;
  const unrealized = currentValue - openCost;
  const totalResult = unrealized + (position?.realizedProfitEUR ?? 0);

  const addTransaction = (type: 'BUY' | 'SELL') => {
    selectionHaptic();
    setEditingTransaction(undefined);
    setInitialType(type);
    setFormVisible(true);
  };

  const editTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setFormVisible(true);
  };

  const removeTransaction = (id: string) => {
    Alert.alert(t('Odstrániť pohyb?'), t('Táto transakcia bude odstránená z histórie a výsledok sa prepočíta.'), [
      { text: t('Zrušiť'), style: 'cancel' },
      {
        text: t('Odstrániť'),
        style: 'destructive',
        onPress: () => {
          void deleteTransaction(id).then(() => setFormVisible(false)).catch((error: unknown) => {
            console.warn('Transaction deletion failed:', error);
            Alert.alert(t('Transakcia sa neodstránila'), errorText(error instanceof Error ? error.message : String(error)));
          });
        },
      },
    ]);
  };

  const save = (input: TransactionInput, id?: string, quote?: Parameters<typeof saveTransaction>[2]) =>
    saveTransaction(input, id, quote);

  if (loading && !position && !asset) {
    return (
      <Page animateOnFocus>
        <Header title={t('Pozícia')} action={<Pressable onPress={() => router.back()}><ArrowLeft size={20} color={colors.text} /></Pressable>} />
        <Surface style={styles.loadingCard}><ActivityIndicator color={colors.green} /></Surface>
      </Page>
    );
  }

  if (!position || !symbol) {
    return (
      <Page animateOnFocus>
        <Header title={t('Pozícia')} action={<Pressable onPress={() => router.back()}><ArrowLeft size={20} color={colors.text} /></Pressable>} />
          <Surface style={styles.loadingCard}><Text style={styles.emptyTable}>{t('Pozíciu sa nepodarilo nájsť.')}</Text></Surface>
      </Page>
    );
  }

  return (
    <Page animateOnFocus>
      <View style={styles.stockHero}>
      <Header
        title={position.symbol}
        subtitle={position.name}
        action={
          <View style={styles.detailHeader}>
            <AssetLogo symbol={position.symbol} color={position.color} size={48} />
            <Pressable accessibilityLabel={t('Späť na portfólio')} onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={18} color={colors.text} />
            </Pressable>
          </View>
        }
      />

      {quoteError && !heldPosition ? <Text accessibilityRole="alert" style={styles.summaryCaption}>{errorText(quoteError)}</Text> : null}
      <StockChart position={position} range={range} onRangeChange={setRange} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Moje pohyby')}
        onPress={() => { selectionHaptic(); setMovementsOpen(true); }}
        style={styles.holdingsButton}
      >
        <Text style={styles.holdingsButtonText}>
          {hideAmounts ? '•••••' : position.shares.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')} {t('ks')}
        </Text>
      </Pressable>
      </View>

      {heldPosition ? (
        <Surface style={styles.resultsCard}>
          <View style={styles.resultHero}>
            <Text style={styles.resultCaption}>{t('Aktuálna hodnota')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.resultTotal}>
              {hideAmounts ? '•••••' : formatMoney(currentValue)}
            </Text>
          </View>
          <View style={styles.resultGrid}>
            <View style={styles.resultDetails}>
              <View>
                <Text style={styles.resultCaption}>{t('Investované · otvorená pozícia')}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.resultAmount}>{hideAmounts ? '•••••' : formatMoney(openCost)}</Text>
              </View>
              <View>
                <Text style={styles.resultCaption}>{t('Priemerná nákupná cena')} ({position.currency})</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.resultAmount}>
                  {hideAmounts ? '•••••' : position.averageCost.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { style: 'currency', currency: position.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
            </View>
            <View style={[styles.resultDetails, styles.resultDivider]}>
              <View>
                <Text style={styles.resultCaption}>{t('Nerealizovaný výnos')}</Text>
                <View style={styles.resultReturn}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.resultAmount, { color: unrealized >= 0 ? colors.green : colors.red }]}>
                    {hideAmounts ? '•••••' : `${unrealized >= 0 ? '+' : ''}${formatMoney(unrealized)}`}
                  </Text>
                  {openCost > 0 ? (
                    <Text style={[styles.resultPct, { color: unrealized >= 0 ? colors.green : colors.red }]}>{formatPercent((unrealized / openCost) * 100)}</Text>
                  ) : null}
                </View>
              </View>
              <View>
                <Text style={styles.resultCaption}>{t('Celkový výsledok')}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.resultAmount, { color: totalResult >= 0 ? colors.green : colors.red }]}>
                  {hideAmounts ? '•••••' : `${totalResult >= 0 ? '+' : ''}${formatMoney(totalResult)}`}
                </Text>
              </View>
            </View>
          </View>
        </Surface>
      ) : null}

      <SectionTitle title={t('Ukazovatele')} />
      <Surface style={styles.statsCard}>
        {statsLoading && estimatesLoading ? <ActivityIndicator color={colors.green} /> : (
          <View>
            {([
              [
                ['P/E TTM', stats?.pe != null ? stats.pe.toFixed(1) : '–'],
                [`${t('Odhad P/E')} ${new Date().getFullYear()}`, estimates?.peThisYear != null ? estimates.peThisYear.toFixed(1) : '–'],
                [`${t('Odhad P/E')} ${new Date().getFullYear() + 1}`, estimates?.peNextYear != null ? estimates.peNextYear.toFixed(1) : '–'],
              ],
              [
                ['EPS TTM', stats?.eps != null ? stats.eps.toFixed(2) : '–'],
                [`${t('Odhad EPS')} ${new Date().getFullYear()}`, estimates?.epsThisYear != null ? estimates.epsThisYear.toFixed(2) : '–'],
                [`${t('Odhad EPS')} ${new Date().getFullYear() + 1}`, estimates?.epsNextYear != null ? estimates.epsNextYear.toFixed(2) : '–'],
              ],
              [
                [t('Ročná dividenda na akciu'), stats?.dividendRate != null ? `${stats.dividendRate.toFixed(2)} ${position.currency}` : '–'],
                [t('Dividendový výnos'), stats?.dividendYield != null ? `${(stats.dividendYield * 100).toFixed(2)} %` : '–'],
                [t('Trhová kapitalizácia'), stats?.marketCap != null ? formatBigNumber(stats.marketCap) : '–'],
              ],
            ] as const).map((group, index) => (
              <View key={index} style={[styles.statsGrid, index > 0 && styles.statsDivider]}>
              {group.map(([label, value], columnIndex) => (
              <View key={label} style={[styles.statItem, columnIndex > 0 && styles.statColumnDivider]}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
              ))}
              </View>
            ))}
            {metricsError ? <Text accessibilityRole="alert" style={styles.metricsError}>{errorText(metricsError)}</Text> : null}
          </View>
        )}
      </Surface>

      <SectionTitle title={t('Výsledkové správy')} />
      <Surface style={styles.statsCard}>
        {reportsLoading ? <ActivityIndicator color={colors.green} /> : (
          <>
            {events?.quarters?.length ? (
              <View style={styles.reportRow}>
                <TableColumn first tone="neutral" header style={[styles.reportColumn, styles.colPeriod]}>
                  <Text style={styles.reportHead}>{t('Obdobie')}</Text>
                </TableColumn>
                <TableColumn tone="cyan" header style={[styles.reportColumn, styles.colNum]}>
                  <Text style={styles.reportHead}>{t('Tržby')}</Text>
                </TableColumn>
                <TableColumn tone="cyan" header style={[styles.reportColumn, styles.colNum]}>
                  <Text style={styles.reportHead}>{t('YoY tržieb')}</Text>
                </TableColumn>
                <TableColumn tone="cyan" header style={[styles.reportColumn, styles.colNum]}>
                  <Text style={styles.reportHead}>{t('Rozdiel tržieb oproti odhadu')}</Text>
                </TableColumn>
                <TableColumn tone="violet" header style={[styles.reportColumn, styles.colNum]}>
                  <Text style={styles.reportHead}>EPS</Text>
                </TableColumn>
                <TableColumn tone="violet" header style={[styles.reportColumn, styles.colNum]}>
                  <Text style={styles.reportHead}>{t('Rozdiel EPS oproti odhadu')}</Text>
                </TableColumn>
              </View>
            ) : null}
            {(events?.quarters ?? []).slice(0, 6).map((quarter) => {
              return (
                <View key={quarter.periodEnd} style={styles.reportRow}>
                  <TableColumn first tone="neutral" style={[styles.reportColumn, styles.colPeriod]}>
                    <Text style={styles.reportTitle}>{quarter.label}</Text>
                  </TableColumn>
                  <TableColumn tone="cyan" style={[styles.reportColumn, styles.colNum]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.reportCell}>{quarter.revenue != null ? formatBigNumber(quarter.revenue) : '–'}</Text>
                  </TableColumn>
                  <TableColumn tone="cyan" style={[styles.reportColumn, styles.colNum]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.reportCell}>{quarter.revenueYoY != null ? `${quarter.revenueYoY.toFixed(1)}%` : '–'}</Text>
                  </TableColumn>
                  <TableColumn tone="cyan" style={[styles.reportColumn, styles.colNum]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[styles.reportCell, quarter.revenueBeat != null ? { color: quarter.revenueBeat >= 0 ? colors.green : colors.red } : null]}>
                      {quarter.revenueBeat != null ? `${quarter.revenueBeat > 0 ? '+' : ''}${formatBigNumber(quarter.revenueBeat)}${quarter.revenueBeatProvisional ? '*' : ''}` : '–'}
                    </Text>
                  </TableColumn>
                  <TableColumn tone="violet" style={[styles.reportColumn, styles.colNum]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.reportCell}>{quarter.epsActual != null ? quarter.epsActual.toFixed(2) : '–'}</Text>
                  </TableColumn>
                  <TableColumn tone="violet" style={[styles.reportColumn, styles.colNum]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[styles.reportCell, quarter.epsBeat != null ? { color: quarter.epsBeat >= 0 ? colors.green : colors.red } : null]}>
                      {quarter.epsBeat != null ? `${quarter.epsBeat > 0 ? '+' : ''}${quarter.epsBeat.toFixed(2)}` : '–'}
                    </Text>
                  </TableColumn>
                </View>
              );
            })}
            {!(events?.quarters?.length) ? (
              <Text style={styles.emptyTable}>{t('Žiadne reporty')}</Text>
            ) : null}
            {reportsError ? <Text accessibilityRole="alert" style={styles.metricsError}>{errorText(reportsError)}</Text> : null}
            {events?.financialDataIssue ? (
              <Text style={styles.reportSub}>
                {t('Niektoré výsledky alebo historické odhady analytikov nie sú dostupné.')}
              </Text>
            ) : null}
            <Text style={styles.reportSub}>
              {t('Rozdiel = výsledok − odhad. Rozdiel tržieb je v mene tržieb, rozdiel EPS na akciu. EPS používa metodiku konsenzu (GAAP alebo upravené).')}
            </Text>
            {events?.quarters.slice(0, 6).some((quarter) => quarter.revenueBeatProvisional) ? (
              <Text style={styles.reportSub}>{t('* Predbežný rozdiel tržieb z odhadu uloženého pred reportom; čaká na manuálne overenie.')}</Text>
            ) : null}
          </>
        )}
      </Surface>

      <Modal visible={movementsOpen} animationType="fade" hardwareAccelerated
        backdropColor={colors.background} onRequestClose={() => setMovementsOpen(false)}>
        <SafeAreaView style={styles.holdingsScreen}>
          <View style={styles.holdingsHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Zavrieť')} onPress={() => setMovementsOpen(false)} style={styles.backButton}>
              <ArrowLeft size={20} color={colors.text} />
            </Pressable>
            <AssetLogo symbol={position.symbol} color={position.color} size={32} />
            <View style={styles.holdingsSummaryCopy}>
              <Text style={styles.holdingsSymbol}>{position.symbol}</Text>
              <Text style={styles.holdingsCaption} numberOfLines={1}>{position.name}</Text>
            </View>
            <View style={styles.holdingsBalance}>
              <Text style={styles.holdingsCaption}>{t('Počet akcií')}</Text>
              <Text style={styles.holdingsShares} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {hideAmounts ? '•••••' : position.shares.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')}
              </Text>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.holdingsContent}>
            <View style={styles.holdingsActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Pridať nákup')} onPress={() => addTransaction('BUY')} style={styles.holdingsAction}>
                <Plus size={18} color={colors.surface} />
                <Text style={[styles.holdingsActionText, { color: colors.surface }]}>{t('Nákup')}</Text>
              </Pressable>
              {position.shares > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('Pridať predaj')} onPress={() => addTransaction('SELL')} style={[styles.holdingsAction, styles.holdingsSellAction]}>
                  <Minus size={18} color={colors.text} />
                  <Text style={styles.holdingsActionText}>{t('Predaj')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.holdingsTransactionsHeader}>
            <Text style={styles.holdingsTransactionsTitle}>{t('Moje pohyby')}</Text>
            <Text style={styles.transactionCount}>{formatTransactionCount(position.transactions.length, language)}</Text>
            </View>
            <TransactionList transactions={position.transactions} onEdit={editTransaction} />
          </ScrollView>
        </SafeAreaView>
        <TransactionModal
          visible={formVisible}
          transaction={editingTransaction}
          initialSymbol={editingTransaction ? undefined : position.symbol}
          initialName={editingTransaction ? undefined : position.name}
          initialCurrency={editingTransaction ? undefined : position.currency}
          initialFxToEur={editingTransaction ? undefined : position.fxToEur}
          initialType={initialType}
          onClose={() => setFormVisible(false)}
          onSave={save}
          onDelete={removeTransaction}
        />
      </Modal>
    </Page>
  );
}

const createStyles = () => StyleSheet.create({
  stockHero: { backgroundColor: colors.surface, borderRadius: 24, padding: 14, marginBottom: 12 },
  holdingsButton: { backgroundColor: colors.green, borderRadius: 24, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  holdingsButtonText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  holdingsScreen: { flex: 1, backgroundColor: colors.background },
  holdingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  holdingsSymbol: { color: colors.text, fontSize: 17, fontWeight: '800' },
  holdingsContent: { paddingHorizontal: 16, paddingBottom: 32 },
  holdingsSummaryCopy: { flex: 1, minWidth: 0 },
  holdingsBalance: { alignItems: 'flex-end', maxWidth: '40%', gap: 2 },
  holdingsShares: { color: colors.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  holdingsCaption: { color: colors.muted, fontSize: 11 },
  holdingsActions: { flexDirection: 'row', gap: 10, marginTop: 2, marginBottom: 22 },
  holdingsAction: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: 12, backgroundColor: colors.green },
  holdingsSellAction: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  holdingsActionText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  holdingsTransactionsHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 12 },
  holdingsTransactionsTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  transactionList: { gap: 7 },
  transactionItem: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, gap: 5 },
  transactionTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  transactionType: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  transactionIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  transactionName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  transactionAmount: { flexShrink: 1, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  transactionBottomLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  transactionPriceLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  transactionMeta: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  detailHeader: { flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  summaryCaption: { color: colors.muted, fontSize: 9, marginTop: 4 },
  resultsCard: { backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4 },
  resultHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultTotal: { color: colors.text, flexShrink: 1, fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  resultGrid: { flexDirection: 'row', paddingTop: 10 },
  resultDetails: { flex: 1, minWidth: 0, gap: 8 },
  resultDivider: { paddingLeft: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  resultCaption: { color: colors.muted, fontSize: 9, fontWeight: '500' },
  resultReturn: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 },
  resultPct: { color: colors.muted, fontSize: 9, fontVariant: ['tabular-nums'] },
  resultAmount: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 2, flexShrink: 1, fontVariant: ['tabular-nums'] },
  chartCard: { padding: 0 },
  chartHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartEyebrow: { color: colors.muted, fontSize: 9 },
  chartPrice: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 3 },
  chartChange: { alignItems: 'flex-end' },
  chartChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chartChangeText: { fontSize: 11, fontWeight: '900' },
  chartChangeAmount: { fontSize: 9, fontWeight: '800', marginTop: 4 },
  chartWrap: { position: 'relative', marginTop: 5, minHeight: 215 },
  chartOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,38,52,0.45)' },
  chartError: { position: 'absolute', left: 8, right: 8, top: 12, color: colors.red, fontSize: 10, textAlign: 'center' },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, minHeight: 17 },
  chartLabel: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 8 },
  chartHint: { color: colors.muted, fontSize: 8, textAlign: 'center', flex: 1 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rangeButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 6 },
  rangeButtonSelected: { backgroundColor: colors.green, borderRadius: 999 },
  rangeText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  rangeTextSelected: { color: colors.surface },
  transactionCount: { color: colors.muted, fontSize: 11 },
  tableCard: { paddingHorizontal: 10, paddingVertical: 6 },
  tableHeader: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 3, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableHeaderCell: { justifyContent: 'center', alignSelf: 'stretch' },
  tableBodyCell: { justifyContent: 'center', alignSelf: 'stretch' },
  tableHeading: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  tableRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 7, paddingHorizontal: 3 },
  dateColumn: { flex: 1.15 },
  typeColumn: { flex: 0.95 },
  sharesColumn: { flex: 0.65 },
  sharesText: { textAlign: 'right' },
  amountColumn: { flex: 1.4 },
  tableDate: { color: colors.text, fontSize: 9, fontWeight: '700' },
  estimatedDate: { color: colors.muted, fontSize: 7, marginTop: 3 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 5 },
  typeBadgeText: { fontSize: 8, fontWeight: '800' },
  tableShares: { color: colors.text, fontSize: 9, fontWeight: '800' },
  tableAmounts: { alignItems: 'flex-end' },
  tablePrice: { color: colors.muted, fontSize: 8 },
  tableTotal: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  tableTotalText: { color: colors.text, fontSize: 9, fontWeight: '800' },
  statsCard: { padding: 14, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statsDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 8, paddingTop: 8 },
  metricsError: { color: colors.red, fontSize: 10, marginTop: 8 },
  statItem: { width: '33.33%', paddingVertical: 6, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  statColumnDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  statValue: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  reportRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 34, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  reportColumn: { justifyContent: 'center', paddingHorizontal: 3 },
  reportTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  reportSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
  reportHead: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  reportCell: { color: colors.text, fontSize: 9, fontWeight: '700', textAlign: 'right' },
  colPeriod: { flex: 1.3 },
  colNum: { flex: 1 },
  emptyTable: { color: colors.muted, fontSize: 10, textAlign: 'center', paddingVertical: 20 },
  loadingCard: { alignItems: 'center', padding: 22 },
});
