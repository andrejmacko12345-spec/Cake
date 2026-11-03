import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ChartNoAxesCombined, Plus, Search, X } from 'lucide-react-native';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { TableColumn, type TableColumnTone } from '../components/table-column';
import { colors } from '../data/portfolio';
import { fetchStockEstimates, StockEstimates } from '../data/fundamentals';
import { useAssetSearch } from '../hooks/use-asset-search';
import { useLocale } from '../context/locale';

const STORAGE_KEY = '@portfolio-mobile/compare-symbols';
const METRICS_KEY = '@portfolio-mobile/compare-metrics';
const MAX_SYMBOLS = 3;
const LABEL_WIDTH = 108;
const MIN_CELL_WIDTH = 66;
const ADD_COLUMN_WIDTH = 32;
const GROUP_GAP_HEIGHT = 30;
const DEFAULT_METRICS = [
  'revenueGrowthThisYear',
  'revenueGrowthNextYear',
  'epsGrowthThisYear',
  'epsGrowthNextYear',
  'peThisYear',
  'peNextYear',
] as const;

type Entry = { data: StockEstimates | null; loading: boolean; error: string };

type Column = {
  key: keyof StockEstimates;
  label: string;
  kind: 'pe' | 'growth';
  group: 'revenue' | 'eps' | 'pe';
  year?: 'current' | 'next';
};

const columns: Column[] = [
  { key: 'revenueGrowthThisYear', label: 'Rast tržieb', kind: 'growth', group: 'revenue', year: 'current' },
  { key: 'revenueGrowthNextYear', label: 'Rast tržieb', kind: 'growth', group: 'revenue', year: 'next' },
  { key: 'epsGrowthThisYear', label: 'EPS rast', kind: 'growth', group: 'eps', year: 'current' },
  { key: 'epsGrowthNextYear', label: 'EPS rast', kind: 'growth', group: 'eps', year: 'next' },
  { key: 'peThisYear', label: 'P/E', kind: 'pe', group: 'pe', year: 'current' },
  { key: 'peNextYear', label: 'P/E', kind: 'pe', group: 'pe', year: 'next' },
];

