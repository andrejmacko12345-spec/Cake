export type AppLanguage = 'sk' | 'en';

export function translateText(text: string, language: AppLanguage, translations: Record<string, string>) {
  if (language === 'en') return Object.hasOwn(translations, text) ? translations[text] : text;
  if (Object.hasOwn(translations, text)) return text;
  for (const [slovak, english] of Object.entries(translations)) {
    if (english === text) return slovak;
  }
  return text;
}

export function translateError(message: string, language: AppLanguage, translations: Record<string, string>) {
  if (Object.hasOwn(translations, message) || Object.values(translations).includes(message)) {
    return translateText(message, language, translations);
  }
  return localizedError(message, language);
}

export function localizedError(message: string, language: AppLanguage) {
  const oversell = /^Predaj (.+) z (\d{4}-\d{2}-\d{2}) je vyšší než počet akcií, ktoré boli k tomuto dátumu nakúpené\.$/.exec(message);
  if (oversell) return language === 'sk' ? message
    : `The sale of ${oversell[1]} on ${oversell[2]} exceeds the shares held on that date.`;
  const csvRow = /^Riadok (\d+): (.+)$/.exec(message);
  if (csvRow) {
    const reasons: [RegExp, string][] = [
      [/^neplatný symbol/, 'invalid symbol'],
      [/^neplatný dátum/, 'invalid date'],
      [/^neplatné množstvo/, 'invalid quantity'],
      [/^neplatná cena/, 'invalid price'],
      [/^nepodporovaná mena/, 'unsupported currency'],
    ];
    for (const [pattern, english] of reasons) {
      if (pattern.test(csvRow[2])) return language === 'sk' ? message
        : `Row ${csvRow[1]}: ${csvRow[2].replace(pattern, english)}`;
    }
  }
  const details: [RegExp, (match: RegExpExecArray) => string][] = [
    [/^Historická cena pre (.+) nie je dostupná k (.+)\.$/, (m) => `The historical price for ${m[1]} on ${m[2]} is unavailable.`],
    [/^Historický kurz USD\/EUR nie je dostupný k (.+)\.$/, (m) => `The historical USD/EUR exchange rate for ${m[1]} is unavailable.`],
    [/^Chýba historická cena (.+) k (.+)\.$/, (m) => `Missing historical price for ${m[1]} on ${m[2]}.`],
    [/^Chýba história (.+)\.$/, (m) => `Missing history for ${m[1]}.`],
    [/^Ročný výnos za (\d+) sa nepodarilo vypočítať\.$/, (m) => `The annual return for ${m[1]} could not be calculated.`],
    [/^Neplatný symbol (.+)\.$/, (m) => `Invalid symbol ${m[1]}.`],
    [/^Symbol (.+) sa nepodarilo nájsť\.$/, (m) => `Symbol ${m[1]} could not be found.`],
    [/^Pre (.+) nie je dostupná aktuálna cena\.$/, (m) => `No current price is available for ${m[1]}.`],
    [/^Pre (.+) nie je dostupná historická cena k (.+)\.$/, (m) => `No historical price is available for ${m[1]} on ${m[2]}.`],
    [/^Historický kurz USD\/EUR k (.+) nie je dostupný\.$/, (m) => `The historical USD/EUR exchange rate for ${m[1]} is unavailable.`],
    [/^Historická mena (.+) pri (.+) nie je podporovaná\.$/, (m) => `The historical currency ${m[1] === 'neznáma' ? 'unknown' : m[1]} for ${m[2]} is not supported.`],
  ];
  for (const [pattern, english] of details) {
    const match = pattern.exec(message);
    if (match) return language === 'sk' ? message : english(match);
  }
  const http = /\bHTTP (\d{3})\b/.exec(message);
  if (http) return language === 'sk' ? `Zdroj dát vrátil HTTP ${http[1]}.` : `The data source returned HTTP ${http[1]}.`;
  const known: Record<string, [string, string]> = {
    'Invalid login credentials': ['Nesprávny e-mail alebo heslo.', 'Invalid email or password.'],
    'Email not confirmed': ['Najprv potvrď e-mailovú adresu.', 'Confirm your email address first.'],
    'User already registered': ['Účet s týmto e-mailom už existuje.', 'An account with this email already exists.'],
    'Failed to fetch': ['Pripojenie zlyhalo. Skontroluj internet a skús znova.', 'Connection failed. Check your internet connection and try again.'],
    'Network request failed': ['Pripojenie zlyhalo. Skontroluj internet a skús znova.', 'Connection failed. Check your internet connection and try again.'],
    'Incomplete authentication link.': ['Prihlasovací odkaz nie je úplný. Vyžiadaj si nový.', 'The sign-in link is incomplete. Request a new one.'],
    'New password should be different from the old password.': ['Nové heslo musí byť odlišné od starého.', 'The new password must be different from the old password.'],
    'Auth session missing!': ['Prihlás sa znova.', 'Please sign in again.'],
    'Account changed before backup. No data was uploaded.': ['Účet sa zmenil. Dáta neboli odoslané.', 'The account changed. No data was uploaded.'],
    'Account identity changed': ['Účet sa zmenil. Prihlás sa znova.', 'The account changed. Please sign in again.'],
    'A newer backup exists. Restore the account backup before saving.': ['Existuje novšia záloha. Pred uložením obnov dáta z účtu.', 'A newer backup exists. Restore the account backup before saving.'],
    'This account has been deleted.': ['Tento účet bol vymazaný.', 'This account has been deleted.'],
    'Account data is changing. Please try again.': ['Dáta účtu sa menia. Skús znova.', 'Account data is changing. Please try again.'],
  };
  const match = known[message];
  if (match) return match[language === 'sk' ? 0 : 1];
  if (/password.*(?:least|short|weak)/i.test(message)) return language === 'sk'
    ? 'Heslo je príliš slabé. Použi dlhšie heslo s písmenami, číslami a symbolmi.'
    : 'The password is too weak. Use a longer password with letters, numbers and symbols.';
  if (/rate.limit|too many|security purposes/i.test(message)) return language === 'sk'
    ? 'Príliš veľa pokusov. Počkaj chvíľu a skús znova.' : 'Too many attempts. Please wait and try again.';
  if (/expired|invalid.*token/i.test(message)) return language === 'sk'
    ? 'Odkaz už nie je platný. Vyžiadaj si nový.' : 'This link is no longer valid. Request a new one.';
  return language === 'sk'
    ? 'Operácia zlyhala. Skús znova. Ak problém pretrváva, kontaktuj podporu.'
    : 'The operation failed. Try again. If the problem persists, contact support.';
}
