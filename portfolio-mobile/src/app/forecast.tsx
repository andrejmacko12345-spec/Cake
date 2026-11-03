import { useEffect, useMemo, useState } from 'react';
import { Info, Sparkles } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Header,
  Page,
  PortfolioChart,
  SectionTitle,
  Surface,
} from '../components/finapp';
import { colors, formatMoney, formatPercent } from '../data/portfolio';
import { ReturnBasis, returnBasisYears, weightedAnnualReturn, windowedAnnualReturn } from '../data/performance';
import { positionValueEUR, usePositions } from '../hooks/use-positions';
import { useLocale } from '../context/locale';

const horizons = [1, 3, 5, 10, 20] as const;
const scenarioDefinitions = [
  { key: 'opatrny', title: 'Opatrný', color: colors.cyan },
  { key: 'zakladny', title: 'Základný', color: colors.green },
  { key: 'optimisticky', title: 'Optimistický', color: colors.violet },
] as const;

type ScenarioKey = (typeof scenarioDefinitions)[number]['key'];

function yearLabel(year: number, language: 'sk' | 'en') {
  if (language === 'en') return year === 1 ? 'year' : 'years';
  if (year === 1) return 'rok';
  return year < 5 ? 'roky' : 'rokov';
}

export default function ForecastScreen() {
  const { t, language } = useLocale();
  const { positions, transactions } = usePositions();
  const [horizon, setHorizon] = useState<(typeof horizons)[number]>(3);
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('zakladny');
  const [selectedChartIndex, setSelectedChartIndex] = useState<number | null>(null);
  const portfolioValue = positions.reduce((sum, position) => sum + positionValueEUR(position), 0);
  const [basis, setBasis] = useState<ReturnBasis>('all');
  const [windowReturn, setWindowReturn] = useState<{ key: string; value: number | null } | null>(null);
  const [basisLoading, setBasisLoading] = useState(false);
  const allReturn = weightedAnnualReturn(transactions, portfolioValue);
  const windowKey = `${basis}|${transactions.length}|${Math.round(portfolioValue)}`;
  useEffect(() => {
    if (basis === 'all' || portfolioValue <= 0) return;
    let active = true;
    setBasisLoading(true);
    windowedAnnualReturn(transactions, portfolioValue, returnBasisYears[basis])
      .then((value) => { if (active) setWindowReturn({ key: windowKey, value }); })
      .catch(() => { if (active) setWindowReturn({ key: windowKey, value: null }); })
      .finally(() => { if (active) setBasisLoading(false); });
    return () => { active = false; };
  }, [basis, windowKey]);
  const windowUnavailable = basis !== 'all' && !basisLoading && windowReturn?.key === windowKey && windowReturn.value === null;
  const calculatedAnnualReturn = basis === 'all'
    ? allReturn
    : windowReturn?.key === windowKey && windowReturn.value !== null ? windowReturn.value : allReturn;
  const realizedAnnualReturn = calculatedAnnualReturn ?? 0;
  const isNegativeReturn = realizedAnnualReturn < 0;
  const scenarios = scenarioDefinitions.map((item) => ({
    ...item,
    rate: Math.max(-99.999, realizedAnnualReturn * (
      item.key === 'zakladny'
        ? 1
        : item.key === 'opatrny'
          ? isNegativeReturn ? 1.25 : 0.75
          : isNegativeReturn ? 0.75 : 1.25
    )),
  }));
  const scenario = scenarios.find((item) => item.key === scenarioKey) ?? scenarios[1];
  const projectedValue = portfolioValue * (1 + scenario.rate / 100) ** horizon;
  const projectedGain = projectedValue - portfolioValue;
  const chartIntervals = horizon * 4;
  const chartValues = useMemo(
    () => Array.from({ length: chartIntervals + 1 }, (_, index) =>
      portfolioValue * (1 + scenario.rate / 100) ** (index / 4),
    ),
    [chartIntervals, portfolioValue, scenario.rate],
  );
  const selectedIndex = Math.max(0, Math.min(chartValues.length - 1, selectedChartIndex ?? chartValues.length - 1));
  const selectedValue = chartValues[selectedIndex] ?? portfolioValue;
  const selectedReturn = portfolioValue > 0 ? (selectedValue / portfolioValue - 1) * 100 : 0;
  const selectedYears = selectedIndex / 4;
  const selectedTimeLabel = selectedIndex === 0
    ? t('Dnes')
    : selectedYears < 1
      ? language === 'sk'
        ? `O ${Math.round(selectedYears * 12)} ${Math.round(selectedYears * 12) === 1 ? 'mesiac' : 'mesiacov'}`
        : `In ${Math.round(selectedYears * 12)} ${Math.round(selectedYears * 12) === 1 ? 'month' : 'months'}`
      : `${language === 'sk' ? 'O ' : 'In '}${selectedYears.toLocaleString(language === 'sk' ? 'sk-SK' : 'en-US', { maximumFractionDigits: 1 })} ${yearLabel(selectedYears, language)}`;

  return (
    <Page>
      <Header title={t('Výhľad')} subtitle={t('Scenárový odhad')} />
      {portfolioValue <= 0 ? (
        <Surface style={styles.emptyState}>
          <Info size={18} color={colors.muted} />
          <Text style={styles.emptyText}>
            {t('Najskôr pridaj svoje pozície do portfólia. Potom sa výhľad vypočíta z ich aktuálnej hodnoty.')}
          </Text>
        </Surface>
      ) : null}

      <Surface style={styles.heroCard}>
        <View style={styles.heroLabelRow}>
          <View style={styles.sparkleIcon}>
            <Sparkles size={16} color={colors.green} />
          </View>
          <Text style={styles.heroLabel}>{t('Modelovaná hodnota portfólia')}</Text>
        </View>
        <Text style={styles.projectedValue}>{formatMoney(projectedValue, true)}</Text>
        <Text style={styles.projectedHint}>
          {language === 'sk' ? 'pri výnose ' : 'at '}
          {formatPercent(scenario.rate, 1)}
          {language === 'sk' ? ` ročne za ${horizon} ${yearLabel(horizon, language)}` : ` per year for ${horizon} ${yearLabel(horizon, language)}`}
        </Text>
        <View style={styles.gainRow}>
          <Text style={styles.gainLabel}>{t('Modelovaný zisk')}</Text>
          <Text style={[styles.gainValue, { color: projectedGain >= 0 ? colors.green : colors.red }]}>
            {projectedGain >= 0 ? '+' : '−'}{formatMoney(Math.abs(projectedGain), true)}
          </Text>
        </View>
      </Surface>

      <SectionTitle title={t('Časový horizont')} />
      <View style={styles.selectorRow}>
        {horizons.map((year) => {
          const selected = horizon === year;
          return (
            <Pressable
              key={year}
              onPress={() => {
                setHorizon(year);
                setSelectedChartIndex(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.selectorButton, selected && styles.selectorButtonSelected]}
            >
              <Text style={[styles.selectorText, selected && styles.selectorTextSelected]}>
                {year} {yearLabel(year, language)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle title={t('Základ výnosu')} />
      <View style={styles.selectorRow}>
        {([
          { key: 'all', label: t('Celé obdobie') },
          { key: '1Y', label: '1Y' },
          { key: '3Y', label: '3Y' },
          { key: '5Y', label: '5Y' },
        ] as const).map((option) => {
          const selected = basis === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setBasis(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.selectorButton, selected && styles.selectorButtonSelected]}
            >
              <Text style={[styles.selectorText, selected && styles.selectorTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {basisLoading ? <Text style={styles.scenarioHint}>{t('Počítam výnos…')}</Text> : null}
      {windowUnavailable ? (
        <Text style={styles.scenarioHint}>
          {t('Na toto obdobie nemáš dosť histórie, použitý je výnos za celé obdobie.')}
        </Text>
      ) : null}

      <SectionTitle title={t('Scenár ročného výnosu')} />
      <Text style={styles.scenarioHint}>
        {t('Základný scenár vychádza z anualizovaného výnosu tvojho portfólia. Opatrný a optimistický ho upravujú pomerovo o 25 %.')}
        {calculatedAnnualReturn === null
          ? ` ${t('Bez dostatočných údajov je zatiaľ použitý výnos 0 %.')}` : ''}
      </Text>
      <View style={styles.scenarioList}>
        {scenarios.map((item) => {
          const selected = scenarioKey === item.key;
          const value = portfolioValue * (1 + item.rate / 100) ** horizon;
          return (
            <Pressable
              key={item.key}
              onPress={() => setScenarioKey(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.scenarioCard, selected && styles.scenarioCardSelected]}
            >
              <View style={[styles.scenarioDot, { backgroundColor: item.color }]} />
              <View style={styles.scenarioCopy}>
                <Text style={styles.scenarioTitle}>{t(item.title)}</Text>
                <Text style={styles.scenarioSub}>{formatPercent(item.rate, 1)} / {t('rok')}</Text>
              </View>
              <Text style={styles.scenarioAmount}>{formatMoney(value, true)}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle title={t('Projekcia hodnoty')} />
      <Surface>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>{t('Odhadovaný vývoj')}</Text>
          <Text style={[styles.chartRate, { color: scenario.color }]}>{formatPercent(scenario.rate, 1)}</Text>
        </View>
        <View style={styles.selectedProjection}>
          <Text style={styles.selectedProjectionTime}>{selectedTimeLabel}</Text>
          <Text style={styles.selectedProjectionValue}>{formatMoney(selectedValue, true)}</Text>
          <Text
            style={[
              styles.selectedProjectionReturn,
              { color: selectedReturn >= 0 ? colors.green : colors.red },
            ]}
          >
            {formatPercent(selectedReturn, 2)} oproti dnešku
          </Text>
        </View>
        <PortfolioChart
          values={chartValues}
          color={scenario.color}
          selectedIndex={selectedIndex}
          onSelectPoint={setSelectedChartIndex}
        />
        <View style={styles.chartLabels}>
          <Text style={styles.chartLabel}>{t('Dnes')}</Text>
          <Text style={styles.chartLabel}>{language === 'sk' ? 'O ' : 'In '}{horizon} {yearLabel(horizon, language)}</Text>
        </View>
        <Text style={styles.chartHint}>{t('Potiahni prstom po grafe a zobraz presnú hodnotu v danom bode.')}</Text>
      </Surface>

      <View style={styles.disclaimer}>
        <Info size={16} color={colors.muted} />
        <Text style={styles.disclaimerText}>
          {t('Ide o matematickú ukážku pri nemennom ročnom výnose. Skutočný vývoj sa nedá predpovedať; nejde o investičné odporúčanie.')}
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 20,
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sparkleIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  heroLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  projectedValue: {
    color: colors.text,
    fontSize: 35,
    fontWeight: '900',
    marginTop: 16,
  },
  projectedHint: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 5,
  },
  gainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 17,
    paddingTop: 14,
  },
  gainLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  gainValue: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '900',
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 1,
  },
  selectorButton: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: 13,
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingVertical: 11,
  },
  selectorButtonSelected: {
    backgroundColor: colors.green,
  },
  selectorText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  selectorTextSelected: {
    color: colors.surface,
  },
  scenarioList: {
    gap: 9,
  },
  scenarioHint: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 9,
  },
  scenarioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scenarioCardSelected: {
    borderColor: colors.green,
  },
  scenarioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 11,
  },
  scenarioCopy: {
    flex: 1,
  },
  scenarioTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  scenarioSub: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  scenarioAmount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  chartRate: {
    fontSize: 14,
    fontWeight: '900',
  },
  selectedProjection: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  selectedProjectionTime: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  selectedProjectionValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  selectedProjectionReturn: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
  },
  chartHint: {
    color: colors.muted,
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -7,
  },
  chartLabel: {
    color: colors.muted,
    fontSize: 10,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
  },
  disclaimerText: {
    color: colors.muted,
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    marginLeft: 8,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    padding: 13,
  },
  emptyText: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    marginLeft: 9,
  },
});
