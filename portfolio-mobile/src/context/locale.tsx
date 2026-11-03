import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

export type AppLanguage = 'sk' | 'en';

const STORAGE_KEY = '@portfolio-mobile/language';

const englishTranslations: Record<string, string> = {
  'Portfólio': 'Portfolio',
  'Udalosti': 'Events',
  'Analytika': 'Analytics',
  'Výhľad': 'Forecast',
  'Moje portfólio': 'My portfolio',
  'Prehľad investícií': 'Investment overview',
  'Trhová hodnota': 'Market value',
  'Denná zmena': 'Daily change',
  'Celkový výnos': 'Total return',
  'Investované': 'Invested',
  'Celkovo nakúpené': 'Total bought',
  'Realizovaný výnos': 'Realized return',
  'Hodnota portfólia': 'Portfolio value',
  'Moje pozície': 'My positions',
  'Pridať akciu': 'Add stock',
  'Pridať akciu a transakciu': 'Add stock and transaction',
  'Pridať prvý nákup': 'Add first purchase',
  'Pridať nákup': 'Add purchase',
  'Pridať predaj': 'Add sale',
  'Zoradiť': 'Sort by',
  'Hodnota': 'Value',
  'A–Z': 'A–Z',
  'Načítavam tvoje pozície…': 'Loading your positions…',
  'Tvoje portfólio čaká na prvú pozíciu': 'Your portfolio is waiting for its first position',
  'Pridaj skutočné nákupy. Každý pohyb sa uloží samostatne a portfólio zobrazí každú akciu iba raz.': 'Add your purchases. Each transaction is saved separately and each stock appears only once in your portfolio.',
  'Zatvorené pozície': 'Closed positions',
  'Vývoj ceny akcie': 'Stock price history',
  'Moje pohyby': 'My transactions',
  'Watchlist': 'Watchlist',
  'Sledované akcie': 'Tracked stocks',
  'Sleduješ': 'Tracking',
  'titulov': 'stocks',
  'Aktuálna cena': 'Current price',
  'vývoj': 'change',
  'Najväčšia zmena': 'Biggest change',
  'Načítavam watchlist…': 'Loading watchlist…',
  'Zatiaľ nič nesleduješ': 'You are not tracking any stocks yet',
  'Pridaj akcie a maj ich ceny na jednom mieste.': 'Add stocks to keep their prices in one place.',
  'Pridať prvú akciu': 'Add your first stock',
  'Pridať do watchlistu': 'Add to watchlist',
  'Vyber titul na sledovanie': 'Choose a stock to track',
  'Názov alebo symbol akcie': 'Stock name or symbol',
  'Začni písať aspoň 2 znaky názvu alebo symbolu akcie.': 'Type at least 2 characters of a stock name or symbol.',
  'Vyhľadávam akcie…': 'Searching stocks…',
  'Nenašli sa žiadne akcie. Skús iný názov alebo symbol.': 'No stocks found. Try another name or symbol.',
  'Obnoviť ceny watchlistu': 'Refresh watchlist prices',
  'Scenárový odhad': 'Scenario estimate',
  'Modelovaná hodnota portfólia': 'Projected portfolio value',
  'Modelovaný zisk': 'Projected gain',
  'Časový horizont': 'Time horizon',
  'rok': 'year',
  'roky': 'years',
  'rokov': 'years',
  'Scenár ročného výnosu': 'Annual return scenario',
  'Opatrný': 'Cautious',
  'Základný': 'Base',
  'Optimistický': 'Optimistic',
  'Projekcia hodnoty': 'Value projection',
  'Odhadovaný vývoj': 'Projected performance',
  'Dnes': 'Today',
  'Potiahni prstom po grafe a zobraz presnú hodnotu v danom bode.': 'Drag across the chart to see the exact value at each point.',
  'Najskôr pridaj svoje pozície do portfólia. Potom sa výhľad vypočíta z ich aktuálnej hodnoty.': 'Add positions to your portfolio first. The forecast will then use their current value.',
  'Základný scenár vychádza z anualizovaného výnosu tvojho portfólia. Opatrný a optimistický ho upravujú pomerovo o 25 %.': 'The base scenario uses your portfolio’s annualized return. Cautious and optimistic scenarios adjust it proportionally by 25%.',
  'Bez dostatočných údajov je zatiaľ použitý výnos 0 %.': 'Without enough data, a 0% return is used for now.',
  'Ide o matematickú ukážku pri nemennom ročnom výnose. Skutočný vývoj sa nedá predpovedať; nejde o investičné odporúčanie.': 'This is a mathematical illustration assuming a constant annual return. Actual performance cannot be predicted; this is not investment advice.',
  'Kalendár trhu': 'Market calendar',
  'Sledované udalosti': 'Tracked events',
  'Všetko': 'All',
  'Výsledky': 'Earnings',
  'Dividendy': 'Dividends',
  'Správy': 'News',
  'Analytika portfólia': 'Portfolio analytics',
  'Porovnanie od prvej investície': 'Comparison since first investment',
  'Výnos v čase': 'Return over time',
  'Výkonnosť po rokoch': 'Annual performance',
  'Porovnať s': 'Compare with',
  'Dáta portfólia': 'Portfolio data',
  'Importovať transakcie (CSV)': 'Import transactions (CSV)',
  'Symbol, Date, Quantity, Price, Price Currency…': 'Symbol, Date, Quantity, Price, Price Currency…',
  'Exportovať transakcie (CSV)': 'Export transactions (CSV)',
  'Exportovať transakcie': 'Export transactions',
  'transakcií': 'transactions',
  'Resetovať portfólio': 'Reset portfolio',
  'Vymaže všetky zadané transakcie': 'Deletes all entered transactions',
  'Nájdené transakcie': 'Transactions found',
  'Predaje presahujúce držané akcie boli upravené': 'Sales exceeding holdings adjusted',
  'vynechané': 'skipped',
  'Pridať k existujúcim': 'Add to existing',
  'Nahradiť všetky': 'Replace all',
  'Zrušiť': 'Cancel',
  'Naozaj vymazať všetky transakcie?': 'Really delete all transactions?',
  'Túto akciu nie je možné vrátiť späť.': 'This cannot be undone.',
  'Vymazať': 'Delete',
  'Importované transakcie': 'Imported transactions',
  'Exportované transakcie': 'Exported transactions',
  'Portfólio bolo vymazané.': 'Portfolio deleted.',
  'Import zlyhal.': 'Import failed.',
  'Export zlyhal.': 'Export failed.',
  'Reset zlyhal.': 'Reset failed.',
  'Zdieľanie súborov nie je na tomto zariadení dostupné.': 'File sharing is not available on this device.',
  'Fundamenty: portfólio vs trh': 'Fundamentals: portfolio vs market',
  'Trh': 'Market',
  'Rozdiel': 'Difference',
  'Aktuálne P/E': 'Current P/E',
  'Porovnanie': 'Compare',
  'Porovnanie akcií': 'Stock comparison',
  'Fundamenty': 'Fundamentals',
  'Hľadať akciu': 'Search stock',
  'Pridať moje pozície': 'Add my positions',
  'P/E tento rok': 'P/E this year',
  'P/E budúci rok': 'P/E next year',
  'Tržby tento rok': 'Revenue this year',
  'Tržby budúci rok': 'Revenue next year',
  'EPS tento rok': 'EPS this year',
  'EPS budúci rok': 'EPS next year',
  'Nepodarilo sa načítať, ťukni pre opakovanie': 'Failed to load, tap to retry',
  'Pridaj akcie cez + alebo tlačidlom Pridať moje pozície.': 'Add stocks with + or the Add my positions button.',
  'Pridaj akcie cez + alebo tlačidlom Moje pozície.': 'Add stocks with + or the My positions button.',
  'Poznámky': 'Notes',
  'Tento rok = aktuálny fiškálny rok, budúci rok = nasledujúci fiškálny rok. P/E za tieto roky je cena / odhadované EPS analytikov. Zvýraznená (tučná) hodnota je najlepšia v stĺpci: najnižšie P/E alebo najvyšší rast. Zdroj je Yahoo Finance a ponúka odhady len na tieto dva roky.': 'This year = current fiscal year, next year = following fiscal year. P/E for these years is price / analyst EPS estimate. The bold underlined value is the best in the column: lowest P/E or highest growth. Source is Yahoo Finance, which only provides estimates for these two years.',
  'Forward P/E': 'Forward P/E',
  'Rast tržieb (budúci rok)': 'Rev. growth next year',
  'Rast EPS (budúci rok)': 'EPS growth next year',
  'Načítavam fundamentálne dáta…': 'Loading fundamentals…',
  'Trh = 20 najväčších firiem S&P 500 vážených kapitalizáciou. Fundamenty sa počítajú len z akcií, ktoré ich majú k dispozícii.': 'Market = 20 largest S&P 500 companies weighted by market cap. Only stocks with available fundamentals are included.',
  'Časové obdobie grafu': 'Chart time period',
  'Počítam výnosy jednotlivých rokov…': 'Calculating yearly returns…',
  'Po načítaní cien sa zobrazí porovnanie po rokoch.': 'The yearly comparison will appear once prices load.',
  'Po načítaní cien sa zobrazí porovnanie výnosov.': 'The return comparison will appear once prices load.',
  'Načítavam porovnanie s indexmi…': 'Loading index comparison…',
  'Trhová hodnota portfólia': 'Portfolio market value',
  'Portfólio aktívne od': 'Portfolio active since',
  'Priemerný ročný výnos': 'Average annual return',
  'MOJE PORTFÓLIO': 'MY PORTFOLIO',
  'Zisk / strata': 'Gain / loss',
  'Pozíciu sa nepodarilo nájsť.': 'Position could not be found.',
  'Dátum': 'Date',
  'Typ': 'Type',
  'Počet': 'Quantity',
  'Zatiaľ nemáš zaznamenané žiadne pohyby.': 'No transactions recorded yet.',
  'Nerealizovaný výnos': 'Unrealized return',
  'Celkový výsledok': 'Total result',
  'Späť na portfólio': 'Back to portfolio',
  'Nastavenia aplikácie': 'App settings',
  'Nastavenia': 'Settings',
  'Jazyk aplikácie': 'App language',
  'Slovenčina': 'Slovak',
  'Angličtina': 'English',
  'Jazyk sa nepodarilo uložiť.': 'Could not save language preference.',
  'Nákup': 'Buy',
  'Predaj': 'Sell',
  'Burzový symbol': 'Ticker symbol',
  'Vyhľadaj a vyber akciu. Potom zadaj počet, dátum a cenu transakcie.': 'Search for and select a stock, then enter the quantity, date, and transaction price.',
  'Zadaj aspoň 2 znaky názvu alebo symbolu.': 'Type at least 2 characters of a name or symbol.',
  'Akcia': 'Stock',
  'Samostatný pohyb s vlastným dátumom a cenou': 'A separate transaction with its own date and price',
  'Dátum transakcie': 'Transaction date',
  'Počet akcií': 'Number of shares',
  'Cena za jednu akciu': 'Price per share',
  'Zadaj cenu': 'Enter price',
  'Zmeniť': 'Change',
  'Obnoviť cenu k dátumu': 'Refresh price for date',
  'Načítavam cenu k dátumu…': 'Loading price for date…',
  'Cena pri nákupe': 'Purchase price',
  'Uložiť': 'Save',
  'Odstrániť': 'Delete',
  'Cena / suma': 'Price / total',
  'Historický kurz USD na EUR': 'Historical USD to EUR exchange rate',
  'Kurz USD → EUR v deň transakcie': 'USD → EUR exchange rate on transaction date',
  'Použitá záverečná cena z': 'Closing price used from',
  'Cenu môžeš ďalej upraviť.': 'You can still edit the price.',
  'Pôvodná pozícia nemala uložený dátum nákupu. Zmeň tento odhad na skutočný dátum, ak ho poznáš.': 'The original position had no purchase date. Replace this estimate with the actual date if you know it.',
  'Vybrať dátum transakcie': 'Choose transaction date',
  'Predchádzajúci rok': 'Previous year',
  'Predchádzajúci mesiac': 'Previous month',
  'Nasledujúci mesiac': 'Next month',
  'Nasledujúci rok': 'Next year',
  'Cena': 'Price',
  'Napr. AAPL': 'e.g. AAPL',
  'Napr. 2': 'e.g. 2',
  'Napr. 0,92': 'e.g. 0.92',
  'Cena za akciu': 'Price per share',
  'Pridať pohyb': 'Add transaction',
  'Obnovenie zlyhalo': 'Refresh failed',
  'Niektoré ceny sa neobnovili': 'Some prices could not be refreshed',
  'Nepodarilo sa obnoviť': 'Could not refresh',
  '4 udalosti v tvojom prehľade': '4 events in your overview',
  'November 2026': 'November 2026',
  'Ukážkový kalendár · termíny si over u emitenta': 'Sample calendar · verify dates with the issuer',
  'Akcia zatiaľ nie je v tvojom portfóliu': 'This stock is not in your portfolio yet',
  'Cena nedostupná': 'Price unavailable',
  'Načítavam cenu…': 'Loading price…',
  'Odhadovaný dátum': 'Estimated date',
  'Potiahni prstom po grafe pre zobrazenie ceny v daný deň.': 'Drag across the chart to see the price on a specific day.',
  'Pozícia': 'Position',
  'Vymazať hľadanie': 'Clear search',
  'Zavrieť': 'Close',
  'Najprv zadaj burzový symbol.': 'Enter a ticker symbol first.',
  'Najprv zadaj platný burzový symbol.': 'Enter a valid ticker symbol first.',
  'Zadaj cenu za jednu akciu.': 'Enter a price per share.',
  'Zadaj platný burzový symbol.': 'Enter a valid ticker symbol.',
  'Zadaj platný dátum v minulosti alebo dnešný dátum vo formáte RRRR-MM-DD.': 'Enter a valid date in the past or today in YYYY-MM-DD format.',
  'Zadaj platný kurz meny voči EUR.': 'Enter a valid exchange rate against EUR.',
  'Zadaj počet akcií väčší ako nula.': 'Enter a number of shares greater than zero.',
  'Historický vývoj': 'Historical performance',
  'Upraviť nákup z': 'Edit purchase on',
  'Upraviť predaj z': 'Edit sale on',
  'ks · hodnota': 'shares · value',
  'Odstrániť pohyb?': 'Delete transaction?',
  'Táto transakcia bude odstránená z histórie a výsledok sa prepočíta.': 'This transaction will be removed from history and the result recalculated.',
  'Transakcia sa neodstránila': 'Transaction could not be deleted',
  'November': 'November',
  'Výsledky za 3. štvrťrok': 'Q3 earnings',
  'Rozhodujúci deň pre dividendu': 'Dividend record date',
  'Novinka v sektore polovodičov': 'Semiconductor sector update',
  'po zatvorení trhu': 'After market close',
  'Očakávané zverejnenie hospodárskych výsledkov.': 'Expected earnings release.',
  'Orientačný dátum podľa ukážkového kalendára.': 'Estimated date from the sample calendar.',
  'Pripomienka k sledovanej spoločnosti.': 'Reminder for a tracked company.',
  'Vybrať': 'Select',
  'Aktuálnu kotáciu môžeš prepísať podľa obchodu. Pri staršej transakcii zadaj jej skutočnú cenu.': 'You can replace the current quote with the actual trade price. For an older transaction, enter its actual price.',
  'Predvolený je aktuálny kurz; pri staršej transakcii zadaj kurz platný v deň obchodu.': 'The current exchange rate is used by default; for an older transaction, enter the rate valid on the trade date.',
  'Graf výnosu v čase. Potiahnite prstom po grafe pre výber dátumu.': 'Return chart over time. Drag across the chart to select a date.',
  'indexy bez dividend': 'indices excluding dividends',
  'Načítavam…': 'Loading…',
  'Pridaj transakcie a zobraz výnosy v porovnaní s indexmi.': 'Add transactions to see returns compared with indices.',
  '1 týždeň': '1 week',
  'celé obdobie': 'all time',
  'Výnos za': 'Return over',
  'Pre toto obdobie nemáme historické kotácie.': 'No historical quotes are available for this period.',
  'Po pridaní transakcií sa zobrazí história portfólia.': 'Your portfolio history will appear after you add transactions.',
  'Potiahni prstom po grafe pre zobrazenie hodnoty a výnosu v daný deň.': 'Drag across the chart to see the portfolio value and return for a specific day.',
};

type LocaleContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (slovak: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('sk');
  const hasSelectedLanguage = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (active && !hasSelectedLanguage.current && (saved === 'sk' || saved === 'en')) {
        setLanguageState(saved);
      }
    }).catch((error: unknown) => {
      Alert.alert('Jazyk', error instanceof Error ? error.message : 'Nepodarilo sa načítať nastavenie jazyka.');
    });
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    hasSelectedLanguage.current = true;
    setLanguageState(nextLanguage);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch (error) {
      throw error;
    }
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    language,
    setLanguage,
    t: (slovak) => language === 'en' ? englishTranslations[slovak] ?? slovak : slovak,
  }), [language, setLanguage]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider.');
  return value;
}
