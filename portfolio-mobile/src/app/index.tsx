import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Settings, TrendingUp, Wallet } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { TransactionModal } from '../components/transaction-modal';
import {
  Header,
  Page,
  PositionRow,
  SectionTitle,
  Surface,
} from '../components/finapp';
import { colors, formatMoney, formatPercent } from '../data/portfolio';
import { Transaction, TransactionInput, positionCostEUR, positionValueEUR, usePositions } from '../hooks/use-positions';
import { useLocale } from '../context/locale';
import { fetchHistoricalQuoteSeries, HistoricalQuotePoint, HistoricalQuoteSeries, LiveQuote } from '../data/quotes';

const HIDE_AMOUNTS_KEY = '@portfolio-mobile/hide-amounts';

const chartRanges = [
  { label: '1D', days: 1 },
  { label: '1T', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1R', days: 365 },
  { label: '3R', days: 1095 },
  { label: '5R', days: 1825 },
  { label: 'YTD', days: 'ytd' },
  { label: 'Všetko', days: null },
] as const;

type ChartRange = (typeof chartRanges)[number]['label'];

type PortfolioHistoryPoint = {
  timestamp: number;
  date: string;
  value: number;
  gainEUR: number;
  returnPercent: number;
  positionReturns: Record<string, { gainEUR: number; returnPercent: number }>;
};

function getRangeStart(range: ChartRange, transactions: Transaction[]) {
  const selected = chartRanges.find((item) => item.label === range) ?? chartRanges[2];
  if (selected.days === null) {
    const earliest = transactions.reduce(
      (date, transaction) => transaction.date < date ? transaction.date : date,
      transactions[0]?.date ?? new Date().toISOString().slice(0, 10),
    );
    return earliest;
  }
  if (selected.days === 'ytd') return `${new Date().getFullYear()}-01-01`;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - selected.days);
  return date.toISOString().slice(0, 10);
}