function formatValue(value: number | null, kind: Column['kind']) {
  if (value === null) return '—';
  if (kind === 'pe') return `${value.toFixed(1)}x`;
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function groupDividerStyle(group: Column['group']) {
  if (group === 'revenue') return styles.groupDividerRevenue;
  if (group === 'eps') return styles.groupDividerEps;
  return styles.groupDividerPe;
}

function groupIndicatorStyle(group: Column['group']) {
  if (group === 'revenue') return styles.groupIndicatorRevenue;
  if (group === 'eps') return styles.groupIndicatorEps;
  return styles.groupIndicatorPe;
}

function metricLabel(column: Column, year: number, translate: (key: string) => string) {
  if (!column.year) return translate(column.label);
  return `${translate(column.label)} ${year + (column.year === 'next' ? 1 : 0)}`;
}

export default function CompareScreen() {
  const { t } = useLocale();
  const { width: screenWidth } = useWindowDimensions();
  const pageScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const searchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loadedStorage, setLoadedStorage] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { results, loading: searching, error: searchError } = useAssetSearch(query);
  const requested = useRef(new Set<string>());
  const pendingMetrics = useRef<string[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([...DEFAULT_METRICS]);
  const [loadedMetrics, setLoadedMetrics] = useState(false);
  const currentYear = new Date().getFullYear();
  const tableWidth = Math.max(0, screenWidth - 24);
  const addColumnWidth = symbols.length >= MAX_SYMBOLS
    ? 0
    : symbols.length
      ? ADD_COLUMN_WIDTH
      : Math.max(ADD_COLUMN_WIDTH, tableWidth - LABEL_WIDTH);
  const cellWidth = symbols.length
    ? Math.max(MIN_CELL_WIDTH, (tableWidth - LABEL_WIDTH - addColumnWidth) / symbols.length)
    : MIN_CELL_WIDTH;

  useEffect(() => {
    if (!showSearch) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [showSearch]);

  useEffect(() => {
    AsyncStorage.getItem(METRICS_KEY)
      .then((saved) => {
        if (!saved || pendingMetrics.current) return;
        const parsed = JSON.parse(saved) as unknown;
        if (parsed && typeof parsed === 'object' && 'version' in parsed) {
          const savedMetrics = parsed as { version?: unknown; keys?: unknown; extra?: unknown };
          if (savedMetrics.version === 5 && Array.isArray(savedMetrics.keys)) {
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
            JSON.stringify({ version: 5, keys: pendingMetrics.current }),
          ).catch(() => undefined);
          pendingMetrics.current = null;
        }
      });
  }, []);

  const saveMetrics = (next: string[]) => {
    setSelectedKeys(next);
    if (loadedMetrics) {
      AsyncStorage.setItem(METRICS_KEY, JSON.stringify({ version: 5, keys: next })).catch(() => undefined);
    } else {
      pendingMetrics.current = next;
    }
  };

  const addMetric = (key: string) => {
    if (selectedKeys.includes(key)) return;
    const newColumn = columns.find((column) => column.key === key);
    if (!newColumn) return;
    const groupOrder = { revenue: 0, eps: 1, pe: 2 };
    const insertionIndex = selectedKeys.findIndex((selectedKey) => {
      const selectedColumn = columns.find((column) => column.key === selectedKey);
      return selectedColumn !== undefined && groupOrder[selectedColumn.group] > groupOrder[newColumn.group];
    });
    const next = [...selectedKeys];
    next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, key);
    saveMetrics(next);
  };
  const visibleColumns = selectedKeys
    .map((key) => columns.find((column) => column.key === key))
    .filter((column): column is Column => column !== undefined);
  const optionalColumns = columns.filter((column) => !selectedKeys.includes(column.key));
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

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      pageScrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => subscription.remove();
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
        .filter((value): value is number => typeof value === 'number' && (column.kind === 'growth' || value > 0));
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
    <Page scrollRef={pageScrollRef}>
      <Header
        title={t('Porovnanie akcií')}
        subtitle={t('Fundamenty')}
      />

      <View style={styles.tableSectionHeader}>
        <Text style={styles.tableSectionTitle}>{t('Ukazovatele')}</Text>
        <View style={styles.metricCount}>
          <Text style={styles.metricCountText}>{selectedKeys.length}</Text>
        </View>
      </View>
      <Surface style={styles.tableCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={[styles.row, styles.tableHeader]}>
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

            {visibleColumns.map((column, index) => {
            const previous = visibleColumns[index - 1];
            return (
              <Fragment key={column.key}>
                {(!previous || previous.group !== column.group)
                  ? (
                    <View style={[
                      styles.groupDivider,
                      groupDividerStyle(column.group),
                      { width: LABEL_WIDTH + cellWidth * symbols.length + addColumnWidth },
                    ]}>
                      <View style={[styles.groupIndicator, groupIndicatorStyle(column.group)]} />
                      <Text style={styles.groupDividerText}>{t(groupLabel(column.group))}</Text>
                    </View>
                  )
                  : null}
                <View style={[styles.row, styles.bodyRow]}>
                  <View style={[styles.labelCell, { width: LABEL_WIDTH }]}>
                    <Text style={styles.labelText} numberOfLines={2}>{metricLabel(column, currentYear, t)}</Text>
                  </View>
                    {symbols.length ? symbols.map((symbol, symbolIndex) => {
                      const entry = entries[symbol];
                      const stockTone = stockColumnTone(symbolIndex);
                      const stockCellStyle = [styles.valueCell, { width: cellWidth, minHeight: 48 }];
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
                        </TableColumn>
                      );
                    }) : <View style={[styles.emptyValueCell, { width: addColumnWidth }]} />}
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
                  <Text style={styles.metricOptionText}>{metricLabel(column, currentYear, t)}</Text>
                </View>
                {symbols.length ? symbols.map((symbol, symbolIndex) => (
                  <TableColumn
                    key={symbol}
                    tone={stockColumnTone(symbolIndex)}
                    style={{ width: cellWidth, minHeight: 45 }}
                  />
                )) : <View style={[styles.emptyValueCell, { width: addColumnWidth }]} />}
              </Pressable>
            )) : null}
          </View>
        </ScrollView>

        {showSearch ? (
          <View style={styles.inlineSearch}>
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
                onFocus={() => setTimeout(() => pageScrollRef.current?.scrollToEnd({ animated: true }), 250)}
              />
              {searching ? <ActivityIndicator size="small" color={colors.green} /> : null}
            </View>
            {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}
            {results.filter((asset) => !symbols.includes(asset.symbol)).slice(0, 5).map((asset) => (
              <Pressable key={asset.symbol} onPress={() => addSymbol(asset.symbol)} style={styles.resultRow}>
                <View style={styles.resultCopy}>
                  <Text style={styles.resultSymbol}>{asset.symbol}</Text>
                  <Text style={styles.resultName} numberOfLines={1}>{asset.name}</Text>
                </View>
                <Plus size={17} color={colors.green} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Surface>

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

      {symbols.length ? (
        <>
          <SectionTitle title={t('Poznámky')} />
          <Text style={styles.note}>
            {t('Roky označujú aktuálny a nasledujúci fiškálny rok. P/E a rast tržieb sú odhady. Tučná hodnota je najlepšia v stĺpci. Zdroj: Yahoo Finance.')}
          </Text>
        </>
      ) : null}
    </Page>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: { flex: 1 },
  tableSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
    marginBottom: 9,
  },
  tableSectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  metricCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
  },
  metricCountText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  tableCard: {
    padding: 0,
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
    paddingVertical: 12,
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
  bodyRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: 48 },
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
  groupIndicator: { width: 6, height: 6, borderRadius: 3 },
  groupIndicatorRevenue: { backgroundColor: colors.green },
  groupIndicatorEps: { backgroundColor: colors.cyan },
  groupIndicatorPe: { backgroundColor: colors.violet },
  groupDividerText: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  labelCell: { paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  labelText: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: '700' },
  stockHead: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 2,
  },
  stockTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addStockHead: {
    minHeight: 56,
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
  valueText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  bestValue: { fontWeight: '900', textDecorationLine: 'underline' },
  addMetricRow: {
    minHeight: 45,
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
  note: { color: colors.muted, fontSize: 10, lineHeight: 15 },
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
  return 'P/E';
}
