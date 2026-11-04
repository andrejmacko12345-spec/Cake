import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AssetLogo } from './asset-logo';
import { Surface } from './finapp';
import { computeDividendPayments, DividendSeries, fetchDividendSeries } from '../data/dividends';
import { colors } from '../data/portfolio';
import { positionCostEUR, positionValueEUR, Position, Transaction } from '../hooks/use-positions';
import { useLocale } from '../context/locale';

const chartAccent = '#ffae42';

type MonthAmount = { label: string; amount: number };

export function DividendOverview({
  positions,
  transactions,
  hideAmounts,
}: {
  positions: Position[];
  transactions: Transaction[];
  hideAmounts: boolean;
}) {
  const { t, language } = useLocale();
  const { width: screenWidth } = useWindowDimensions();
  const [series, setSeries] = useState<DividendSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [period, setPeriod] = useState<'annual' | number>('annual');
  const symbols = useMemo(
    () => positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol),
    [positions],
  );
  const symbolsKey = symbols.join('|');

  useEffect(() => {
    let active = true;
    if (!symbolsKey) {
      setSeries([]);
      setErrors([]);
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    setErrors([]);
    Promise.allSettled(symbolsKey.split('|').map((symbol) => fetchDividendSeries(symbol)))
      .then((results) => {
        if (!active) return;
        const loaded: DividendSeries[] = [];
        const failed: string[] = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') loaded.push(result.value);
          else {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            failed.push(`${symbolsKey.split('|')[index]}: ${reason}`);
          }
        });
        setSeries(loaded);
        setErrors(failed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [symbolsKey]);

  const positionBySymbol = useMemo(
    () => new Map(positions.map((position) => [position.symbol, position])),
    [positions],
  );
  const fxBySymbol = useMemo(
    () => Object.fromEntries(positions.map((position) => [position.symbol, position.fxToEur])),
    [positions],
  );
  const usdFx = positions.find((position) => position.currency === 'USD')?.fxToEur ?? 1;
  const payments = useMemo(
    () => computeDividendPayments(transactions, series, fxBySymbol, usdFx),
    [transactions, series, fxBySymbol, usdFx],
  );
  const today = new Date();
  const currentYear = today.getFullYear();
  const trailingStart = new Date(today);
  trailingStart.setUTCFullYear(trailingStart.getUTCFullYear() - 1);
  const trailingStartDate = trailingStart.toISOString().slice(0, 10);
  const trailingPayments = payments.filter((payment) => payment.date >= trailingStartDate);
  const annualEstimate = series.reduce((total, item) => {
    const position = positionBySymbol.get(item.symbol);
    if (!position || position.shares <= 1e-8) return total;
    const trailingPerShare = item.events
      .filter((event) => event.date >= trailingStartDate)
      .reduce((sum, event) => sum + event.amount, 0);
    return total + trailingPerShare * position.shares * position.fxToEur;
  }, 0);
  const portfolioValue = positions.reduce((sum, position) => sum + positionValueEUR(position), 0);
  const costBasis = positions.reduce((sum, position) => sum + positionCostEUR(position), 0);
  const yieldOnValue = portfolioValue > 0 ? annualEstimate / portfolioValue * 100 : 0;
  const yieldOnCost = costBasis > 0 ? annualEstimate / costBasis * 100 : 0;
  const chartPayments = period === 'annual'
    ? trailingPayments
    : payments.filter((payment) => Number(payment.date.slice(0, 4)) === period);
  const monthNames = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(currentYear, index, 1)).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', { month: 'short' }),
  );
  const monthlyAmounts: MonthAmount[] = monthNames.map((label, month) => ({
    label,
    amount: chartPayments
      .filter((payment) => Number(payment.date.slice(5, 7)) === month + 1)
      .reduce((sum, payment) => sum + payment.amountEUR, 0),
  }));
  const maxMonth = Math.max(...monthlyAmounts.map((month) => month.amount), 0);
  const chartWidth = Math.max(260, screenWidth - 80);
  const chartHeight = 126;
  const baseline = 108;
  const barSlot = chartWidth / 12;
  const barWidth = Math.min(20, barSlot * 0.56);
  const incomeBySymbol = series.map((item) => {
    const position = positionBySymbol.get(item.symbol);
    const perShare = item.events
      .filter((event) => event.date >= trailingStartDate)
      .reduce((sum, event) => sum + event.amount, 0);
    return {
      symbol: item.symbol,
      name: position?.name ?? item.symbol,
      amount: position ? perShare * position.shares * position.fxToEur : 0,
      payments: item.events.filter((event) => event.date >= trailingStartDate).length,
      color: position?.color ?? colors.violet,
    };
  }).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const money = (value: number, digits = 2) => hideAmounts
    ? '•••••'
    : new Intl.NumberFormat(language === 'sk' ? 'sk-SK' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  return (
    <View>
      <Surface style={styles.incomeCard}>
        <Text style={styles.eyebrow}>{t('Odhadovaný dividendový príjem')}</Text>
        <Text style={styles.annualValue}>{money(annualEstimate)}</Text>
        <Text style={styles.annualCaption}>{t('za posledných 12 mesiacov')}</Text>
        <View style={styles.rateGrid}>
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>{t('Mesačne')}</Text>
            <Text style={styles.rateValue}>{money(annualEstimate / 12)}</Text>
          </View>
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>{t('Denne')}</Text>
            <Text style={styles.rateValue}>{money(annualEstimate / 365)}</Text>
          </View>
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>{t('Dividendový výnos')}</Text>
            <Text style={styles.rateValue}>{yieldOnValue.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} %</Text>
          </View>
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>{t('Výnos z nákupnej ceny')}</Text>
            <Text style={styles.rateValue}>{yieldOnCost.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 2 })} %</Text>
          </View>
        </View>
      </Surface>

      <Surface style={styles.chartCard}>
        <View style={styles.chartHeading}>
          <View>
            <Text style={styles.sectionTitle}>{t('Dividendový kalendár')}</Text>
            <Text style={styles.sectionSubtitle}>
              {period === 'annual' ? t('Mesačné výplaty · posledných 12 mesiacov') : `${t('Mesačné výplaty')} · ${period}`}
            </Text>
          </View>
          {loading ? <ActivityIndicator size="small" color={chartAccent} /> : null}
        </View>
        <View style={styles.chartPlot}>
          <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
            <Line x1="0" y1={baseline} x2={chartWidth} y2={baseline} stroke={colors.border} strokeWidth="1" />
            {monthlyAmounts.map((item, index) => {
              const height = maxMonth > 0 && item.amount > 0 ? Math.max(4, item.amount / maxMonth * 76) : 3;
              const x = index * barSlot + (barSlot - barWidth) / 2;
              return (
                <Rect
                  key={item.label}
                  x={x}
                  y={baseline - height}
                  width={barWidth}
                  height={height}
                  rx={barWidth / 2}
                  fill={chartAccent}
                  opacity={item.amount > 0 ? 1 : 0.15}
                />
              );
            })}
          </Svg>
          {!loading && !chartPayments.length ? (
            <Text style={styles.chartEmptyMessage}>{t('V tomto období nemáš zaznamenané dividendy.')}</Text>
          ) : null}
        </View>
        <View style={styles.monthLabels}>
          {monthlyAmounts.map((item) => (
            <Text key={item.label} numberOfLines={1} style={styles.monthLabel}>{item.label}</Text>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodOptions}>
          <PeriodButton label={t('Ročne')} selected={period === 'annual'} onPress={() => setPeriod('annual')} />
          {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map((year) => (
            <PeriodButton
              key={year}
              label={String(year)}
              selected={period === year}
              onPress={() => setPeriod(year)}
            />
          ))}
        </ScrollView>
      </Surface>

      <View style={styles.holdingsHeading}>
        <Text style={styles.sectionTitle}>{t('Dividendové pozície')}</Text>
        <Text style={styles.holdingsCount}>{incomeBySymbol.length}</Text>
      </View>
      {incomeBySymbol.length ? (
        <Surface style={styles.holdingsCard}>
          {incomeBySymbol.map((item, index) => (
            <View
              key={item.symbol}
              style={[styles.holdingRow, index < incomeBySymbol.length - 1 && styles.holdingDivider]}
            >
              <AssetLogo symbol={item.symbol} color={item.color} size={38} />
              <View style={styles.holdingInfo}>
                <Text numberOfLines={1} style={styles.holdingSymbol}>{item.symbol}</Text>
                <Text numberOfLines={1} style={styles.holdingName}>
                  {item.name} · {item.payments} {t('výplat za rok')}
                </Text>
              </View>
              <View style={styles.holdingAmount}>
                <Text style={styles.holdingValue}>{money(item.amount)}</Text>
                <Text style={styles.holdingCaption}>{t('ročný odhad')}</Text>
              </View>
            </View>
          ))}
        </Surface>
      ) : !loading && !errors.length ? (
        <Surface style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t('Zatiaľ bez dividend')}</Text>
          <Text style={styles.emptyDescription}>{t('Keď budú dostupné dividendové údaje pre tvoje akcie, zobrazíme ich tu.')}</Text>
        </Surface>
      ) : null}
      {errors.length ? (
        <Text style={styles.errorText}>
          {t('Niektoré dividendové údaje sa nepodarilo načítať')}: {errors.join(' · ')}
        </Text>
      ) : null}
      <Text style={styles.note}>{t('Odhad podľa dividend za posledných 12 mesiacov a aktuálneho počtu akcií. Skutočné výplaty a výnos sa môžu líšiť.')}</Text>
    </View>
  );
}

function PeriodButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.periodButton, selected && styles.periodButtonSelected]}
    >
      <Text style={[styles.periodText, selected && styles.periodTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  incomeCard: { padding: 18, backgroundColor: colors.surface, borderRadius: 22 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  annualValue: { color: colors.text, fontSize: 38, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  annualCaption: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 1 },
  rateGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rateItem: { width: '50%', paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center' },
  rateLabel: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  rateValue: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  chartCard: { padding: 16, backgroundColor: colors.surface, borderRadius: 22, marginTop: 12 },
  chartHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartPlot: { position: 'relative' },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: 10, marginTop: 4 },
  chartEmptyMessage: { color: colors.muted, fontSize: 10, textAlign: 'center', position: 'absolute', top: 47, left: 0, right: 0 },
  monthLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  monthLabel: { color: colors.muted, fontSize: 8, textAlign: 'center', width: `${100 / 12}%` },
  periodOptions: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  periodButton: { minWidth: 52, paddingVertical: 8, paddingHorizontal: 9, borderRadius: 11, alignItems: 'center' },
  periodButtonSelected: { backgroundColor: chartAccent },
  periodText: { color: chartAccent, fontSize: 12, fontWeight: '800' },
  periodTextSelected: { color: colors.surface },
  holdingsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 9 },
  holdingsCount: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  holdingsCard: { paddingVertical: 2, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 18 },
  holdingRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10 },
  holdingDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  holdingInfo: { flex: 1, minWidth: 0 },
  holdingSymbol: { color: colors.text, fontSize: 13, fontWeight: '900' },
  holdingName: { color: colors.muted, fontSize: 9, marginTop: 3 },
  holdingAmount: { alignItems: 'flex-end' },
  holdingValue: { color: colors.text, fontSize: 13, fontWeight: '800' },
  holdingCaption: { color: colors.muted, fontSize: 9, marginTop: 3 },
  emptyCard: { alignItems: 'center', padding: 20 },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  emptyDescription: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 7, lineHeight: 16 },
  errorText: { color: colors.red, fontSize: 10, lineHeight: 15, marginTop: 8 },
  note: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 10, marginBottom: 6 },
});