function latestPointAt(points: HistoricalQuotePoint[], timestamp: number) {
  let low = 0;
  let high = points.length - 1;
  let result: HistoricalQuotePoint | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp <= timestamp) {
      result = points[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function createPortfolioHistory(
  transactions: Transaction[],
  series: HistoricalQuoteSeries[],
  fxSeries: HistoricalQuotePoint[],
  rangeStart: string,
  rangeStartTimestamp?: number,
): PortfolioHistoryPoint[] {
  const seriesBySymbol = new Map(series.map((item) => [item.symbol, item]));
  const timestamps = [...new Set(series.flatMap((item) => item.points.map((point) => point.timestamp)))].sort((a, b) => a - b);
  const orderedTransactions = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let previousValue: number | undefined;
  let previousDate = '';
  let periodGain = 0;
  let periodGrowth = 1;
  const previousPositionValues = new Map<string, number>();
  const positionGains = new Map(transactions.map((transaction) => [transaction.symbol, 0]));
  const positionGrowth = new Map(transactions.map((transaction) => [transaction.symbol, 1]));

  return timestamps.map((timestamp) => {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const quantities = new Map<string, number>();
    for (const transaction of orderedTransactions) {
      if (transaction.date > date) break;
      const current = quantities.get(transaction.symbol) ?? 0;
      quantities.set(transaction.symbol, current + (transaction.type === 'BUY' ? transaction.shares : -transaction.shares));
    }

    let value = 0;
    const positionValues = new Map<string, number>();
    for (const [symbol, shares] of quantities) {
      if (shares <= 1e-8) continue;
      const quoteSeries = seriesBySymbol.get(symbol);
      const quote = quoteSeries ? latestPointAt(quoteSeries.points, timestamp) : undefined;
      if (!quote || !quoteSeries) {
        throw new Error(`Historická cena pre ${symbol} nie je dostupná k ${date}.`);
      }
      let fxToEur = 1;
      if (quoteSeries.currency === 'USD') {
        const fxPoint = latestPointAt(fxSeries, timestamp);
        if (!fxPoint) throw new Error(`Historický kurz USD/EUR nie je dostupný k ${date}.`);
        fxToEur = 1 / fxPoint.price;
      }
      const positionValue = shares * quote.price * fxToEur;
      value += positionValue;
      positionValues.set(symbol, positionValue);
    }

    let dailyProfit = 0;
    let dailyReturn = 0;
    if (previousValue !== undefined && (rangeStartTimestamp !== undefined
      ? timestamp >= rangeStartTimestamp
      : date >= rangeStart)) {
      const cashFlows = new Map<string, number>();
      const buyFlows = new Map<string, number>();
      for (const transaction of orderedTransactions) {
        if (transaction.date > date) break;
        if (transaction.date <= previousDate) continue;
        const flow = (transaction.type === 'BUY' ? 1 : -1) *
          transaction.shares * transaction.price * transaction.fxToEur;
        cashFlows.set(transaction.symbol, (cashFlows.get(transaction.symbol) ?? 0) + flow);
        if (transaction.type === 'BUY') {
          buyFlows.set(transaction.symbol, (buyFlows.get(transaction.symbol) ?? 0) + flow);
        }
      }
      const cashFlow = [...cashFlows.values()].reduce((sum, flow) => sum + flow, 0);
      const buyFlow = [...buyFlows.values()].reduce((sum, flow) => sum + flow, 0);
      dailyProfit = value - (previousValue ?? 0) - cashFlow;
      const returnBase = previousValue && previousValue > 0
        ? previousValue
        : buyFlow;
      dailyReturn = returnBase > 0 ? dailyProfit / returnBase : 0;
      periodGain += dailyProfit;
      periodGrowth *= 1 + dailyReturn;
      for (const symbol of new Set([...previousPositionValues.keys(), ...positionValues.keys(), ...cashFlows.keys()])) {
        const previousPositionValue = previousPositionValues.get(symbol) ?? 0;
        const currentPositionValue = positionValues.get(symbol) ?? 0;
        const positionCashFlow = cashFlows.get(symbol) ?? 0;
        const positionBuyFlow = buyFlows.get(symbol) ?? 0;
        const positionGain = currentPositionValue - previousPositionValue - positionCashFlow;
        const positionReturnBase = previousPositionValue > 0
          ? previousPositionValue
          : positionBuyFlow;
        positionGains.set(symbol, (positionGains.get(symbol) ?? 0) + positionGain);
        if (positionReturnBase > 0) {
          positionGrowth.set(
            symbol,
            (positionGrowth.get(symbol) ?? 1) * (1 + positionGain / positionReturnBase),
          );
        }
      }
    }
    previousPositionValues.clear();
    for (const [symbol, positionValue] of positionValues) previousPositionValues.set(symbol, positionValue);
    previousValue = value;
    previousDate = date;
    return {
      timestamp,
      date,
      value,
      gainEUR: periodGain,
      returnPercent: (periodGrowth - 1) * 100,
      positionReturns: Object.fromEntries([...positionGains.entries()].map(([symbol, gainEUR]) => [
        symbol,
        { gainEUR, returnPercent: ((positionGrowth.get(symbol) ?? 1) - 1) * 100 },
      ])),
    };
  });
}

function InvestmentTimeline({
  transactions,
  range,
  onRangeChange,
  onPositionReturnsChange,
  currentValue,
  hideAmounts,
}: {
  transactions: Transaction[];
  range: ChartRange;
  onRangeChange: (value: ChartRange) => void;
  onPositionReturnsChange: (returns: Record<string, { gainEUR: number; returnPercent: number }>) => void;
  currentValue: number;
  hideAmounts: boolean;
}) {
  const { t, language } = useLocale();
  const money = (value: number) => (hideAmounts ? '•••••' : formatMoney(value));
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const rangeStart = getRangeStart(range, transactions);
  const rangeStartTimestamp = useMemo(
    () => range === '1D' ? Math.floor(Date.now() / 1000) - 24 * 60 * 60 : undefined,
    [range],
  );

  useEffect(() => {
    let active = true;
    if (!transactions.length) {
      setHistory([]);
      setHistoryError('');
      setLoadingHistory(false);
      setSelectedIndex(null);
      return () => { active = false; };
    }

    const rangeStartDate = new Date(`${rangeStart}T00:00:00.000Z`);
    rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - (range === '1D' ? 5 : 7));
    const queryStart = rangeStartDate.toISOString().slice(0, 10);
    const interval = range === '1D' ? '5m' : range === '5R' || range === 'Všetko' ? '1wk' : '1d';
    const symbols = [...new Set(transactions.map((transaction) => transaction.symbol))];
    setLoadingHistory(true);
    setHistoryError('');
    setSelectedIndex(null);

    Promise.all(symbols.map((symbol) => fetchHistoricalQuoteSeries(symbol, queryStart, interval)))
      .then(async (series) => {
        const needsFx = series.some((item) => item.currency === 'USD');
        const fx = needsFx
          ? await fetchHistoricalQuoteSeries('EURUSD=X', queryStart, interval)
          : undefined;
        if (needsFx && fx?.currency !== 'USD') {
          throw new Error('Historický menový kurz USD/EUR nie je dostupný.');
        }
        return createPortfolioHistory(
          transactions,
          series,
          fx?.points ?? [],
          rangeStart,
          rangeStartTimestamp,
        );
      })
      .then((points) => {
        if (active) {
          setHistory(points.filter((point) =>
            rangeStartTimestamp !== undefined
              ? point.timestamp >= rangeStartTimestamp
              : point.date >= rangeStart));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setHistory([]);
          setHistoryError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });

    return () => { active = false; };
  }, [transactions, range, rangeStart, rangeStartTimestamp]);

  const selectedRangeLabel = range === '1T'
    ? t('1 týždeň')
    : range === 'Všetko'
      ? t('celé obdobie')
      : range;
  const values = history.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const rangeValue = max - min || 1;
  const points = history.map((point, index) => ({
    x: history.length === 1 ? 160 : 8 + (index / (history.length - 1)) * 296,
    y: 122 - ((point.value - min) / rangeValue) * 98,
  }));
  const path = points.reduce((result, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    return `${result} L ${point.x} ${point.y}`;
  }, '');
  const labels = history.length > 1
    ? [history[0].date, history[Math.floor(history.length / 2)].date, history[history.length - 1].date]
    : [];
  const monthLabel = (point: PortfolioHistoryPoint) => range === '1D'
    ? new Date(point.timestamp * 1000).toLocaleTimeString(language === 'sk' ? 'sk-SK' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
    : new Date(`${point.date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
      day: 'numeric',
      month: 'short',
    });
  const selectedPoint = selectedIndex !== null
    ? history[Math.min(selectedIndex, history.length - 1)]
    : history[history.length - 1];
  const displayedValue = selectedPoint?.value ?? currentValue;
  const displayedGain = selectedPoint?.gainEUR ?? 0;
  const displayedReturn = selectedPoint?.returnPercent ?? 0;
  useEffect(() => {
    onPositionReturnsChange(selectedPoint?.positionReturns ?? {});
  }, [onPositionReturnsChange, selectedPoint]);
  const updateSelectedPoint = (locationX: number) => {
    if (!history.length || chartWidth <= 0) return;
    const normalized = Math.min(1, Math.max(0, locationX / chartWidth));
    setSelectedIndex(Math.round(normalized * (history.length - 1)));
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      history.length > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
    onPanResponderGrant: (event) => updateSelectedPoint(event.nativeEvent.locationX),
    onPanResponderMove: (event) => updateSelectedPoint(event.nativeEvent.locationX),
    onPanResponderTerminate: () => setSelectedIndex(null),
  }), [history, chartWidth]);

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartTitle}>{t('Hodnota portfólia')}</Text>
          <Text style={styles.chartSubtitle}>
            {selectedPoint
              ? range === '1D'
                ? new Date(selectedPoint.timestamp * 1000).toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')
                : new Date(`${selectedPoint.date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US')
              : `${t('Výnos za')} ${selectedRangeLabel}`}
          </Text>
        </View>
        <View style={styles.chartMetrics}>
          <Text style={styles.chartTotal}>{money(displayedValue)}</Text>
          {!historyError ? (
            <Text style={[styles.chartReturn, { color: displayedGain >= 0 ? colors.green : colors.red }]}>
              {formatPercent(displayedReturn)}{hideAmounts ? '' : ` · ${displayedGain >= 0 ? '+' : ''}${formatMoney(displayedGain)}`}
            </Text>
          ) : null}
        </View>
      </View>
      <View
        {...panResponder.panHandlers}
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        style={styles.chartWrap}
      >
        <Svg width="100%" height={185} viewBox="0 0 320 145" preserveAspectRatio="none">
          <Line x1="8" y1="126" x2="312" y2="126" stroke={colors.border} strokeWidth="1" />
          <Line x1="8" y1="18" x2="8" y2="126" stroke={colors.border} strokeWidth="1" />
          {path ? <Path d={path} fill="none" stroke={colors.green} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {selectedPoint && points[selectedIndex ?? points.length - 1] ? (
            <>
              <Line
                x1={points[selectedIndex ?? points.length - 1].x}
                y1="18"
                x2={points[selectedIndex ?? points.length - 1].x}
                y2="126"
                stroke={colors.muted}
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              <Circle
                cx={points[selectedIndex ?? points.length - 1].x}
                cy={points[selectedIndex ?? points.length - 1].y}
                r="5"
                fill={colors.green}
                stroke={colors.background}
                strokeWidth="2"
              />
            </>
          ) : null}
        </Svg>
        <View style={styles.chartLabels}>
          {labels.map((date, index) => (
            <Text key={`${date}-${index}`} style={styles.chartLabel}>
              {monthLabel(history[index === 0 ? 0 : index === 1 ? Math.floor(history.length / 2) : history.length - 1])}
            </Text>
          ))}
          {!labels.length && !loadingHistory && !historyError ? (
            <Text style={styles.chartEmptyLabel}>
              {transactions.length
                ? t('Pre toto obdobie nemáme historické kotácie.')
                : t('Po pridaní transakcií sa zobrazí história portfólia.')}
            </Text>
          ) : null}
          {loadingHistory ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </View>
      </View>
      {historyError ? (
        <Text accessibilityRole="alert" style={styles.chartError}>{historyError}</Text>
      ) : null}
      {history.length ? (
        <Text style={styles.chartHint}>{t('Potiahni prstom po grafe pre zobrazenie hodnoty a výnosu v daný deň.')}</Text>
      ) : null}
      <View style={styles.rangeRow}>
        {chartRanges.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: range === item.label }}
            onPress={() => onRangeChange(item.label)}
            style={[styles.rangeButton, range === item.label && styles.rangeButtonSelected]}
          >
            <Text style={[styles.rangeText, range === item.label && styles.rangeTextSelected]}>
              {item.label === '1T' && language === 'en'
                ? '1W'
                : item.label === 'Všetko'
                  ? t(item.label)
                  : item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function PortfolioScreen() {
  const router = useRouter();
  const {
    positions,
    transactions,
    loading,
    saveTransaction,
  } = usePositions();
  const [formVisible, setFormVisible] = useState(false);
  const [initialType, setInitialType] = useState<'BUY' | 'SELL'>('BUY');
  const [range, setRange] = useState<ChartRange>('3M');
  const [positionSort, setPositionSort] = useState<'value' | 'alphabetical'>('value');
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [periodReturns, setPeriodReturns] = useState<Record<string, { gainEUR: number; returnPercent: number }>>({});
  const { t, language } = useLocale();
  const [hideAmounts, setHideAmounts] = useState(false);
  const money = (value: number) => (hideAmounts ? '•••••' : formatMoney(value));
  const signedMoney = (value: number) => (hideAmounts ? '•••••' : `${value >= 0 ? '+' : ''}${formatMoney(value)}`);

  useEffect(() => {
    AsyncStorage.getItem(HIDE_AMOUNTS_KEY)
      .then((saved) => setHideAmounts(saved === 'true'))
      .catch(() => undefined);
  }, []);

  const toggleHideAmounts = () => {
    const next = !hideAmounts;
    setHideAmounts(next);
    AsyncStorage.setItem(HIDE_AMOUNTS_KEY, String(next)).catch(() => undefined);
  };

  const totals = useMemo(() => positions.reduce(
    (result, position) => {
      result.value += positionValueEUR(position);
      result.openCost += positionCostEUR(position);
      result.invested += position.totalInvestedEUR;
      if (position.shares > 1e-8) result.openInvested += position.totalInvestedEUR;
      result.realized += position.realizedProfitEUR;
      return result;
    },
    { value: 0, openCost: 0, invested: 0, openInvested: 0, realized: 0 },
  ), [positions]);
  const unrealized = totals.value - totals.openCost;
  const totalReturn = unrealized + totals.realized;
  const returnPercent = totals.invested > 0 ? totalReturn / totals.invested * 100 : 0;
  const activePositions = useMemo(
    () => positions
      .filter((position) => position.shares > 1e-8)
      .sort((a, b) => positionSort === 'value'
        ? positionValueEUR(b) - positionValueEUR(a)
        : a.name.localeCompare(b.name, 'sk')),
    [positions, positionSort],
  );
  const closedPositions = useMemo(
    () => positions
      .filter((position) => position.shares <= 1e-8)
      .sort((a, b) => positionSort === 'value'
        ? positionValueEUR(b) - positionValueEUR(a)
        : a.name.localeCompare(b.name, 'sk')),
    [positions, positionSort],
  );
  const dailyGain = positions.reduce((sum, position) => {
    const dailyReturn = position.dailyChangePct;
    const previousValue = positionValueEUR(position) / (1 + dailyReturn / 100);
    return sum + (position.hasMarketQuote ? positionValueEUR(position) - previousValue : 0);
  }, 0);
  const dailyPercent = totals.value - dailyGain > 0 ? dailyGain / (totals.value - dailyGain) * 100 : 0;
  const latestQuote = positions
    .filter((position) => position.hasMarketQuote)
    .map((position) => position.updatedAt)
    .sort()
    .at(-1);
  const headlineGain = latestQuote ? dailyGain : totalReturn;
  const headlinePercent = latestQuote ? dailyPercent : returnPercent;

  const openNewTransaction = (type: 'BUY' | 'SELL' = 'BUY') => {
    setInitialType(type);
    setFormVisible(true);
  };

  const openPositionDetails = (symbol: string) =>
    router.push({ pathname: '/position', params: { symbol } });
  const handleSaveTransaction = (input: TransactionInput, id?: string, quote?: LiveQuote) =>
    saveTransaction(input, id, quote);

  return (
    <Page>
      <Header
        title={t('Moje portfólio')}
        subtitle={t('Prehľad investícií')}
        action={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel={hideAmounts
                ? (language === 'sk' ? 'Zobraziť sumy' : 'Show amounts')
                : (language === 'sk' ? 'Skryť sumy' : 'Hide amounts')}
              accessibilityRole="button"
              onPress={toggleHideAmounts}
              style={styles.iconButton}
            >
              {hideAmounts ? <EyeOff size={18} color={colors.green} /> : <Eye size={18} color={colors.green} />}
            </Pressable>
            <Pressable
              accessibilityLabel={t('Nastavenia aplikácie')}
              accessibilityRole="button"
              onPress={() => router.navigate('/settings')}
              style={styles.iconButton}
            >
              <Settings size={18} color={colors.green} />
            </Pressable>
          </View>
        }
      />
      <Surface style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>{t('Trhová hodnota')}</Text>
        <Text style={styles.balanceValue}>{money(totals.value)}</Text>
        <View style={styles.returnRow}>
          <Text style={styles.headlineHint}>{latestQuote ? t('Denná zmena') : t('Celkový výnos')}</Text>
          <View style={styles.returnIndicator}>
            {headlineGain >= 0 ? <TrendingUp size={16} color={colors.green} /> : null}
            <Text style={[styles.returnPercent, { color: headlineGain >= 0 ? colors.green : colors.red }]}>
              {formatPercent(headlinePercent)}
            </Text>
          </View>
          <Text style={[styles.returnAmount, { color: headlineGain >= 0 ? colors.green : colors.red }]}>
            {hideAmounts ? '' : signedMoney(headlineGain)}
          </Text>
        </View>
        <View style={styles.balanceDivider} />
        <View style={styles.balanceStats}>
          <View style={styles.balanceStat}>
            <Text style={styles.statLabel}>{t('Celkovo nakúpené')}</Text>
            <Text style={styles.statValue}>{money(totals.openCost)}</Text>
          </View>
          <View style={styles.balanceStat}>
            <Text style={styles.statLabel}>{t('Celkový výnos')}</Text>
            <Text style={[styles.statValue, { color: totalReturn >= 0 ? colors.green : colors.red }]}>
              {hideAmounts ? '' : `${signedMoney(totalReturn)} (`}{formatPercent(returnPercent)}{hideAmounts ? '' : ')'}
            </Text>
          </View>
        </View>
        <View style={[styles.balanceStats, { marginTop: 10 }]}>
          <View style={styles.balanceStat}>
            <Text style={styles.statLabel}>{t('Nerealizovaný výnos')}</Text>
            <Text style={[styles.statValue, { color: unrealized >= 0 ? colors.green : colors.red }]}>
              {signedMoney(unrealized)}
            </Text>
          </View>
          <View style={styles.balanceStat}>
            <Text style={styles.statLabel}>{t('Realizovaný výnos')}</Text>
            <Text style={[styles.statValue, { color: totals.realized >= 0 ? colors.green : colors.red }]}>
              {signedMoney(totals.realized)}
            </Text>
          </View>
        </View>
        {latestQuote ? (
          <Text style={styles.lastUpdated}>
            {language === 'sk' ? 'Trhové ceny aktualizované ' : 'Market prices updated '}
            {new Date(latestQuote).toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US')}
          </Text>
        ) : null}
      </Surface>

      <InvestmentTimeline
        transactions={transactions}
        range={range}
        onRangeChange={setRange}
        onPositionReturnsChange={setPeriodReturns}
        currentValue={totals.value}
        hideAmounts={hideAmounts}
      />

      <SectionTitle
        title={t('Moje pozície')}
        action={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Pridať akciu a transakciu')}
            onPress={() => openNewTransaction('BUY')}
            hitSlop={8}
            style={styles.addPositionButton}
          >
            <Plus size={18} color={colors.green} />
          </Pressable>
        )}
      />

      {positions.length ? (
        <View style={styles.sortControl}>
          <Text style={styles.sortLabel}>{t('Zoradiť')}</Text>
          <View style={styles.sortOptions}>
            {([
              { key: 'value', label: t('Hodnota') },
              { key: 'alphabetical', label: t('A–Z') },
            ] as const).map((option) => {
              const selected = positionSort === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setPositionSort(option.key)}
                  style={[styles.sortButton, selected && styles.sortButtonSelected]}
                >
                  <Text style={[styles.sortButtonText, selected && styles.sortButtonTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {loading ? (
        <Surface style={styles.emptyCard}>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.emptyDescription}>{t('Načítavam tvoje pozície…')}</Text>
        </Surface>
      ) : activePositions.length ? (
        <Surface style={styles.assetsCard}>
          {activePositions.map((position) => (
            <PositionRow
              key={position.id}
              position={position}
              hideAmounts={hideAmounts}
              performance={range === 'Všetko' ? undefined : periodReturns[position.symbol]}
              onPress={() => openPositionDetails(position.symbol)}
            />
          ))}
        </Surface>
      ) : (
        <Surface style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Wallet size={23} color={colors.green} />
          </View>
          <Text style={styles.emptyTitle}>
            {closedPositions.length
              ? language === 'sk' ? 'Momentálne nemáš otvorené pozície' : 'You have no open positions'
              : t('Tvoje portfólio čaká na prvú pozíciu')}
          </Text>
          <Text style={styles.emptyDescription}>
            {closedPositions.length
              ? language === 'sk'
                ? 'Predané pozície nájdeš nižšie v sekcii Zatvorené pozície. Ich výsledok zostáva započítaný.'
                : 'Find sold positions below in Closed positions. Their result is still included.'
              : t('Pridaj skutočné nákupy. Každý pohyb sa uloží samostatne a portfólio zobrazí každú akciu iba raz.')}
          </Text>
          <Pressable onPress={() => openNewTransaction('BUY')} style={styles.emptyButton}>
            <Plus size={16} color={colors.surface} />
            <Text style={styles.emptyButtonText}>{closedPositions.length ? t('Pridať nákup') : t('Pridať prvý nákup')}</Text>
          </Pressable>
        </Surface>
      )}

      {closedPositions.length > 0 ? (
        <View style={styles.closedSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: closedExpanded }}
            onPress={() => setClosedExpanded((expanded) => !expanded)}
            style={styles.closedToggle}
          >
            <View>
              <Text style={styles.closedTitle}>{t('Zatvorené pozície')}</Text>
              <Text style={styles.closedSubtitle}>{closedPositions.length} predaných titulov · výnos je v celkovom výsledku</Text>
            </View>
            <View style={styles.closedToggleRight}>
              <Text style={styles.closedCount}>{closedPositions.length}</Text>
              {closedExpanded
                ? <ChevronUp size={18} color={colors.muted} />
                : <ChevronDown size={18} color={colors.muted} />}
            </View>
          </Pressable>
          {closedExpanded ? (
            <Surface style={styles.assetsCard}>
              {closedPositions.map((position) => (
                <PositionRow
                  key={position.id}
                  position={position}
                  hideAmounts={hideAmounts}
                  performance={periodReturns[position.symbol]}
                  onPress={() => openPositionDetails(position.symbol)}
                />
              ))}
            </Surface>
          ) : null}
        </View>
      ) : null}

      {activePositions.length > 0 ? (
        <Text style={styles.hint}>
          Ťukni na akciu a zobraz jej graf aj kompletnú históriu nákupov a predajov.
        </Text>
      ) : null}

      <Pressable
        accessibilityLabel={t('Pridať akciu a transakciu')}
        accessibilityRole="button"
        onPress={() => openNewTransaction('BUY')}
        style={styles.floatingAdd}
      >
        <Plus size={23} color={colors.surface} />
      </Pressable>

      <TransactionModal
        visible={formVisible}
        initialType={initialType}
        onClose={() => setFormVisible(false)}
        onSave={handleSaveTransaction}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    width: 39, height: 39, borderRadius: 13, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  balanceCard: { borderRadius: 29, padding: 21, alignItems: 'center', marginBottom: 13 },
  balanceLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  balanceValue: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: 0.2, marginTop: 5 },
  returnRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 },
  headlineHint: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  returnIndicator: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  returnPercent: { fontSize: 13, fontWeight: '900' },
  returnAmount: { fontSize: 13, fontWeight: '800' },
  balanceDivider: { width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 13 },
  balanceStats: { width: '100%', flexDirection: 'row' },
  balanceStat: { flex: 1 },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 5 },
  lastUpdated: { alignSelf: 'flex-start', color: colors.muted, fontSize: 9, marginTop: 12 },
  chartCard: { marginHorizontal: 2, marginTop: 4, marginBottom: 4 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  chartTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  chartSubtitle: { color: colors.muted, fontSize: 9, marginTop: 3 },
  chartMetrics: { alignItems: 'flex-end' },
  chartTotal: { color: colors.text, fontSize: 14, fontWeight: '900' },
  chartReturn: { fontSize: 9, fontWeight: '800', marginTop: 4 },
  chartWrap: { marginTop: 6 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, marginTop: -4, minHeight: 18 },
  chartLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },
  chartEmptyLabel: { color: colors.muted, fontSize: 9, textAlign: 'center', flex: 1 },
  chartError: { color: colors.red, fontSize: 9, lineHeight: 14, marginTop: 3 },
  chartHint: { color: colors.muted, fontSize: 8, marginTop: 3 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rangeButton: { paddingVertical: 8, paddingHorizontal: 7, borderRadius: 999 },
  rangeButtonSelected: { backgroundColor: colors.green },
  rangeText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  rangeTextSelected: { color: colors.surface },
  closedSection: { marginTop: 8 },
  closedToggle: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  closedTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
  closedSubtitle: { color: colors.muted, fontSize: 8, marginTop: 4 },
  closedToggleRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closedCount: { color: colors.green, fontSize: 11, fontWeight: '900' },
  addPositionButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  sortControl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sortLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  sortOptions: { flexDirection: 'row', gap: 5, padding: 3, borderRadius: 11, backgroundColor: colors.surface },
  sortButton: { minWidth: 62, alignItems: 'center', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  sortButtonSelected: { backgroundColor: colors.green },
  sortButtonText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  sortButtonTextSelected: { color: colors.surface },
  assetsCard: { paddingVertical: 2, backgroundColor: 'transparent', borderRadius: 0 },
  emptyCard: { alignItems: 'center', padding: 22 },
  emptyIcon: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center', marginBottom: 13,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  emptyDescription: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 8 },
  emptyButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.green,
    borderRadius: 13, paddingVertical: 11, paddingHorizontal: 15, marginTop: 16,
  },
  emptyButtonText: { color: colors.surface, fontSize: 12, fontWeight: '900', marginLeft: 6 },
  hint: { color: colors.muted, fontSize: 9, marginTop: 2 },
  floatingAdd: {
    alignSelf: 'flex-end',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 10,
    elevation: 5,
  },
});
