import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AssetLogo } from '../components/asset-logo';
import { TransactionModal } from '../components/transaction-modal';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { Asset, availableAssets, colors, formatMoney, formatPercent } from '../data/portfolio';
import { fetchLiveQuote, LiveQuote } from '../data/quotes';
import { fetchHistoricalQuoteSeries, HistoricalQuotePoint } from '../data/quotes';
import { useLocale } from '../context/locale';
import { fetchKeyStats, KeyStats } from '../data/fundamentals';
import { CompanyEvents, fetchCompanyEvents } from '../data/events';
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
  const { t, language } = useLocale();
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
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      history.length > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
    onPanResponderGrant: (event) => {
      const index = Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / chartWidth)) * (history.length - 1));
      setSelectedIndex(index);
    },
    onPanResponderMove: (event) => {
      const index = Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / chartWidth)) * (history.length - 1));
      setSelectedIndex(index);
    },
    onPanResponderTerminate: () => setSelectedIndex(null),
  }), [chartWidth, history.length]);
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
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        style={styles.chartWrap}
      >
        <Svg width="100%" height={215} viewBox="0 0 320 140" preserveAspectRatio="none">
          <Line x1="8" y1="124" x2="312" y2="124" stroke={colors.border} strokeWidth="1" />
          {path ? <Path d={path} fill="none" stroke={colors.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {selectedChartPoint ? (
            <>
              <Line x1={selectedChartPoint.x} y1="10" x2={selectedChartPoint.x} y2="124" stroke={colors.muted} strokeWidth="1" strokeDasharray="3 4" />
              <Circle cx={selectedChartPoint.x} cy={selectedChartPoint.y} r="5" fill={colors.green} stroke={colors.background} strokeWidth="2" />
            </>
          ) : null}
        </Svg>
        {loading ? (
          <View style={styles.chartOverlay}><ActivityIndicator color={colors.green} /></View>
        ) : null}
        {error ? <Text style={styles.chartError}>{error}</Text> : null}
      </View>
      <View style={styles.chartLabels}>
        {labels.length
          ? labels.map((point, index) => (
              <Text key={`${point.timestamp}-${index}`} style={styles.chartLabel}>
                {range === '1D' ? timeLabel(point) : dateLabel(point.date)}
              </Text>
            ))
          : <Text style={styles.chartHint}>{t('Potiahni prstom po grafe pre zobrazenie ceny v daný deň.')}</Text>}
      </View>
      <View style={styles.rangeRow}>
        {ranges.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: item.label === range }}
            onPress={() => onRangeChange(item.label)}
            style={[styles.rangeButton, item.label === range && styles.rangeButtonSelected]}
          >
            <Text style={[styles.rangeText, item.label === range && styles.rangeTextSelected]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </Surface>
  );
}

function TransactionTable({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit: (transaction: Transaction) => void;
}) {
  const { t, language } = useLocale();
  return (
    <Surface style={styles.tableCard}>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeading, styles.dateColumn]}>{t('Dátum')}</Text>
        <Text style={[styles.tableHeading, styles.typeColumn]}>{t('Typ')}</Text>
        <Text style={[styles.tableHeading, styles.sharesColumn]}>{t('Počet')}</Text>
        <Text style={[styles.tableHeading, styles.amountColumn]}>{t('Cena / suma')}</Text>
      </View>
      {transactions.map((transaction) => {
        const isBuy = transaction.type === 'BUY';
        const total = transaction.shares * transaction.price;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isBuy ? t('Upraviť nákup z') : t('Upraviť predaj z')} ${transaction.date}`}
            key={transaction.id}
            onPress={() => onEdit(transaction)}
            style={styles.tableRow}
          >
            <View style={styles.dateColumn}>
              <Text style={styles.tableDate}>{new Date(`${transaction.date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US')}</Text>
              {transaction.dateEstimated ? <Text style={styles.estimatedDate}>{t('Odhadovaný dátum')}</Text> : null}
            </View>
            <View style={[styles.typeBadge, { backgroundColor: isBuy ? 'rgba(120,216,79,0.12)' : 'rgba(255,90,98,0.12)' }]}>
              {isBuy
                ? <TrendingUp size={11} color={colors.green} />
                : <TrendingDown size={11} color={colors.red} />}
              <Text style={[styles.typeBadgeText, { color: isBuy ? colors.green : colors.red }]}>
                {isBuy ? t('Nákup') : t('Predaj')}
              </Text>
            </View>
            <Text style={[styles.tableShares, styles.sharesColumn]}>{transaction.shares.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')}</Text>
            <View style={[styles.amountColumn, styles.tableAmounts]}>
              <Text style={styles.tablePrice}>
                {transaction.price.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} {transaction.currency}
              </Text>
              <View style={styles.tableTotal}>
                <Text style={styles.tableTotalText}>{formatMoney(total * transaction.fxToEur)}</Text>
                <Pencil size={10} color={colors.muted} />
              </View>
            </View>
          </Pressable>
        );
      })}
      {!transactions.length ? <Text style={styles.emptyTable}>{t('Zatiaľ nemáš zaznamenané žiadne pohyby.')}</Text> : null}
    </Surface>
  );
}

