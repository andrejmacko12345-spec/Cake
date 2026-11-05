import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Bell, Check, ChevronDown, ChevronRight, Download, Globe2, Moon, Palette, Sun, Trash2, Upload } from 'lucide-react-native';
import { setEventPref, useEventPrefs } from '../data/event-prefs';
import { Header, Page, Surface } from '../components/finapp';
import { AppLanguage, useLocale } from '../context/locale';
import { createEncryptedBackup, decryptBackup, getBackupTransactions, LocalBackup, restoreLocalBackup } from '../data/local-backup';
import { availableAssets, colors } from '../data/portfolio';
import { storeTheme, ThemeName, useTheme, useThemedStyles } from '../data/theme';
import { fetchHistoricalQuoteSeries } from '../data/quotes';
import {
  parseTransactionCsv,
  reconcileOversells,
  rowsToTransactions,
  transactionsToCsv,
  transactionCsvTemplate,
} from '../data/transaction-csv';
import { Transaction, usePositions } from '../hooks/use-positions';

const languages: { code: AppLanguage; label: string; englishLabel: string }[] = [
  { code: 'sk', label: 'Slovenčina', englishLabel: 'Slovak' },
  { code: 'en', label: 'Angličtina', englishLabel: 'English' },
];

type PendingImport = { transactions: Transaction[]; adjusted: number; dropped: number };

const themeOptions: { name: ThemeName; label: string; Icon: typeof Moon }[] = [
  { name: 'dark', label: 'Tmavý', Icon: Moon },
  { name: 'light', label: 'Svetlý', Icon: Sun },
];

