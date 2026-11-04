import { useAppStorage } from '../data/app-storage';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { DividendOverview } from '../components/dividend-overview';
import { Header, Page } from '../components/finapp';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { usePositions } from '../hooks/use-positions';

export default function DividendsScreen() {
  const AsyncStorage = useAppStorage();
  const router = useRouter();
  const { t, language } = useLocale();
  const { positions, transactions } = usePositions();
  const [hideAmounts, setHideAmounts] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    AsyncStorage.getItem('@portfolio-mobile/hide-amounts').then((value) => {
      if (active) setHideAmounts(value === 'true');
    }).catch((error: unknown) => {
      if (active) Alert.alert(t('Chyba'), error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [t]));

  return (
    <Page>
      <Header title={t('Dividendy')} action={
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'sk' ? 'Späť' : 'Back'}
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/')} style={styles.back}>
          <ArrowLeft size={18} color={colors.text} />
        </Pressable>
      } />
      <DividendOverview positions={positions.filter((position) => position.shares > 1e-8)}
        transactions={transactions} hideAmounts={hideAmounts} />
    </Page>
  );
}

const styles = StyleSheet.create({
  back: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.surface },
});
