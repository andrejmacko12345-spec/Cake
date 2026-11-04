import type { ComponentRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, X } from 'lucide-react-native';
import { AssetLogo } from '../components/asset-logo';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { useLocale } from '../context/locale';
import { CompanyEvents, QuarterResult } from '../data/events';
import { earningsOutcome } from '../data/quarterly';
import { getEventsCacheSnapshot, preloadCompanyEvents, subscribeToEventsCache } from '../data/events-cache';
import { useEventPrefs } from '../data/event-prefs';
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
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;
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
  const router = useRouter();
  const { language, t } = useLocale();
  const sk = language === 'sk';
  const { positions } = usePositions();
  const prefs = useEventPrefs();
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

  const symbols = useMemo(
    () => [...new Set(positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol))],
    [positions],
  );
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
                      accessibilityLabel={`${label}: ${beat === null || !Number.isFinite(beat) ? (sk ? 'Odhad nedostupný' : 'Estimate unavailable') : beat > 0 ? 'Beat' : beat < 0 ? 'Miss' : (sk ? 'V súlade s odhadom' : 'In line')}`}>
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
      <Header compact title={t('Udalosti')} action={<Bell size={18} color={colors.text} />} />
      {loading ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {!symbols.length ? <Text style={styles.empty}>{t('Pridaj pozície a uvidíš udalosti svojich akcií.')}</Text> : null}
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
                {t('Beat = výsledok − odhad. Revenue beat je v mene tržieb, EPS beat na akciu. EPS používa metodiku konsenzu (GAAP alebo upravené).')}
              </Text>
              {detail?.quarters.some((quarter) => quarter.revenueBeatProvisional) ? (
                <Text style={styles.sheetNote}>{t('* Predbežný revenue beat z odhadu uloženého pred reportom; čaká na manuálne overenie.')}</Text>
              ) : null}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </Page>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function QuarterCard({ quarter, sk }: { quarter: QuarterResult; sk: boolean }) {
  const outcome = earningsOutcome(quarter);
  const accent = outcome === 'beat' ? colors.green : outcome === 'miss' ? colors.red : colors.muted;
  return (
    <Surface style={{ ...styles.quarter, borderColor: accent }}>
      <Text style={[styles.quarterTitle, { color: accent }]}>
        {quarter.label} · {outcome === 'beat' ? 'Beat'
          : outcome === 'miss' ? (sk ? 'Zaostanie' : 'Miss')
            : (sk ? 'Neutrálne / neúplné' : 'In-line / incomplete')}
      </Text>
      <Row label={sk ? 'Tržby' : 'Revenue'} value={fmtRevenue(quarter.revenue, sk)} />
      <Row label={sk ? 'Tržby YoY' : 'Revenue YoY'} value={fmtPct(quarter.revenueYoY)} color={pctColor(quarter.revenueYoY)} />
      <Row label={quarter.revenueBeatProvisional ? 'Revenue beat*' : 'Revenue beat'} value={fmtBeat(quarter.revenueBeat, sk, true)} color={pctColor(quarter.revenueBeat)} />
      <Row label="EPS" value={fmtNum(quarter.epsActual)} />
      <Row label="EPS beat" value={fmtBeat(quarter.epsBeat, sk)} color={pctColor(quarter.epsBeat)} />
    </Surface>
  );
}

const styles = StyleSheet.create({
  reportIndicators: { flexDirection: 'row', gap: 16 },
  reportIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reportDot: { width: 7, height: 7, borderRadius: 4 },
  loader: { marginVertical: 24 },
  empty: { color: colors.muted, fontSize: 12, textAlign: 'center', marginVertical: 18, lineHeight: 18 },
  eventCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 7, marginBottom: 4, borderRadius: 13 },
  dateBadge: {
    width: 34,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dateDay: { color: colors.text, fontSize: 16, fontWeight: '900' },
  dateMonth: { color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: 1 },
  eventAccent: { width: 3, alignSelf: 'stretch', borderRadius: 4, marginRight: 11 },
  eventBody: { flex: 1, minWidth: 0 },
  eventTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 },
  symbol: { color: colors.green, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  category: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  eventTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  eventTimeText: { color: colors.muted, fontSize: 10, marginTop: 2, flexShrink: 1 },
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
