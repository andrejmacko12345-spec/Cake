import { Fragment, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeft, ChevronDown, Info } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { TableColumn } from '../components/table-column';
import { colors, formatMoney } from '../data/portfolio';
import {
  fetchHistoricalQuoteSeries,
  HistoricalQuotePoint,
  HistoricalQuoteSeries,
} from '../data/quotes';
import { positionCostEUR, positionValueEUR, Transaction, usePositions } from '../hooks/use-positions';
import { weightedAnnualReturn } from '../data/performance';
import { fetchFundamentalsComparison, FundamentalMetrics } from '../data/fundamentals';
import { useLocale } from '../context/locale';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const benchmarkAssets = [
  { symbol: '^GSPC', name: 'S&P 500', shortName: 'S&P', color: '#58b5ff' },
  { symbol: '^IXIC', name: 'NASDAQ', shortName: 'NASDAQ', color: '#ff9b55' },
  { symbol: '^DJI', name: 'Dow Jones', shortName: 'DOW', color: '#b59aff' },
] as const;
const portfolioSeries = { symbol: 'portfolio', name: 'Portfólio', shortName: 'PORT.', color: colors.green } as const;

type BenchmarkValue = {
  symbol: string;
  name: string;
  shortName: string;
  color: string;
  annualizedReturn: number | null;
};

type AnnualPerformance = {
  year: number;
  portfolioReturn: number | null;
  benchmarks: Record<string, number | null>;
};

type ComparisonPoint = {
  date: string;
  portfolioReturn: number | null;
  benchmarks: Record<string, number | null>;
};

type AnalyticsHistory = {
  annualPerformance: AnnualPerformance[];
  comparison: ComparisonPoint[];
  benchmarks: BenchmarkValue[];
  benchmarkError: string;
};

