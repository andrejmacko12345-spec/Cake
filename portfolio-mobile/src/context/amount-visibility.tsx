import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { onBulkStorageChange, useAppStorage } from '../data/app-storage';
import { useLocale } from './locale';

const STORAGE_KEY = '@portfolio-mobile/hide-amounts';
type AmountVisibility = {
  hideAmounts: boolean;
  updating: boolean;
  toggleHideAmounts: () => Promise<void>;
};
const AmountVisibilityContext = createContext<AmountVisibility | null>(null);

export function AmountVisibilityProvider({ children }: { children: ReactNode }) {
  const storage = useAppStorage();
  const { t, errorText } = useLocale();
  const [hideAmounts, setHideAmounts] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const messages = useRef({ t, errorText });
  useEffect(() => { messages.current = { t, errorText }; }, [t, errorText]);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      void storage.getItem(STORAGE_KEY).then((value) => {
        if (value !== null && value !== 'true' && value !== 'false') throw new Error('Invalid amount visibility setting.');
        if (active && current === request) setHideAmounts(value === 'true');
      }).catch((error: unknown) => {
        console.warn('Could not load amount visibility:', error);
        if (active && current === request) Alert.alert(messages.current.t('Nastavenie súkromia sa nepodarilo načítať.'), messages.current.errorText(error instanceof Error ? error.message : String(error)));
      }).finally(() => { if (active && current === request) setReady(true); });
    };
    const unsubscribe = onBulkStorageChange(load);
    load();
    return () => { active = false; unsubscribe(); };
  }, [storage]);

  const toggleHideAmounts = useCallback(async () => {
    if (!ready || pending.current) return;
    pending.current = true;
    const next = !hideAmounts;
    setHideAmounts(next);
    setSaving(true);
    try {
      await storage.setItem(STORAGE_KEY, String(next));
    } catch (error) {
      setHideAmounts(true);
      console.warn('Could not save amount visibility:', error);
      Alert.alert(t('Nastavenie súkromia sa nepodarilo uložiť.'), errorText(error instanceof Error ? error.message : String(error)));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }, [hideAmounts, ready, storage, t, errorText]);

  return <AmountVisibilityContext.Provider value={{ hideAmounts, updating: !ready || saving, toggleHideAmounts }}>
    {children}
  </AmountVisibilityContext.Provider>;
}

export function useAmountVisibility() {
  const value = useContext(AmountVisibilityContext);
  if (!value) throw new Error('useAmountVisibility requires AmountVisibilityProvider.');
  return value;
}
