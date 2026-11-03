import type { ComponentRef } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronRight, Clock3, Newspaper, X } from 'lucide-react-native';
import { AssetLogo } from '../components/asset-logo';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { useLocale } from '../context/locale';
import { CompanyEvents, fetchCompanyEvents, QuarterResult } from '../data/events';
import { colors } from '../data/portfolio';
import { usePositions } from '../hooks/use-positions';

type Category = 'Výsledky' | 'Dividendy' | 'Správy';
type Filter = 'Všetko' | Category;

type EventItem = {
  key: string;
  symbol: string;
  category: Category;
  date: number; // ms
  title: string;
  lines: string[];
  link?: string;
  company?: CompanyEvents;
  color: string;
};

const filters: Filter[] = ['Všetko', 'Výsledky', 'Dividendy', 'Správy'];
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

async function loadAll(symbols: string[], force: boolean) {
  const result: Record<string, CompanyEvents> = {};
  let index = 0;
  const worker = async () => {
    while (index < symbols.length) {
      const symbol = symbols[index++];
      try {
        result[symbol] = await fetchCompanyEvents(symbol, force);
      } catch {
        // symbol bez dát preskočíme
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, symbols.length) }, worker));
  return result;
}

export default function EventsScreen() {
  const { language, t } = useLocale();
  const sk = language === 'sk';
  const { positions } = usePositions();
  const [filter, setFilter] = useState<Filter>('Všetko');
  const [data, setData] = useState<Record<string, CompanyEvents>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<CompanyEvents | null>(null);

  const symbols = useMemo(
    () => [...new Set(positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol))],
    [positions],
  );
  const symbolKey = symbols.join(',');

  const load = useCallback(
    async (force: boolean) => {
      if (!symbols.length) {
        setData({});
        return;
      }
      setLoading(true);
      const loaded = await loadAll(symbols, force);
      setData(loaded);
      setFailed(Object.keys(loaded).length === 0);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbolKey],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

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
        if (next.epsEstimate !== null) lines.push(`${sk ? 'Odhad EPS' : 'EPS estimate'}: ${fmtNum(next.epsEstimate)}`);
        if (next.revenueEstimate !== null) {
          lines.push(`${sk ? 'Odhad tržieb' : 'Revenue estimate'}: ${fmtRevenue(next.revenueEstimate, sk)}`);
        }
        if (next.estimate) lines.push(sk ? 'Dátum je orientačný' : 'Date is an estimate');
        list.push({
          key: `${symbol}-next`,
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
        const lines: string[] = [];
        if (quarter.epsActual !== null) {
          lines.push(`EPS ${fmtNum(quarter.epsActual)} ${sk ? 'vs odhad' : 'vs est.'} ${fmtNum(quarter.epsEstimate)}`);
        }
        if (quarter.epsSurprisePct !== null) {
          lines.push(
            `${quarter.epsSurprisePct >= 0 ? (sk ? 'Prekonané' : 'Beat') : sk ? 'Nedosiahnuté' : 'Missed'} ${fmtPct(quarter.epsSurprisePct)}`,
          );
        }
        list.push({
          key: `${symbol}-q-${quarter.label}`,
          symbol,
          category: 'Výsledky',
          date: reportedMs,
          title: `${sk ? 'Výsledky' : 'Earnings'} ${quarter.label}`,
          lines,
          company,
          color: quarter.epsSurprisePct !== null && quarter.epsSurprisePct < 0 ? colors.red : colors.green,
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
    return list.filter((item) => filter === 'Všetko' || item.category === filter);
  }, [data, filter, sk]);

  const now = Date.now();
  const timelinePast = items.filter((item) => item.date < now || item.category === 'Správy').sort((a, b) => a.date - b.date);
  const timelineFuture = items.filter((item) => item.date >= now && item.category !== 'Správy').sort((a, b) => a.date - b.date);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const todayY = useRef(0);
  const scrolledToToday = useRef(false);
  useEffect(() => {
    if (scrolledToToday.current || !items.length) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, todayY.current - 90), animated: false });
      scrolledToToday.current = true;
    }, 150);
    return () => clearTimeout(timer);
  }, [items.length]);

  const renderItem = (item: EventItem) => {
    const date = new Date(item.date);
    const months = sk ? MONTHS_SK : MONTHS_EN;
    const clickable = item.category === 'Výsledky' || item.link;
    const onPress = () => {
      if (item.link) void Linking.openURL(item.link).catch(() => undefined);
      else if (item.company) setDetail(item.company);
    };
    return (
      <Pressable key={item.key} disabled={!clickable} onPress={onPress}>
        <Surface style={styles.eventCard}>
          <View style={styles.dateBadge}>
            <Text style={styles.dateDay}>{String(date.getDate()).padStart(2, '0')}</Text>
            <Text style={styles.dateMonth}>{months[date.getMonth()]}</Text>
          </View>
          <AssetLogo symbol={item.symbol} color={item.color} size={34} />
          <View style={styles.eventBody}>
            <View style={styles.eventTopline}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.category}>{t(item.category)}</Text>
            </View>
            <Text style={styles.eventTitle} numberOfLines={item.category === 'Správy' ? 3 : 2}>{item.title}</Text>
            {item.lines.map((line) => (
              <View key={line} style={styles.eventTime}>
                {item.category === 'Správy' ? (
                  <Newspaper size={12} color={colors.muted} />
                ) : (
                  <Clock3 size={12} color={colors.muted} />
                )}
                <Text style={styles.eventTimeText}>{line}</Text>
              </View>
            ))}
          </View>
          {clickable ? <ChevronRight size={16} color={colors.muted} /> : null}
        </Surface>
      </Pressable>
    );
  };

  return (
    <Page scrollRef={scrollRef}>
      <Header title={t('Udalosti')} subtitle={t('Podľa tvojho portfólia')} action={<Bell size={20} color={colors.text} />} />
      <View style={styles.filterRow}>
        {filters.map((item) => {
          const selected = filter === item;
          return (
            <Pressable
              key={item}
              onPress={() => setFilter(item)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{t(item)}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && !items.length ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
      {!symbols.length ? <Text style={styles.empty}>{t('Pridaj pozície a uvidíš udalosti svojich akcií.')}</Text> : null}
      {failed && symbols.length ? <Text style={styles.empty}>{t('Údaje sa nepodarilo načítať. Potiahni nadol a skús znova.')}</Text> : null}

      {timelinePast.map(renderItem)}
      {items.length ? (
        <View onLayout={(event) => { todayY.current = event.nativeEvent.layout.y; }} style={styles.todayRow}>
          <View style={styles.todayLine} />
          <Text style={styles.todayText}>{sk ? 'DNES' : 'TODAY'}</Text>
          <View style={styles.todayLine} />
        </View>
      ) : null}
      {timelineFuture.map(renderItem)}

      <Modal visible={detail !== null} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetCopy}>
                <Text style={styles.sheetTitle}>{detail?.symbol}</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>{detail?.name}</Text>
              </View>
              <Pressable onPress={() => setDetail(null)} accessibilityRole="button" style={styles.closeButton}>
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView>
              {detail?.nextEarnings ? <UpcomingCard company={detail} sk={sk} /> : null}
              {detail?.quarters.length ? (
                detail.quarters.slice(0, 4).map((quarter, index) => (
                  <QuarterCard key={quarter.label} quarter={quarter} first={index === 0} sk={sk} />
                ))
              ) : (
                <Text style={styles.empty}>{t('Výsledky zatiaľ nie sú dostupné.')}</Text>
              )}
              <Text style={styles.sheetNote}>{t('Odhad tržieb Yahoo pre zverejnené štvrťroky neposkytuje.')}</Text>
            </ScrollView>
          </View>
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

function UpcomingCard({ company, sk }: { company: CompanyEvents; sk: boolean }) {
  const next = company.nextEarnings;
  if (!next) return null;
  const last = company.quarters[3];
  const growth = (estimate: number | null, base: number | null | undefined) =>
    estimate !== null && base ? ((estimate - base) / Math.abs(base)) * 100 : null;
  const epsYoY = growth(next.epsEstimate, last?.epsActual);
  const revYoY = growth(next.revenueEstimate, last?.revenue);
  const ms = next.date * 1000;
  const time = earningsTime(ms, sk);
  return (
    <Surface style={styles.upcoming}>
      <Text style={styles.quarterTitle}>
        {sk ? 'Očakávania' : 'Expectations'}{next.label ? ` · ${next.label}` : ''}
      </Text>
      <Row
        label={sk ? 'Dátum výsledkov' : 'Report date'}
        value={`${new Date(ms).toLocaleDateString(sk ? 'sk-SK' : 'en-US')}${next.estimate ? (sk ? ' (orientačne)' : ' (est.)') : ''}`}
      />
      {time ? <Row label={sk ? 'Čas' : 'Time'} value={time} /> : null}
      <Row label={sk ? 'Tržby (odhad)' : 'Revenue (est.)'} value={fmtRevenue(next.revenueEstimate, sk)} />
      <Row label={sk ? 'Tržby r/r (odhad)' : 'Revenue YoY (est.)'} value={fmtPct(revYoY)} color={pctColor(revYoY)} />
      <Row label={sk ? 'EPS (odhad)' : 'EPS (est.)'} value={fmtNum(next.epsEstimate)} />
      <Row label={sk ? 'EPS r/r (odhad)' : 'EPS YoY (est.)'} value={fmtPct(epsYoY)} color={pctColor(epsYoY)} />
    </Surface>
  );
}

function QuarterCard({ quarter, first, sk }: { quarter: QuarterResult; first: boolean; sk: boolean }) {
  const diff = quarter.epsActual !== null && quarter.epsEstimate !== null ? quarter.epsActual - quarter.epsEstimate : null;
  return (
    <Surface style={first ? styles.quarterFirst : styles.quarter}>
      <Text style={styles.quarterTitle}>{quarter.label}</Text>
      <Row label={sk ? 'Tržby' : 'Revenue'} value={fmtRevenue(quarter.revenue, sk)} />
      <Row label={sk ? 'Tržby r/r' : 'Revenue YoY'} value={fmtPct(quarter.revenueYoY)} color={pctColor(quarter.revenueYoY)} />
      <Row label="EPS" value={fmtNum(quarter.epsActual)} />
      <Row label={sk ? 'EPS r/r' : 'EPS YoY'} value={fmtPct(quarter.epsYoY)} color={pctColor(quarter.epsYoY)} />
      <Row label={sk ? 'Odhad analytikov (EPS)' : 'Analyst estimate (EPS)'} value={fmtNum(quarter.epsEstimate)} />
      <Row
        label={sk ? 'Prekonanie / nedosiahnutie' : 'Beat / miss'}
        value={diff === null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${fmtPct(quarter.epsSurprisePct)})`}
        color={pctColor(quarter.epsSurprisePct)}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterChip: { backgroundColor: colors.surface, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 13 },
  filterChipSelected: { backgroundColor: colors.green },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  filterTextSelected: { color: colors.surface },
  loader: { marginVertical: 24 },
  empty: { color: colors.muted, fontSize: 12, textAlign: 'center', marginVertical: 18, lineHeight: 18 },
  eventCard: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  dateBadge: {
    width: 44,
    height: 50,
    borderRadius: 13,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  dateDay: { color: colors.text, fontSize: 17, fontWeight: '900' },
  dateMonth: { color: colors.muted, fontSize: 9, fontWeight: '800', marginTop: 1 },
  eventAccent: { width: 3, alignSelf: 'stretch', borderRadius: 4, marginRight: 11 },
  eventBody: { flex: 1 },
  eventTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  symbol: { color: colors.green, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  category: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  eventTime: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  eventTimeText: { color: colors.muted, fontSize: 11, marginLeft: 5, flexShrink: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sheetCopy: { flex: 1 },
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
  quarter: { marginBottom: 10 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  todayLine: { flex: 1, height: 1, backgroundColor: colors.green },
  todayText: { color: colors.green, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  upcoming: { marginBottom: 10, borderWidth: 1, borderColor: colors.violet },
  quarterFirst: { marginBottom: 10, borderWidth: 1, borderColor: colors.green },
  quarterTitle: { color: colors.text, fontSize: 14, fontWeight: '900', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.muted, fontSize: 12 },
  rowValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
});
