import { useThemedStyles } from '../data/theme';
import { AnimatedCollapse } from '../components/animated-collapse';
import { selectionHaptic } from '../data/haptics';
import type { ComponentRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight, Filter, Minus, X } from 'lucide-react-native';
import { AssetLogo } from '../components/asset-logo';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { useLocale } from '../context/locale';
import { CompanyEvents, QuarterResult } from '../data/events';
import { earningsOutcome } from '../data/quarterly';
import { getEventsCacheSnapshot, preloadCompanyEvents, subscribeToEventsCache } from '../data/events-cache';
import { setEventSymbols, useEventPrefs } from '../data/event-prefs';
import { resolveEventSymbols, toggleEventSymbolGroup } from '../data/event-symbols';
import { useWatchlists } from '../hooks/use-watchlists';
import { availableAssets } from '../data/portfolio';
import { colors } from '../data/portfolio';
import { usePositions } from '../hooks/use-positions';
import { usePopupAnimation } from '../hooks/use-popup-animation';

type Category = 'Výsledky' | 'Dividendy' | 'Správy';

type EventItem = {
  key: string;
  symbol: string;
  category: Category;
  date: number; // ms
  title: string;
  lines: string[];
  link?: string;
  company?: CompanyEvents;
  report?: QuarterResult;
  upcoming?: boolean;
  color: string;
};

const DAY = 86_400_000;
const MONTHS_SK = ['JAN', 'FEB', 'MAR', 'APR', 'MÁJ', 'JÚN', 'JÚL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEC'];
const MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtNum(value: number | null, digits = 2) {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function fmtPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} %`;
}

function pctColor(value: number | null) {
  if (value === null || !Number.isFinite(value) || value === 0) return colors.muted;
  return value > 0 ? colors.green : colors.red;
}

function fmtRevenue(value: number | null, sk: boolean) {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} ${sk ? 'mld.' : 'B'}`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(0)} ${sk ? 'mil.' : 'M'}`;
  return value.toFixed(0);
}

function fmtBeat(value: number | null, sk: boolean, revenue = false) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${revenue ? fmtRevenue(value, sk) : fmtNum(value)}`;
}

// Čas zverejnenia výsledkov: pred otvorením / po zatvorení trhu podľa newyorského času.
function earningsTime(ms: number, sk: boolean) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(ms));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN) % 24;
    if (!Number.isFinite(hour)) return null;
    if (hour < 9) return sk ? 'pred otvorením trhu' : 'before market open';
    if (hour >= 16) return sk ? 'po zatvorení trhu' : 'after market close';
    return sk ? 'počas obchodovania' : 'during market hours';
  } catch {
    return null;
  }
}

