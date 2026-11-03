import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronUp, Plus, Search, X } from 'lucide-react-native';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { colors } from '../data/portfolio';
import { fetchStockEstimates, StockEstimates } from '../data/fundamentals';
import { useAssetSearch } from '../hooks/use-asset-search';
import { usePositions } from '../hooks/use-positions';
import { useLocale } from '../context/locale';

const STORAGE_KEY = '@portfolio-mobile/compare-symbols';
const METRICS_KEY = '@portfolio-mobile/compare-metrics';
const MAX_SYMBOLS = 30;

type Entry = { data: StockEstimates | null; loading: boolean; error: string };

type Column = {
  key: keyof StockEstimates;
  label: string;
  kind: 'pe' | 'growth';
};

const columns: Column[] = [
  { key: 'currentPE', label: 'Aktuálne P/E', kind: 'pe' },
  { key: 'forwardPE', label: 'Forward P/E', kind: 'pe' },
  { key: 'peThisYear', label: 'P/E tento rok', kind: 'pe' },
  { key: 'peNextYear', label: 'P/E budúci rok', kind: 'pe' },
  { key: 'revenueGrowthThisYear', label: 'Tržby tento rok', kind: 'growth' },
  { key: 'revenueGrowthNextYear', label: 'Tržby budúci rok', kind: 'growth' },
  { key: 'epsGrowthThisYear', label: 'EPS tento rok', kind: 'growth' },
  { key: 'epsGrowthNextYear', label: 'EPS budúci rok', kind: 'growth' },
];