export default function PositionDetailScreen() {
  const { symbol: symbolParam } = useLocalSearchParams<{ symbol: string }>();
  const symbol = Array.isArray(symbolParam) ? symbolParam[0] : symbolParam;
  const router = useRouter();
  const { positions, loading, saveTransaction, deleteTransaction } = usePositions();
  const { t, language } = useLocale();
  const heldPosition = positions.find((item) => item.symbol === symbol);
  const asset = availableAssets.find((item) => item.symbol === symbol) ?? (
    symbol && /^[A-Z0-9.^=-]{1,20}$/.test(symbol)
      ? { symbol, name: symbol, price: 0, change: 0, color: colors.violet }
      : undefined
  );
  const [marketQuote, setMarketQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [range, setRange] = useState<RangeLabel>('1D');
  const [formVisible, setFormVisible] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [stats, setStats] = useState<KeyStats | null>(null);
  const [events, setEvents] = useState<CompanyEvents | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setInfoLoading(true);
    setStats(null);
    setEvents(null);
    Promise.allSettled([fetchKeyStats(symbol), fetchCompanyEvents(symbol)]).then(([s, e]) => {
      if (!active) return;
      if (s.status === 'fulfilled') setStats(s.value);
      if (e.status === 'fulfilled') setEvents(e.value);
      setInfoLoading(false);
    });
    return () => { active = false; };
  }, [symbol]);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [initialType, setInitialType] = useState<'BUY' | 'SELL'>('BUY');

  useEffect(() => {
    if (heldPosition || !symbol || !asset) return;
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
  }, [asset, heldPosition, symbol]);

  const position = heldPosition ?? (asset ? createAssetPosition(asset, marketQuote) : undefined);
  const currentValue = position ? positionValueEUR(position) : 0;
  const openCost = position ? positionCostEUR(position) : 0;
  const unrealized = currentValue - openCost;
  const totalResult = unrealized + (position?.realizedProfitEUR ?? 0);

  const addTransaction = (type: 'BUY' | 'SELL') => {
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
            Alert.alert(t('Transakcia sa neodstránila'), error instanceof Error ? error.message : String(error));
          });
        },
      },
    ]);
  };

  const save = (input: TransactionInput, id?: string, quote?: Parameters<typeof saveTransaction>[2]) =>
    saveTransaction(input, id, quote);

  if (loading && !position && !asset) {
    return (
      <Page>
        <Header title={t('Pozícia')} action={<Pressable onPress={() => router.back()}><ArrowLeft size={20} color={colors.text} /></Pressable>} />
        <Surface style={styles.loadingCard}><ActivityIndicator color={colors.green} /></Surface>
      </Page>
    );
  }

  if (!position || !symbol) {
    return (
      <Page>
        <Header title={t('Pozícia')} action={<Pressable onPress={() => router.back()}><ArrowLeft size={20} color={colors.text} /></Pressable>} />
          <Surface style={styles.loadingCard}><Text style={styles.emptyTable}>{t('Pozíciu sa nepodarilo nájsť.')}</Text></Surface>
      </Page>
    );
  }

  return (
    <Page>
      <Header
        title={position.symbol}
        subtitle={position.name}
        action={
          <View style={styles.detailHeader}>
            <AssetLogo symbol={position.symbol} color={position.color} size={42} />
            <Pressable accessibilityLabel={t('Späť na portfólio')} onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={18} color={colors.text} />
            </Pressable>
          </View>
        }
      />

      <View style={styles.actionRow}>
        <View style={styles.priceSummary}>
          <Text style={styles.currentPrice}>
            {position.currentPrice > 0
              ? `${position.currentPrice.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} ${position.currency}`
              : quoteError ? t('Cena nedostupná') : heldPosition ? t('Cena nedostupná') : t('Načítavam cenu…')}
          </Text>
          <Text style={styles.summaryCaption}>
            {heldPosition
              ? `${position.shares.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')} ${t('ks · hodnota')} ${formatMoney(currentValue)}`
              : quoteError || t('Akcia zatiaľ nie je v tvojom portfóliu')}
          </Text>
        </View>
        <Pressable accessibilityLabel={t('Pridať nákup')} onPress={() => addTransaction('BUY')} style={styles.buyButton}>
          <Plus size={14} color={colors.surface} />
          <Text style={styles.buyButtonText}>{t('Nákup')}</Text>
        </Pressable>
        {heldPosition ? (
          <Pressable accessibilityLabel={t('Pridať predaj')} onPress={() => addTransaction('SELL')} style={styles.sellButton}>
            <Plus size={14} color={colors.red} />
            <Text style={styles.sellButtonText}>{t('Predaj')}</Text>
          </Pressable>
        ) : null}
      </View>

      {heldPosition ? (
        <View style={styles.resultsRow}>
          <Surface style={styles.resultCard}>
            <Text style={styles.resultCaption}>{t('Nerealizovaný výnos')}</Text>
            <Text style={[styles.resultAmount, { color: unrealized >= 0 ? colors.green : colors.red }]}>
              {unrealized >= 0 ? '+' : ''}{formatMoney(unrealized)}
            </Text>
          </Surface>
          <Surface style={styles.resultCard}>
            <Text style={styles.resultCaption}>{t('Celkový výsledok')}</Text>
            <Text style={[styles.resultAmount, { color: totalResult >= 0 ? colors.green : colors.red }]}>
              {totalResult >= 0 ? '+' : ''}{formatMoney(totalResult)}
            </Text>
          </Surface>
        </View>
      ) : null}

      <SectionTitle title={t('Vývoj ceny akcie')} />
      <StockChart position={position} range={range} onRangeChange={setRange} />

      <SectionTitle title={t('Ukazovatele')} />
      <Surface style={styles.statsCard}>
        {infoLoading ? <ActivityIndicator color={colors.green} /> : (
          <View style={styles.statsGrid}>
            {([
              ['EPS', stats?.eps != null ? stats.eps.toFixed(2) : '–'],
              ['P/E', stats?.pe != null ? stats.pe.toFixed(1) : '–'],
              ['Forward P/E', stats?.forwardPE != null ? stats.forwardPE.toFixed(1) : '–'],
              [t('Dividend yield'), stats?.dividendYield != null ? `${(stats.dividendYield * 100).toFixed(2)} %` : '–'],
              [t('Trhová kapitalizácia'), stats?.marketCap != null ? formatBigNumber(stats.marketCap) : '–'],
            ] as const).map(([label, value]) => (
              <View key={label} style={styles.statItem}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            ))}
          </View>
        )}
      </Surface>

      <SectionTitle title={t('Earnings reporty')} />
      <Surface style={styles.statsCard}>
        {infoLoading ? <ActivityIndicator color={colors.green} /> : (
          <>
            {events?.nextEarnings ? (
              <View style={styles.reportRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportTitle}>{t('Budúci report')}</Text>
                  <Text style={styles.reportSub}>
                    {new Date(events.nextEarnings.date * 1000).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US')}
                    {events.nextEarnings.estimate ? ` (${t('odhad')})` : ''}
                  </Text>
                </View>
                <View style={styles.reportRight}>
                  <Text style={styles.reportValue}>
                    {events.nextEarnings.epsEstimate != null ? `EPS ${events.nextEarnings.epsEstimate.toFixed(2)}` : '–'}
                  </Text>
                  <Text style={styles.reportSub}>
                    {events.nextEarnings.revenueEstimate != null
                      ? `${t('Tržby')} ${formatBigNumber(events.nextEarnings.revenueEstimate)}` : `${t('Tržby')} –`}
                  </Text>
                </View>
              </View>
            ) : null}
            {(events?.quarters ?? []).slice(0, 4).map((quarter) => {
              const beat = quarter.epsActual != null && quarter.epsEstimate != null
                ? quarter.epsActual >= quarter.epsEstimate : null;
              return (
                <View key={quarter.periodEnd} style={styles.reportRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reportTitle}>{quarter.label}</Text>
                    <Text style={styles.reportSub}>
                      {quarter.epsEstimate != null ? `${t('Odhad')} ${quarter.epsEstimate.toFixed(2)}` : t('Odhad nedostupný')}
                    </Text>
                  </View>
                  <View style={styles.reportRight}>
                    <Text style={[styles.reportValue, beat != null && { color: beat ? colors.green : colors.red }]}>
                      {quarter.epsActual != null ? `EPS ${quarter.epsActual.toFixed(2)}` : '–'}
                    </Text>
                    <Text style={styles.reportSub}>
                      {`${t('Tržby')} ${quarter.revenue != null ? formatBigNumber(quarter.revenue) : '–'}`}
                      {quarter.revenueYoY != null
                        ? ` · ${quarter.revenueYoY >= 0 ? '+' : ''}${quarter.revenueYoY.toFixed(1)} % YoY`
                        : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
            {!events?.nextEarnings && !(events?.quarters?.length) ? (
              <Text style={styles.emptyTable}>{t('Žiadne reporty')}</Text>
            ) : null}
          </>
        )}
      </Surface>

      {heldPosition ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: movementsOpen }}
            onPress={() => setMovementsOpen(!movementsOpen)}
            style={styles.movementsToggle}
          >
            <Text style={styles.movementsTitle}>{t('Moje pohyby')}</Text>
            <Text style={styles.transactionCount}>{formatTransactionCount(position.transactions.length, language)}</Text>
            {movementsOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
          </Pressable>
          {movementsOpen ? <TransactionTable transactions={position.transactions} onEdit={editTransaction} /> : null}
        </>
      ) : null}

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
    </Page>
  );
}

const styles = StyleSheet.create({
  detailHeader: { flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  priceSummary: { flex: 1 },
  currentPrice: { color: colors.text, fontSize: 20, fontWeight: '900' },
  summaryCaption: { color: colors.muted, fontSize: 9, marginTop: 4 },
  buyButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, backgroundColor: colors.green },
  buyButtonText: { color: colors.surface, fontSize: 10, fontWeight: '900' },
  sellButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,90,98,0.12)' },
  sellButtonText: { color: colors.red, fontSize: 10, fontWeight: '900' },
  resultsRow: { flexDirection: 'row', gap: 8, marginBottom: 3 },
  resultCard: { flex: 1, padding: 12, marginBottom: 4 },
  resultCaption: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  resultAmount: { fontSize: 13, fontWeight: '900', marginTop: 5 },
  chartCard: { padding: 14 },
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
  chartLabel: { color: colors.muted, fontSize: 8 },
  chartHint: { color: colors.muted, fontSize: 8, textAlign: 'center', flex: 1 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rangeButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 6 },
  rangeButtonSelected: { backgroundColor: colors.green },
  rangeText: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  rangeTextSelected: { color: colors.surface },
  transactionCount: { color: colors.muted, fontSize: 10, fontWeight: '700', marginRight: 8 },
  movementsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  movementsTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  tableCard: { paddingHorizontal: 10, paddingVertical: 6 },
  tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableHeading: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  tableRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 7, paddingHorizontal: 3 },
  dateColumn: { flex: 1.15 },
  typeColumn: { flex: 0.95 },
  sharesColumn: { flex: 0.65, textAlign: 'right' },
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
  statItem: { width: '33.33%', paddingVertical: 6 },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  statValue: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 3 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  reportTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  reportSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
  reportRight: { alignItems: 'flex-end' },
  reportValue: { color: colors.text, fontSize: 12, fontWeight: '900' },
  emptyTable: { color: colors.muted, fontSize: 10, textAlign: 'center', paddingVertical: 20 },
  loadingCard: { alignItems: 'center', padding: 22 },
});
