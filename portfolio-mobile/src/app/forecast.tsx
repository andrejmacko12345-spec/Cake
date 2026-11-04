import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Check, ChevronDown, Settings2, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Header,
  Page,
  PortfolioChart,
  Surface,
} from '../components/finapp';
import { colors, formatMoney, formatPercent } from '../data/portfolio';
import { weightedAnnualReturn } from '../data/performance';
import { ForecastBasis, marketAnnualReturn, marketPeriod, smoothedPortfolioReturn } from '../data/forecast-model';
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
  const horizonRef = useRef<(typeof horizons)[number]>(3);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [projectionTop, setProjectionTop] = useState(340);
  const [chartHeight, setChartHeight] = useState(120);
  const [sliderWidth, setSliderWidth] = useState(1);
  const [sliderPosition] = useState(() => new Animated.Value(0));
  const [thumbScale] = useState(() => new Animated.Value(1));
  const [sliderDragging, setSliderDragging] = useState(false);
  const sliderRef = useRef<ComponentRef<typeof View>>(null);
  const sliderGesture = useRef<{ left: number | null; pageX: number } | null>(null);
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('zakladny');
  const [selectedChartIndex, setSelectedChartIndex] = useState<number | null>(null);
  const portfolioValue = positions.reduce((sum, position) => sum + positionValueEUR(position), 0);
  const [basis, setBasis] = useState<ForecastBasis>('all');
  const [basisSettingsOpen, setBasisSettingsOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [modelResult, setModelResult] = useState<{
    transactions: typeof transactions; year: number; rate: number | null; years: number; error: string | null;
  } | null>(null);
  const allReturn = weightedAnnualReturn(transactions, portfolioValue);
  const currentYear = new Date().getUTCFullYear();
  const market = useMemo(() => {
    try { return { rate: marketAnnualReturn(currentYear), error: null }; }
    catch (error) { return { rate: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [currentYear]);
  useEffect(() => {
    if (basis !== 'smoothed' && !basisSettingsOpen) return;
    let active = true;
    smoothedPortfolioReturn(transactions, currentYear)
      .then(({ rate, years }) => {
        if (active) setModelResult({ transactions, year: currentYear, rate, years, error: null });
      })
      .catch((error: unknown) => {
        if (active) setModelResult({ transactions, year: currentYear, rate: null, years: 0,
          error: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [basis, basisSettingsOpen, transactions, currentYear]);
  const currentModel = modelResult?.transactions === transactions && modelResult.year === currentYear ? modelResult : null;
  const basisLoading = basis === 'smoothed' && !currentModel;
  const basisError = basis === 'market' ? market.error : basis === 'smoothed' ? currentModel?.error : null;
  const calculatedAnnualReturn = basis === 'all' ? allReturn : basis === 'market' ? market.rate : currentModel?.rate ?? null;
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
  const changeHorizon = (index: number) => {
    const next = horizons[Math.max(0, Math.min(horizons.length - 1, index))];
    if (next === horizonRef.current) return;
    horizonRef.current = next;
    setHorizon(next);
    setSelectedChartIndex(null);
    const feedback = Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
      : Platform.OS === 'ios'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Promise.resolve();
    void feedback.catch((error: unknown) => {
      console.warn('Forecast slider haptics failed:', error);
    });
  };
  const selectHorizonAt = (x: number) => {
    const ratio = Math.max(0, Math.min(1, (x - 12) / Math.max(1, sliderWidth - 24)));
    sliderPosition.setValue(ratio);
    changeHorizon(Math.round(ratio * (horizons.length - 1)));
  };
  const horizonIndex = horizons.indexOf(horizon);
  useEffect(() => {
    if (sliderDragging) return;
    const animation = Animated.spring(sliderPosition, {
      toValue: horizonIndex / (horizons.length - 1),
      useNativeDriver: Platform.OS !== 'web', speed: 22, bounciness: 4,
    });
    animation.start();
    return () => animation.stop();
  }, [horizonIndex, sliderWidth, sliderDragging, sliderPosition]);
  const finishSlider = () => {
    sliderGesture.current = null;
    setSliderDragging(false);
    Animated.spring(thumbScale, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 24, bounciness: 3 }).start();
  };
  const compact = viewportHeight > 0 && viewportHeight < 650;

  return (
    <Page onScrollViewLayout={setViewportHeight} scrollEnabled={!sliderDragging}>
      <Header title="Výhľad" compact />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('Časový horizont')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Nastavenia výhľadu')}
            accessibilityState={{ expanded: basisSettingsOpen }}
            onPress={() => setBasisSettingsOpen(true)}
            style={styles.settingsButton}
          >
            <Settings2 size={18} color={colors.green} />
          </Pressable>
      </View>
      <Modal
        visible={basisSettingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBasisSettingsOpen(false)}
      >
        <View style={styles.settingsScrim}>
          <Pressable
            accessibilityLabel={t('Zavrieť')}
            style={StyleSheet.absoluteFill}
            onPress={() => setBasisSettingsOpen(false)}
          />
          <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsPanel}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>{t('Nastavenia výhľadu')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Zavrieť')}
                onPress={() => setBasisSettingsOpen(false)}
                style={styles.settingsClose}
              >
                <X size={17} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.settingsDescription}>
              {t('Vyber model ročného výnosu pre všetky tri scenáre.')}
            </Text>
            <View style={styles.basisOptions}>
              {([
                { key: 'all', label: t('Výnos portfólia za celé obdobie'), rate: allReturn,
                  description: t('Tvoj skutočný anualizovaný výnos.'), color: colors.cyan },
                { key: 'smoothed', label: t('Vyhladený model portfólia'), rate: currentModel?.rate ?? null,
                  description: t('Tlmenie extrémnych rokov a krátkej histórie.'), color: colors.green },
                { key: 'market', label: t('Historický výnos S&P 500'), rate: market.rate,
                  description: `${marketPeriod.firstYear}–${marketPeriod.lastYear} · ${t('Vrátane dividend · USD')}`, color: colors.violet },
              ] as const).map((option) => {
                const selected = basis === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setBasis(option.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.basisCard, selected && { borderColor: option.color }]}
                  >
                    <View style={styles.basisCardHeader}>
                      <Text style={styles.basisCardTitle}>{option.label}</Text>
                      <View style={[styles.basisRadio, selected && { backgroundColor: option.color, borderColor: option.color }]}>
                        {selected ? <Check size={13} color={colors.background} /> : null}
                      </View>
                    </View>
                    <View style={styles.basisRateRow}>
                      <Text style={[styles.basisRate, { color: option.color }]}>
                        {option.rate === null ? '—' : formatPercent(option.rate, 2)}
                      </Text>
                      <Text style={styles.basisPerYear}>/ {t('rok')}</Text>
                    </View>
                    <Text style={styles.basisCardDescription}>{option.description}</Text>
                    {option.key === 'smoothed' && !currentModel ? <Text style={styles.basisCardDescription}>{t('Počítam výnos…')}</Text> : null}
                    {option.key === 'smoothed' && currentModel?.error ? <Text style={styles.basisError} accessibilityRole="alert">{t(currentModel.error)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            {basisError && basis !== 'smoothed' ? <Text style={styles.basisError} accessibilityRole="alert">{t(basisError)}</Text> : null}
            <Pressable onPress={() => setMethodologyOpen((open) => !open)} accessibilityRole="button"
              accessibilityState={{ expanded: methodologyOpen }} style={styles.methodologyButton}>
              <Text style={styles.methodologyLabel}>{t('Ako sa počíta výnos')}</Text>
              <ChevronDown size={16} color={colors.muted} style={{ transform: [{ rotate: methodologyOpen ? '180deg' : '0deg' }] }} />
            </Pressable>
            {methodologyOpen ? <>
            <Text style={styles.settingsDescription}>
              {basis === 'all' ? t('Anualizovaný výnos celého portfólia zohľadňuje sumy a dátumy nákupov a predajov (XIRR).')
                : basis === 'smoothed' ? t('Medián ročných výnosov dokončených kalendárnych rokov v EUR. Váha portfólia je n / (n + 3), zvyšok tvorí trh; n je počet dostupných rokov. Kombinácia je geometrická. Bez celého roka sa použije trhový základ. Dividendy portfólia nie sú zahrnuté.')
                  : t('Geometrický ročný výnos S&P 500 za 20 dokončených rokov vrátane reinvestovaných dividend v USD. Bez inflácie, poplatkov a prepočtu USD/EUR.')}
            </Text>
            <Text style={styles.settingsDescription}>
              S&P 500 · {marketPeriod.firstYear}–{marketPeriod.lastYear} · {market.rate === null ? '—' : formatPercent(market.rate, 2)} / {t('rok')}
              {'\n'}{t('Zdroj: Slickcharts · S&P 500 Total Returns.')}
              {basis === 'smoothed' && currentModel && !currentModel.error ? `\n${t('Dokončené roky portfólia')}: ${currentModel.years}` : ''}
            </Text>
            <Text style={styles.settingsDescription}>
              {t('Základný scenár používa zvolený model. Opatrný a optimistický upravujú výnos pomerovo o 25 %.')}
            </Text>
            {calculatedAnnualReturn === null && !basisLoading && !basisError ? <Text style={styles.scenarioHint}>{t('Na výpočet výnosu zatiaľ nie je dosť údajov.')}</Text> : null}
            <Text style={styles.settingsDescription}>
              {t('Ide o matematickú ukážku pri nemennom ročnom výnose. Skutočný vývoj sa nedá predpovedať; nejde o investičné odporúčanie.')}
            </Text>
            </> : null}
          </ScrollView>
        </View>
      </Modal>
      <View
        ref={sliderRef}
        style={[styles.slider, compact && { height: 36 }]}
        onLayout={({ nativeEvent: { layout } }) => setSliderWidth(layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          sliderPosition.stopAnimation();
          const gesture = { left: null as number | null, pageX: event.nativeEvent.pageX };
          sliderGesture.current = gesture;
          setSliderDragging(true);
          Animated.spring(thumbScale, { toValue: 1.18, useNativeDriver: Platform.OS !== 'web', speed: 24, bounciness: 3 }).start();
          sliderRef.current?.measureInWindow((left) => {
            if (sliderGesture.current !== gesture) return;
            gesture.left = left;
            selectHorizonAt(gesture.pageX - left);
          });
        }}
        onResponderMove={(event) => {
          const gesture = sliderGesture.current;
          if (!gesture) return;
          gesture.pageX = event.nativeEvent.pageX;
          if (gesture.left !== null) selectHorizonAt(gesture.pageX - gesture.left);
        }}
        onResponderTerminationRequest={() => false}
        onResponderRelease={finishSlider}
        onResponderTerminate={finishSlider}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('Časový horizont')}
        accessibilityValue={{ min: 0, max: horizons.length - 1, now: horizonIndex, text: `${horizon} ${yearLabel(horizon, language)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => changeHorizon(horizonIndex + (nativeEvent.actionName === 'increment' ? 1 : -1))}
      >
        <Text pointerEvents="none" style={styles.horizonValue}>{horizon} {yearLabel(horizon, language)}</Text>
        <View pointerEvents="none" style={styles.sliderTrack}>
          <Animated.View style={[styles.sliderFill, {
            transform: [
              { translateX: sliderPosition.interpolate({ inputRange: [0, 1], outputRange: [-Math.max(0, sliderWidth - 24) / 2, 0], extrapolate: 'clamp' }) },
              { scaleX: sliderPosition.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) },
            ],
          }]} />
          {horizons.map((year, index) => (
            <View key={year} style={[styles.sliderTick, { left: `${index / (horizons.length - 1) * 100}%`,
              backgroundColor: index <= horizonIndex ? colors.green : colors.muted }]} />
          ))}
          <Animated.View style={[styles.sliderThumb, { transform: [
            { translateX: sliderPosition.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, sliderWidth - 24)], extrapolate: 'clamp' }) },
            { scale: thumbScale },
          ] }]}>
            <View style={styles.sliderThumbCore} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.horizonLabels}>
        {horizons.map((year) => {
          const selected = horizon === year;
          return (
            <Pressable
              key={year}
              onPress={() => changeHorizon(horizons.indexOf(year))}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={styles.horizonLabelButton}
            >
              <Text style={[styles.selectorText, selected && { color: colors.green }]}>
                {year} {yearLabel(year, language)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>{t('Scenár ročného výnosu')}</Text>
      {basisLoading || basisError ? <Text style={styles.scenarioHint} accessibilityRole={basisError ? 'alert' : undefined}>
        {basisLoading ? t('Počítam výnos…') : t('Výnos modelu nie je dostupný. Skontroluj nastavenia.')}
      </Text> : null}
      {portfolioValue <= 0 ? <Text style={styles.scenarioHint}>{t('Pre výhľad pridaj pozície do portfólia.')}</Text> : null}
      <View style={styles.scenarioList}>
        {scenarios.map((item) => {
          const selected = scenarioKey === item.key;
          const value = portfolioValue * (1 + item.rate / 100) ** horizon;
          const gain = value - portfolioValue;
          return (
            <Pressable
              key={item.key}
              onPress={() => setScenarioKey(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.scenarioCard, compact && styles.scenarioCardCompact, selected && styles.scenarioCardSelected]}
            >
              <View style={[styles.scenarioDot, { backgroundColor: item.color }]} />
              <View style={styles.scenarioCopy}>
                <Text style={styles.scenarioTitle}>{t(item.title)}</Text>
                <Text style={styles.scenarioSub}>{calculatedAnnualReturn === null ? '—' : formatPercent(item.rate, 1)} / {t('rok')}</Text>
              </View>
              <View style={styles.scenarioNumbers}>
                <Text style={styles.scenarioAmount}>{calculatedAnnualReturn === null ? '—' : formatMoney(value, true)}</Text>
                <Text style={[styles.scenarioProfit, { color: gain >= 0 ? colors.green : colors.red }]}>
                  {calculatedAnnualReturn === null ? '—' : `${gain >= 0 ? '+' : '−'}${formatMoney(Math.abs(gain), true)}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View onLayout={({ nativeEvent: { layout } }) => setProjectionTop(layout.y)}>
      <Text style={styles.sectionTitle}>{t('Projekcia hodnoty')}</Text>
      <Surface style={{ ...styles.projectionCard, height: Math.max(120, viewportHeight - 16 - projectionTop - 28 - 28) }}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>{t('Odhadovaný vývoj')}</Text>
          <Text style={[styles.chartRate, { color: scenario.color }]}>{calculatedAnnualReturn === null ? '—' : formatPercent(scenario.rate, 1)}</Text>
        </View>
        <View style={[styles.selectedProjection, compact && styles.selectedProjectionCompact]}>
          <Text style={[styles.selectedProjectionTime, compact && { lineHeight: 11 }]}>{selectedTimeLabel}</Text>
          <Text style={[styles.selectedProjectionValue, compact && { fontSize: 16, lineHeight: 18, marginTop: 0 }]}>{calculatedAnnualReturn === null ? '—' : formatMoney(selectedValue, true)}</Text>
          <Text
            style={[
              styles.selectedProjectionReturn,
              compact && { fontSize: 10, lineHeight: 12, marginTop: 0 },
              { color: selectedReturn >= 0 ? colors.green : colors.red },
            ]}
          >
            {calculatedAnnualReturn === null ? '—' : `${formatPercent(selectedReturn, 2)} ${t('oproti dnešku')}`}
          </Text>
        </View>
        <View style={styles.chartSpace} onLayout={({ nativeEvent: { layout } }) => setChartHeight(Math.max(1, layout.height - 10))}>
        {calculatedAnnualReturn !== null ? <PortfolioChart
          values={chartValues}
          color={scenario.color}
          selectedIndex={selectedIndex}
          onSelectPoint={setSelectedChartIndex}
          onSelectionEnd={() => setSelectedChartIndex(null)}
          height={chartHeight}
        /> : null}
        </View>
        <View style={styles.chartLabels}>
          <Text style={styles.chartLabel}>{t('Dnes')}</Text>
          <Text style={styles.chartLabel}>{language === 'sk' ? 'O ' : 'In '}{horizon} {yearLabel(horizon, language)}</Text>
        </View>
      </Surface>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  basisOptions: { gap: 6, marginBottom: 10 },
  basisCard: { padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 5 },
  basisCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  basisCardTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  basisRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  basisRateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  basisRate: { fontSize: 26, fontWeight: '900' },
  basisPerYear: { color: colors.muted, fontSize: 12 },
  basisCardDescription: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  methodologyButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 6 },
  methodologyLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  basisError: { color: colors.red, fontSize: 11, marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 6, marginTop: 2, lineHeight: 20 },
  horizonValue: { color: colors.green, fontSize: 13, lineHeight: 16, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  slider: { height: 48, justifyContent: 'center', paddingHorizontal: 12 },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised },
  sliderFill: { height: 6, borderRadius: 3, backgroundColor: colors.green },
  sliderTick: { position: 'absolute', width: 6, height: 6, marginLeft: -3, borderRadius: 3, backgroundColor: colors.muted },
  sliderThumb: { position: 'absolute', left: 0, top: -9, marginLeft: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.green, borderWidth: 3, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  sliderThumbCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.surface },
  horizonLabels: { flexDirection: 'row', marginBottom: 4 },
  horizonLabelButton: { flex: 1, paddingVertical: 5 },
  scenarioNumbers: { alignItems: 'flex-end', gap: 3 },
  scenarioProfit: { fontSize: 10, fontWeight: '600' },
  projectionCard: { marginBottom: 0, padding: 12 },
  chartSpace: { flex: 1, minHeight: 30 },
  settingsButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  settingsScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  settingsScroll: { maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  settingsPanel: {
    padding: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: colors.background,
  },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  settingsTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  settingsClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.surface },
  settingsDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 16 },
  settingsLabel: { color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 8 },
  selectorButton: {
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: 13,
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingVertical: 7,
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
    gap: 4,
    marginBottom: 4,
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
    paddingVertical: 9,
  },
  scenarioCardSelected: {
    borderColor: colors.green,
  },
  scenarioCardCompact: { paddingVertical: 5 },
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
  selectedProjectionCompact: { paddingVertical: 3, marginTop: 4 },
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
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 0,
  },
  chartLabel: {
    color: colors.muted,
    fontSize: 10,
  },
});