function AccordionHeader({
  icon,
  title,
  open,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  open: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={styles.accordion}
    >
      <View style={styles.languageIcon}>{icon}</View>
      <Text style={styles.accordionTitle}>{title}</Text>
      {open ? <ChevronDown size={18} color={colors.muted} /> : <ChevronRight size={18} color={colors.muted} />}
    </Pressable>
  );
}

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
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { language, setLanguage, t, errorText } = useLocale();
  const [openSection, setOpenSection] = useState<'language' | 'data' | 'appearance' | 'events' | null>(null);
  const eventPrefs = useEventPrefs();
  const themeChoice = useTheme();
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeError, setThemeError] = useState('');

  const chooseTheme = async (name: ThemeName) => {
    if (name === themeChoice || savingTheme) return;
    setSavingTheme(true);
    setThemeError('');
    try {
      await storeTheme(name);
    } catch (error) {
      console.warn('Theme change failed:', error);
      setThemeError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTheme(false);
    }
  };
  const { transactions, importTransactions, resetPortfolio, refreshQuotes } = usePositions();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<'import' | 'export' | 'template' | 'reset' | 'backup-export' | 'backup-import' | 'backup-restore' | null>(null);
  const [dataMessage, setDataMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupRecoveryCode, setBackupRecoveryCode] = useState('');
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState('');
  const [backupContent, setBackupContent] = useState('');
  const [pendingBackup, setPendingBackup] = useState<LocalBackup | null>(null);

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

  const exportCsv = async (template = false) => {
    setDataMessage('');
    setDataError('');
    setBusy(template ? 'template' : 'export');
    try {
      const csv = template ? transactionCsvTemplate() : transactionsToCsv(transactions);
      const fileName = template ? 'transactions-template.csv' : `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
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
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: t(template ? 'Stiahnuť vzor CSV' : 'Exportovať transakcie') });
      }
      setDataMessage(template ? t('Vzor CSV bol exportovaný. Pred importom nahraď ukážkové riadky vlastnými transakciami.') : `${t('Exportované transakcie')}: ${transactions.length}`);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Export zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  const exportEncryptedBackup = async () => {
    setDataMessage('');
    setDataError('');
    setCreatedRecoveryCode('');
    setBusy('backup-export');
    try {
      const backup = await createEncryptedBackup();
      const fileName = `fincake-backup-${new Date().toISOString().slice(0, 10)}.fincake-backup`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([backup.content], { type: 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        if (!(await Sharing.isAvailableAsync())) throw new Error(t('Zdieľanie súborov nie je na tomto zariadení dostupné.'));
        const file = new File(Paths.cache, fileName);
        file.create({ overwrite: true });
        await file.write(backup.content);
        await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: t('Uložiť šifrovanú zálohu') });
      }
      setCreatedRecoveryCode(backup.recoveryCode);
      setDataMessage(t('Záloha je pripravená. Súbor a obnovovací kód ulož oddelene.'));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Export zálohy zlyhal.'));
    } finally {
      setBusy(null);
    }
  };

  const copyRecoveryCode = async () => {
    try {
      await Clipboard.setStringAsync(createdRecoveryCode);
      setDataMessage(t('Obnovovací kód bol skopírovaný.'));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Kód sa nepodarilo skopírovať.'));
    }
  };

  const pickEncryptedBackup = async () => {
    setDataMessage('');
    setDataError('');
    setPendingBackup(null);
    setBusy('backup-import');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (asset.size !== undefined && asset.size > 16 * 1024 * 1024) throw new Error(t('Backup file is too large.'));
      setBackupContent(await readPickedFile(asset));
      setBackupRecoveryCode('');
      setCreatedRecoveryCode('');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Načítanie zálohy zlyhalo.'));
    } finally {
      setBusy(null);
    }
  };

  const inspectEncryptedBackup = async () => {
    setDataMessage('');
    setDataError('');
    setBusy('backup-import');
    try {
      const backup = await decryptBackup(backupContent, backupRecoveryCode);
      setPendingBackup(backup);
      setDataMessage(`${t('Záloha obsahuje transakcie')}: ${getBackupTransactions(backup).length}`);
    } catch (error) {
      setPendingBackup(null);
      setDataError(error instanceof Error ? error.message : t('Obnovenie zálohy zlyhalo.'));
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async () => {
    if (!pendingBackup) return;
    setBusy('backup-restore');
    setDataMessage('');
    setDataError('');
    try {
      await restoreLocalBackup(pendingBackup);
      await setLanguage(pendingBackup.values['@portfolio-mobile/language'] as AppLanguage);
      await storeTheme(pendingBackup.values['@portfolio-mobile/theme'] as ThemeName);
      setPendingBackup(null);
      setBackupContent('');
      setBackupRecoveryCode('');
      setCreatedRecoveryCode('');
      setDataMessage(t('Záloha bola obnovená. Existujúce dáta boli nahradené.'));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : t('Obnovenie zálohy zlyhalo.'));
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
        title={t('Profil')}
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
      <Pressable accessibilityRole="link" style={styles.accordion} onPress={() => router.push('/legal')}>
        <Text style={styles.accordionTitle}>{t('Súkromie a podpora')}</Text>
        <ChevronRight size={18} color={colors.muted} />
      </Pressable>
      <View style={styles.menuCard}>
      <AccordionHeader
        icon={<Globe2 size={17} color={colors.green} />}
        title={t('Jazyk aplikácie')}
        open={openSection === 'language'}
        onPress={() => setOpenSection(openSection === 'language' ? null : 'language')}
      />
      {openSection === 'language' ? (<>
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
      {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorText(saveError)}</Text> : null}
      </>) : null}

      <AccordionHeader
        icon={<Bell size={17} color={colors.green} />}
        title={t('Nastavenia udalostí')}
        open={openSection === 'events'}
        onPress={() => setOpenSection(openSection === 'events' ? null : 'events')}
      />
      {openSection === 'events' ? (
        <Surface style={styles.languageList}>
          {([
            { key: 'earnings', label: t('Výsledky (earnings)') },
            { key: 'dividends', label: t('Dividendy') },
            { key: 'news', label: t('Správy') },
          ] as const).map((option) => {
            const selected = eventPrefs[option.key];
            return (
              <Pressable
                key={option.key}
                accessibilityRole="switch"
                accessibilityState={{ checked: selected }}
                onPress={() => void setEventPref(option.key, !selected).catch((error: unknown) => {
                  console.warn('Event preferences could not be saved:', error);
                  Alert.alert(t('Chyba'), errorText(error instanceof Error ? error.message : String(error)));
                })}
                style={[styles.languageOption, selected && styles.languageOptionSelected]}
              >
                <View style={styles.languageCopy}>
                  <Text style={styles.languageName}>{option.label}</Text>
                </View>
                {selected ? <Check size={18} color={colors.green} /> : null}
              </Pressable>
            );
          })}
        </Surface>
      ) : null}

      <AccordionHeader
        icon={<Upload size={17} color={colors.green} />}
        title={t('Prenos dát')}
        open={openSection === 'data'}
        onPress={() => setOpenSection(openSection === 'data' ? null : 'data')}
      />
      {openSection === 'data' ? (<>
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
          onPress={() => exportCsv()}
          style={[styles.languageOption, !transactions.length && styles.disabled]}
        >
          <View style={styles.languageIcon}><Download size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Exportovať transakcie (CSV)')}</Text>
            <Text style={styles.languageNative}>{`${transactions.length} ${t('transakcií')}`}</Text>
          </View>
          {busy === 'export' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy !== null}
          onPress={() => exportCsv(true)} style={styles.languageOption}>
          <View style={styles.languageIcon}><Download size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Stiahnuť vzor CSV')}</Text>
            <Text style={styles.languageNative}>{t('Ukážkový nákup a predaj. Pred importom nahraď riadky vlastnými údajmi.')}</Text>
            <Text style={styles.languageNative}>{t('Dátum YYYY-MM-DD, desatinná bodka, mena EUR alebo USD. Quantity: kladné = nákup, záporné = predaj. To Cash: TRUE = ponechať výnos predaja v hotovosti. Poplatky sa zatiaľ neimportujú.')}</Text>
          </View>
          {busy === 'template' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={exportEncryptedBackup}
          style={styles.languageOption}
        >
          <View style={styles.languageIcon}><Download size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Vytvoriť šifrovanú zálohu')}</Text>
            <Text style={styles.languageNative}>{t('Obsahuje transakcie, zoznamy akcií a nastavenia. Obnovovací kód ulož oddelene od súboru.')}</Text>
          </View>
          {busy === 'backup-export' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={pickEncryptedBackup}
          style={styles.languageOption}
        >
          <View style={styles.languageIcon}><Upload size={17} color={colors.green} /></View>
          <View style={styles.languageCopy}>
            <Text style={styles.languageName}>{t('Obnoviť zo šifrovanej zálohy')}</Text>
            <Text style={styles.languageNative}>{t('Vyber záložný súbor a zadaj jeho obnovovací kód.')}</Text>
          </View>
          {busy === 'backup-import' ? <ActivityIndicator size="small" color={colors.green} /> : null}
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

      {createdRecoveryCode ? (
        <Surface style={styles.confirmCard}>
          <Text style={styles.languageName}>{t('Obnovovací kód')}</Text>
          <Text style={styles.languageNative}>{t('Bez tohto kódu sa šifrovaná záloha nedá obnoviť. Kód nie je uložený v súbore.')}</Text>
          <Text selectable style={styles.recoveryCode}>{createdRecoveryCode}</Text>
          <Pressable accessibilityRole="button" onPress={copyRecoveryCode} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t('Kopírovať kód')}</Text>
          </Pressable>
        </Surface>
      ) : null}

      {backupContent && !pendingBackup ? (
        <Surface style={styles.confirmCard}>
          <Text style={styles.languageName}>{t('Obnovovací kód zálohy')}</Text>
          <TextInput
            accessibilityLabel={t('Obnovovací kód zálohy')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setBackupRecoveryCode}
            placeholder={t('Vlož obnovovací kód')}
            placeholderTextColor={colors.muted}
            style={styles.recoveryInput}
            value={backupRecoveryCode}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null || !backupRecoveryCode.trim()}
            onPress={inspectEncryptedBackup}
            style={[styles.primaryButton, (busy !== null || !backupRecoveryCode.trim()) && styles.disabled]}
          >
            <Text style={styles.primaryText}>{t('Overiť zálohu')}</Text>
          </Pressable>
        </Surface>
      ) : null}

      {pendingBackup ? (
        <Surface style={styles.confirmCard}>
          <Text style={styles.languageName}>{t('Nahradiť existujúce dáta zálohou?')}</Text>
          <Text style={styles.languageNative}>{t('Obnovia sa transakcie, zoznamy akcií a nastavenia. Táto akcia prepíše aktuálne dáta.')}</Text>
          <View style={styles.confirmActions}>
            <Pressable disabled={busy !== null} onPress={restoreBackup} style={styles.primaryButton}>
              <Text style={styles.primaryText}>{t('Nahradiť a obnoviť')}</Text>
            </Pressable>
            <Pressable
              disabled={busy !== null}
              onPress={() => { setPendingBackup(null); setBackupContent(''); setBackupRecoveryCode(''); }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>{t('Zrušiť')}</Text>
            </Pressable>
          </View>
          {busy === 'backup-restore' ? <ActivityIndicator size="small" color={colors.green} /> : null}
        </Surface>
      ) : null}

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
      {dataError ? <Text accessibilityRole="alert" style={styles.error}>{errorText(dataError)}</Text> : null}
      </>) : null}

      <AccordionHeader
        icon={<Palette size={17} color={colors.green} />}
        title={t('Vzhľad')}
        open={openSection === 'appearance'}
        onPress={() => setOpenSection(openSection === 'appearance' ? null : 'appearance')}
      />
      {openSection === 'appearance' ? (<>
        <Surface style={styles.languageList}>
          {themeOptions.map((option) => {
            const selected = themeChoice === option.name;
            return (
              <Pressable
                key={option.name}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: savingTheme }}
                disabled={savingTheme}
                onPress={() => { void chooseTheme(option.name); }}
                style={[styles.languageOption, selected && styles.languageOptionSelected]}
              >
                <View style={styles.languageIcon}>
                  <option.Icon size={17} color={selected ? colors.green : colors.muted} />
                </View>
                <View style={styles.languageCopy}>
                  <Text style={styles.languageName}>{t(option.label)}</Text>
                </View>
                {selected ? <Check size={18} color={colors.green} /> : null}
              </Pressable>
            );
          })}
        </Surface>
        {themeError ? (
          <Text accessibilityRole="alert" style={styles.error}>{errorText(themeError)}</Text>
        ) : null}
      </>) : null}
      </View>
    </Page>
  );
}

const createStyles = () => StyleSheet.create({
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuCard: {
    marginTop: 8,
    borderRadius: 22,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  accordionTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    width: 39,
    height: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  languageList: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    padding: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: colors.surfaceRaised,
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
    backgroundColor: 'transparent',
    marginRight: 12,
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
    margin: 12,
  },
  success: {
    color: colors.green,
    fontSize: 12,
    margin: 12,
  },
  disabled: {
    opacity: 0.45,
  },
  confirmCard: {
    margin: 12,
    padding: 13,
    gap: 4,
  },
  recoveryCode: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    paddingVertical: 10,
  },
  recoveryInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    marginVertical: 8,
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