export default function EventsScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { language, t, errorText } = useLocale();
  const sk = language === 'sk';
  const { positions } = usePositions();
  const prefs = useEventPrefs();
  const watchlists = useWatchlists();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSymbols, setDraftSymbols] = useState<string[] | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [cache, setCache] = useState(getEventsCacheSnapshot);
  const [detail, setDetail] = useState<CompanyEvents | null>(null);
  const detailPosition = positions.find((position) => position.symbol === detail?.symbol);
  const dailyChange = detailPosition?.hasMarketQuote && Number.isFinite(detailPosition.dailyChangePct)
    ? detailPosition.dailyChangePct : null;
  const detailAnimation = usePopupAnimation(detail !== null);
  const closeDetail = () => detailAnimation.close(() => setDetail(null));
  const [detailUpcoming, setDetailUpcoming] = useState(false);
  const [screenFocused, setScreenFocused] = useState(false);
  const [scrollHeight, setScrollHeight] = useState(0);
  const [todayPosition, setTodayPosition] = useState<{ y: number; height: number } | null>(null);

  useFocusEffect(useCallback(() => {
    setScreenFocused(true);
    return () => setScreenFocused(false);
  }, []));

  const portfolioSymbols = useMemo(
    () => [...new Set(positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol))],
    [positions],
  );
  const watchlistSymbols = useMemo(() => watchlists.lists.flatMap((list) => list.symbols), [watchlists.lists]);
  const symbols = useMemo(() => resolveEventSymbols(portfolioSymbols, watchlistSymbols, prefs.symbols),
    [portfolioSymbols, watchlistSymbols, prefs.symbols]);
  const selectedSymbols = resolveEventSymbols(portfolioSymbols, watchlistSymbols, draftSymbols);
  const toggleSymbol = (symbol: string) => {
    setDraftSymbols((previous) => toggleEventSymbolGroup(portfolioSymbols, previous, [symbol]));
  };
  const selectionMark = (checked: boolean | 'mixed') => (
    <View style={[styles.selectionBox, checked !== false && styles.selectionBoxActive]}>
      {checked === 'mixed' ? <Minus size={14} strokeWidth={3} color={colors.background} />
        : checked ? <Check size={14} strokeWidth={3} color={colors.background} /> : null}
    </View>
  );
  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await setEventSymbols(draftSymbols);
      setSettingsOpen(false);
    } catch (error) {
      console.warn('Event stock selection could not be saved:', error);
      Alert.alert(t('Chyba'), errorText(error instanceof Error ? error.message : String(error)));
    } finally {
      setSavingSettings(false);
    }
  };
  const symbolKey = symbols.join(',');

  useEffect(() => {
    const unsubscribe = subscribeToEventsCache(setCache);
    setCache(getEventsCacheSnapshot());
    return unsubscribe;
  }, [symbolKey]);

  useFocusEffect(useCallback(() => {
    if (symbols.length) void preloadCompanyEvents(symbols);
  }, [symbolKey]));

  const data = useMemo(
    () => Object.fromEntries(symbols.flatMap((symbol) => cache.data[symbol] ? [[symbol, cache.data[symbol]]] : [])),
    [cache.data, symbolKey],
  );
  const loading = symbols.some((symbol) => cache.loading.includes(symbol));
  const failed = symbols.length > 0 && symbols.every((symbol) => !data[symbol] && cache.errors[symbol]);

  const items = useMemo(() => {
    const now = Date.now();
    const list: EventItem[] = [];
    for (const company of Object.values(data)) {
      const symbol = company.symbol;
      const latestReportMs = company.lastReportDate ? company.lastReportDate * 1000 : 0;
      const reportedThisPeriod = latestReportMs > now - 90 * DAY && latestReportMs <= now;
      const showNext = !!company.nextEarnings && (!reportedThisPeriod || !company.quarters.length);
      const showPast = !showNext;
      if (company.nextEarnings && showNext) {
        const next = company.nextEarnings;
        const ms = next.date * 1000;
        const lines: string[] = [];
        const time = earningsTime(ms, sk);
        if (time) lines.push(time);
        if (next.estimate) lines.push(sk ? 'Dátum je orientačný' : 'Date is an estimate');
        list.push({
          key: `${symbol}-next`,
          upcoming: true,
          symbol,
          category: 'Výsledky',
          date: ms,
          title: `${sk ? 'Výsledky' : 'Earnings'}${next.label ? ` ${next.label}` : ''}`,
          lines,
          company,
          color: colors.violet,
        });
      }
      const latest = company.quarters[0];
      // Presný dátum starších výsledkov Yahoo nedáva; odvodíme ho z oneskorenia posledného reportu.
      let lag = company.lastReportDate && latest
        ? company.lastReportDate * 1000 - new Date(latest.periodEnd).getTime()
        : 30 * DAY;
      if (!(lag > 0 && lag < 75 * DAY)) lag = 30 * DAY;
      (showPast ? company.quarters.slice(0, 1) : []).forEach((quarter, index) => {
        const reportedMs = index === 0 && company.lastReportDate
          ? company.lastReportDate * 1000
          : new Date(quarter.periodEnd).getTime() + lag;
        if (!reportedMs || reportedMs > now) return;
        list.push({
          key: `${symbol}-q-${quarter.label}`,
          symbol,
          category: 'Výsledky',
          date: reportedMs,
          title: `${sk ? 'Výsledky' : 'Earnings'} ${quarter.label}`,
          lines: [],
          report: quarter,
          company,
          color: earningsOutcome(quarter) === 'beat' ? colors.green
            : earningsOutcome(quarter) === 'miss' ? colors.red : colors.muted,
        });
      });
      const dividendLine = company.dividendAmount !== null
        ? [`${sk ? 'Dividenda' : 'Dividend'}: ${fmtNum(company.dividendAmount, 3)} ${company.currency}`]
        : [];
      for (const [field, label] of [
        [company.dividendPay, sk ? 'Výplata dividendy' : 'Dividend payment'],
      ] as const) {
        if (field === null) continue;
        const ms = field * 1000;
        if (ms < now - 90 * DAY) continue;
        list.push({
          key: `${symbol}-div-${label}`,
          symbol,
          category: 'Dividendy',
          date: ms,
          title: label,
          lines: dividendLine,
          color: colors.cyan,
        });
      }
      for (const news of company.news.slice(0, 1)) {
        const ms = news.time * 1000;
        if (now - ms > 7 * DAY) continue;
        list.push({
          key: `${symbol}-news-${news.link}`,
          symbol,
          category: 'Správy',
          date: ms,
          title: news.title,
          lines: [news.publisher],
          link: news.link,
          color: colors.blue,
        });
      }
    }
    return list.filter((item) => item.category === 'Výsledky' ? prefs.earnings : item.category === 'Dividendy' ? prefs.dividends : prefs.news);
  }, [data, prefs, sk]);

  const now = Date.now();
  const timelinePast = items.filter((item) => item.date < now || item.category === 'Správy').sort((a, b) => a.date - b.date);
  const timelineFuture = items.filter((item) => item.date >= now && item.category !== 'Správy').sort((a, b) => a.date - b.date);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  useEffect(() => {
    if (!screenFocused || !items.length || !todayPosition || !scrollHeight) return;
    const timer = setTimeout(() => {
      const centeredY = todayPosition.y - (scrollHeight - todayPosition.height) / 2;
      scrollRef.current?.scrollTo({ y: Math.max(0, centeredY), animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [items.length, screenFocused, scrollHeight, todayPosition]);

  const renderItem = (item: EventItem) => {
    const date = new Date(item.date);
    const months = sk ? MONTHS_SK : MONTHS_EN;
    const clickable = item.category === 'Výsledky' || item.link;
    const reported = item.category === 'Výsledky' && item.date <= Date.now();
    const onPress = () => {
      if (item.link) void Linking.openURL(item.link).catch(() => undefined);
      else if (item.company) {
        setDetailUpcoming(item.upcoming === true);
        setDetail(item.company);
      }
    };
    return (
      <Pressable key={item.key} disabled={!clickable} onPress={onPress}>
        <Surface style={reported ? { ...styles.eventCard, borderLeftWidth: 4, borderLeftColor: item.color, backgroundColor: item.color === colors.red ? 'rgba(239,68,68,0.12)' : item.color === colors.green ? 'rgba(34,197,94,0.12)' : colors.surface } : styles.eventCard}>
          <View style={styles.dateBadge}>
            <Text style={styles.dateDay}>{String(date.getDate()).padStart(2, '0')}</Text>
            <Text style={styles.dateMonth}>{months[date.getMonth()]}</Text>
          </View>
          <AssetLogo symbol={item.symbol} color={item.color} size={32} />
          <View style={styles.eventBody}>
            <View style={styles.eventTopline}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.category}>{item.report ? item.report.label : t(item.category)}</Text>
            </View>
            {!item.report ? <Text style={styles.eventTitle} numberOfLines={item.category === 'Správy' ? 2 : 1}>
              {item.category === 'Výsledky'
                ? item.title.replace(/^(Výsledky|Earnings)\s*/, '')
                : item.title}
            </Text> : null}
            {item.report ? (
              <View style={styles.reportPreview}>
                <View style={styles.reportIndicators}>
                  {([
                    [sk ? 'Tržby' : 'Revenue', item.report.revenueBeat],
                    ['EPS', item.report.epsBeat],
                  ] as const).map(([label, beat]) => (
                    <View key={label} style={styles.reportIndicator} accessible
                      accessibilityLabel={`${label}: ${beat === null || !Number.isFinite(beat) ? (sk ? 'Odhad nedostupný' : 'Estimate unavailable') : beat > 0 ? t('Prekonanie odhadu') : beat < 0 ? t('Zaostanie za odhadom') : (sk ? 'V súlade s odhadom' : 'In line')}`}>
                      <Text style={styles.eventTimeText}>{label}</Text>
                      <View style={[styles.reportDot, { backgroundColor: pctColor(beat) }]} />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {item.lines.length ? (
              <Text style={styles.eventTimeText} numberOfLines={1}>{item.lines.join(' · ')}</Text>
            ) : null}
          </View>
          {clickable ? <ChevronRight size={16} color={colors.muted} /> : null}
        </Surface>
      </Pressable>
    );
  };

  return (
    <Page scrollRef={scrollRef} onScrollViewLayout={setScrollHeight}>
      <Header compact title={t('Udalosti')} action={
        <Pressable accessibilityRole="button" accessibilityLabel={t('Nastavenia udalostí')}
          style={styles.closeButton} onPress={() => { setDraftSymbols(prefs.symbols); setExpandedGroups([]); setSettingsOpen(true); }}>
          <Filter size={18} color={colors.text} />
        </Pressable>
      } />
      {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {!symbols.length ? <Text style={styles.empty}>{t('Vyber akcie v nastaveniach udalostí alebo pridaj pozície do portfólia.')}</Text> : null}
      {failed && symbols.length ? <Text style={styles.empty}>{t('Údaje sa nepodarilo načítať. Potiahni nadol a skús znova.')}</Text> : null}

      {timelinePast.map(renderItem)}
      {items.length ? (
        <View
          onLayout={(event) => {
            const { y, height } = event.nativeEvent.layout;
            setTodayPosition((previous) =>
              previous?.y === y && previous.height === height ? previous : { y, height },
            );
          }}
          style={styles.todayRow}
        >
          <View style={styles.todayLine} />
          <Text style={styles.todayText}>{sk ? 'DNES' : 'TODAY'}</Text>
          <View style={styles.todayLine} />
        </View>
      ) : null}
      {timelineFuture.map(renderItem)}

      <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => {
        if (!savingSettings) setSettingsOpen(false);
      }}>
        <View style={[styles.scrim, styles.backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} disabled={savingSettings} onPress={() => setSettingsOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, styles.sheetCopy]}>{t('Nastavenia udalostí')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Zavrieť')} disabled={savingSettings}
                style={styles.closeButton} onPress={() => setSettingsOpen(false)}>
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView>
              {watchlists.loading ? <ActivityIndicator color={colors.green} /> : null}
              {watchlists.error ? <Text accessibilityRole="alert" style={styles.empty}>{errorText(watchlists.error)}</Text> : null}
              {[{ id: 'portfolio', name: t('Portfólio'), symbols: portfolioSymbols },
                { id: 'watchlist', name: t('Sledované'), symbols: [...new Set(watchlistSymbols)] }].map((group) => {
                const count = group.symbols.filter((symbol) => selectedSymbols.includes(symbol)).length;
                const checked = group.symbols.length > 0 && count === group.symbols.length
                  ? true : count > 0 ? 'mixed' : false;
                const expanded = expandedGroups.includes(group.id);
                const disabled = savingSettings || (group.id === 'watchlist' && (watchlists.loading || !!watchlists.error));
                return (
                  <View key={group.id} style={styles.selectionGroup}>
                    <View style={styles.groupHeader}>
                      <Pressable accessibilityRole="checkbox" accessibilityLabel={group.name}
                        accessibilityState={{ checked, disabled: disabled || !group.symbols.length }}
                        aria-checked={checked} disabled={disabled || !group.symbols.length}
                        style={styles.groupSelect} onPress={() => setDraftSymbols((previous) =>
                          toggleEventSymbolGroup(portfolioSymbols, previous, group.symbols, group.id === 'portfolio'))}>
                        {selectionMark(checked)}
                        <View style={styles.sheetCopy}>
                          <Text style={styles.groupTitle}>{group.name}</Text>
                          <Text style={styles.selectionCount}>{count} / {group.symbols.length} · {t('Vybrané akcie')}</Text>
                        </View>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${t('Detail akcií')} · ${group.name}`}
                        accessibilityState={{ expanded }} disabled={savingSettings}
                        style={styles.expandButton} onPress={() => {
                          selectionHaptic();
                          setExpandedGroups((previous) => expanded
                            ? previous.filter((id) => id !== group.id) : [...previous, group.id]);
                        }}>
                        <ChevronDown size={20} color={colors.muted} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                      </Pressable>
                    </View>
                    <AnimatedCollapse expanded={expanded}><View style={styles.groupDetails}>
                      {group.symbols.length ? group.symbols.map((symbol) => {
                        const name = positions.find((position) => position.symbol === symbol)?.name
                          ?? availableAssets.find((asset) => asset.symbol === symbol)?.name;
                        const selected = selectedSymbols.includes(symbol);
                        return (
                          <Pressable key={symbol} accessibilityRole="checkbox" accessibilityLabel={`${symbol}${name ? ` · ${name}` : ''}`}
                            accessibilityState={{ checked: selected }} aria-checked={selected} disabled={disabled}
                            style={styles.stockOption} onPress={() => toggleSymbol(symbol)}>
                            {selectionMark(selected)}
                            <View style={styles.sheetCopy}>
                              <Text style={styles.stockTicker}>{symbol}</Text>
                              {name ? <Text style={styles.sheetSubtitle}>{name}</Text> : null}
                            </View>
                          </Pressable>
                        );
                      }) : <Text style={styles.sheetNote}>{t('Žiadne akcie')}</Text>}
                    </View></AnimatedCollapse>
                  </View>
                );
              })}
              <Text style={styles.sheetNote}>{draftSymbols === null
                ? t('Nové pozície sa pridajú automaticky.')
                : t('Vlastný výber akcií. Nové akcie pridaj ručne.')}</Text>
            </ScrollView>
            <Pressable accessibilityRole="button" disabled={savingSettings || watchlists.loading || !!watchlists.error}
              style={[styles.saveSelection, (savingSettings || watchlists.loading || !!watchlists.error) && { opacity: 0.5 }]}
              onPress={() => void saveSettings()}>
              {savingSettings ? <ActivityIndicator color={colors.background} /> : <Text style={styles.saveSelectionText}>{t('Uložiť')}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={detail !== null} animationType="none" transparent onRequestClose={closeDetail}>
        <View style={styles.scrim}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, detailAnimation.backdrop]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDetail} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} />
          <Animated.View style={[styles.sheet, detailAnimation.sheet]}>
            <View style={styles.sheetHeader}>
              <Pressable style={({ pressed }) => [styles.sheetCopy, styles.stockLink, pressed && { opacity: 0.65 }]} accessibilityRole="button"
                accessibilityLabel={`${t('Detail akcie')} ${detail?.symbol ?? ''}`}
                onPress={() => {
                  if (!detail) return;
                  const symbol = detail.symbol;
                  detailAnimation.close(() => {
                    setDetail(null);
                    router.push({ pathname: '/position', params: { symbol } });
                  });
                }}>
                <View style={styles.stockLinkCopy}>
                  <View style={styles.stockLinkTitle}>
                    <Text style={styles.sheetTitle}>{detail?.symbol}</Text>
                    <Text style={[styles.dailyChange, { color: pctColor(dailyChange) }]}>{fmtPct(dailyChange)}</Text>
                  </View>
                  <Text style={styles.sheetSubtitle} numberOfLines={1}>{detail?.name}</Text>
                </View>
                <ChevronRight size={20} color={colors.muted} />
              </Pressable>
              <Pressable onPress={closeDetail} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} style={styles.closeButton}>
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView>
              {detailUpcoming && detail?.nextEarnings ? (
                <Surface style={styles.upcoming}>
                  <Text style={[styles.quarterTitle, { color: colors.violet }]}>
                    {detail.nextEarnings.label ? `${detail.nextEarnings.label} · ` : ''}{t('Očakávané výsledky')}
                  </Text>
                  {detail.nextEarnings.estimates?.revenueCurrency ? (
                    <Text style={styles.metricCurrency}>
                      {sk ? 'Tržby' : 'Revenue'}: {detail.nextEarnings.estimates.revenueCurrency}
                      {detail.nextEarnings.estimates.epsCurrency ? ` · EPS: ${detail.nextEarnings.estimates.epsCurrency}` : ''}
                    </Text>
                  ) : null}
                  <Row label={sk ? 'Tržby' : 'Revenue'}
                    value={fmtRevenue(detail.nextEarnings.estimates?.revenue ?? null, sk)} />
                  <Row label={sk ? 'Tržby YoY' : 'Revenue YoY'} value={fmtPct(detail.nextEarnings.estimates?.revenueYoY ?? null)}
                    color={pctColor(detail.nextEarnings.estimates?.revenueYoY ?? null)} />
                  <Row label="EPS"
                    value={fmtNum(detail.nextEarnings.estimates?.eps ?? null)} />
                  <Row label="EPS YoY" value={fmtPct(detail.nextEarnings.estimates?.epsYoY ?? null)}
                    color={pctColor(detail.nextEarnings.estimates?.epsYoY ?? null)} />
                  <Text style={styles.sheetNote}>{t('Odhady analytikov, nie zverejnené výsledky. Chýbajúci alebo nejednoznačný odhad je označený pomlčkou.')}</Text>
                </Surface>
              ) : null}
              {detailUpcoming && detail?.quarters.length ? <SectionTitle title={t('Zverejnené výsledky')} /> : null}
              {detail?.quarters.length ? (
                detail.quarters.slice(0, 4).map((quarter) => (
                  <QuarterCard key={quarter.label} quarter={quarter} sk={sk} />
                ))
              ) : (
                <Text style={styles.empty}>{t('Výsledky zatiaľ nie sú dostupné.')}</Text>
              )}
              {detail?.financialDataIssue ? (
                <Text style={styles.sheetNote}>
                  {t('Niektoré výsledky alebo historické odhady analytikov nie sú dostupné.')}
                </Text>
              ) : null}
              <Text style={styles.sheetNote}>
                {t('Rozdiel = výsledok − odhad. Rozdiel tržieb je v mene tržieb, rozdiel EPS na akciu. EPS používa metodiku konsenzu (GAAP alebo upravené).')}
              </Text>
              {detail?.quarters.some((quarter) => quarter.revenueBeatProvisional) ? (
                <Text style={styles.sheetNote}>{t('* Predbežný rozdiel tržieb z odhadu uloženého pred reportom; čaká na manuálne overenie.')}</Text>
              ) : null}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </Page>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function QuarterCard({ quarter, sk }: { quarter: QuarterResult; sk: boolean }) {
  const styles = useThemedStyles(createStyles);
  const outcome = earningsOutcome(quarter);
  const accent = outcome === 'beat' ? colors.green : outcome === 'miss' ? colors.red : colors.muted;
  return (
    <Surface style={{ ...styles.quarter, borderColor: accent }}>
      <Text style={[styles.quarterTitle, { color: accent }]}>
        {quarter.label} · {outcome === 'beat' ? (sk ? 'Prekonanie odhadu' : 'Beat')
          : outcome === 'miss' ? (sk ? 'Zaostanie' : 'Miss')
            : (sk ? 'Neutrálne / neúplné' : 'In-line / incomplete')}
      </Text>
      <Row label={sk ? 'Tržby' : 'Revenue'} value={fmtRevenue(quarter.revenue, sk)} />
      <Row label={sk ? 'Tržby YoY' : 'Revenue YoY'} value={fmtPct(quarter.revenueYoY)} color={pctColor(quarter.revenueYoY)} />
      <Row label={`${sk ? 'Rozdiel tržieb oproti odhadu' : 'Revenue beat'}${quarter.revenueBeatProvisional ? '*' : ''}`} value={fmtBeat(quarter.revenueBeat, sk, true)} color={pctColor(quarter.revenueBeat)} />
      <Row label="EPS" value={fmtNum(quarter.epsActual)} />
      <Row label={sk ? 'Rozdiel EPS oproti odhadu' : 'EPS beat'} value={fmtBeat(quarter.epsBeat, sk)} color={pctColor(quarter.epsBeat)} />
    </Surface>
  );
}

const createStyles = () => StyleSheet.create({
  stockOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10 },
  selectionGroup: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 10, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center' },
  groupSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 68 },
  groupTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  selectionCount: { color: colors.muted, fontSize: 11, marginTop: 4, fontVariant: ['tabular-nums'] },
  expandButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  groupDetails: { paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectionBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  selectionBoxActive: { backgroundColor: colors.green, borderColor: colors.green },
  stockTicker: { color: colors.text, fontSize: 13, fontWeight: '800' },
  saveSelection: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, marginTop: 8 },
  saveSelectionText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  reportIndicators: { flexDirection: 'row', gap: 16 },
  reportIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reportDot: { width: 7, height: 7, borderRadius: 4 },
  loader: { marginVertical: 24 },
  empty: { color: colors.muted, fontSize: 12, textAlign: 'center', marginVertical: 18, lineHeight: 18 },
  eventCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 9, marginBottom: 5, borderRadius: 14 },
  dateBadge: {
    width: 38,
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dateDay: { color: colors.text, fontSize: 17, fontWeight: '900' },
  dateMonth: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 1 },
  eventAccent: { width: 3, alignSelf: 'stretch', borderRadius: 4, marginRight: 11 },
  eventBody: { flex: 1, minWidth: 0 },
  eventTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 },
  symbol: { color: colors.green, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  category: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  eventTimeText: { color: colors.muted, fontSize: 11, marginTop: 2, flexShrink: 1 },
  reportPreview: { marginTop: 2 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sheetCopy: { flex: 1 },
  stockLink: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 10, borderRadius: 14, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  stockLinkCopy: { flex: 1, minWidth: 0 },
  stockLinkTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 10 },
  dailyChange: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sheetSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetNote: { color: colors.muted, fontSize: 11, marginVertical: 8, lineHeight: 16 },
  quarter: { marginBottom: 10, borderWidth: 1 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  todayLine: { flex: 1, height: 1, backgroundColor: colors.green },
  todayText: { color: colors.green, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  upcoming: { marginBottom: 10, borderWidth: 1, borderColor: colors.violet, backgroundColor: 'rgba(100,121,255,0.07)' },
  metricCurrency: { color: colors.muted, fontSize: 10, marginBottom: 6 },
  quarterTitle: { color: colors.text, fontSize: 14, fontWeight: '900', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.muted, fontSize: 12 },
  rowValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
});
