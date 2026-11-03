import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Check, Download, Globe2, Trash2, Upload } from 'lucide-react-native';
import { Header, Page, SectionTitle, Surface } from '../components/finapp';
import { AppLanguage, useLocale } from '../context/locale';
import { availableAssets, colors } from '../data/portfolio';
import { fetchHistoricalQuoteSeries } from '../data/quotes';
import {
  parseTransactionCsv,
  reconcileOversells,
  rowsToTransactions,
  transactionsToCsv,
} from '../data/transaction-csv';
import { Transaction, usePositions } from '../hooks/use-positions';

const languages: { code: AppLanguage; label: string; englishLabel: string }[] = [
  { code: 'sk', label: 'Slovenčina', englishLabel: 'Slovak' },
  { code: 'en', label: 'Angličtina', englishLabel: 'English' },
];

type PendingImport = { transactions: Transaction[]; adjusted: number; dropped: number };

async function readPickedFile(asset: DocumentPicker.DocumentPickerAsset) {
  if (Platform.OS === 'web') {
    return (await fetch(asset.uri)).text();
  }
  try {
    return await readAsStringAsync(asset.uri);
  } catch {
    return (await fetch(asset.uri)).text();
  }
}

async function loadUsdRates(startDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 10);
  const series = await fetchHistoricalQuoteSeries('EURUSD=X', start.toISOString().slice(0, 10), '1d');
  return series.points
    .map((point) => ({ date: new Date(point.timestamp * 1000).toISOString().slice(0, 10), rate: 1 / point.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default function SettingsScreen() {
  const router = useRouter();
  const { language, setLanguage, t } = useLocale();
  const { transactions, importTransactions, resetPortfolio, refreshQuotes } = usePositions();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<'import' | 'export' | 'reset' | null>(null);
  const [dataMessage, setDataMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const startImport = async () => {
    setDataMessage('');
    setDataError('');
    setPending(null);
    setBusy('import');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const rows = parseTransactionCsv(await readPickedFile(picked.assets[0]));
      const usdDates = rows.filter((row) => row.currency === 'USD').map((row) => row.date).sort();
      const rates = usdDates.length ? await loadUsdRates(usdDates[0]) : [];
      const fxToEurOn = (date: string) => {
        let rate = rates[0]?.rate ?? 1;
        for (const point of rates) {
          if (point.date > date) break;
          rate = point.rate;
        }
        return rate;
      };
      const nameFor = (symbol: string) => availableAssets.find((asset) => asset.symbol === symbol)?.name ?? symbol;
      const imported = rowsToTransactions(rows, fxToEurOn, nameFor);
      const reconciled = reconcileOversells([], imported);
      setPending({ transactions: reconciled.transactions, adjusted: reconciled.adjusted, dropped: reconciled.dropped });
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Import zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = async (mode: 'append' | 'replace') => {
    if (!pending) return;
    setBusy('import');
    setDataError('');
    try {
      let items = pending.transactions;
      if (mode === 'append') {
        items = reconcileOversells(transactions, pending.transactions).transactions;
      }
      await importTransactions(items, mode);
      setDataMessage(`${t('Importované transakcie')}: ${items.length}`);
      setPending(null);
      void refreshQuotes().catch(() => undefined);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Import zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setDataMessage('');
    setDataError('');
    setBusy('export');
    try {
      const csv = transactionsToCsv(transactions);
      const fileName = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        if (!(await Sharing.isAvailableAsync())) throw new Error(t('Zdieľanie súborov nie je na tomto zariadení dostupné.'));
        const file = new File(Paths.cache, fileName);
        file.create({ overwrite: true });
        await file.write(csv);
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: t('Exportovať transakcie') });
      }
      setDataMessage(`${t('Exportované transakcie')}: ${transactions.length}`);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Export zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    setDataMessage('');
    setDataError('');
    try {
      await resetPortfolio();
      setConfirmReset(false);
      setDataMessage(t('Portfólio bolo vymazané.'));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Reset zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page>
      <Header
        title={t('Nastavenia aplikácie')}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={language === 'sk' ? 'Späť' : 'Back'}
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <ArrowLeft size={18} color={colors.text} />
          </Pressable>
        }
      />
      <SectionTitle title={t('Jazyk aplikácie')} />
      <Surface style={styles.languageList}>
        {languages.map((option) => {
          const selected = language === option.code;
          return (
            <Pressable
              key={option.code}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: savingLanguage }}
              disabled={savingLanguage}
              onPress={async () => {
                if (selected) return;
                setSavingLanguage(true);
                setSaveError('');
                try {
                  await setLanguage(option.code);
                } catch (error) {
                  setSaveError(error instanceof Error ? error.message : t('Jazyk sa nepodarilo uložiť.'));
                } finally {
                  setSavingLanguage(false);
                }
              }}
              style={[styles.languageOption, selected && styles.languageOptionSelected]}
            >
              <View style={styles.languageIcon}>
                <Globe2 size={17} color={selected ? colors.green : colors.muted} />
              </View>
              <View style={styles.languageCopy}>
                <Text style={styles.languageName}>
                  {language === 'sk' ? option.label : option.englishLabel}
                </Text>
                <Text style={styles.languageNative}>{option.label}</Text>
              </View>
              {savingLanguage && !selected
                ? <ActivityIndicator size="small" color={colors.green} />
                : selected ? <Check size={18} color={colors.green} /> : null}
            </Pressable>
          );
        })}
      </Surface>
      {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}

      <SectionTitle title={t('Dáta portfólia')} />
      <Surface style={styles.languageList}>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={startImport}
          style={styles.languageOption}
        >
          <View style={styles.languageIcon}><Upload size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Importovať transakcie (CSV)')}</Text>
            <Text style={styles.languageNative}>{t('Symbol, Date, Quantity, Price, Price Currency…')}</Text>
          </View>
          {busy === 'import' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null || !transactions.length}
          onPress={exportCsv}
          style={[styles.languageOption, !transactions.length && styles.disabled]}
        >
          <View style={styles.languageIcon}><Download size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Exportovať transakcie (CSV)')}</Text>
            <Text style={styles.languageNative}>{`${transactions.length} ${t('transakcií')}`}</Text>
          </View>
          {busy === 'export' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null || !transactions.length}
          onPress={() => setConfirmReset(true)}
          style={[styles.languageOption, !transactions.length && styles.disabled]}
        >
          <View style={styles.languageIcon}><Trash2 size={17} color={colors.red} /></View>
          <View style={styles.languageCopy}>
            <Text style={[styles.languageName, { color: colors.red }]}>{t('Resetovať portfólio')}</Text>
            <Text style={styles.languageNative}>{t('Vymaže všetky zadané transakcie')}</Text>
          </View>
        </Pressable>
      </Surface>

      {pending ? (
        <Surface style={styles.confirmCard}>
          <Text style={styles.languageName}>{`${t('Nájdené transakcie')}: ${pending.transactions.length}`}</Text>
          {pending.adjusted || pending.dropped ? (
            <Text style={styles.languageNative}>
              {`${t('Predaje presahujúce držané akcie boli upravené')}: ${pending.adjusted}, ${t('vynechané')}: ${pending.dropped}`}
            </Text>
          ) : null}
          <View style={styles.confirmActions}>
            <Pressable disabled={busy !== null} onPress={() => confirmImport('append')} style={styles.primaryButton}>
              <Text style={styles.primaryText}>{t('Pridať k existujúcim')}</Text>
            </Pressable>
            <Pressable disabled={busy !== null} onPress={() => confirmImport('replace')} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t('Nahradiť všetky')}</Text>
            </Pressable>
            <Pressable disabled={busy !== null} onPress={() => setPending(null)} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t('Zrušiť')}</Text>
            </Pressable>
          </View>
        </Surface>
      ) : null}

      {confirmReset ? (
        <Surface style={styles.confirmCard}>
          <Text style={styles.languageName}>{t('Naozaj vymazať všetky transakcie?')}</Text>
          <Text style={styles.languageNative}>{t('Túto akciu nie je možné vrátiť späť.')}</Text>
          <View style={styles.confirmActions}>
            <Pressable disabled={busy !== null} onPress={reset} style={[styles.primaryButton, { backgroundColor: colors.red }]}>
              <Text style={styles.primaryText}>{t('Vymazať')}</Text>
            </Pressable>
            <Pressable disabled={busy !== null} onPress={() => setConfirmReset(false)} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t('Zrušiť')}</Text>
            </Pressable>
          </View>
        </Surface>
      ) : null}

      {dataMessage ? <Text style={styles.success}>{dataMessage}</Text> : null}
      {dataError ? <Text accessibilityRole="alert" style={styles.error}>{dataError}</Text> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 39,
    height: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  languageList: {
    paddingVertical: 2,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 66,
    paddingHorizontal: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  languageOptionSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  languageIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
    marginRight: 11,
  },
  languageCopy: {
    flex: 1,
  },
  languageName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  languageNative: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  error: {
    color: colors.red,
    fontSize: 12,
    marginTop: 10,
  },
  success: {
    color: colors.green,
    fontSize: 12,
    marginTop: 10,
  },
  disabled: {
    opacity: 0.45,
  },
  confirmCard: {
    marginTop: 10,
    padding: 13,
    gap: 4,
  },
  confirmActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  primaryButton: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: colors.green,
  },
  primaryText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '800',
  },
  secondaryButton: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  secondaryText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
});
