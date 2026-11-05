import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { getRandomBytesAsync } from 'expo-crypto';
import type { Transaction } from '../hooks/use-positions';
import { appStorage, setItems } from './app-storage';
import { isTransaction, validateLedger } from './transaction-validation';
import { defaultWatchlists, isValidSymbol, parseWatchlists, WATCHLIST_KEY } from './watchlists';
import { parseEventSymbols } from './event-symbols';

const TRANSACTIONS_KEY = '@portfolio-mobile/transactions-v1';
const LANGUAGE_KEY = '@portfolio-mobile/language';
const COMPARE_SYMBOLS_KEY = '@portfolio-mobile/compare-symbols';
const COMPARE_METRICS_KEY = '@portfolio-mobile/compare-metrics';
const HIDE_AMOUNTS_KEY = '@portfolio-mobile/hide-amounts';
const THEME_KEY = '@portfolio-mobile/theme';
const EVENT_PREFERENCES_KEY = 'event-preferences';
const BACKUP_KEYS = [
  TRANSACTIONS_KEY,
  WATCHLIST_KEY,
  LANGUAGE_KEY,
  COMPARE_SYMBOLS_KEY,
  COMPARE_METRICS_KEY,
  HIDE_AMOUNTS_KEY,
  THEME_KEY,
  EVENT_PREFERENCES_KEY,
] as const;
const DEFAULTS: Record<(typeof BACKUP_KEYS)[number], string> = {
  [TRANSACTIONS_KEY]: '{"transactions":[],"quotes":{}}',
  [WATCHLIST_KEY]: JSON.stringify(defaultWatchlists),
  [LANGUAGE_KEY]: 'sk',
  [COMPARE_SYMBOLS_KEY]: '[]',
  [COMPARE_METRICS_KEY]: '{"version":6,"keys":[]}',
  [HIDE_AMOUNTS_KEY]: 'false',
  [THEME_KEY]: 'dark',
  [EVENT_PREFERENCES_KEY]: '{"earnings":true,"dividends":false,"news":false}',
};
const FORMAT = 'fincake-local-backup';
const AAD = utf8ToBytes('fincake-local-backup-v1');
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_FILE_LENGTH = 16 * 1024 * 1024;

export type LocalBackup = { version: 1; values: Record<string, string> };
export type EncryptedBackup = {
  format: typeof FORMAT;
  version: 1;
  nonce: string;
  ciphertext: string;
};

function encode(bytes: Uint8Array) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const second = index + 1 < bytes.length;
    const third = index + 2 < bytes.length;
    const value = (bytes[index] << 16) | ((second ? bytes[index + 1] : 0) << 8) | (third ? bytes[index + 2] : 0);
    result += BASE64URL[(value >>> 18) & 63] + BASE64URL[(value >>> 12) & 63];
    if (second) result += BASE64URL[(value >>> 6) & 63];
    if (third) result += BASE64URL[value & 63];
  }
  return result;
}

function decode(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid recovery code or backup file.');
  }
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value) {
    buffer = (buffer << 6) | BASE64URL.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  const decoded = Uint8Array.from(bytes);
  if (buffer !== 0 || encode(decoded) !== value) throw new Error('Invalid recovery code or backup file.');
  return decoded;
}