function getEarliestTransactionDate(transactions: Transaction[]) {
  return transactions.reduce(
    (earliest, transaction) => transaction.date < earliest ? transaction.date : earliest,
    transactions[0]?.date ?? new Date().toISOString().slice(0, 10),
  );
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

function firstPointAtOrAfter(points: HistoricalQuotePoint[], timestamp: number) {
  let low = 0;
  let high = points.length - 1;
  let result: HistoricalQuotePoint | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp >= timestamp) {
      result = points[middle];
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

function annualizedIndexReturn(start: HistoricalQuotePoint, end: HistoricalQuotePoint) {
  if (end.timestamp <= start.timestamp || start.price <= 0) return null;
  const years = (end.timestamp - start.timestamp) * 1000 / YEAR_MS;
  const growth = end.price / start.price;
  return years > 0 ? (Math.pow(growth, 1 / years) - 1) * 100 : (growth - 1) * 100;
}

function formatWholeEUR(value: number, language: 'sk' | 'en') {
  return new Intl.NumberFormat(language === 'sk' ? 'sk-SK' : 'en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function calculateComparison(
  transactions: Transaction[],
  assetSeries: HistoricalQuoteSeries[],
  indexSeries: Map<string, HistoricalQuoteSeries>,
  fxPoints: HistoricalQuotePoint[],
  startDate: string,
): AnalyticsHistory {
  const seriesBySymbol = new Map(assetSeries.map((series) => [series.symbol, series]));
  const timestamps = [...new Set([
    ...assetSeries.flatMap((series) => series.points.map((point) => point.timestamp)),
    ...[...indexSeries.values()].flatMap((series) => series.points.map((point) => point.timestamp)),
  ])].sort((a, b) => a - b);
  const orderedTransactions = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  const startTimestamp = new Date(`${startDate}T00:00:00.000Z`).getTime() / 1000;
  const benchmarkStarts = new Map<string, HistoricalQuotePoint>();
  const benchmarkEnds = new Map<string, HistoricalQuotePoint>();
  for (const [symbol, series] of indexSeries) {
    const first = firstPointAtOrAfter(series.points, startTimestamp);
    const last = series.points[series.points.length - 1];
    if (first && last && first.price > 0) {
      benchmarkStarts.set(symbol, first);
      benchmarkEnds.set(symbol, last);
    }
  }

  const sharesBySymbol = new Map<string, number>();
  const annualGrowth = new Map<number, number>();
  const annualBenchmarks = new Map<number, Record<string, number | null>>();
  const comparison: ComparisonPoint[] = [];
  let transactionIndex = 0;
  let previousValue = 0;
  let portfolioGrowth = 1;

  for (const timestamp of timestamps) {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    let buyFlowEUR = 0;
    let sellFlowEUR = 0;
    while (
      transactionIndex < orderedTransactions.length &&
      orderedTransactions[transactionIndex].date <= date
    ) {
      const transaction = orderedTransactions[transactionIndex];
      const currentShares = sharesBySymbol.get(transaction.symbol) ?? 0;
      const direction = transaction.type === 'BUY' ? 1 : -1;
      sharesBySymbol.set(transaction.symbol, currentShares + direction * transaction.shares);
      const flowEUR = direction * transaction.shares * transaction.price * transaction.fxToEur;
      if (direction > 0) buyFlowEUR += flowEUR;
      else sellFlowEUR -= flowEUR;
      transactionIndex += 1;
    }

    let portfolioValue = 0;
    for (const [symbol, shares] of sharesBySymbol) {
      if (shares <= 1e-8) continue;
      const series = seriesBySymbol.get(symbol);
      const quote = series ? latestPointAt(series.points, timestamp) : undefined;
      if (!quote || !series) {
        throw new Error(`Historická cena pre ${symbol} nie je dostupná k ${date}.`);
      }
      let fxToEur = 1;
      if (series.currency === 'USD') {
        const fx = latestPointAt(fxPoints, timestamp);
        if (!fx) throw new Error(`Historický kurz USD/EUR nie je dostupný k ${date}.`);
        fxToEur = 1 / fx.price;
      }
      portfolioValue += shares * quote.price * fxToEur;
    }

    let portfolioReturn: number | null = null;
    if (timestamp >= startTimestamp) {
      const returnBase = previousValue + buyFlowEUR;
      const growthFactor = returnBase > 0
        ? (portfolioValue + sellFlowEUR) / returnBase
        : 1;
      portfolioGrowth *= growthFactor;
      portfolioReturn = (portfolioGrowth - 1) * 100;
      const year = Number(date.slice(0, 4));
      annualGrowth.set(year, (annualGrowth.get(year) ?? 1) * growthFactor);
    }

    const year = Number(date.slice(0, 4));
    const yearStart = Math.max(startTimestamp, Date.UTC(year, 0, 1) / 1000);
    const yearEnd = Math.min(
      Date.UTC(year + 1, 0, 1) / 1000 - 1,
      timestamps[timestamps.length - 1] ?? timestamp,
    );
    if (timestamp >= yearStart && timestamp <= yearEnd) {
      const yearReturns = annualBenchmarks.get(year) ?? {};
      for (const benchmark of benchmarkAssets) {
        const series = indexSeries.get(benchmark.symbol);
        if (!series) {
          yearReturns[benchmark.symbol] = null;
          continue;
        }
        const start = firstPointAtOrAfter(series.points, yearStart);
        const end = latestPointAt(series.points, yearEnd);
        yearReturns[benchmark.symbol] = start && end && start.price > 0
          ? (end.price / start.price - 1) * 100
          : null;
      }
      annualBenchmarks.set(year, yearReturns);
    }

    if (timestamp >= startTimestamp) {
      const benchmarkReturns: Record<string, number | null> = {};
      for (const benchmark of benchmarkAssets) {
        const series = indexSeries.get(benchmark.symbol);
        const base = benchmarkStarts.get(benchmark.symbol);
        const quote = series ? latestPointAt(series.points, timestamp) : undefined;
        benchmarkReturns[benchmark.symbol] = base && quote && timestamp >= base.timestamp
          ? (quote.price / base.price - 1) * 100
          : null;
      }
      comparison.push({ date, portfolioReturn, benchmarks: benchmarkReturns });
    }

    previousValue = portfolioValue;
  }

  const lastTimestamp = timestamps[timestamps.length - 1] ?? startTimestamp;
  const annualPerformance = [...annualGrowth.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, growth]) => ({
      year,
      portfolioReturn: (growth - 1) * 100,
      benchmarks: annualBenchmarks.get(year) ?? {},
    }));

  const benchmarks = benchmarkAssets.map((benchmark) => {
    const start = benchmarkStarts.get(benchmark.symbol);
    const end = benchmarkEnds.get(benchmark.symbol);
    const series = indexSeries.get(benchmark.symbol);
    return {
      ...benchmark,
      annualizedReturn: start && end
        ? annualizedIndexReturn(start, end)
        : null,
    };
  });

  return {
    annualPerformance,
    comparison,
    benchmarks,
    benchmarkError: benchmarkAssets.some((benchmark) => !indexSeries.has(benchmark.symbol))
      ? 'Niektoré indexové ceny sa nepodarilo načítať.'
      : '',
  };
}

function formatCompactPercent(value: number | null, language: 'sk' | 'en' = 'sk') {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 1 })}%`;
}

function formatDetailedPercent(value: number | null, language: 'sk' | 'en' = 'sk') {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function BenchmarkPicker({
  selectedSymbol,
  onSelect,
}: {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedBenchmark = benchmarkAssets.find((benchmark) => benchmark.symbol === selectedSymbol)
    ?? benchmarkAssets[0];

  return (
    <View style={styles.benchmarkPicker}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Vybraný index: ${selectedBenchmark.name}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={() => setIsOpen((open) => !open)}
        style={styles.benchmarkPickerButton}
      >
        <Text style={styles.benchmarkPickerLabel}>{selectedBenchmark.name}</Text>
        <ChevronDown size={14} color={colors.text} />
      </Pressable>
      {isOpen ? (
        <View style={styles.benchmarkPickerOptions}>
          {benchmarkAssets.map((benchmark) => (
            <Pressable
              key={benchmark.symbol}
              accessibilityRole="button"
              accessibilityState={{ selected: benchmark.symbol === selectedSymbol }}
              onPress={() => {
                onSelect(benchmark.symbol);
                setIsOpen(false);
              }}
              style={[
                styles.benchmarkPickerOption,
                benchmark.symbol === selectedSymbol && styles.benchmarkPickerOptionSelected,
              ]}
            >
              <Text style={styles.benchmarkPickerOptionText}>{benchmark.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const comparisonPeriods = [
  { label: '1M', days: 30 },
  { label: '3M', days: 91 },
  { label: '6M', days: 183 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: 'Všetko', days: null },
] as const;

type ComparisonPeriod = typeof comparisonPeriods[number]['label'];

function getComparisonForPeriod(
  values: ComparisonPoint[],
  period: ComparisonPeriod,
  benchmarkSymbol: string,
) {
  const selectedPeriod = comparisonPeriods.find((item) => item.label === period) ?? comparisonPeriods[comparisonPeriods.length - 1];
  const latestDate = values[values.length - 1]?.date;
  const cutoff = selectedPeriod.days !== null && latestDate
    ? new Date(`${latestDate}T00:00:00.000Z`).getTime() - selectedPeriod.days * DAY_MS
    : Number.NEGATIVE_INFINITY;
  const filtered = values.filter((point) =>
    new Date(`${point.date}T00:00:00.000Z`).getTime() >= cutoff);
  const portfolioBase = filtered.find((point) => point.portfolioReturn !== null)?.portfolioReturn ?? null;
  const benchmarkBase = filtered.find((point) =>
    point.benchmarks[benchmarkSymbol] !== null &&
    point.benchmarks[benchmarkSymbol] !== undefined)?.benchmarks[benchmarkSymbol] ?? null;
  const rebase = (value: number | null, base: number | null) => {
    if (value === null || base === null || base <= -100) return null;
    return ((1 + value / 100) / (1 + base / 100) - 1) * 100;
  };

  return filtered.map((point) => ({
    ...point,
    portfolioReturn: rebase(point.portfolioReturn, portfolioBase),
    benchmarks: {
      [benchmarkSymbol]: rebase(point.benchmarks[benchmarkSymbol] ?? null, benchmarkBase),
    },
  }));
}

function ComparisonLineChart({
  values,
  benchmark,
  onInteractionChange,
}: {
  values: ComparisonPoint[];
  benchmark: typeof benchmarkAssets[number];
  onInteractionChange: (interacting: boolean) => void;
}) {
  const { t, language } = useLocale();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.max(260, screenWidth - 92);
  const chartHeight = 205;
  const padding = { left: 34, right: 8, top: 16, bottom: 23 };
  const [containerWidth, setContainerWidth] = useState(chartWidth);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => () => onInteractionChange(false), [onInteractionChange]);
  const endInteraction = () => {
    setSelectedIndex(null);
    onInteractionChange(false);
  };
  const allValues = values.flatMap((point) => [
    point.portfolioReturn,
    point.benchmarks[benchmark.symbol] ?? null,
  ]).filter((value): value is number => value !== null);
  const min = Math.min(0, ...allValues);
  const max = Math.max(0, ...allValues);
  const spread = max - min || 1;
  const x = (index: number) => padding.left +
    (index / Math.max(1, values.length - 1)) * (chartWidth - padding.left - padding.right);
  const y = (value: number) => padding.top +
    ((max - value) / spread) * (chartHeight - padding.top - padding.bottom);
  const makePath = (getValue: (point: ComparisonPoint) => number | null) => {
    let path = '';
    let started = false;
    values.forEach((point, index) => {
      const value = getValue(point);
      if (value === null) {
        started = false;
        return;
      }
      path += `${started ? ' L' : ' M'} ${x(index)} ${y(value)}`;
      started = true;
    });
    return path;
  };
  const ticks = [...new Set([max, 0, min])];
  const dateLabels = values.length > 1
    ? [values[0].date, values[Math.floor(values.length / 2)].date, values[values.length - 1].date]
    : [];
  const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
    month: 'short',
    year: '2-digit',
  });
  const activeIndex = selectedIndex === null
    ? values.length - 1
    : Math.min(selectedIndex, values.length - 1);
  const activePoint = values[activeIndex];
  const series = [
    {
      symbol: portfolioSeries.symbol,
      color: portfolioSeries.color,
      value: (point: ComparisonPoint) => point.portfolioReturn,
    },
    {
      symbol: benchmark.symbol,
      color: benchmark.color,
      value: (point: ComparisonPoint) => point.benchmarks[benchmark.symbol] ?? null,
    },
  ];
  const selectNearestPoint = (event: { nativeEvent: { locationX: number } }) => {
    if (values.length < 2) return;
    const chartX = event.nativeEvent.locationX * chartWidth / Math.max(1, containerWidth);
    const plotWidth = chartWidth - padding.left - padding.right;
    const ratio = Math.max(0, Math.min(1, (chartX - padding.left) / plotWidth));
    setSelectedIndex(Math.round(ratio * (values.length - 1)));
  };

  return (
    <View
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => values.length > 1}
      onMoveShouldSetResponder={() => values.length > 1}
      onResponderGrant={(event) => {
        onInteractionChange(true);
        selectNearestPoint(event);
      }}
      onResponderMove={selectNearestPoint}
      onResponderTerminationRequest={() => false}
      onResponderRelease={endInteraction}
      onResponderTerminate={endInteraction}
      onTouchCancel={endInteraction}
      accessibilityLabel={t('Graf výnosu v čase. Potiahnite prstom po grafe pre výber dátumu.')}
    >
      {values.length > 1 ? (
        <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {ticks.map((tick, index) => (
            <Fragment key={`${tick}-${index}`}>
              <Line
                x1={padding.left}
                y1={y(tick)}
                x2={chartWidth - padding.right}
                y2={y(tick)}
                stroke={tick === 0 ? colors.text : colors.border}
                strokeWidth={tick === 0 ? 1.3 : 0.7}
              />
              <SvgText
                x={padding.left - 5}
                y={y(tick) + 3}
                fill={colors.muted}
                fontSize="8"
                textAnchor="end"
              >
                {formatCompactPercent(tick, language)}
              </SvgText>
            </Fragment>
          ))}
          {series.map((item) => {
            const path = makePath(item.value);
            return path ? (
              <Path
                key={item.symbol}
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth={item.symbol === portfolioSeries.symbol ? 2.8 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null;
          })}
          {selectedIndex !== null && activePoint ? (
            <>
              <Line
                x1={x(activeIndex)}
                y1={padding.top}
                x2={x(activeIndex)}
                y2={chartHeight - padding.bottom}
                stroke={colors.muted}
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {series.map((item) => {
                const value = item.value(activePoint);
                return value === null ? null : (
                  <Circle
                    key={`selected-${item.symbol}`}
                    cx={x(activeIndex)}
                    cy={y(value)}
                    r={item.symbol === portfolioSeries.symbol ? 4 : 3.5}
                    fill={item.color}
                    stroke={colors.surface}
                    strokeWidth="1.5"
                  />
                );
              })}
            </>
          ) : null}
          {dateLabels.map((date, index) => {
            const pointIndex = index === 0 ? 0 : index === 1 ? Math.floor(values.length / 2) : values.length - 1;
            return (
              <SvgText
                key={`${date}-${index}`}
                x={x(pointIndex)}
                y={chartHeight - 4}
                fill={colors.muted}
                fontSize="8"
                textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
              >
                {formatDate(date)}
              </SvgText>
            );
          })}
        </Svg>
      ) : (
        <View style={styles.chartEmpty}>
          <Text style={styles.emptyText}>{t('Po načítaní cien sa zobrazí porovnanie výnosov.')}</Text>
        </View>
      )}
      {activePoint ? (
        <View style={styles.selectedPoint}>
          {selectedIndex !== null ? <Text style={styles.selectedPointDate}>
            {new Date(`${activePoint.date}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text> : null}
          {series.map((item) => (
            <View key={`value-${item.symbol}`} style={styles.selectedPointRow}>
              <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.selectedPointLabel}>
                {item.symbol === portfolioSeries.symbol ? portfolioSeries.name : benchmark.name}
              </Text>
              <Text style={[styles.selectedPointValue, { color: item.color }]}>
                {formatDetailedPercent(item.value(activePoint), language)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AnnualComparisonChart({
  values,
  benchmark,
}: {
  values: AnnualPerformance[];
  benchmark: typeof benchmarkAssets[number];
}) {
  const { language, t } = useLocale();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const viewportWidth = Math.max(280, screenWidth - 72);
  const groupWidth = 104;
  const chartWidth = Math.max(viewportWidth, values.length * groupWidth);
  const chartHeight = Math.round(Math.max(145, Math.min(190, screenHeight * 0.22)));
  const displayedValues = [...values].reverse();
  const series = [
    portfolioSeries,
    {
      symbol: benchmark.symbol,
      name: benchmark.name,
      shortName: benchmark.shortName,
      color: benchmark.color,
    },
  ];
  const returns = values.flatMap((item) => [
    item.portfolioReturn,
    item.benchmarks[benchmark.symbol] ?? null,
  ]).filter((value): value is number => value !== null);
  const max = Math.max(0, ...returns);
  const min = Math.min(0, ...returns);
  const spread = max - min || 1;
  const plotTop = 26;
  const plotHeight = chartHeight - plotTop - 38;
  const baseline = plotTop + (max === min ? 1 : max / spread) * plotHeight;
  const groupCenter = (index: number) => index * groupWidth + groupWidth / 2;
  const barWidth = 30;
  const barGap = 14;
  const clusterWidth = series.length * barWidth + (series.length - 1) * barGap;
  const formatValue = (value: number | null) => value === null
    ? '—'
    : `${value > 0 ? '+' : ''}${value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 1 })}%`;

  return values.length ? (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {displayedValues.map((year, yearIndex) => (
            yearIndex % 2 === 0 ? (
              <Rect
                key={`year-band-${year.year}`}
                x={yearIndex * groupWidth + 2}
                y={6}
                width={groupWidth - 4}
                height={chartHeight - 24}
                fill={colors.surfaceRaised}
                fillOpacity="0.45"
                rx="8"
              />
            ) : null
          ))}
          {displayedValues.slice(1).map((year, yearIndex) => (
            <Line
              key={`year-divider-${year.year}`}
              x1={(yearIndex + 1) * groupWidth}
              y1={8}
              x2={(yearIndex + 1) * groupWidth}
              y2={chartHeight - 18}
              stroke={colors.border}
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          ))}
          <Line x1="4" y1={baseline} x2={chartWidth - 4} y2={baseline} stroke={colors.text} strokeWidth="1.2" />
          {displayedValues.map((year, yearIndex) => {
            const center = groupCenter(yearIndex);
            const startX = center - clusterWidth / 2;
            const annualReturns = [
              year.portfolioReturn,
              year.benchmarks[benchmark.symbol] ?? null,
            ];
            return (
              <Fragment key={year.year}>
                {annualReturns.map((value, seriesIndex) => {
                  if (value === null) return null;
                  const height = Math.max(1.5, Math.abs(value) / spread * plotHeight);
                  const x = startX + seriesIndex * (barWidth + barGap);
                  return (
                    <Fragment key={series[seriesIndex].symbol}>
                      <Rect
                        x={x}
                        y={value >= 0 ? baseline - height : baseline}
                        width={barWidth}
                        height={height}
                        fill={series[seriesIndex].color}
                        rx="2"
                      />
                      <SvgText
                        x={x + barWidth / 2}
                        y={value >= 0 ? baseline - height - 7 : baseline + height + 15}
                        fill={series[seriesIndex].color}
                        fontSize="12"
                        fontWeight="900"
                        textAnchor="middle"
                      >
                        {formatValue(value)}
                      </SvgText>
                    </Fragment>
                  );
                })}
                <SvgText
                  x={center}
                  y={chartHeight - 5}
                  fill={colors.muted}
                  fontSize="13"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  {year.year}
                </SvgText>
              </Fragment>
            );
          })}
        </Svg>
      </ScrollView>

      <View style={styles.annualLegend}>
        {series.map((item) => (
          <View key={item.symbol} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.name}</Text>
          </View>
        ))}
      </View>

    </View>
  ) : (
    <View style={styles.chartEmpty}>
      <Text style={styles.emptyText}>{t('Po načítaní cien sa zobrazí porovnanie po rokoch.')}</Text>
    </View>
  );
}

function ReturnCard({
  title,
  portfolioReturn,
  indexReturns,
}: {
  title: string;
  portfolioReturn: number | null;
  indexReturns: BenchmarkValue[];
}) {
  const { t, language } = useLocale();
  const portfolioColor = portfolioReturn === null
    ? colors.muted
    : portfolioReturn >= 0 ? colors.green : colors.red;

  return (
    <Surface style={styles.returnCard}>
      <View style={styles.returnCardHeading}>
        <Text style={styles.returnCardTitle}>{t(title)}</Text>
      </View>
      <View style={styles.portfolioReturnBlock}>
        <Text style={[styles.portfolioReturnValue, { color: portfolioColor }]}>
          {formatCompactPercent(portfolioReturn, language)}
        </Text>
      </View>
      <View style={styles.indexReturns}>
        {indexReturns.map((benchmark) => {
          const value = benchmark.annualizedReturn;
          return (
            <View key={benchmark.symbol} style={styles.indexReturn}>
              <View style={styles.indexReturnIdentity}>
                <View style={[styles.indexReturnDot, { backgroundColor: benchmark.color }]} />
                <Text numberOfLines={1} style={styles.indexReturnLabel}>{benchmark.shortName}</Text>
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.indexReturnValue}>{formatCompactPercent(value, language)}</Text>
            </View>
          );
        })}
      </View>
    </Surface>
  );
}

function FundamentalsTable({
  portfolio,
  market,
  language,
}: {
  portfolio: FundamentalMetrics;
  market: FundamentalMetrics;
  language: 'sk' | 'en';
}) {
  const { t } = useLocale();
  const locale = language === 'sk' ? 'sk-SK' : 'en-US';
  const year = new Date().getFullYear();
  const groups = ['P/E', t('Rast EPS'), t('Rast tržieb')];
  const rows = [
    { label: 'P/E TTM', key: 'currentPE', isPE: true, year: null },
    { label: 'Forward P/E', key: 'peThisYear', isPE: true, year },
    { label: 'Forward P/E', key: 'peNextYear', isPE: true, year: year + 1 },
    { label: t('EPS rast TTM'), key: 'epsGrowthTTM', isPE: false, year: null },
    { label: t('Rast EPS'), key: 'epsGrowthThisYear', isPE: false, year },
    { label: t('Rast EPS'), key: 'epsGrowthNextYear', isPE: false, year: year + 1 },
    { label: t('Rast tržieb TTM'), key: 'revenueGrowthTTM', isPE: false, year: null },
    { label: t('Rast tržieb'), key: 'revenueGrowthThisYear', isPE: false, year },
    { label: t('Rast tržieb'), key: 'revenueGrowthNextYear', isPE: false, year: year + 1 },
  ] as const;
  return (
    <View style={styles.fundTable}>
      <View style={[styles.fundRow, styles.fundHeaderRow]}>
        <View style={styles.fundLabelBox} />
        <TableColumn tone="green" header style={styles.fundColumn}><Text style={[styles.fundCell, styles.fundHeader]}>{t('Portfólio')}</Text></TableColumn>
        <TableColumn tone="cyan" header style={styles.fundColumn}><Text style={[styles.fundCell, styles.fundHeader]}>{t('S&P 500')}</Text></TableColumn>
        <TableColumn tone="violet" header style={styles.fundColumn}><Text style={[styles.fundCell, styles.fundHeader]}>{t('Rozdiel')}</Text></TableColumn>
      </View>
      {rows.map((row, index) => {
        const p = portfolio[row.key];
        const m = market[row.key];
        const format = (value: number | null) => value === null
          ? '—'
          : row.isPE
            ? value.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })
            : `${(value * 100).toLocaleString(locale, { maximumFractionDigits: 0 })}%`;
        const diff = p === null || m === null ? null : row.isPE ? p - m : (p - m) * 100;
        const good = diff === null ? null : row.isPE ? diff <= 0 : diff >= 0;
        const diffText = diff === null
          ? '—'
          : `${diff > 0 ? '+' : ''}${diff.toLocaleString(locale, { maximumFractionDigits: 1 })}${row.isPE ? '' : ' pp'}`;
        return (
          <Fragment key={row.key}>
            {index % 3 === 0 ? (
              <View style={[styles.fundGroupHeader, index > 0 && styles.fundGroupSpacing]}>
                <Text style={styles.fundGroupTitle}>{groups[index / 3]}</Text>
              </View>
            ) : null}
            <View style={[styles.fundRow, index % 3 === 1 && styles.fundAlternateRow]}>
              <View style={styles.fundLabelBox}>
                <Text style={styles.fundLabel}>{row.label}</Text>
                {row.year !== null ? <Text style={styles.fundDate}>31.12.{row.year}</Text> : null}
              </View>
              <TableColumn tone="green" style={styles.fundColumn}><Text style={styles.fundCell}>{format(p)}</Text></TableColumn>
              <TableColumn tone="cyan" style={styles.fundColumn}><Text style={styles.fundCell}>{format(m)}</Text></TableColumn>
              <TableColumn tone="violet" style={styles.fundColumn}>
                <Text style={[styles.fundCell, { color: good === null ? colors.muted : good ? colors.green : colors.red }]}>{diffText}</Text>
              </TableColumn>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const { t, language } = useLocale();
  const { positions, transactions, loading } = usePositions();
  const [history, setHistory] = useState<AnalyticsHistory>({
    annualPerformance: [],
    comparison: [],
    benchmarks: benchmarkAssets.map((benchmark) => ({
      ...benchmark,
      annualizedReturn: null,
    })),
    benchmarkError: '',
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [fundamentals, setFundamentals] = useState<{ portfolio: FundamentalMetrics; market: FundamentalMetrics } | null>(null);
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false);
  const [fundamentalsError, setFundamentalsError] = useState('');
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>('Všetko');
  const [chartInteracting, setChartInteracting] = useState(false);
  const [lineBenchmarkSymbol, setLineBenchmarkSymbol] = useState<string>(benchmarkAssets[0].symbol);
  const [annualBenchmarkSymbol, setAnnualBenchmarkSymbol] = useState<string>(benchmarkAssets[0].symbol);
  const totalValue = positions.reduce((sum, position) => sum + positionValueEUR(position), 0);
  const openCostEUR = positions.reduce((sum, position) => sum + positionCostEUR(position), 0);
  const realizedEUR = positions.reduce((sum, position) => sum + position.realizedProfitEUR, 0);
  const unrealizedEUR = totalValue - openCostEUR;
  const totalReturnEUR = positions.reduce(
    (sum, position) => sum + positionValueEUR(position) - positionCostEUR(position) + position.realizedProfitEUR,
    0,
  );
  const startDate = getEarliestTransactionDate(transactions);
  const weightedAnnualReturnValue = useMemo(
    () => weightedAnnualReturn(transactions, totalValue),
    [transactions, totalValue],
  );
  const lineBenchmark = benchmarkAssets.find((benchmark) => benchmark.symbol === lineBenchmarkSymbol)
    ?? benchmarkAssets[0];
  const annualBenchmark = benchmarkAssets.find((benchmark) => benchmark.symbol === annualBenchmarkSymbol)
    ?? benchmarkAssets[0];
  const periodComparison = useMemo(
    () => getComparisonForPeriod(history.comparison, comparisonPeriod, lineBenchmark.symbol),
    [history.comparison, comparisonPeriod, lineBenchmark.symbol],
  );

  const holdingsKey = positions
    .map((position) => `${position.symbol}:${Math.round(positionValueEUR(position))}`)
    .join('|');

  useEffect(() => {
    let active = true;
    setFundamentalsLoading(true);
    setFundamentalsError('');
    const holdings = positions
      .map((position) => ({ symbol: position.symbol, weight: positionValueEUR(position) }))
      .filter((holding) => holding.weight > 0);
    fetchFundamentalsComparison(holdings)
      .then((data) => { if (active) setFundamentals(data); })
      .catch((error) => {
        if (active) setFundamentalsError(error instanceof Error ? error.message : 'Fundamentálne dáta sa nepodarilo načítať.');
      })
      .finally(() => { if (active) setFundamentalsLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey]);

  useEffect(() => {
    let active = true;
    if (!transactions.length) {
      setHistory({
        annualPerformance: [],
        comparison: [],
        benchmarks: benchmarkAssets.map((benchmark) => ({
          ...benchmark,
          annualizedReturn: null,
        })),
        benchmarkError: '',
      });
      setHistoryError('');
      setHistoryLoading(false);
      return () => { active = false; };
    }

    const queryStartDate = new Date(`${startDate}T00:00:00.000Z`);
    queryStartDate.setUTCDate(queryStartDate.getUTCDate() - 7);
    const queryStart = queryStartDate.toISOString().slice(0, 10);
    setHistoryLoading(true);
    setHistoryError('');

    const symbols = [...new Set(transactions.map((transaction) => transaction.symbol))];
    Promise.all([
      Promise.all(symbols.map((symbol) => fetchHistoricalQuoteSeries(symbol, queryStart, '1d'))),
      Promise.allSettled(benchmarkAssets.map((benchmark) =>
        fetchHistoricalQuoteSeries(benchmark.symbol, queryStart, '1d'))),
    ])
      .then(async ([assetSeries, benchmarkResults]) => {
        const needsFx = assetSeries.some((item) => item.currency === 'USD');
        const fxSeries = needsFx
          ? await fetchHistoricalQuoteSeries('EURUSD=X', queryStart, '1d')
          : undefined;
        if (needsFx && fxSeries?.currency !== 'USD') {
          throw new Error('Historický menový kurz USD/EUR nie je dostupný.');
        }

        const indexSeries = new Map<string, HistoricalQuoteSeries>();
        benchmarkResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            indexSeries.set(benchmarkAssets[index].symbol, result.value);
          }
        });
        const comparison = calculateComparison(
          transactions,
          assetSeries,
          indexSeries,
          fxSeries?.points ?? [],
          startDate,
        );
        return comparison;
      })
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setHistoryError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => { active = false; };
  }, [transactions, startDate]);

  const formattedStartDate = useMemo(
    () => transactions.length
      ? new Date(`${startDate}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      : '—',
    [startDate, transactions.length],
  );
  return (
    <Page animateOnFocus scrollEnabled={!chartInteracting}>
      <Header
        title={t('Analytika portfólia')}
        subtitle={t('Porovnanie od prvej investície')}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={language === 'sk' ? 'Späť' : 'Back'}
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
            style={{ width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.surface }}
          >
            <ArrowLeft size={18} color={colors.text} />
          </Pressable>
        }
      />
      <View style={styles.overviewRow}>
        <Surface style={styles.marketCard}>
          <Text style={styles.marketLabel}>{t('Celkový výnos')}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.marketValue}>{formatWholeEUR(totalReturnEUR, language)}</Text>
          <View style={styles.marketStatRow}>
            <Text style={styles.marketStatLabel}>{t('Nerealizovaný výnos')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.marketStatValue}>{formatWholeEUR(unrealizedEUR, language)}</Text>
          </View>
          <View style={styles.marketStatRow}>
            <Text style={styles.marketStatLabel}>{t('Realizovaný výnos')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.marketStatValue}>{formatWholeEUR(realizedEUR, language)}</Text>
          </View>
        </Surface>
        <ReturnCard
          title={t('Priemerný ročný výnos')}
          portfolioReturn={weightedAnnualReturnValue}
          indexReturns={history.benchmarks}
        />
      </View>

      <SectionTitle
        title={t('Výkonnosť po rokoch')}
        action={historyLoading ? <ActivityIndicator size="small" color={colors.green} /> : null}
      />
      <Surface style={styles.performanceCard}>
        <View style={styles.chartControls}>
          <Text style={styles.controlLabel}>{t('Porovnať s')}</Text>
          <BenchmarkPicker
            selectedSymbol={annualBenchmark.symbol}
            onSelect={setAnnualBenchmarkSymbol}
          />
        </View>
        {historyLoading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.emptyText}>{t('Počítam výnosy jednotlivých rokov…')}</Text>
          </View>
        ) : historyError ? (
          <View style={styles.errorState}>
            <Info size={15} color={colors.red} />
            <Text style={styles.errorText}>{historyError}</Text>
          </View>
        ) : (
          <AnnualComparisonChart values={history.annualPerformance} benchmark={annualBenchmark} />
        )}
      </Surface>

      {history.benchmarkError ? (
        <Text style={styles.inlineError}>{history.benchmarkError}</Text>
      ) : null}

      <SectionTitle
        title={t('Výnos v čase')}
        action={historyLoading ? <ActivityIndicator size="small" color={colors.green} /> : null}
      />
      <Surface style={styles.performanceCard}>
        <View style={styles.chartControls}>
          <Text style={styles.controlLabel}>{t('Porovnať s')}</Text>
          <BenchmarkPicker
            selectedSymbol={lineBenchmark.symbol}
            onSelect={setLineBenchmarkSymbol}
          />
        </View>
        <View style={styles.periodSelector} accessibilityLabel={t('Časové obdobie grafu')}>
          {comparisonPeriods.map((period) => (
            <Pressable
              key={period.label}
              accessibilityRole="button"
              accessibilityState={{ selected: comparisonPeriod === period.label }}
              onPress={() => setComparisonPeriod(period.label)}
              style={[
                styles.periodButton,
                comparisonPeriod === period.label && styles.periodButtonSelected,
              ]}
            >
              <Text
                style={[
                  styles.periodButtonText,
                  comparisonPeriod === period.label && styles.periodButtonTextSelected,
                ]}
              >
                {period.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {historyLoading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.emptyText}>{t('Načítavam porovnanie s indexmi…')}</Text>
          </View>
        ) : historyError ? (
          <View style={styles.errorState}>
            <Info size={15} color={colors.red} />
            <Text style={styles.errorText}>{historyError}</Text>
          </View>
        ) : (
          <ComparisonLineChart
            key={`${lineBenchmark.symbol}-${comparisonPeriod}-${periodComparison.length}`}
            values={periodComparison}
            benchmark={lineBenchmark}
            onInteractionChange={setChartInteracting}
          />
        )}
      </Surface>

      <SectionTitle
        title={t('Fundamenty: portfólio vs trh')}
        action={fundamentalsLoading ? <ActivityIndicator size="small" color={colors.green} /> : null}
      />
      <Surface style={styles.performanceCard}>
        {fundamentals ? (
          <FundamentalsTable portfolio={fundamentals.portfolio} market={fundamentals.market} language={language} />
        ) : fundamentalsError ? (
          <View style={styles.errorState}>
            <Info size={15} color={colors.red} />
            <Text style={styles.errorText}>{fundamentalsError}</Text>
          </View>
        ) : (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.emptyText}>{t('Načítavam fundamentálne dáta…')}</Text>
          </View>
        )}
        <Text style={styles.fundNote}>
          {t('S&P 500: vzorka 50 veľkých firiem, vážená trhovou kapitalizáciou.')}
        </Text>
      </Surface>

      <View style={styles.periodNote}>
        <Info size={14} color={colors.muted} />
        <Text style={styles.periodNoteText}>
          {loading
            ? t('Načítavam…')
            : transactions.length
              ? `${language === 'sk' ? 'Od' : 'Since'} ${formattedStartDate} · ${t('indexy bez dividend')}`
              : t('Pridaj transakcie a zobraz výnosy v porovnaní s indexmi.')}
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  marketCard: {
    flex: 1.15,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  marketValue: {
    textAlign: 'center',
    color: colors.green,
    fontSize: 29,
    fontWeight: '900',
    marginTop: 6,
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  marketLabel: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  marketStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
    paddingTop: 5,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  marketStatLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  marketStatValue: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  returnCard: {
    flex: 0.85,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
  },
  returnCardHeading: {
    alignItems: 'center',
    marginBottom: 6,
  },
  returnCardTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  portfolioReturnBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  portfolioReturnValue: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    marginTop: 2,
  },
  indexReturns: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 5,
  },
  indexReturn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRadius: 7,
    backgroundColor: colors.surfaceRaised,
  },
  indexReturnIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  indexReturnDot: {
    width: 6,
    height: 6,
    borderRadius: 5,
  },
  indexReturnLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  indexReturnValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'right',
  },
  fundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fundTable: { overflow: 'hidden', borderRadius: 10 },
  fundHeaderRow: { minHeight: 34, backgroundColor: colors.surfaceRaised },
  fundAlternateRow: { backgroundColor: colors.surfaceRaised },
  fundGroupHeader: { paddingHorizontal: 6, paddingVertical: 7, backgroundColor: colors.surfaceRaised, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  fundGroupSpacing: { marginTop: 10 },
  fundGroupTitle: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  fundDate: { color: colors.muted, fontSize: 8, marginTop: 2 },
  fundLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
  },
  fundLabelBox: { flex: 1.5, paddingHorizontal: 6 },
  fundHeader: {
    color: colors.muted,
    fontSize: 10,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  fundCell: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  fundColumn: { flex: 1, alignSelf: 'stretch' },
  fundNote: {
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 10,
  },
  inlineError: {
    color: colors.red,
    fontSize: 9,
    marginTop: 1,
    marginBottom: 8,
  },
  performanceCard: {
    paddingHorizontal: 12,
    paddingTop: 13,
    paddingBottom: 11,
  },
  chartControls: {
    position: 'relative',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 9,
  },
  controlLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  benchmarkPicker: {
    position: 'relative',
    zIndex: 2,
  },
  benchmarkPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surfaceRaised,
  },
  benchmarkPickerLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
  },
  benchmarkPickerOptions: {
    position: 'absolute',
    top: '100%',
    right: 0,
    zIndex: 3,
    minWidth: 132,
    marginTop: 4,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    elevation: 5,
  },
  benchmarkPickerOption: {
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 7,
  },
  benchmarkPickerOptionSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  benchmarkPickerOptionText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
  },
  periodSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  periodButton: {
    minWidth: 40,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },
  periodButtonSelected: {
    borderColor: colors.green,
    backgroundColor: colors.green,
  },
  periodButtonText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  periodButtonTextSelected: {
    color: colors.background,
  },
  chartLoading: {
    height: 185,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  chartEmpty: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 9,
    textAlign: 'center',
  },
  errorState: {
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  errorText: {
    flex: 1,
    color: colors.red,
    fontSize: 9,
    lineHeight: 14,
  },
  selectedPoint: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 3,
    borderRadius: 9,
    backgroundColor: colors.surfaceRaised,
  },
  selectedPointDate: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 4,
  },
  selectedPointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  selectedPointLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
  },
  selectedPointValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  annualLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    color: colors.muted,
    fontSize: 10,
  },
  periodNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
  },
  periodNoteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 8,
    lineHeight: 13,
    marginLeft: 7,
  },
});
