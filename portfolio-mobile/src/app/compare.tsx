import { useThemedStyles } from '../data/theme';
import { useAppStorage } from '../data/app-storage';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ChartNoAxesCombined, Plus, Search, X } from 'lucide-react-native';
import { Header, Page, Surface } from '../components/finapp';
import { TableColumn, type TableColumnTone } from '../components/table-column';
import { colors } from '../data/portfolio';
import { fetchStockEstimates, StockEstimates } from '../data/fundamentals';
import { useAssetSearch } from '../hooks/use-asset-search';
import { useLocale } from '../context/locale';

const STORAGE_KEY = '@portfolio-mobile/compare-symbols';
const METRICS_KEY = '@portfolio-mobile/compare-metrics';
const MAX_SYMBOLS = 3;
const LABEL_WIDTH = 108;
const ADD_COLUMN_WIDTH = 32;
const GROUP_GAP_HEIGHT = 24;
const DEFAULT_METRICS = [
  'currentPE',
  'peThisYear',
  'peNextYear',
  'revenueGrowthThisYear',
  'revenueGrowthNextYear',
  'epsGrowthThisYear',
  'epsGrowthNextYear',
  'grossMargin',
  'netMargin',
  'priceToSalesTTM',
] as const;

type Entry = { data: StockEstimates | null; loading: boolean; error: string };

type Column = {
  key: keyof StockEstimates;
  label: string;
  kind: 'pe' | 'growth' | 'margin';
  group: 'revenue' | 'eps' | 'pe' | 'profitability';
  year?: 'current' | 'next';
};

const columns: Column[] = [
  { key: 'currentPE', label: 'P/E TTM', kind: 'pe', group: 'pe' },
  { key: 'peThisYear', label: 'P/E', kind: 'pe', group: 'pe', year: 'current' },
  { key: 'peNextYear', label: 'P/E', kind: 'pe', group: 'pe', year: 'next' },
  { key: 'revenueGrowthThisYear', label: 'Rast tržieb', kind: 'growth', group: 'revenue', year: 'current' },
  { key: 'revenueGrowthNextYear', label: 'Rast tržieb', kind: 'growth', group: 'revenue', year: 'next' },
  { key: 'epsGrowthThisYear', label: 'EPS rast', kind: 'growth', group: 'eps', year: 'current' },
  { key: 'epsGrowthNextYear', label: 'EPS rast', kind: 'growth', group: 'eps', year: 'next' },
  { key: 'grossMargin', label: 'Hrubá marža', kind: 'margin', group: 'profitability' },
  { key: 'netMargin', label: 'Čistá marža', kind: 'margin', group: 'profitability' },
  { key: 'priceToSalesTTM', label: 'P/S TTM', kind: 'pe', group: 'profitability' },
];

