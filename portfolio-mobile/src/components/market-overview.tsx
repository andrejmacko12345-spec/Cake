import { useThemedStyles } from '../data/theme';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { useLocale } from '../context/locale';
import { colors, formatPercent } from '../data/portfolio';
import { fetchIndexHistory, indexRanges, marketIndices, type IndexHistory, type IndexRange } from '../data/quotes';
import { PortfolioChart } from './finapp';

type MarketIndex = (typeof marketIndices)[number];
type Entry = { data: IndexHistory | null; error: string | null };

function IndexDetail({ index, onClose }: { index: MarketIndex; onClose: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { t, language } = useLocale();
  const [range, setRange] = useState<IndexRange>('1D');
  const [entry, setEntry] = useState<{ range: IndexRange; data: IndexHistory | null; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetchIndexHistory(index.symbol, range).then((data) => {
      if (active) setEntry({ range, data, error: null });
    }).catch((error: unknown) => {
      if (active) setEntry({ range, data: null, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [index.symbol, range, retry]);
  const current = entry?.range === range ? entry : null;
  const data = current?.data;
  const point = data?.points[selected ?? data.points.length - 1];
  const change = data && point ? (point.price / data.baseline - 1) * 100 : null;
  const color = change !== null && change < 0 ? colors.red : colors.green;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} />
        <View style={styles.sheet}>
          <View style={styles.heading}>
            <Text style={styles.title}>{index.name}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} style={styles.iconButton}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView>
            <Text style={[styles.detailValue, { color }]}>{point ? point.price.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</Text>
            <Text style={[styles.change, { color }]}>{change === null ? '—' : formatPercent(change, 2)}</Text>
            <Text style={styles.note}>{point ? new Date(point.timestamp * 1000).toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US') : t('Načítavam…')}</Text>
            <View style={styles.ranges}>
              {indexRanges.map((item) => (
                <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === range }}
                  onPress={() => {
                    if (item === range) return;
                    setSelected(null); setEntry(null); setRange(item);
                  }} style={[styles.range, item === range && styles.rangeSelected]}>
                  <Text style={[styles.rangeText, item === range && { color: colors.background }]}>{item}</Text>
                </Pressable>
              ))}
            </View>
            {!current ? <ActivityIndicator style={styles.loader} color={colors.green} /> : null}
            {current?.error ? <>
              <Text style={styles.error} accessibilityRole="alert">{current.error}</Text>
              <Pressable accessibilityRole="button" onPress={() => { setEntry(null); setRetry((value) => value + 1); }} style={styles.retry}>
                <Text style={styles.retryText}>{t('Skúsiť znova')}</Text>
              </Pressable>
            </> : null}
            {data ? <>
              <PortfolioChart values={data.points.map((item) => item.price)} color={color} height={210}
                selectedIndex={selected ?? data.points.length - 1} onSelectPoint={setSelected} onSelectionEnd={() => setSelected(null)} />
              <View style={styles.heading}>
                {[data.points[0], data.points[data.points.length - 1]].map((item, index) => (
                  <Text key={index} style={styles.note}>{new Date(item.timestamp * 1000).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US')}</Text>
                ))}
              </View>
            </> : null}
            <Text style={styles.note}>{t('Hodnota indexu v bodoch. Denná zmena je voči predchádzajúcemu uzavretiu; ostatné obdobia voči prvému bodu grafu.')}</Text>
            <Text style={styles.note}>{t('Zdroj: Yahoo Finance. Údaje môžu byť oneskorené.')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function MarketOverview() {
  const styles = useThemedStyles(createStyles);
  const { t, language, errorText } = useLocale();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [selected, setSelected] = useState<MarketIndex | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      const results = await Promise.all(marketIndices.map(async (index) => {
        try {
          const data = await fetchIndexHistory(index.symbol, '1D');
          return { symbol: index.symbol, data, error: null };
        } catch (error) {
          return { symbol: index.symbol, data: null, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      if (active) {
        setEntries((current) => Object.fromEntries(results.map(({ symbol, data, error }) => [
          symbol, { data: data ?? current[symbol]?.data ?? null, error },
        ])));
        setInitialLoading(false);
      }
      pending = false;
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return (
    <View style={styles.overview}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={t(expanded ? 'Skryť trhy' : 'Zobraziť trhy')}
        onPress={() => setExpanded((value) => !value)} style={styles.toggle}>
        {!expanded ? <Text style={styles.note}>{t('Zobraziť trhy')}</Text> : null}
        {expanded ? <ChevronUp size={14} color={colors.muted} /> : <ChevronDown size={14} color={colors.muted} />}
      </Pressable>
      <View style={expanded ? styles.cards : { display: 'none' }}>
      {marketIndices.map((index) => {
        const entry = entries[index.symbol];
        const data = entry?.data;
        const last = data?.points[data.points.length - 1];
        const change = last && data ? (last.price / data.baseline - 1) * 100 : null;
        const negative = change !== null && change < 0;
        const color = negative ? colors.red : colors.green;
        return (
          <Pressable key={index.symbol} accessibilityRole="button" accessibilityLabel={index.name}
            onPress={() => {
              setSelected(index);
            }} style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={1}>{index.symbol === '^IXIC' ? 'NASDAQ' : index.name}</Text>
              <Text style={[styles.returnValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{change === null ? '—' : formatPercent(change, 2)}</Text>
              <Text style={styles.indexValue}>{last ? last.price.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</Text>
            {entry?.error ? <Text numberOfLines={1} style={styles.cardError} accessibilityRole="alert">{errorText(entry.error)}</Text> : null}
          </Pressable>
        );
      })}
      </View>
      {expanded && initialLoading ? <ActivityIndicator size="small" color={colors.green} /> : null}
      {selected ? <IndexDetail key={selected.symbol} index={selected} onClose={() => {
        setSelected(null);
      }} /> : null}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1, minWidth: 0, gap: 1, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 10,
  },
  overview: { marginBottom: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minHeight: 24 },
  cards: { flexDirection: 'row', gap: 6 },
  cardError: { color: colors.red, fontSize: 10 },
  cardTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  indexValue: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  returnValue: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  detailValue: { fontSize: 32, fontWeight: '900' },
  change: { fontSize: 16, fontWeight: '800' },
  error: { color: colors.red, fontSize: 11, marginVertical: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 28, maxHeight: '90%' },
  ranges: { flexDirection: 'row', gap: 4, marginVertical: 14 },
  range: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: colors.surfaceRaised },
  rangeSelected: { backgroundColor: colors.green },
  rangeText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  loader: { marginVertical: 70 },
  retry: { alignItems: 'center', padding: 12 },
  retryText: { color: colors.green, fontWeight: '700' },
});
