import { useThemedStyles } from '../data/theme';
import { Link } from 'expo-router';
import { ArrowLeft, Briefcase, ChevronRight, Layers3, Sparkles } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale } from '../context/locale';

const values = [
  {
    title: 'Dizajn na prvom mieste',
    text: 'Všetko robím s dôrazom na čitateľnosť, priestor a pohyb.',
    icon: Sparkles,
  },
  {
    title: 'Technická presnosť',
    text: 'Kód je jednoduchý, udržiavateľný a pripravovaný na škálovanie.',
    icon: Layers3,
  },
  {
    title: 'Výsledok',
    text: 'Mojou prioritou je to, aby aplikácia bola nielen krásna, ale aj užitočná.',
    icon: Briefcase,
  },
];

export default function AboutScreen() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLocale();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Link href="/" asChild>
          <Pressable style={styles.backButton}>
            <ArrowLeft size={18} color="#dbeafe" />
            <Text style={styles.backText}>{t('Späť')}</Text>
          </Pressable>
        </Link>

        <Text style={styles.eyebrow}>{t('O mne')}</Text>
        <Text style={styles.title}>{t('Vytváram riešenia, ktoré majú zmysel.')}</Text>
        <Text style={styles.description}>
          {t('Pomáham startupom, tímom a firmám budovať mobilné produkty, ktoré spájajú ľudský dizajn s technickým výkonom. Moje projekty sú zamerané na rýchly vývoj, kvalitu UX a jasné obchodné ciele.')}
        </Text>

        <View style={styles.cardList}>
          {values.map(({ title, text, icon: Icon }) => (
            <View key={title} style={styles.card}>
              <View style={styles.iconWrap}>
                <Icon size={18} color="#dbeafe" />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t(title)}</Text>
                <Text style={styles.cardText}>{t(text)}</Text>
              </View>
            </View>
          ))}
        </View>

        <Link href="/projects" asChild>
          <Pressable style={styles.linkRow}>
            <Text style={styles.linkText}>{t('Pozrieť projekty')}</Text>
            <ChevronRight size={18} color="#dbeafe" />
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = () => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1021',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 20,
  },
  backText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  eyebrow: {
    color: '#93c5fd',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    marginBottom: 14,
  },
  description: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 24,
  },
  cardList: {
    marginBottom: 0,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 18,
    flexDirection: 'row',
    marginBottom: 14,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  cardText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 20,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#172033',
    borderWidth: 1,
    borderColor: '#23314d',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  linkText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginRight: 8,
  },
});
