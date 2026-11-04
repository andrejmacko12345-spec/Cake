import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  RefreshCw,
  Search,
  X,
} from 'lucide-react-native';
import { availableAssets, Asset, colors } from '../data/portfolio';
import { fetchHistoricalQuoteForDate, fetchLiveQuote, LiveQuote } from '../data/quotes';
import { Transaction, TransactionInput, usePositions } from '../hooks/use-positions';
import { useAssetSearch } from '../hooks/use-asset-search';
import { useLocale } from '../context/locale';

type Props = {
  visible: boolean;
  transaction?: Transaction;
  initialSymbol?: string;
  initialName?: string;
  initialCurrency?: 'EUR' | 'USD';
  initialFxToEur?: number;
  initialType?: 'BUY' | 'SELL';
  onClose: () => void;
  onSave: (input: TransactionInput, id?: string, quote?: LiveQuote) => Promise<void>;
  onDelete?: (id: string) => void;
};

function getCatalogAsset(symbol: string): Asset | undefined {
  return availableAssets.find((asset) => asset.symbol === symbol);
}

function parseAmount(value: string) {
  const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today();
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function TransactionModal({
  visible,
  transaction,
  initialSymbol,
  initialName,
  initialCurrency,
  initialFxToEur,
  initialType = 'BUY',
  onClose,
  onSave,
  onDelete,
}: Props) {
  const isEditing = Boolean(transaction);
  const { t, language } = useLocale();
  const { positions } = usePositions();
  const fixedSymbol = Boolean(initialSymbol || transaction);
  const [symbol, setSymbol] = useState('');
  const [type, setType] = useState<'BUY' | 'SELL'>('BUY');
  const [sharesInput, setSharesInput] = useState('');
  const heldShares = positions.find((position) => position.symbol === symbol.trim().toUpperCase())?.shares ?? 0;
  const [priceInput, setPriceInput] = useState('');
  const [dateInput, setDateInput] = useState(today());
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [currency, setCurrency] = useState<'EUR' | 'USD'>('EUR');
  const [fxInput, setFxInput] = useState('0.92');
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingHistoricalPrice, setLoadingHistoricalPrice] = useState(false);
  const [historicalPriceDate, setHistoricalPriceDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showAssetResults, setShowAssetResults] = useState(false);
  const [selectedAssetName, setSelectedAssetName] = useState('');
  const symbolInputRef = useRef<TextInput>(null);
  const dateInputRef = useRef(dateInput);
  const symbolRef = useRef(symbol);
  const historicalRequestId = useRef(0);
  dateInputRef.current = dateInput;
  symbolRef.current = symbol;
  const { results: assetResults, loading: searchingAssets, error: assetSearchError } = useAssetSearch(
    showAssetResults ? symbol : '',
  );

  useEffect(() => {
    if (!visible) return;
    setSymbol(transaction?.symbol ?? initialSymbol ?? '');
    symbolRef.current = transaction?.symbol ?? initialSymbol ?? '';
    setType(transaction?.type ?? initialType);
    setSharesInput(transaction ? String(transaction.shares) : '');
    setPriceInput(transaction ? String(transaction.price) : '');
    setDateInput(transaction?.date ?? today());
    dateInputRef.current = transaction?.date ?? today();
    setCalendarMonth((transaction?.date ?? today()).slice(0, 7));
    setCalendarOpen(false);
    setCurrency(transaction?.currency ?? initialCurrency ?? 'EUR');
    setFxInput(String(transaction?.fxToEur ?? initialFxToEur ?? 0.92));
    setQuote(null);
    setHistoricalPriceDate('');
    setLoadingHistoricalPrice(false);
    setErrorMessage('');
    setShowAssetResults(false);
    setSelectedAssetName('');
    historicalRequestId.current += 1;
  }, [visible, transaction, initialSymbol, initialType, initialCurrency, initialFxToEur]);

  useEffect(() => {
    if (!visible || transaction || initialSymbol) return;
    const timer = setTimeout(() => symbolInputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [visible, transaction, initialSymbol]);

  useEffect(() => {
    if (!visible || transaction || !initialSymbol) return;
    let active = true;
    setLoadingQuote(true);
    fetchLiveQuote(initialSymbol).then((liveQuote) => {
      if (!active) return;
      setQuote(liveQuote);
      if (dateInputRef.current === today()) {
        setCurrency(liveQuote.currency);
        setFxInput(String(liveQuote.fxToEur));
        setPriceInput(String(liveQuote.price));
      }
    }).catch((error: unknown) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (active) setLoadingQuote(false);
    });
    return () => {
      active = false;
    };
  }, [visible, transaction, initialSymbol]);

  const loadHistoricalPrice = async (
    targetDate = dateInputRef.current,
    targetSymbol = symbolRef.current,
  ) => {
    const normalized = targetSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(normalized)) {
      setErrorMessage(t('Najprv zadaj platný burzový symbol.'));
      return;
    }
    if (!isValidDate(targetDate)) {
      setErrorMessage(t('Zadaj platný dátum v minulosti alebo dnešný dátum vo formáte RRRR-MM-DD.'));
      return;
    }
    const requestId = historicalRequestId.current + 1;
    historicalRequestId.current = requestId;
    setLoadingHistoricalPrice(true);
    setErrorMessage('');
    try {
      const historicalQuote = await fetchHistoricalQuoteForDate(normalized, targetDate);
      if (
        requestId !== historicalRequestId.current ||
        dateInputRef.current !== targetDate ||
        symbolRef.current.trim().toUpperCase() !== normalized
      ) return;
      setPriceInput(String(historicalQuote.price));
      setCurrency(historicalQuote.currency);
      setFxInput(String(historicalQuote.fxToEur));
      setHistoricalPriceDate(historicalQuote.date);
    } catch (error) {
      if (requestId === historicalRequestId.current) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId === historicalRequestId.current) setLoadingHistoricalPrice(false);
    }
  };

  const loadQuote = async (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setErrorMessage(t('Najprv zadaj burzový symbol.'));
      return;
    }
    setSymbol(normalized);
    symbolRef.current = normalized;
    setShowAssetResults(false);
    setSelectedAssetName(
      assetResults.find((asset) => asset.symbol === normalized)?.name ??
      getCatalogAsset(normalized)?.name ??
      normalized,
    );
    setLoadingQuote(true);
    setErrorMessage('');
    try {
      if (dateInputRef.current !== today()) {
        await loadHistoricalPrice(dateInputRef.current, normalized);
        return;
      }
      const liveQuote = await fetchLiveQuote(normalized);
      setQuote(liveQuote);
      setCurrency(liveQuote.currency);
      setFxInput(String(liveQuote.fxToEur));
      setPriceInput(String(liveQuote.price));
    } catch (error) {
      setQuote(null);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingQuote(false);
    }
  };

  const save = async () => {
    const normalized = symbol.trim().toUpperCase();
    const shares = parseAmount(sharesInput);
    const price = parseAmount(priceInput);
    const fxToEur = currency === 'EUR' ? 1 : parseAmount(fxInput);
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(normalized)) {
      setErrorMessage(t('Zadaj platný burzový symbol.'));
      return;
    }
    if (!shares) {
      setErrorMessage(t('Zadaj počet akcií väčší ako nula.'));
      return;
    }
    if (!price) {
      setErrorMessage(t('Zadaj cenu za jednu akciu.'));
      return;
    }
    if (!isValidDate(dateInput)) {
      setErrorMessage(t('Zadaj platný dátum v minulosti alebo dnešný dátum vo formáte RRRR-MM-DD.'));
      return;
    }
    if (!fxToEur) {
      setErrorMessage(t('Zadaj platný kurz meny voči EUR.'));
      return;
    }

    const catalog = getCatalogAsset(normalized);
    const input: TransactionInput = {
      symbol: normalized,
      name: quote?.symbol === normalized ? quote.name : selectedAssetName || initialName || catalog?.name || normalized,
      type,
      shares,
      price,
      currency,
      fxToEur,
      date: dateInput,
    };

    setSaving(true);
    setErrorMessage('');
    try {
      await onSave(input, transaction?.id, quote?.symbol === normalized ? quote : undefined);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const [calendarYear, calendarMonthIndex] = calendarMonth.split('-').map(Number);
  const calendarOffset = (new Date(calendarYear, calendarMonthIndex - 1, 1).getDay() + 6) % 7;
  const calendarDayCount = new Date(calendarYear, calendarMonthIndex, 0).getDate();
  const calendarCells = Array.from({ length: 42 }, (_, index) => {
    const day = index - calendarOffset + 1;
    return day > 0 && day <= calendarDayCount
      ? dateKey(calendarYear, calendarMonthIndex - 1, day)
      : null;
  });
  const calendarTitle = new Date(calendarYear, calendarMonthIndex - 1, 1).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
    month: 'long',
  });
  const shiftCalendar = (monthOffset: number, yearOffset = 0) => {
    const next = new Date(calendarYear + yearOffset, calendarMonthIndex - 1 + monthOffset, 1);
    setCalendarMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };
  const maximumCalendarMonth = today().slice(0, 7);
  const selectDate = (selectedDate: string) => {
    dateInputRef.current = selectedDate;
    setDateInput(selectedDate);
    setHistoricalPriceDate('');
    setCalendarOpen(false);
    setErrorMessage('');
    historicalRequestId.current += 1;
    setLoadingHistoricalPrice(false);
    if (selectedDate === today()) {
      if (quote) {
        setCurrency(quote.currency);
        setFxInput(String(quote.fxToEur));
        setPriceInput(String(quote.price));
      } else {
        setPriceInput('');
      }
    } else if (/^[A-Z0-9.^=-]{1,20}$/.test(symbolRef.current.trim().toUpperCase())) {
      setPriceInput('');
      void loadHistoricalPrice(selectedDate, symbolRef.current);
    } else {
      setPriceInput('');
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.scrim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headingIcon}>
              {isEditing ? <Pencil size={17} color={colors.green} /> : <Search size={17} color={colors.green} />}
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.title}>
                {isEditing
                  ? `${language === 'sk' ? 'Upraviť pohyb' : 'Edit transaction'} ${transaction?.symbol}`
                  : type === 'BUY' ? t('Pridať nákup') : t('Pridať predaj')}
              </Text>
              <Text style={styles.subtitle}>{t('Samostatný pohyb s vlastným dátumom a cenou')}</Text>
            </View>
            <Pressable accessibilityLabel={t('Zavrieť')} onPress={onClose} style={styles.closeButton}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {!isEditing ? (
              <View style={styles.typeRow}>
                {(['BUY', 'SELL'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: type === value }}
                    onPress={() => setType(value)}
                    style={[styles.typeButton, type === value && styles.typeButtonSelected]}
                  >
                    <Text style={[styles.typeText, type === value && styles.typeTextSelected]}>
                      {value === 'BUY' ? t('Nákup') : t('Predaj')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!fixedSymbol ? (
              <>
                <Text style={styles.label}>{t('Burzový symbol')}</Text>
                <View style={styles.symbolRow}>
                  <TextInput
                    ref={symbolInputRef}
                    accessibilityLabel={t('Burzový symbol')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoFocus
                    onChangeText={(text) => {
                      const nextSymbol = text.toUpperCase();
                      setSymbol(nextSymbol);
                      symbolRef.current = nextSymbol;
                      setShowAssetResults(true);
                      setSelectedAssetName('');
                      historicalRequestId.current += 1;
                      setLoadingHistoricalPrice(false);
                      setQuote(null);
                      setPriceInput('');
                      setErrorMessage('');
                    }}
                    onSubmitEditing={() => void loadQuote(symbol)}
                    placeholder={t('Napr. AAPL')}
                    placeholderTextColor={colors.muted}
                    returnKeyType="search"
                    style={[styles.input, styles.symbolInput]}
                    value={symbol}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={loadingQuote}
                    onPress={() => void loadQuote(symbol)}
                    style={[styles.quoteButton, loadingQuote && styles.disabled]}
                  >
                    {loadingQuote
                      ? <ActivityIndicator size="small" color={colors.surface} />
                      : <><RefreshCw size={14} color={colors.surface} /><Text style={styles.quoteButtonText}>{t('Cena')}</Text></>}
                  </Pressable>
                </View>
                <Text style={styles.fieldHint}>{t('Vyhľadaj a vyber akciu. Potom zadaj počet, dátum a cenu transakcie.')}</Text>
                {showAssetResults && symbol.trim() ? (
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    style={styles.assetResults}
                  >
                    {symbol.trim().length < 2 ? (
                      <Text style={styles.assetSearchHint}>{t('Zadaj aspoň 2 znaky názvu alebo symbolu.')}</Text>
                    ) : searchingAssets ? (
                      <View style={styles.assetSearchStatus}>
                        <ActivityIndicator size="small" color={colors.green} />
                        <Text style={styles.assetSearchHint}>{t('Vyhľadávam akcie…')}</Text>
                      </View>
                    ) : assetSearchError ? (
                      <Text style={styles.assetSearchHint}>{assetSearchError}</Text>
                    ) : assetResults.length ? assetResults.map((asset) => (
                      <Pressable
                        key={asset.symbol}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('Vybrať')} ${asset.symbol} ${asset.name}`}
                        onPress={() => void loadQuote(asset.symbol)}
                        style={styles.assetResult}
                      >
                        <View style={[styles.assetResultMark, { backgroundColor: asset.color }]} />
                        <View style={styles.assetResultCopy}>
                          <Text style={styles.assetResultSymbol}>{asset.symbol}</Text>
                          <Text style={styles.assetResultName} numberOfLines={1}>{asset.name}</Text>
                        </View>
                        <Check size={15} color={colors.muted} />
                      </Pressable>
                    )) : (
                      <Text style={styles.assetSearchHint}>{t('Nenašli sa žiadne akcie. Skús iný názov alebo symbol.')}</Text>
                    )}
                  </ScrollView>
                ) : null}
              </>
            ) : (
              <View style={styles.fixedSymbol}>
                <Text style={styles.label}>{t('Akcia')}</Text>
                <Text style={styles.fixedSymbolText}>{symbol} · {initialName ?? transaction?.name ?? ''}</Text>
              </View>
            )}

            {quote ? (
              <View style={styles.quoteCard}>
                <View style={styles.quoteCopy}>
                  <Text style={styles.quoteName}>{quote.name}</Text>
                  <Text style={styles.quoteMeta}>
                    {historicalPriceDate
                      ? language === 'sk' ? 'Historická cena · môžeš ju upraviť' : 'Historical price · you can edit it'
                      : language === 'sk' ? 'Trhovú cenu môžeš upraviť' : 'You can edit the market price'}
                  </Text>
                </View>
                <Text style={styles.quoteValue}>
                  {historicalPriceDate && parseAmount(priceInput)
                    ? `${parseAmount(priceInput)?.toFixed(2)} ${currency}`
                    : `${quote.price.toFixed(2)} ${quote.currency}`}
                </Text>
              </View>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <AlertCircle size={16} color={colors.red} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('Dátum transakcie')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Vybrať dátum transakcie')}
                accessibilityState={{ expanded: calendarOpen }}
                onPress={() => {
                  if (!calendarOpen) setCalendarMonth(dateInput.slice(0, 7));
                  setCalendarOpen((open) => !open);
                }}
                style={styles.datePickerButton}
              >
                <CalendarDays size={16} color={colors.green} />
                <Text style={styles.datePickerText}>
                  {new Date(`${dateInput}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
                <Text style={styles.datePickerHint}>{t('Zmeniť')}</Text>
              </Pressable>
              {calendarOpen ? (
                <View style={styles.calendar}>
                  <View style={styles.calendarNavigation}>
                    <Pressable
                      accessibilityLabel={t('Predchádzajúci rok')}
                      disabled={calendarYear <= 1900}
                      onPress={() => shiftCalendar(0, -1)}
                      style={styles.calendarNavigationButton}
                    >
                      <ChevronsLeft size={17} color={calendarYear <= 1900 ? colors.muted : colors.text} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t('Predchádzajúci mesiac')}
                      disabled={calendarMonth <= '1900-01'}
                      onPress={() => shiftCalendar(-1)}
                      style={styles.calendarNavigationButton}
                    >
                      <ChevronLeft size={17} color={colors.text} />
                    </Pressable>
                    <Text style={styles.calendarTitle}>{calendarTitle} {calendarYear}</Text>
                    <Pressable
                      accessibilityLabel={t('Nasledujúci mesiac')}
                      disabled={calendarMonth >= maximumCalendarMonth}
                      onPress={() => shiftCalendar(1)}
                      style={styles.calendarNavigationButton}
                    >
                      <ChevronRight
                        size={17}
                        color={calendarMonth >= maximumCalendarMonth ? colors.muted : colors.text}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t('Nasledujúci rok')}
                      disabled={calendarYear >= Number(today().slice(0, 4))}
                      onPress={() => shiftCalendar(0, 1)}
                      style={styles.calendarNavigationButton}
                    >
                      <ChevronsRight
                        size={17}
                        color={calendarYear >= Number(today().slice(0, 4)) ? colors.muted : colors.text}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.calendarWeek}>
                    {(language === 'sk' ? ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']).map((day) => (
                      <Text key={day} style={styles.calendarWeekday}>{day}</Text>
                    ))}
                  </View>
                  {Array.from({ length: 6 }, (_, week) => (
                    <View key={week} style={styles.calendarWeek}>
                      {calendarCells.slice(week * 7, week * 7 + 7).map((day, dayIndex) => {
                        const disabled = !day || day > today();
                        const selected = day === dateInput;
                        return (
                          <Pressable
                            key={day ?? `empty-${week}-${dayIndex}`}
                            accessibilityRole="button"
                            accessibilityLabel={day ?? 'Prázdny deň'}
                            accessibilityState={{ selected, disabled }}
                            disabled={disabled}
                            onPress={() => day && selectDate(day)}
                            style={[
                              styles.calendarDay,
                              selected && styles.calendarDaySelected,
                              disabled && styles.calendarDayDisabled,
                            ]}
                          >
                            <Text
                              style={[
                                styles.calendarDayText,
                                selected && styles.calendarDayTextSelected,
                                disabled && styles.calendarDayTextDisabled,
                              ]}
                            >
                              {day ? Number(day.slice(-2)) : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={loadingHistoricalPrice || loadingQuote}
                onPress={() => void loadHistoricalPrice(dateInput, symbol)}
                style={[styles.historicalPriceButton, (loadingHistoricalPrice || loadingQuote) && styles.disabled]}
              >
                {loadingHistoricalPrice
                  ? <ActivityIndicator size="small" color={colors.green} />
                  : <CalendarDays size={14} color={colors.green} />}
                <Text style={styles.historicalPriceText}>
                  {loadingHistoricalPrice ? t('Načítavam cenu k dátumu…') : t('Obnoviť cenu k dátumu')}
                </Text>
              </Pressable>
              {historicalPriceDate ? (
                <Text style={styles.fieldHint}>
                  {t('Použitá záverečná cena z')} {new Date(`${historicalPriceDate}T12:00:00`).toLocaleDateString(language === 'sk' ? 'sk-SK' : 'en-US')}.
                  {' '}{t('Cenu môžeš ďalej upraviť.')}
                </Text>
              ) : null}
              {transaction?.dateEstimated ? (
                <Text style={styles.fieldHint}>{t('Pôvodná pozícia nemala uložený dátum nákupu. Zmeň tento odhad na skutočný dátum, ak ho poznáš.')}</Text>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.sharesHeader}>
                <Text style={styles.label}>{t('Počet akcií')}</Text>
                {type === 'SELL' && !isEditing && heldShares > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSharesInput(String(heldShares))}
                    style={styles.sellAllButton}
                  >
                    <Text style={styles.sellAllText}>{t('Predať všetko')}</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                accessibilityLabel={t('Počet akcií')}
                keyboardType="decimal-pad"
                onChangeText={setSharesInput}
                placeholder={t('Napr. 2')}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={sharesInput}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('Cena za jednu akciu')}</Text>
              <View style={styles.priceRow}>
                <TextInput
                  accessibilityLabel={t('Cena za akciu')}
                  keyboardType="decimal-pad"
                  onChangeText={setPriceInput}
                  placeholder={t('Zadaj cenu')}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.priceInput]}
                  value={priceInput}
                />
                <View style={styles.currencyToggle}>
                  {(['EUR', 'USD'] as const).map((item) => {
                    const selected = currency === item;
                    return (
                      <Pressable
                        key={item}
                        disabled={Boolean(quote)}
                        onPress={() => setCurrency(item)}
                        style={[styles.currencyButton, selected && styles.currencyButtonSelected]}
                      >
                        <Text style={[styles.currencyText, selected && styles.currencyTextSelected]}>{item}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.fieldHint}>
                {t('Aktuálnu kotáciu môžeš prepísať podľa obchodu. Pri staršej transakcii zadaj jej skutočnú cenu.')}
              </Text>
            </View>

            {currency === 'USD' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{t('Kurz USD → EUR v deň transakcie')}</Text>
                <TextInput
                  accessibilityLabel={t('Historický kurz USD na EUR')}
                  keyboardType="decimal-pad"
                  onChangeText={setFxInput}
                  placeholder={t('Napr. 0,92')}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={fxInput}
                />
                <Text style={styles.fieldHint}>
                  {t('Predvolený je aktuálny kurz; pri staršej transakcii zadaj kurz platný v deň obchodu.')}
                </Text>
              </View>
            ) : null}

            <View style={styles.formFooter}>
              {transaction && onDelete ? (
                <Pressable onPress={() => onDelete(transaction.id)} disabled={saving} style={styles.deleteButton}>
                  <Text style={styles.deleteText}>{t('Odstrániť')}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} disabled={saving} style={styles.cancelButton}>
                <Text style={styles.cancelText}>{t('Zrušiť')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving || loadingQuote || loadingHistoricalPrice}
                onPress={() => void save()}
                style={[styles.saveButton, (saving || loadingQuote || loadingHistoricalPrice) && styles.disabled]}
              >
                {saving ? <ActivityIndicator size="small" color={colors.surface} /> : <Check size={17} color={colors.surface} />}
                <Text style={styles.saveText}>{isEditing ? t('Uložiť') : t('Pridať pohyb')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 22 : 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headingIcon: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginRight: 11,
  },
  headingCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  closeButton: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingTop: 12, paddingBottom: 10 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 7 },
  input: {
    minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 13, color: colors.text, fontSize: 14, fontWeight: '700', paddingHorizontal: 13,
  },
  typeRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 13, padding: 4, marginBottom: 15 },
  typeButton: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 10 },
  typeButtonSelected: { backgroundColor: colors.surfaceRaised },
  typeText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  typeTextSelected: { color: colors.green },
  symbolRow: { flexDirection: 'row', marginBottom: 10 },
  symbolInput: { flex: 1, marginRight: 8 },
  quoteButton: {
    minWidth: 86, minHeight: 46, flexDirection: 'row', gap: 6, backgroundColor: colors.green,
    borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
  },
  quoteButtonText: { color: colors.surface, fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  assetResults: {
    maxHeight: 190,
    overflow: 'hidden',
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  assetResult: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingHorizontal: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  assetResultMark: { width: 8, height: 8, borderRadius: 4, marginRight: 9 },
  assetResultCopy: { flex: 1 },
  assetResultSymbol: { color: colors.text, fontSize: 11, fontWeight: '900' },
  assetResultName: { color: colors.muted, fontSize: 9, marginTop: 2 },
  assetSearchHint: { color: colors.muted, fontSize: 10, lineHeight: 15, padding: 11 },
  assetSearchStatus: { flexDirection: 'row', alignItems: 'center' },
  fixedSymbol: { marginBottom: 12 },
  fixedSymbolText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  quoteCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 14, padding: 12, marginBottom: 14,
  },
  quoteCopy: { flex: 1 },
  quoteName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  quoteMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  quoteValue: { color: colors.green, fontSize: 13, fontWeight: '900' },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255,90,98,0.1)',
    borderRadius: 12, padding: 10, marginBottom: 12,
  },
  errorText: { color: '#ffc0c3', fontSize: 11, lineHeight: 16, flex: 1, marginLeft: 8 },
  fieldGroup: { marginBottom: 13 },
  sharesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sellAllButton: { paddingHorizontal: 10, paddingVertical: 8, marginBottom: 5, borderRadius: 8, backgroundColor: colors.surfaceRaised },
  sellAllText: { color: colors.green, fontSize: 11, fontWeight: '800' },
  datePickerButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  datePickerText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  datePickerHint: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '800',
  },
  calendar: {
    marginTop: 8,
    padding: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  calendarNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  calendarNavigationButton: {
    width: 30,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  calendarWeek: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  calendarWeekday: {
    flex: 1,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 6,
  },
  calendarDay: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 1,
    borderRadius: 9,
  },
  calendarDaySelected: {
    backgroundColor: colors.green,
  },
  calendarDayDisabled: {
    opacity: 0.25,
  },
  calendarDayText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  calendarDayTextSelected: {
    color: colors.surface,
    fontWeight: '900',
  },
  calendarDayTextDisabled: {
    color: colors.muted,
  },
  historicalPriceButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 2,
    marginTop: 6,
  },
  historicalPriceText: { color: colors.green, fontSize: 10, fontWeight: '800' },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  priceInput: { flex: 1, marginRight: 9 },
  currencyToggle: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.surface, padding: 3 },
  currencyButton: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 9 },
  currencyButtonSelected: { backgroundColor: colors.surfaceRaised },
  currencyText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  currencyTextSelected: { color: colors.green },
  fieldHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 6 },
  formFooter: { flexDirection: 'row', marginTop: 4, gap: 9 },
  deleteButton: {
    minHeight: 47, backgroundColor: 'rgba(255,90,98,0.12)', borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
  },
  deleteText: { color: colors.red, fontSize: 11, fontWeight: '800' },
  cancelButton: {
    flex: 1, minHeight: 47, backgroundColor: colors.surface, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  saveButton: {
    flex: 1.5, minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.green, borderRadius: 13, gap: 7,
  },
  saveText: { color: colors.surface, fontSize: 12, fontWeight: '900' },
});
