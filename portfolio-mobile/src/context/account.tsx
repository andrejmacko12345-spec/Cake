import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, Text, View } from 'react-native';
import { authRedirectUrl, supabase } from '../data/supabase';
import { useLinkingURL } from 'expo-linking';
import { parseAuthLink } from '../data/auth-link';
import { clearAccountData, flushAccountWrites, pauseAccountWrites, onStorageChange, readBackup, restoreBackup, setStorageOwner } from '../data/app-storage';
import { parseBackup } from '../data/account-backup';
import { colors } from '../data/portfolio';
import { readStoredTheme, storeTheme } from '../data/theme';
import { appStorage } from '../data/app-storage';

type Account = {
  session: Session | null;
  configured: boolean;
  backupError: string;
  lastBackup: string | null;
  backupNow: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  reloadBackup: () => void;
  recovery: boolean;
  finishRecovery: () => void;
  authError: string;
};
const AccountContext = createContext<Account | null>(null);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(!supabase);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [recovery, setRecovery] = useState(false);
  const [authError, setAuthError] = useState('');
  const [firstBackupChoice, setFirstBackupChoice] = useState<{ userId: string; importGuest: boolean } | null>(null);
  const [needsFirstBackup, setNeedsFirstBackup] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const link = useLinkingURL();
  const consumedLink = useRef<string | null>(null);
  const revision = useRef(0);
  const epoch = useRef(0);
  const lastPayload = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const deletingAccount = useRef(false);
  const signingOut = useRef(false);
  const userId = session?.user.id ?? null;
  const currentUser = useRef(userId);
  currentUser.current = userId;

  useEffect(() => {
    if (!link || link === consumedLink.current || !supabase) return;
    consumedLink.current = link;
    const client = supabase;
    void (async () => {
      try {
        const result = parseAuthLink(link, authRedirectUrl);
        if (!result) return;
        if (deletingAccount.current || signingOut.current) throw new Error('An account operation is in progress. Open the link again after it completes.');
        if (inFlight.current) await inFlight.current;
        if (result.recovery) setRecovery(true);
        const { error } = await client.auth.setSession({
          access_token: result.accessToken, refresh_token: result.refreshToken,
        });
        if (error) { setRecovery(false); throw error; }
        setAuthError('');
      } finally {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    })().catch((error: unknown) => setAuthError(messageOf(error)));
  }, [link]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      if ((next?.user.id ?? null) !== currentUser.current) setReady(false);
      currentUser.current = next?.user.id ?? null;
      setSession(next);
      if (!next) setRecovery(false);
      if (_event !== 'INITIAL_SESSION') setInitialized(true);
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setLoadError(error.message);
      } else {
        setSession(data.session);
        setInitialized(true);
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(messageOf(error));
    });
    const refresh = (state: string) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    if (Platform.OS !== 'web') refresh(AppState.currentState ?? 'active');
    const appState = Platform.OS !== 'web' ? AppState.addEventListener('change', refresh) : null;
    return () => { active = false; subscription.unsubscribe(); appState?.remove(); client.auth.stopAutoRefresh(); };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const generation = ++epoch.current;
    let active = true;
    setReady(false);
    setBackupError('');
    setLastBackup(null);
    setNeedsFirstBackup(false);
    void (async () => {
      // Wait for an already-started write before changing local storage ownership.
      if (inFlight.current) await inFlight.current.catch(() => undefined);
      if (!userId) {
        setStorageOwner(null);
        const theme = await appStorage.getItem('@portfolio-mobile/theme');
        if (!theme) await appStorage.setItem('@portfolio-mobile/theme', readStoredTheme());
        else storeTheme(theme === 'light' ? 'light' : 'dark', false);
      }
      if (userId && supabase) {
        const { data, error } = await supabase.from('account_backups')
          .select('payload,revision,updated_at').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        if (!active || generation !== epoch.current) return;
        if (!data && firstBackupChoice?.userId !== userId) {
          setNeedsFirstBackup(true);
          return;
        }
        const backup = data ? parseBackup(data.payload)
          : firstBackupChoice?.importGuest ? await readBackup(null) : parseBackup({ version: 1, values: {} });
        if (!data) {
          if (currentUser.current !== userId || !active) return;
          const result = await supabase.rpc('save_account_backup', { p_payload: backup, p_revision: 0, p_user_id: userId });
          if (result.error) throw result.error;
          revision.current = Number(result.data);
          setLastBackup(new Date().toISOString());
        } else {
          revision.current = data.revision;
          setLastBackup(data.updated_at);
        }
        if (!active || generation !== epoch.current) return;
        await restoreBackup(userId, backup);
        lastPayload.current = JSON.stringify(await readBackup(userId));
        if (backup.values['@portfolio-mobile/theme']) {
          storeTheme(backup.values['@portfolio-mobile/theme'] === 'light' ? 'light' : 'dark', false);
        }
      }
      if (!active || generation !== epoch.current) return;
      setStorageOwner(userId);
      setLoadError('');
      setReady(true);
    })().catch((error: unknown) => {
      if (active) { console.warn('Account restore failed:', error); setLoadError(messageOf(error)); }
    });
    return () => { active = false; };
  }, [initialized, userId, reload, firstBackupChoice]);

  const backupNow = useCallback(async () => {
    if (deletingAccount.current) throw new Error('Account deletion is in progress.');
    if (!userId || !supabase || !ready) return;
    while (inFlight.current) {
      await inFlight.current;
      if (currentUser.current !== userId) return;
    }
    if (deletingAccount.current) throw new Error('Account deletion is in progress.');
    const client = supabase;
    const operation = (async () => {
      const backup = await readBackup(userId);
      const { data: auth, error: authFailure } = await client.auth.getSession();
      if (authFailure) throw authFailure;
      if (auth.session?.user.id !== userId || currentUser.current !== userId) {
        throw new Error('Account changed before backup. No data was uploaded.');
      }
      const serialized = JSON.stringify(backup);
      if (serialized === lastPayload.current) return;
      const { data, error } = await client.rpc('save_account_backup', {
        p_payload: backup, p_revision: revision.current, p_user_id: userId,
      });
      if (error) throw error;
      if (currentUser.current !== userId) return;
      revision.current = Number(data);
      lastPayload.current = serialized;
      setLastBackup(new Date().toISOString());
    })();
    inFlight.current = operation;
    try { await operation; setBackupError(''); }
    catch (error) { setBackupError(messageOf(error)); throw error; }
    finally { if (inFlight.current === operation) inFlight.current = null; }
  }, [userId, ready]);

  useEffect(() => {
    if (!ready || !userId) return;
    let timer: ReturnType<typeof setTimeout>;
    const save = () => {
      if (!deletingAccount.current && !signingOut.current) {
        void backupNow().catch((error: unknown) => console.warn('Account backup failed:', error));
      }
    };
    const unsubscribe = onStorageChange(() => { clearTimeout(timer); timer = setTimeout(save, 1500); });
    const interval = setInterval(save, 60000);
    const subscription = AppState.addEventListener('change', save);
    return () => { clearTimeout(timer); clearInterval(interval); unsubscribe(); subscription.remove(); };
  }, [ready, userId, backupNow]);

  const signOut = async () => {
    if (!supabase) return;
    if (signingOut.current) throw new Error('Sign-out is already in progress.');
    signingOut.current = true;
    setTransitioning(true);
    const resume = pauseAccountWrites(userId);
    try {
      await flushAccountWrites(userId);
      await backupNow();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } finally { resume(); signingOut.current = false; setTransitioning(false); }
  };
  const deleteAccount = async (password: string) => {
    if (!supabase || !session?.user.email) throw new Error('Please sign in again.');
    if (deletingAccount.current) throw new Error('Account deletion is already in progress.');
    deletingAccount.current = true;
    setTransitioning(true);
    const resume = pauseAccountWrites(userId);
    try {
      // Do not race deletion against an RPC that could recreate the backup.
      if (inFlight.current) {
        try { await inFlight.current; }
        catch (error) { console.warn('Outstanding backup failed before account deletion:', error); }
      }
      const verification = await supabase.auth.signInWithPassword({ email: session.user.email, password });
      if (verification.error) throw verification.error;
      const deletion = await supabase.rpc('delete_own_account', { p_user_id: session.user.id });
      if (deletion.error) throw deletion.error;
      setReady(false);
      let cleanupFailure: unknown;
      try { await clearAccountData(session.user.id); }
      catch (error) { cleanupFailure = error; }
      const logout = await supabase.auth.signOut({ scope: 'local' });
      if (logout.error) {
        setLoadError(logout.error.message);
        throw logout.error;
      }
      if (cleanupFailure) {
        console.warn('Deleted account cache cleanup failed:', cleanupFailure);
        Alert.alert('Fincake', 'Account deleted, but local cache cleanup failed. Clear app data in device settings.');
      }
    } finally { resume(); deletingAccount.current = false; setTransitioning(false); }
  };
  const reloadBackup = () => {
    setLoadError('');
    if (!initialized && supabase) {
      void supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        setSession(data.session); setInitialized(true);
      }).catch((error: unknown) => setLoadError(messageOf(error)));
    } else setReload((value) => value + 1);
  };
  return (
    <AccountContext.Provider value={{
      session, configured: !!supabase, backupError, lastBackup, backupNow, signOut, deleteAccount, reloadBackup,
      recovery, finishRecovery: () => setRecovery(false), authError,
    }}>
      {!initialized || !ready ? (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 28, gap: 18 }}>
          {needsFirstBackup && userId ? <>
            <Text style={{ color: colors.text, fontSize: 20 }}>First account backup / Prvá záloha účtu</Text>
            <Text style={{ color: colors.muted }}>This account has no backup. Choose whether to upload this device's guest portfolio. / Účet nemá zálohu. Chceš preniesť lokálne portfólio?</Text>
            <Pressable accessibilityRole="button" onPress={() => setFirstBackupChoice({ userId, importGuest: false })}>
              <Text style={{ color: colors.green, padding: 14 }}>Start empty / Začať s prázdnym účtom</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setFirstBackupChoice({ userId, importGuest: true })}>
              <Text style={{ color: colors.text, padding: 14 }}>Import guest data / Preniesť lokálne dáta</Text>
            </Pressable>
          </> : loadError ? <>
            <Text style={{ color: colors.red }}>{loadError}</Text>
            <Pressable onPress={reloadBackup}><Text style={{ color: colors.green }}>Skúsiť znova / Retry</Text></Pressable>
            <Pressable onPress={() => {
              if (!supabase) return;
              void supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
                if (error) setLoadError(error.message);
                else { setSession(null); setInitialized(true); }
              }).catch((error: unknown) => setLoadError(messageOf(error)));
            }}><Text style={{ color: colors.text }}>Pokračovať bez účtu / Continue without account</Text></Pressable>
          </> : <><ActivityIndicator color={colors.green} /><Text style={{ color: colors.muted }}>Načítavam účet / Loading account…</Text></>}
        </View>
      ) : <View key={`${userId ?? 'guest'}:${reload}`} style={{ flex: 1 }}>
        {backupError ? <Text accessibilityRole="alert" style={{ color: colors.red, backgroundColor: colors.surface, padding: 14, paddingTop: 40 }}>
          Záloha zlyhala. Otvor Profil. / Backup failed. Open Profile.
        </Text> : null}
        {children}
        {transitioning ? <View accessibilityViewIsModal style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
          backgroundColor: colors.background, justifyContent: 'center',
        }}><ActivityIndicator color={colors.green} /></View> : null}
      </View>}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useAccount requires AccountProvider.');
  return account;
}
