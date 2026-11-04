import { useThemedStyles } from '../data/theme';
import { Pressable, StyleSheet } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { DividendOverview } from '../components/dividend-overview';
import { Header, Page } from '../components/finapp';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { usePositions } from '../hooks/use-positions';
import { useAmountVisibility } from '../context/amount-visibility';

export default function DividendsScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { t, language } = useLocale();
  const { positions, transactions } = usePositions();
  const { hideAmounts } = useAmountVisibility();

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

const createStyles = () => StyleSheet.create({
  back: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.surface },
});
