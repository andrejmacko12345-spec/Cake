import { useThemedStyles } from '../data/theme';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAccount } from '../context/account';
import { useLocale } from '../context/locale';
import { authRedirectUrl, supabase } from '../data/supabase';
import { colors } from '../data/portfolio';
import { Surface } from './finapp';
import { localizedError } from '../data/translations';

type Mode = 'login' | 'register' | 'confirm' | 'reset';

export function AccountPanel() {
  const styles = useThemedStyles(createStyles);
  const { t, language, errorText } = useLocale();
  const account = useAccount();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (failure) {
      console.warn('Account operation failed:', failure);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    finally { setBusy(false); }
  };
  const switchMode = (next: Mode) => {
    setMode(next); setError(''); setMessage(''); setPassword('');
  };
  const submit = () => run(async () => {
    if (!supabase) throw new Error(t('Prihlasovanie nie je nakonfigurované.'));
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error(t('Zadaj platný e-mail.'));
    if (mode === 'register' && password.length < 8) {
      throw new Error(t('Heslo musí mať aspoň 8 znakov.'));
    }
    if (mode === 'register') {
      const { data, error: failure } = await supabase.auth.signUp({
        email: address, password, options: {
          data: { display_name: name.trim() }, emailRedirectTo: authRedirectUrl,
        },
      });
      if (failure) throw failure;
      if (!data.session) { setMode('confirm'); setPassword(''); setMessage(t('Potvrdzovací odkaz sme poslali na e-mail. Po potvrdení sa môžeš prihlásiť.')); }
    } else if (mode === 'reset') {
      const { error: failure } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: authRedirectUrl });
      if (failure) throw failure;
      setMessage(t('Odkaz na obnovu hesla sme poslali na e-mail. Otvor ho na tomto zariadení.'));
    } else {
      const { error: failure } = await supabase.auth.signInWithPassword({ email: address, password });
      if (failure) throw failure;
    }
  });
  const button = (label: string, action: () => void, danger = false) => (
    <Pressable accessibilityRole="button" disabled={busy} onPress={action}
      style={[styles.button, danger && { backgroundColor: colors.red }, busy && { opacity: 0.5 }]}>
      <Text style={styles.buttonText}>{t(label)}</Text>
    </Pressable>
  );
  const input = (label: string, value: string, change: (value: string) => void, secure = false) => (
    <TextInput accessibilityLabel={t(label)} placeholder={t(label)} placeholderTextColor={colors.muted}
      value={value} onChangeText={change} secureTextEntry={secure} editable={!busy}
      autoCapitalize="none" autoCorrect={false} style={styles.input}
      keyboardType={label === 'E-mail' ? 'email-address' : 'default'}
      autoComplete={secure ? mode === 'register' || account.recovery ? 'new-password' : 'current-password'
        : label === 'E-mail' ? 'email' : 'off'} />
  );
  return (
    <Surface style={styles.card}>
      <Text style={styles.title}>{account.session
        ? account.session.user.user_metadata.display_name || t('Môj účet') : t('Účet a zálohovanie')}</Text>
      {account.authError ? <Text accessibilityRole="alert" style={styles.error}>{localizedError(account.authError, language)}</Text> : null}
      {account.session && account.recovery ? <>
        <Text style={styles.heading}>{t('Uložiť nové heslo')}</Text>
        {input('Heslo', password, setPassword, true)}
        {button('Uložiť nové heslo', () => { void run(async () => {
          if (!supabase) throw new Error(t('Prihlasovanie nie je nakonfigurované.'));
          if (password.length < 8) throw new Error(t('Heslo musí mať aspoň 8 znakov.'));
          const result = await supabase.auth.updateUser({ password });
          if (result.error) throw result.error;
          setPassword(''); account.finishRecovery();
        }); })}
      </> : account.session ? <>
        <Text style={styles.copy}>{account.session.user.email}</Text>
        <Text style={styles.copy}>{t('Posledná záloha')}: {account.lastBackup
          ? new Date(account.lastBackup).toLocaleString(language === 'sk' ? 'sk-SK' : 'en-GB') : '—'}</Text>
        <Text style={styles.copy}>{t('Zálohy obsahujú transakcie, zoznamy sledovaných a nastavenia. Kurzy a finančné cache sa nezálohujú.')}</Text>
        {account.backupError ? <>
          <Text accessibilityRole="alert" style={styles.error}>{localizedError(account.backupError, language)}</Text>
          <Text style={styles.copy}>{t('Obnovenie nahradí lokálne dáta prihláseného účtu dátami zo zálohy.')}</Text>
          {button('Obnoviť dáta z účtu', account.reloadBackup)}
        </> : null}
        {button('Zálohovať teraz', () => { void run(account.backupNow); })}
        {button('Odhlásiť sa', () => { void run(account.signOut); })}
        {!deleting ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setDeleting(true)}>
          <Text style={styles.error}>{t('Vymazať účet')}</Text>
        </Pressable> : <>
          <Text style={styles.error}>{t('Účet a cloudová záloha sa natrvalo vymažú. Zadaj heslo na potvrdenie.')}</Text>
          {input('Heslo', password, setPassword, true)}
          {button('Natrvalo vymazať účet', () => { void run(async () => {
            await account.deleteAccount(password);
          }); }, true)}
          <Pressable accessibilityRole="button" onPress={() => { setDeleting(false); setPassword(''); }}><Text style={styles.copy}>{t('Zrušiť')}</Text></Pressable>
        </>}
      </> : <>
        <Text style={styles.copy}>{t('Bez účtu zostávajú dáta iba v zariadení. Účet bez zálohy ponúkne prenos lokálnych dát alebo prázdny účet. Existujúca záloha sa obnoví automaticky.')}</Text>
        {!account.configured ? <Text style={styles.error}>{t('Prihlasovanie nie je nakonfigurované.')}</Text> : <>
          <Text style={styles.heading}>{t(mode === 'register' ? 'Vytvoriť účet' : mode === 'confirm'
            ? 'Overiť e-mail' : mode === 'reset' ? 'Obnoviť heslo' : 'Prihlásiť sa')}</Text>
          {mode === 'register' ? input('Meno', name, setName) : null}
          {input('E-mail', email, setEmail)}
          {mode === 'confirm' ? <Text style={styles.copy}>{t('Otvor potvrdzovací odkaz v e-maile. Potom sa vráť a prihlás sa.')}</Text> : null}
          {mode === 'login' || mode === 'register' ? input('Heslo', password, setPassword, true) : null}
          {mode === 'register' ? <Text style={styles.copy}>{t('Vytvorením účtu sa tvoje portfólio a nastavenia uložia do Supabase. Účet aj zálohu môžeš vymazať v Profile.')}</Text> : null}
          {mode !== 'confirm' ? button(mode === 'register' ? 'Vytvoriť účet'
            : mode === 'reset' ? 'Poslať odkaz' : 'Prihlásiť sa', () => { void submit(); }) : null}
          <View style={styles.links}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => switchMode(mode === 'login' ? 'register' : 'login')}>
              <Text style={styles.link}>{t(mode === 'login' ? 'Vytvoriť účet' : 'Prihlásiť sa')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => switchMode('reset')}><Text style={styles.link}>{t('Zabudnuté heslo')}</Text></Pressable>
          </View>
          {mode === 'confirm' ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void run(async () => {
            if (!supabase) throw new Error(t('Prihlasovanie nie je nakonfigurované.'));
            const result = await supabase.auth.resend({
              type: 'signup', email: email.trim(), options: { emailRedirectTo: authRedirectUrl },
            });
            if (result.error) throw result.error;
            setMessage(t('Potvrdzovací odkaz sme poslali na e-mail. Po potvrdení sa môžeš prihlásiť.'));
          }); }}><Text style={styles.link}>{t('Poslať odkaz znova')}</Text></Pressable> : null}
        </>}
      </>}
      {busy ? <ActivityIndicator color={colors.green} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{errorText(error)}</Text> : null}
      {message ? <Text style={styles.copy}>{message}</Text> : null}
    </Surface>
  );
}

const createStyles = () => StyleSheet.create({
  card: { padding: 18, marginBottom: 16, gap: 12 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  heading: { color: colors.text, fontSize: 17, fontWeight: '700' },
  copy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: { color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 13, fontSize: 15, minHeight: 48 },
  button: { backgroundColor: colors.green, borderRadius: 12, padding: 13, alignItems: 'center', minHeight: 46 },
  buttonText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  links: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  link: { color: colors.text, fontSize: 13, fontWeight: '700', paddingVertical: 5 },
  error: { color: colors.red, fontSize: 12, lineHeight: 18 },
});