export function parseLocalBackup(input: unknown): LocalBackup {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1
    || !('values' in input) || !input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    throw new Error('Unsupported or invalid backup data.');
  }
  const values: Record<string, string> = { ...DEFAULTS };
  for (const [key, value] of Object.entries(input.values)) {
    if (!BACKUP_KEYS.some((allowed) => allowed === key) || typeof value !== 'string') {
      throw new Error('Invalid backup field.');
    }
    if (key === LANGUAGE_KEY) {
      if (value !== 'sk' && value !== 'en') throw new Error('Invalid backup language.');
    } else if (key === THEME_KEY) {
      if (value !== 'dark' && value !== 'light') throw new Error('Invalid backup theme.');
    } else if (key === HIDE_AMOUNTS_KEY) {
      if (value !== 'true' && value !== 'false') throw new Error('Invalid backup visibility setting.');
    } else {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || (key !== COMPARE_SYMBOLS_KEY && Array.isArray(parsed))) {
        throw new Error('Invalid backup data.');
      }
      const parsedObject = parsed as Record<string, unknown>;
      if (key === TRANSACTIONS_KEY) {
        if (!('transactions' in parsedObject) || !Array.isArray(parsedObject.transactions)
          || !parsedObject.transactions.every(isTransaction)) throw new Error('Invalid transaction backup.');
        validateLedger(parsedObject.transactions);
      } else if (key === WATCHLIST_KEY) {
        parseWatchlists(value);
      } else if (key === COMPARE_SYMBOLS_KEY) {
        if (!Array.isArray(parsed) || !parsed.every((symbol) => typeof symbol === 'string' && isValidSymbol(symbol))) {
          throw new Error('Invalid comparison symbols.');
        }
      } else if (key === COMPARE_METRICS_KEY) {
        if (!('version' in parsedObject) || typeof parsedObject.version !== 'number'
          || !('keys' in parsedObject) || !Array.isArray(parsedObject.keys)
          || !parsedObject.keys.every((metric) => typeof metric === 'string')) {
          throw new Error('Invalid comparison settings.');
        }
      } else if (key === EVENT_PREFERENCES_KEY) {
        parseEventSymbols(parsedObject.symbols);
        for (const preference of ['earnings', 'dividends', 'news']) {
          if (preference in parsedObject && typeof parsedObject[preference] !== 'boolean') {
            throw new Error('Invalid event preferences.');
          }
        }
      }
    }
    values[key] = value;
  }
  const storedTransactions: unknown = JSON.parse(values[TRANSACTIONS_KEY]);
  if (!storedTransactions || typeof storedTransactions !== 'object' || !('transactions' in storedTransactions)
    || !Array.isArray(storedTransactions.transactions) || !storedTransactions.transactions.every(isTransaction)) {
    throw new Error('Invalid transaction backup.');
  }
  values[TRANSACTIONS_KEY] = JSON.stringify({ transactions: storedTransactions.transactions, quotes: {} });
  return { version: 1, values };
}

export async function createEncryptedBackup() {
  const values: Record<string, string> = {};
  for (const key of BACKUP_KEYS) values[key] = await appStorage.getItem(key) ?? DEFAULTS[key];
  const backup = parseLocalBackup({ version: 1, values });
  const key = await getRandomBytesAsync(32);
  const nonce = await getRandomBytesAsync(12);
  const ciphertext = gcm(key, nonce, AAD).encrypt(utf8ToBytes(JSON.stringify(backup)));
  const content = JSON.stringify({
    format: FORMAT,
    version: 1,
    nonce: encode(nonce),
    ciphertext: encode(ciphertext),
  } satisfies EncryptedBackup);
  if (content.length > MAX_FILE_LENGTH) throw new Error('Backup file is too large.');
  return {
    content,
    recoveryCode: encode(key),
  };
}

export async function decryptBackup(input: string, recoveryCode: string): Promise<LocalBackup> {
  if (input.length > MAX_FILE_LENGTH) throw new Error('Backup file is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(input); }
  catch { throw new Error('Invalid backup file.'); }
  if (!parsed || typeof parsed !== 'object' || !('format' in parsed) || parsed.format !== FORMAT
    || !('version' in parsed) || parsed.version !== 1 || !('nonce' in parsed)
    || typeof parsed.nonce !== 'string' || !('ciphertext' in parsed)
    || typeof parsed.ciphertext !== 'string') {
    throw new Error('Unsupported or invalid backup file.');
  }
  const normalizedCode = recoveryCode.trim();
  if (normalizedCode.length !== 43) throw new Error('Invalid recovery code or backup file.');
  const key = decode(normalizedCode);
  const nonce = decode(parsed.nonce);
  const ciphertext = decode(parsed.ciphertext);
  if (key.length !== 32 || nonce.length !== 12 || ciphertext.length < 16) {
    throw new Error('Invalid recovery code or backup file.');
  }
  let plaintext: Uint8Array;
  try { plaintext = gcm(key, nonce, AAD).decrypt(ciphertext); }
  catch { throw new Error('Recovery code is incorrect or the backup file is damaged.'); }
  let backup: unknown;
  try { backup = JSON.parse(bytesToUtf8(plaintext)); }
  catch { throw new Error('Backup contents are invalid.'); }
  return parseLocalBackup(backup);
}

export function getBackupTransactions(backup: LocalBackup): Transaction[] {
  const parsed: unknown = JSON.parse(parseLocalBackup(backup).values[TRANSACTIONS_KEY]);
  if (!parsed || typeof parsed !== 'object' || !('transactions' in parsed)
    || !Array.isArray(parsed.transactions) || !parsed.transactions.every(isTransaction)) {
    throw new Error('Invalid transaction backup.');
  }
  return parsed.transactions;
}

export async function restoreLocalBackup(backup: LocalBackup) {
  const parsed = parseLocalBackup(backup);
  await setItems(BACKUP_KEYS.map((key) => [key, parsed.values[key]]));
}