function formatValue(value: number | null, kind: Column['kind']) {
  if (value === null) return '—';
  if (kind === 'pe') return `${value.toFixed(1)}x`;
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export default function CompareScreen() {
  const { t } = useLocale();
  const { positions } = usePositions();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loadedStorage, setLoadedStorage] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { results, loading: searching, error: searchError } = useAssetSearch(query);
  const requested = useRef(new Set<string>());
  const [selectedKeys, setSelectedKeys] = useState<string[]>(columns.map((column) => column.key));

  useEffect(() => {
    AsyncStorage.getItem(METRICS_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) {
          setSelectedKeys(parsed.filter((item): item is string => columns.some((column) => column.key === item)));
        }
      })
      .catch(() => undefined);
  }, []);

  const toggleMetric = (key: string) => {
    const next = selectedKeys.includes(key)
      ? selectedKeys.filter((item) => item !== key)
      : columns.map((column) => column.key as string).filter((item) => item === key || selectedKeys.includes(item));
    setSelectedKeys(next);
    AsyncStorage.setItem(METRICS_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const visibleColumns = columns.filter((column) => selectedKeys.includes(column.key));

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!saved) return;
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) setSymbols(parsed.filter((item): item is string => typeof item === 'string'));
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
  };

  const heldSymbols = useMemo(
    () => [...new Set(positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol))],
    [positions],
  );
  const holdingsActive = heldSymbols.length > 0 && heldSymbols.every((symbol) => symbols.includes(symbol));

  const toggleOpenPositions = () => {
    if (holdingsActive) {
      for (const symbol of heldSymbols) requested.current.delete(symbol);
      saveSymbols(symbols.filter((symbol) => !heldSymbols.includes(symbol)));
    } else {
      saveSymbols([...new Set([...symbols, ...heldSymbols])].slice(0, MAX_SYMBOLS));
    }
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
    <Page onRefresh={refreshAll}>
      <Header
        title={t('Porovnanie akcií')}
        subtitle={t('Fundamenty')}
        action={(
          <Pressable
            accessibilityLabel={t('Pridať akciu')}
            accessibilityRole="button"
            onPress={() => setShowSearch((value) => !value)}
            style={styles.addButton}
          >
            {showSearch ? <X size={19} color={colors.surface} /> : <Plus size={19} color={colors.surface} />}
          </Pressable>
        )}
      />

      {showSearch ? (
        <Surface style={styles.searchCard}>
          <View style={styles.searchBox}>
            <Search size={16} color={colors.muted} />
            <TextInput
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
          {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}
          {results.slice(0, 6).map((asset) => {
            const added = symbols.includes(asset.symbol);
            return (
              <Pressable
                key={asset.symbol}
                disabled={added}
                onPress={() => addSymbol(asset.symbol)}
                style={[styles.resultRow, added && styles.resultAdded]}
              >
                <Text style={styles.resultSymbol}>{asset.symbol}</Text>
                <Text style={styles.resultName} numberOfLines={1}>{asset.name}</Text>
                <Text style={styles.resultAction}>{added ? '✓' : '+'}</Text>
              </Pressable>
            );
          })}
        </Surface>
      ) : null}

      <View style={styles.chipRow}>
        <Pressable
          onPress={toggleOpenPositions}
          style={[styles.chip, styles.chipAction, holdingsActive && styles.chipActive]}
        >
          <Text style={[styles.chipActionText, holdingsActive && styles.chipActiveText]}>
            {t('Moje pozície')}{holdingsActive ? ' ✓' : ''}
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: metricsOpen }}
        onPress={() => setMetricsOpen(!metricsOpen)}
        style={styles.metricsToggle}
      >
        <Text style={styles.metricsToggleText}>{t('Ukazovatele')}</Text>
        <Text style={styles.metricsCount}>{visibleColumns.length}/{columns.length}</Text>
        {metricsOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
      </Pressable>
      {metricsOpen ? (
      <View style={styles.chipRow}>
        {columns.map((column) => {
          const active = selectedKeys.includes(column.key);
          return (
            <Pressable
              key={column.key}
              onPress={() => toggleMetric(column.key)}
              style={[styles.chip, active && styles.chipSelected]}
            >
              <Text style={[styles.chipText, !active && styles.chipMuted]}>{t(column.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      ) : null}

      {symbols.length && visibleColumns.length ? (
        <Surface style={styles.tableCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.row}>
                <View style={styles.labelCell} />
                {symbols.map((symbol) => (
                  <Pressable key={symbol} onPress={() => removeSymbol(symbol)} style={styles.stockHead}>
                    <Text style={styles.symbolText}>{symbol}</Text>
                    <Text style={styles.nameText} numberOfLines={1}>{entries[symbol]?.data?.name ?? ''}</Text>
                    <X size={11} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
              {visibleColumns.map((column) => (
                <View key={column.key} style={[styles.row, styles.bodyRow]}>
                  <Text style={[styles.labelCell, styles.labelText]}>{t(column.label)}</Text>
                  {symbols.map((symbol) => {
                    const entry = entries[symbol];
                    if (entry?.loading && !entry.data) {
                      return (
                        <View key={symbol} style={styles.valueCell}>
                          <ActivityIndicator size="small" color={colors.green} />
                        </View>
                      );
                    }
                    if (entry?.error && !entry.data) {
                      return (
                        <Pressable key={symbol} style={styles.valueCell} onPress={() => void loadSymbol(symbol)}>
                          <Text style={styles.errorText}>↻</Text>
                        </Pressable>
                      );
                    }
                    const value = entry?.data?.[column.key];
                    const numeric = typeof value === 'number' ? value : null;
                    const isBest = numeric !== null && best[column.key] === numeric;
                    return (
                      <Text
                        key={symbol}
                        style={[
                          styles.valueCell,
                          styles.valueText,
                          numeric !== null && column.kind === 'growth'
                            ? { color: numeric >= 0 ? colors.green : colors.red }
                            : null,
                          isBest && styles.bestValue,
                        ]}
                      >
                        {formatValue(numeric, column.kind)}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Surface>
      ) : (
        <Surface>
          <Text style={styles.emptyText}>{t('Pridaj akcie cez + alebo tlačidlom Moje pozície.')}</Text>
        </Surface>
      )}

      <SectionTitle title={t('Poznámky')} />
      <Text style={styles.note}>
        {t('Tento rok = aktuálny fiškálny rok, budúci rok = nasledujúci fiškálny rok. P/E za tieto roky je cena / odhadované EPS analytikov. Zvýraznená (tučná) hodnota je najlepšia v stĺpci: najnižšie P/E alebo najvyšší rast. Zdroj je Yahoo Finance a ponúka odhady len na tieto dva roky.')}
      </Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCard: { padding: 12, marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 10,
    minHeight: 40,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  resultAdded: { opacity: 0.5 },
  resultSymbol: { color: colors.text, fontSize: 14, fontWeight: '800', width: 64 },
  resultName: { flex: 1, color: colors.muted, fontSize: 12 },
  resultAction: { color: colors.green, fontSize: 18, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metricsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  metricsToggleText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' },
  metricsCount: { color: colors.muted, fontSize: 11, fontWeight: '700', marginRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  chipAction: { borderColor: colors.green },
  chipActionText: { color: colors.green, fontSize: 12, fontWeight: '700' },
  chipActive: { backgroundColor: colors.green },
  chipSelected: { borderColor: colors.green },
  chipMuted: { color: colors.muted, fontWeight: '600' },
  chipActiveText: { color: colors.surface },
  tableCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  bodyRow: { borderTopWidth: 1, borderTopColor: colors.border, minHeight: 46 },
  labelCell: { width: 104, paddingHorizontal: 10 },
  labelText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  stockHead: { width: 78, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 2 },
  valueCell: { width: 78, textAlign: 'center', alignItems: 'center', justifyContent: 'center' },
  valueText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  bestValue: { fontWeight: '900', textDecorationLine: 'underline' },
  symbolText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  nameText: { color: colors.muted, fontSize: 9 },
  errorText: { color: colors.red, fontSize: 11 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.muted, fontSize: 11, lineHeight: 16 },
});
