import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Bookmark, BriefcaseBusiness, Check, ChevronDown, Search, X } from 'lucide-react-native';
import { Header, Page, Surface } from '../components/finapp';
import { TableColumn } from '../components/table-column';
import type { TableColumnTone } from '../components/table-column';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { useThemedStyles } from '../data/theme';
import { selectionHaptic } from '../data/haptics';
import { fetchProjectionBase, parseProjectionNumber, projectionDefaults, projectStock } from '../data/projections';
import type { ProjectionBase, ProjectionInputs, ProjectionYear } from '../data/projections';
import { useAssetSearch } from '../hooks/use-asset-search';
import { usePositions } from '../hooks/use-positions';
import { useWatchlists } from '../hooks/use-watchlists';

type Draft = Record<keyof ProjectionInputs, string>;
const fields: Array<{ key: keyof Draft; label: string; percent: boolean }> = [
  { key: 'revenueGrowth', label: 'Rast tržieb', percent: true },
  { key: 'incomeGrowth', label: 'Rast čistého zisku', percent: true },
  { key: 'peLow', label: 'Dolné P/E', percent: false },
  { key: 'peHigh', label: 'Horné P/E', percent: false },
];
const emptyDraft = (): Draft => ({
  revenueGrowth: '', incomeGrowth: '', peLow: '', peHigh: '',
});