function formatValue(value: number | null, kind: Column['kind']) {
  if (value === null) return '—';
  if (kind === 'pe') return `${value.toFixed(1)}x`;
  const percent = value * 100;
  return `${kind === 'growth' && percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function groupDividerStyle(group: Column['group'], styles: ReturnType<typeof createStyles>) {
  if (group === 'revenue') return styles.groupDividerRevenue;
  if (group === 'eps') return styles.groupDividerEps;
  if (group === 'profitability') return styles.groupDividerProfitability;
  return styles.groupDividerPe;
}

function groupIndicatorStyle(group: Column['group'], styles: ReturnType<typeof createStyles>) {
  if (group === 'revenue') return styles.groupIndicatorRevenue;
  if (group === 'eps') return styles.groupIndicatorEps;
  if (group === 'profitability') return styles.groupIndicatorProfitability;
  return styles.groupIndicatorPe;
}

function metricLabel(column: Column, translate: (key: string) => string) {
  if (!column.year) return translate(column.label);
  const year = new Date().getFullYear() + (column.year === 'next' ? 1 : 0);
  return `${translate(column.label)} · ${year}`;
}

function calendarDate(data: StockEstimates | null | undefined, column: Column) {
  const date = column.year === 'current' ? data?.cy0End : column.year === 'next' ? data?.cy1End : null;
  if (!column.year) return null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  const [year, month] = date.split('-');
  return `${month}.${year}`;
}

export default function CompareScreen() {
  const styles = useThemedStyles(createStyles);
  const AsyncStorage = useAppStorage();
  const { t, errorText } = useLocale();
  const { width: screenWidth } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [tableLayout, setTableLayout] = useState({ width: screenWidth - 24, y: 60 });
  const [tableHeaderHeight, setTableHeaderHeight] = useState(48);
  const pageScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const searchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loadedStorage, setLoadedStorage] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [showSearch, setShowSearch] = useState(false);
  const searchReveal = useRef(new Animated.Value(0)).current;
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { results, loading: searching, error: searchError } = useAssetSearch(query);
  const requested = useRef(new Set<string>());
  const pendingMetrics = useRef<string[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([...DEFAULT_METRICS]);
  const [loadedMetrics, setLoadedMetrics] = useState(false);
  const tableWidth = Math.max(0, tableLayout.width - 2);
  const addColumnWidth = symbols.length >= MAX_SYMBOLS
    ? 0
    : symbols.length
      ? ADD_COLUMN_WIDTH
      : Math.max(ADD_COLUMN_WIDTH, tableWidth - LABEL_WIDTH);
  const cellWidth = symbols.length
    ? Math.max(0, (tableWidth - LABEL_WIDTH - addColumnWidth) / symbols.length)
    : 0;

  useEffect(() => {
    if (!showSearch) return;
    searchReveal.setValue(0);
    const animation = Animated.timing(searchReveal, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [showSearch, searchReveal]);

  useEffect(() => {
    AsyncStorage.getItem(METRICS_KEY)
      .then((saved) => {
        if (!saved || pendingMetrics.current) return;
        const parsed = JSON.parse(saved) as unknown;
        if (parsed && typeof parsed === 'object' && 'version' in parsed) {
          const savedMetrics = parsed as { version?: unknown; keys?: unknown; extra?: unknown };
          if (savedMetrics.version === 6 && Array.isArray(savedMetrics.keys)) {
            setSelectedKeys([...new Set(savedMetrics.keys.filter((item): item is string =>
              typeof item === 'string' && columns.some((column) => column.key === item),
            ))]);
          } else if ((savedMetrics.version === 3 || savedMetrics.version === 4) && Array.isArray(savedMetrics.keys)) {
            const previous = [...new Set(savedMetrics.keys.filter((item): item is string =>
              typeof item === 'string' && columns.some((column) => column.key === item),
            ))];
            const extras = previous.filter((item) => !DEFAULT_METRICS.includes(item as (typeof DEFAULT_METRICS)[number]));
            setSelectedKeys([...DEFAULT_METRICS, ...extras]);
          } else if (savedMetrics.version === 2 && Array.isArray(savedMetrics.extra)) {
            setSelectedKeys([
              ...DEFAULT_METRICS,
              ...savedMetrics.extra.filter((item): item is string =>
                typeof item === 'string'
                && columns.some((column) => column.key === item)
                && !DEFAULT_METRICS.includes(item as (typeof DEFAULT_METRICS)[number]),
              ),
            ]);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setLoadedMetrics(true);
        if (pendingMetrics.current) {
          AsyncStorage.setItem(
            METRICS_KEY,
            JSON.stringify({ version: 6, keys: pendingMetrics.current }),
          ).catch(() => undefined);
          pendingMetrics.current = null;
        }
      });
  }, []);

  const saveMetrics = (next: string[]) => {
    setSelectedKeys(next);
    if (loadedMetrics) {
      AsyncStorage.setItem(METRICS_KEY, JSON.stringify({ version: 6, keys: next })).catch(() => undefined);
    } else {
      pendingMetrics.current = next;
    }
  };

  const addMetric = (key: string) => {
    if (selectedKeys.includes(key)) return;
    const newColumn = columns.find((column) => column.key === key);
    if (!newColumn) return;
    const groupOrder = { pe: 0, revenue: 1, eps: 2, profitability: 3 };
    const insertionIndex = selectedKeys.findIndex((selectedKey) => {
      const selectedColumn = columns.find((column) => column.key === selectedKey);
      return selectedColumn !== undefined && groupOrder[selectedColumn.group] > groupOrder[newColumn.group];
    });
    const next = [...selectedKeys];
    next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, key);
    saveMetrics(next);
  };
  const visibleColumns = columns.filter((column) => selectedKeys.includes(column.key));
  const optionalColumns = columns.filter((column) => !selectedKeys.includes(column.key));
  const groupCount = visibleColumns.filter((column, index) => column.group !== visibleColumns[index - 1]?.group).length;
  const rowHeight = viewportHeight && visibleColumns.length
    ? Math.max(26, Math.floor(
      (viewportHeight - 16 - tableLayout.y - 28 - (symbols.length >= MAX_SYMBOLS ? 20 : 0)
        - 2 - tableHeaderHeight - groupCount * GROUP_GAP_HEIGHT
        - (optionalColumns.length ? 36 : 0)) / visibleColumns.length,
    ))
    : 36;
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) {
          setSymbols(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_SYMBOLS));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadedStorage(true));
  }, []);

  const saveSymbols = useCallback((next: string[]) => {
    setSymbols(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const loadSymbol = useCallback(async (symbol: string) => {
    setEntries((current) => ({
      ...current,
      [symbol]: { data: current[symbol]?.data ?? null, loading: true, error: '' },
    }));
    try {
      const data = await fetchStockEstimates(symbol);
      setEntries((current) => ({ ...current, [symbol]: { data, loading: false, error: '' } }));
    } catch (error) {
      requested.current.delete(symbol);
      setEntries((current) => ({
        ...current,
        [symbol]: {
          data: current[symbol]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!loadedStorage) return;
    for (const symbol of symbols) {
      if (requested.current.has(symbol)) continue;
      requested.current.add(symbol);
      void loadSymbol(symbol);
    }
  }, [symbols, loadedStorage, loadSymbol]);

  const refreshAll = async () => {
    requested.current.clear();
    for (const symbol of symbols) requested.current.add(symbol);
    await Promise.all(symbols.map((symbol) => loadSymbol(symbol)));
  };

  const addSymbol = (symbol: string) => {
    if (symbols.includes(symbol) || symbols.length >= MAX_SYMBOLS) return;
    saveSymbols([...symbols, symbol]);
    setQuery('');
    setShowSearch(false);
  };

  const removeSymbol = (symbol: string) => {
    requested.current.delete(symbol);
    saveSymbols(symbols.filter((item) => item !== symbol));
  };

  // Najlepšia hodnota v stĺpci: najnižšie kladné P/E, najvyšší rast.
  const best = useMemo(() => {
    const result: Partial<Record<keyof StockEstimates, number>> = {};
    for (const column of columns) {
      const values = symbols
        .map((symbol) => entries[symbol]?.data?.[column.key])
        .filter((value): value is number => typeof value === 'number' && (column.kind !== 'pe' || value > 0));
      if (values.length > 1) {
        result[column.key] = column.kind === 'pe' ? Math.min(...values) : Math.max(...values);
      }
    }
    return result;
  }, [entries, symbols]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoiding}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
    >
    <Page scrollRef={pageScrollRef} onScrollViewLayout={setViewportHeight}>
      <Header
        title={t('Porovnanie akcií')}
        compact
      />

      <View onLayout={({ nativeEvent: { layout } }) => setTableLayout({ width: layout.width, y: layout.y })}>
      <Surface style={styles.tableCard}>
          <View style={{ width: tableWidth }}>
            <View
              style={[styles.row, styles.tableHeader]}
              onLayout={({ nativeEvent: { layout } }) => setTableHeaderHeight(layout.height)}
            >
              <View style={styles.metricHeader}>
                <Text style={styles.headerLabel}>{t('Ukazovatele')}</Text>
              </View>
              {symbols.map((symbol, symbolIndex) => (
                <TableColumn
                  key={symbol}
                  tone={stockColumnTone(symbolIndex)}
                  header
                  style={[styles.stockHead, { width: cellWidth }]}
                >
                  <View style={styles.stockTitle}>
                    <Text style={styles.symbolText}>{symbol}</Text>
                    <Pressable onPress={() => removeSymbol(symbol)} accessibilityLabel={`${t('Odstrániť')} ${symbol}`}>
                      <X size={13} color={colors.muted} />
                    </Pressable>
                  </View>
                  <Text style={styles.nameText} numberOfLines={1}>{entries[symbol]?.data?.name ?? ''}</Text>
                </TableColumn>
              ))}
              {symbols.length < MAX_SYMBOLS ? <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Pridať akciu')}
                accessibilityState={{ expanded: showSearch }}
                onPress={() => {
                  setMetricsOpen(false);
                  setShowSearch((value) => !value);
                }}
                style={[styles.addStockHead, { width: addColumnWidth }]}
              >
                {showSearch ? <X size={16} color={colors.green} /> : <Plus size={16} color={colors.green} />}
              </Pressable> : null}
            </View>

            {showSearch ? (
              <Animated.View style={[
                styles.inlineSearch,
                {
                  width: LABEL_WIDTH + cellWidth * symbols.length + addColumnWidth,
                  opacity: searchReveal,
                  transform: [{ translateY: searchReveal.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
                },
              ]}>
                <View style={styles.searchBox}>
                  <Search size={16} color={colors.muted} />
                  <TextInput
                    ref={searchInputRef}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onChangeText={setQuery}
                    placeholder={t('Hľadať akciu')}
                    placeholderTextColor={colors.muted}
                    style={styles.searchInput}
                    value={query}
                  />
                  {searching ? <ActivityIndicator size="small" color={colors.green} /> : null}
                </View>
                {searchError ? <Text style={styles.errorText}>{errorText(searchError)}</Text> : null}
                {results.filter((asset) => !symbols.includes(asset.symbol)).slice(0, 5).map((asset) => (
                  <Pressable key={asset.symbol} onPress={() => addSymbol(asset.symbol)} style={styles.resultRow}>
                    <View style={styles.resultCopy}>
                      <Text style={styles.resultSymbol}>{asset.symbol}</Text>
                      <Text style={styles.resultName} numberOfLines={1}>{asset.name}</Text>
                    </View>
                    <Plus size={17} color={colors.green} />
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}

            {visibleColumns.map((column, index) => {
            const previous = visibleColumns[index - 1];
            return (
              <Fragment key={column.key}>
                {(!previous || previous.group !== column.group)
                  ? (
                    <View style={[
                      styles.groupDivider,
                      groupDividerStyle(column.group, styles),
                      { width: LABEL_WIDTH + cellWidth * symbols.length + addColumnWidth },
                    ]}>
                      <View style={[styles.groupIndicator, groupIndicatorStyle(column.group, styles)]} />
                      <Text style={styles.groupDividerText}>{t(groupLabel(column.group))}</Text>
                    </View>
                  )
                  : null}
                <View style={[styles.row, styles.bodyRow, { minHeight: rowHeight }]}>
                  <View style={[styles.labelCell, { width: LABEL_WIDTH }]}>
                    <Text style={styles.labelText} numberOfLines={2}>{metricLabel(column, t)}</Text>
                  </View>
                    {symbols.length ? symbols.map((symbol, symbolIndex) => {
                      const entry = entries[symbol];
                      const stockTone = stockColumnTone(symbolIndex);
                      const stockCellStyle = [styles.valueCell, { width: cellWidth, minHeight: rowHeight - StyleSheet.hairlineWidth }];
                      if (entry?.loading && !entry.data) {
                        return (
                          <TableColumn key={symbol} tone={stockTone} style={{ width: cellWidth }}>
                            <View style={stockCellStyle}><ActivityIndicator size="small" color={colors.green} /></View>
                          </TableColumn>
                        );
                      }
                      if (entry?.error && !entry.data) {
                        return (
                          <TableColumn key={symbol} tone={stockTone} style={{ width: cellWidth }}>
                            <Pressable style={stockCellStyle} onPress={() => void loadSymbol(symbol)}>
                              <Text style={styles.errorText}>↻</Text>
                            </Pressable>
                          </TableColumn>
                        );
                      }
                      const value = entry?.data?.[column.key];
                      const numeric = typeof value === 'number' ? value : null;
                      const isBest = numeric !== null && best[column.key] === numeric;
                      return (
                        <TableColumn key={symbol} tone={stockTone} style={{ width: cellWidth }}>
                          <View style={styles.metricValue}>
                          <Text
                            style={[
                              styles.valueText,
                              { textAlign: 'center' },
                              numeric !== null && column.kind === 'growth'
                                ? { color: numeric >= 0 ? colors.green : colors.red }
                                : null,
                              isBest && styles.bestValue,
                            ]}
                          >
                            {formatValue(numeric, column.kind)}
                          </Text>
                          {column.year ? <Text style={styles.calendarDate}>{calendarDate(entry?.data, column)}</Text> : null}
                          </View>
                        </TableColumn>
                      );
                    }) : <View style={{ width: addColumnWidth, minHeight: rowHeight - StyleSheet.hairlineWidth }} />}
                  </View>
                </Fragment>
              );
            })}

            {optionalColumns.length ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Pridať ukazovateľ')}
              accessibilityState={{ expanded: metricsOpen }}
              onPress={() => {
                setShowSearch(false);
                setMetricsOpen((value) => !value);
              }}
              style={[
                styles.row,
                styles.addMetricRow,
                { width: LABEL_WIDTH + cellWidth * symbols.length + addColumnWidth },
              ]}
            >
              {metricsOpen ? <X size={15} color={colors.green} /> : <Plus size={15} color={colors.green} />}
              <Text style={styles.addMetricText}>
                {metricsOpen ? t('Zavrieť') : t('Pridať ukazovateľ')}
              </Text>
            </Pressable> : null}

            {metricsOpen ? optionalColumns.map((column) => (
              <Pressable
                key={column.key}
                accessibilityRole="button"
                onPress={() => addMetric(column.key)}
                style={[styles.row, styles.metricOptionRow]}
              >
                <View style={styles.metricOptionLabel}>
                  <Plus size={14} color={colors.green} />
                  <Text style={styles.metricOptionText}>{metricLabel(column, t)}</Text>
                </View>
                {symbols.length ? symbols.map((symbol, symbolIndex) => (
                  <TableColumn
                    key={symbol}
                    tone={stockColumnTone(symbolIndex)}
                    style={{ width: cellWidth, minHeight: 45 }}
                  >{null}</TableColumn>
                )) : <View style={[styles.emptyValueCell, { width: addColumnWidth }]} />}
              </Pressable>
            )) : null}
          </View>
      </Surface>
      </View>

      {!symbols.length ? (
        <View style={styles.emptyCompare}>
          <View style={styles.emptyCompareIcon}>
            <ChartNoAxesCombined size={19} color={colors.green} />
          </View>
          <View style={styles.emptyCompareCopy}>
            <Text style={styles.emptyCompareTitle}>{t('Začni porovnaním akcií')}</Text>
            <Text style={styles.emptyCompareText}>{t('Pridaj akcie cez plus v hlavičke tabuľky. Porovnať môžeš najviac tri.')}</Text>
          </View>
        </View>
      ) : null}

      {symbols.length >= MAX_SYMBOLS ? <Text style={styles.limitNote}>{t('Porovnať možno najviac 3 akcie.')}</Text> : null}

    </Page>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  keyboardAvoiding: { flex: 1 },
  tableCard: {
    padding: 0,
    marginBottom: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
  },
  emptyCompare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyCompareIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  emptyCompareCopy: { flex: 1, gap: 3 },
  emptyCompareTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  emptyCompareText: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  tableHeader: { backgroundColor: colors.surfaceRaised, borderBottomWidth: 1, borderBottomColor: colors.border },
  metricHeader: {
    width: LABEL_WIDTH,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  headerLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 10,
    minHeight: 40,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  inlineSearch: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 4 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultSymbol: { color: colors.text, fontSize: 13, fontWeight: '800', width: 58 },
  resultName: { flex: 1, color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bodyRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  groupDivider: {
    height: GROUP_GAP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderLeftWidth: 3,
  },
  groupDividerRevenue: { backgroundColor: 'rgba(120,216,79,0.08)', borderLeftColor: colors.green },
  groupDividerEps: { backgroundColor: 'rgba(22,196,216,0.08)', borderLeftColor: colors.cyan },
  groupDividerPe: { backgroundColor: 'rgba(100,121,255,0.09)', borderLeftColor: colors.violet },
  groupDividerProfitability: { backgroundColor: 'rgba(255,180,90,0.08)', borderLeftColor: '#ffb45a' },
  groupIndicator: { width: 6, height: 6, borderRadius: 3 },
  groupIndicatorRevenue: { backgroundColor: colors.green },
  groupIndicatorEps: { backgroundColor: colors.cyan },
  groupIndicatorPe: { backgroundColor: colors.violet },
  groupIndicatorProfitability: { backgroundColor: '#ffb45a' },
  groupDividerText: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  labelCell: { paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  labelText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 15, fontWeight: '700' },
  stockHead: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 2,
  },
  stockTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addStockHead: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  valueCell: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  emptyValueCell: { minHeight: 48 },
  valueText: { color: colors.text, fontSize: 13, lineHeight: 15, fontWeight: '700' },
  metricValue: { alignItems: 'center', justifyContent: 'center', paddingVertical: 1 },
  calendarDate: { color: colors.muted, fontSize: 9, lineHeight: 9 },
  bestValue: { fontWeight: '900' },
  addMetricRow: {
    minHeight: 36,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addMetricText: { color: colors.green, fontSize: 12, fontWeight: '700' },
  metricOptionRow: { minHeight: 42, borderBottomWidth: 1, borderBottomColor: colors.border },
  metricOptionLabel: {
    width: LABEL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  metricOptionText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  symbolText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  nameText: { color: colors.muted, fontSize: 9 },
  errorText: { color: colors.red, fontSize: 11 },
  limitNote: { color: colors.muted, fontSize: 10, textAlign: 'right', marginTop: 2, marginBottom: 4 },
});

function stockColumnTone(index: number): TableColumnTone {
  if (index === 0) return 'green';
  if (index === 1) return 'cyan';
  return 'violet';
}

function groupLabel(group: Column['group']) {
  if (group === 'revenue') return 'Rast tržieb';
  if (group === 'eps') return 'EPS rast';
  if (group === 'profitability') return 'Ziskovosť a P/S';
  return 'P/E';
}