export default function StockProjections({ embedded = false }: { embedded?: boolean }) {
  const styles = useThemedStyles(createStyles);
  const { t, errorText, language } = useLocale();
  const [symbol, setSymbol] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [base, setBase] = useState<ProjectionBase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState('');
  const [availableHeight, setAvailableHeight] = useState(0);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [tableTop, setTableTop] = useState(0);
  const [watchlistsOpen, setWatchlistsOpen] = useState(false);
  const watchlists = useWatchlists();
  const rowHeight = availableHeight && tableTop
    ? Math.max(26, Math.floor((availableHeight - tableTop - 16 - 28 - 8 - 18) / 9)) : 38;
  const { results, loading: searching, error: searchError } = useAssetSearch(query);
  const { positions } = usePositions();
  const quickStocks = [...new Map(positions.filter((position) => position.shares > 1e-8)
    .map((position) => [position.symbol, position])).values()];
  const selectStock = (next: string) => {
    selectionHaptic();
    Keyboard.dismiss();
    setSearchOpen(false);
    setPortfolioOpen(false);
    setWatchlistsOpen(false);
    setQuery('');
    if (next !== symbol) {
      setBase(null);
      setLoading(false);
      setError('');
      setDraft(emptyDraft());
      setSymbol(next);
    }
  };
  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true);
    setBase(null);
    setError('');
    fetchProjectionBase(symbol).then((value) => {
      if (active) {
        setBase(value);
        setDraft(projectionDefaults(value));
      }
    }).catch((failure: unknown) => {
      console.warn('Projection data failed:', failure);
      if (active) setError(failure instanceof Error ? failure.message : 'Fundamentálne dáta sa nepodarilo načítať.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [symbol, retry]);

  const calculation = useMemo(() => {
    if (!base) return { years: [] as ProjectionYear[], error: '' };
    if (Object.values(draft).some((value) => !value.trim())) return { years: [] as ProjectionYear[], error: '' };
    const revenueGrowth = parseProjectionNumber(draft.revenueGrowth);
    const incomeGrowth = parseProjectionNumber(draft.incomeGrowth);
    const peLow = parseProjectionNumber(draft.peLow);
    const peHigh = parseProjectionNumber(draft.peHigh);
    if (revenueGrowth === null || incomeGrowth === null || peLow === null || peHigh === null) {
      return { years: [] as ProjectionYear[], error: 'Zadaj platné rasty a kladné P/E. Horné P/E nesmie byť nižšie než dolné.' };
    }
    const input = { revenueGrowth, incomeGrowth, peLow, peHigh };
    try {
      return { years: projectStock(base, [input, input, input]), error: '' };
    } catch (failure) {
      return { years: [] as ProjectionYear[], error: failure instanceof Error ? failure.message : 'Východiskové údaje projekcie nie sú platné.' };
    }
  }, [base, draft]);
  const number = (value: number | null | undefined, digits = 2) =>
    value === null || value === undefined ? '—' : value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  const percent = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : `${number(value * 100)}%`;
  const compact = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : value.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', {
      notation: 'compact', maximumFractionDigits: 1,
    });
  const resultRows: Array<{ label: string; key: keyof ProjectionYear; format: typeof number; tone: TableColumnTone; start?: boolean }> = [
    { label: 'Tržby', key: 'revenue', format: compact, tone: 'cyan' },
    { label: 'Čistý zisk', key: 'netIncome', format: compact, tone: 'cyan' },
    { label: 'Čistá marža', key: 'margin', format: percent, tone: 'violet', start: true },
    { label: 'EPS', key: 'eps', format: number, tone: 'violet' },
    { label: 'Dolná cena akcie', key: 'priceLow', format: number, tone: 'amber', start: true },
    { label: 'Horná cena akcie', key: 'priceHigh', format: number, tone: 'amber' },
    { label: 'Dolné CAGR', key: 'cagrLow', format: percent, tone: 'green', start: true },
    { label: 'Horné CAGR', key: 'cagrHigh', format: percent, tone: 'green' },
  ];
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Page topInset={!embedded} onScrollViewLayout={setAvailableHeight}>
        {!embedded ? <Header title={t('Projekcie')} compact action={
          <Pressable accessibilityRole="button" accessibilityLabel={t('Späť')}
            style={styles.back} onPress={() => router.navigate('/compare')}>
            <ArrowLeft size={22} color={colors.text} />
          </Pressable>
        } /> : null}
        <View style={styles.select}>
          <Search size={18} color={colors.green} />
          <TextInput value={query} onChangeText={setQuery} onFocus={() => {
            setSearchOpen(true);
            setPortfolioOpen(false);
            setWatchlistsOpen(false);
          }}
            showSoftInputOnFocus autoCapitalize="characters" autoCorrect={false}
            accessibilityLabel={t('Hľadať akciu')}
            placeholder={symbol ? `${symbol} · ${t('Hľadať akciu')}` : t('Názov firmy alebo ticker')}
            placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" />
          {searching ? <ActivityIndicator size="small" color={colors.green} /> : null}
          {base && !searchOpen ? <Text style={styles.currentPrice}
            accessibilityLabel={`${t('Aktuálna cena')}: ${number(base.price)} ${base.currency}`}>
            {number(base.price)} {base.currency}
          </Text> : null}
          {symbol ? <Pressable accessibilityRole="button" accessibilityLabel={t('Zrušiť výber akcie')}
            style={styles.searchClose} onPress={() => selectStock('')}>
            <X size={18} color={colors.text} />
          </Pressable> : searchOpen ? <Pressable accessibilityRole="button" accessibilityLabel={t('Zavrieť')}
            style={styles.searchClose} onPress={() => {
              Keyboard.dismiss();
              setSearchOpen(false);
              setQuery('');
            }}><X size={16} color={colors.muted} /></Pressable> : null}
        </View>
        {searchOpen && query.trim().length >= 2 ? <View style={styles.results}>
          {searchError ? <Text accessibilityRole="alert" style={styles.error}>{errorText(searchError)}</Text> : null}
          {!searching && !searchError && !results.length ? <Text style={styles.hint}>{t('Žiadne akcie sa nenašli.')}</Text> : null}
          {results.map((asset) => <Pressable key={asset.symbol} accessibilityRole="button"
            accessibilityLabel={`${asset.symbol} · ${asset.name}`} style={styles.searchResult}
            onPress={() => selectStock(asset.symbol)}>
            <Text style={styles.selectText}>{asset.symbol}</Text>
            <Text style={styles.resultName} numberOfLines={1}>{asset.name}</Text>
          </Pressable>)}
        </View> : null}
        <View style={styles.quickSection}>
          <View style={styles.quickSelectors}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Z môjho portfólia')}
            accessibilityState={{ expanded: portfolioOpen }} style={styles.dropdownButton}
            onPress={() => {
              Keyboard.dismiss();
              setSearchOpen(false);
              setQuery('');
              setWatchlistsOpen(false);
              setPortfolioOpen((open) => !open);
            }}>
            <BriefcaseBusiness size={15} color={colors.muted} />
            <Text style={styles.dropdownLabel}>{t('Portfólio')}</Text>
            <View style={styles.countBadge}><Text style={styles.countText}>{quickStocks.length}</Text></View>
            <ChevronDown size={16} color={colors.muted} style={{ transform: [{ rotate: portfolioOpen ? '180deg' : '0deg' }] }} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Sledované')}
            accessibilityState={{ expanded: watchlistsOpen }} style={styles.dropdownButton} onPress={() => {
              Keyboard.dismiss();
              setSearchOpen(false);
              setQuery('');
              setPortfolioOpen(false);
              setWatchlistsOpen((open) => !open);
            }}>
            <Bookmark size={15} color={colors.muted} />
            <Text style={styles.dropdownLabel}>{t('Sledované')}</Text>
            <View style={styles.countBadge}><Text style={styles.countText}>{watchlists.lists.length}</Text></View>
            <ChevronDown size={16} color={colors.muted} />
          </Pressable>
          </View>
          {portfolioOpen || watchlistsOpen ? <Modal visible transparent animationType="fade" onRequestClose={() => {
            setPortfolioOpen(false); setWatchlistsOpen(false);
          }}>
            <View style={styles.menuScrim}>
              <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
                accessibilityLabel={t('Zavrieť')} onPress={() => { setPortfolioOpen(false); setWatchlistsOpen(false); }} />
              <View style={styles.dropdown}>
                <View style={styles.menuHeading}>
                  <Text style={styles.selectText}>{portfolioOpen ? t('Z môjho portfólia') : t('Sledované')}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Zavrieť')} style={styles.searchClose}
                    onPress={() => { setPortfolioOpen(false); setWatchlistsOpen(false); }}><X size={18} color={colors.text} /></Pressable>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator style={styles.menuList}>
            {portfolioOpen && !quickStocks.length ? <Text style={styles.emptyMenu}>{t('Žiadne otvorené pozície.')}</Text> : null}
            {portfolioOpen ? quickStocks.map((position) => <Pressable key={position.symbol} accessibilityRole="button"
              accessibilityLabel={`${t('Vybrať akciu')} ${position.symbol}`}
              accessibilityState={{ selected: symbol === position.symbol }}
              style={[styles.chip, symbol === position.symbol && styles.selectedChip]}
              onPress={() => selectStock(position.symbol)}>
              <Text style={[styles.chipText, symbol === position.symbol && styles.selectedChipText]}>{position.symbol}</Text>
              <Text style={styles.resultName} numberOfLines={1}>{position.name}</Text>
              {symbol === position.symbol ? <Check size={16} color={colors.green} /> : null}
            </Pressable>) : null}
            {watchlistsOpen ? <>
              {watchlists.loading ? <ActivityIndicator color={colors.green} /> : null}
              {watchlists.error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(watchlists.error)}</Text> : null}
              {watchlists.lists.map((list) => <View key={list.id}>
                <Text style={styles.listHeading}>{list.id === 'default' && list.name === 'Watchlist' ? t('Sledované') : list.name} ({list.symbols.length})</Text>
                {!list.symbols.length ? <Text style={styles.emptyMenu}>{t('Zoznam je prázdny.')}</Text> : null}
                {[...new Set(list.symbols)].map((ticker) => <Pressable key={ticker} accessibilityRole="button"
                  accessibilityLabel={`${t('Vybrať akciu')} ${ticker}`}
                  accessibilityState={{ selected: symbol === ticker }}
                  style={[styles.chip, symbol === ticker && styles.selectedChip]} onPress={() => selectStock(ticker)}>
                  <Text style={styles.chipText}>{ticker}</Text>
                  {symbol === ticker ? <Check size={16} color={colors.green} /> : null}
                </Pressable>)}
              </View>)}
            </> : null}
                </ScrollView>
              </View>
            </View>
          </Modal> : null}
        </View>
        {loading ? <ActivityIndicator style={styles.loading} color={colors.green} /> : null}
        {error ? <Surface><Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.back}>
            <Text style={styles.selectText}>{t('Skúsiť znova')}</Text>
          </Pressable>
        </Surface> : null}
        <>
          <View style={styles.inputs}>
            {fields.map((field) => <View key={field.key} style={styles.inputField}>
              <Text style={styles.inputLabel}>{t(field.label)}{field.percent ? ' %' : ''}</Text>
              <TextInput value={draft[field.key]} keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                accessibilityLabel={t(field.label)} editable={!!base}
                placeholder="—" placeholderTextColor={colors.muted} maxLength={14} style={styles.input}
                showSoftInputOnFocus selectTextOnFocus
                onChangeText={(value) => setDraft((previous) => ({ ...previous, [field.key]: value }))} />
            </View>)}
          </View>
          {base?.peHistoryUnavailable ? <Text accessibilityRole="alert" style={styles.hint}>
            {t('Historické P/E nie je dostupné. Zadaj P/E ručne.')}
          </Text> : null}
          <View onLayout={(event) => setTableTop(event.nativeEvent.layout.y)} style={styles.tableContainer}>
          <Surface style={styles.table}>
              <View>
                <View style={[styles.row, { minHeight: rowHeight }]}>
                  <TableColumn first header style={styles.label}><Text style={styles.heading}>{t('Ukazovatele')}</Text></TableColumn>
                  {['O 1 rok', 'O 2 roky', 'O 3 roky'].map((label) =>
                    <TableColumn key={label} tone="cyan" header style={styles.cell}><Text style={styles.heading}>{t(label)}</Text></TableColumn>)}
                </View>
                {resultRows.map((row) => <View key={row.key} style={[styles.row, { minHeight: rowHeight },
                  row.start && styles.sectionStart]}>
                  <TableColumn first tone={row.tone} style={styles.label}><Text style={[styles.labelText, styles.groupLabel]}
                    numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(row.label)}</Text></TableColumn>
                  {[0, 1, 2].map((index) => <TableColumn key={index}
                    tone={row.tone} style={styles.cell}>
                    <Text style={[styles.value,
                      row.tone === 'green' && calculation.years[index]?.[row.key] != null && {
                        color: (calculation.years[index]?.[row.key] ?? 0) < 0 ? colors.red : colors.green,
                      }]} adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1}
                      accessibilityLabel={calculation.years[index] && (row.key === 'revenue' || row.key === 'netIncome')
                        ? number(calculation.years[index][row.key], 0) : undefined}>
                      {row.format(calculation.years[index]?.[row.key])}
                    </Text>
                  </TableColumn>)}
                </View>)}
              </View>
          </Surface>
          </View>
          {calculation.error ? <Text accessibilityRole="alert" style={styles.error}>{t(calculation.error)}</Text> : null}
        </>
      </Page>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  flex: { flex: 1 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  select: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, marginBottom: 8, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  searchInput: { flex: 1, minWidth: 0, minHeight: 40, color: colors.text, fontSize: 13, paddingVertical: 6 },
  currentPrice: { color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  searchClose: { minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  results: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 8 },
  searchResult: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultName: { flex: 1, color: colors.muted, fontSize: 12 },
  quickSection: { marginBottom: 6 },
  quickSelectors: { flexDirection: 'row', gap: 8 },
  dropdownButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 34, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dropdownLabel: { flex: 1, color: colors.text, fontSize: 11, fontWeight: '700' },
  countBadge: { backgroundColor: colors.surfaceRaised, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  countText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  menuScrim: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.5)' },
  dropdown: { height: '65%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' },
  menuHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14 },
  menuList: { flex: 1 },
  listHeading: { color: colors.text, backgroundColor: colors.surfaceRaised, fontSize: 13, fontWeight: '800', paddingHorizontal: 14, paddingVertical: 10 },
  emptyMenu: { color: colors.muted, fontSize: 12, padding: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  selectedChip: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  selectedChipText: { color: colors.green },
  selectText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  hint: { color: colors.muted, fontSize: 12, marginVertical: 3, flexShrink: 1 },
  loading: { padding: 24 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 19, marginVertical: 10 },
  error: { color: colors.red, fontSize: 13, marginVertical: 10 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sectionStart: { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  groupLabel: { color: colors.text, fontWeight: '700' },
  tableContainer: { marginTop: 6 },
  table: { padding: 0, marginBottom: 0, overflow: 'hidden', borderRadius: 18,
    borderWidth: 2, borderColor: '#444444' },
  label: { flex: 1.2, minWidth: 0, paddingHorizontal: 6, paddingVertical: 3 },
  cell: { flex: 1, minWidth: 0, paddingHorizontal: 5, paddingVertical: 3 },
  heading: { color: colors.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  labelText: { color: colors.muted, fontSize: 12 },
  value: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  inputs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  inputField: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  inputLabel: { flex: 1, color: colors.muted, fontSize: 10 },
  input: { width: 62, color: colors.text, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 6, minHeight: 36, textAlign: 'right', fontSize: 13 },
});
