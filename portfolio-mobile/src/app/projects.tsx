import { useThemedStyles } from '../data/theme';
import { Link } from 'expo-router';
import { ArrowLeft, ExternalLink, FolderKanban } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale } from '../context/locale';

const projects = [
  {
    name: 'FinFlow',
    summary: 'Mobilný finančný dashboard s prehľadom výdavkov, rozpočtov a notifikácií.',
    stack: ['React Native', 'Expo', 'Supabase'],
    color: '#8b5cf6',
  },
  {
    name: 'North Studio',
    summary: 'Rezervačný a CRM systém pre salóny a servisné tímy so zdieľaným plánovaním.',
    stack: ['Expo', 'TypeScript', 'Node'],
    color: '#14b8a6',
  },
  {
    name: 'LaunchPad',
    summary: 'Projekty pre marketingové kampane so sledovaním leadov a výkonu v reálnom čase.',
    stack: ['React Native', 'API', 'Analytics'],
    color: '#f59e0b',
  },
];

export default function ProjectsScreen() {
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

        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>{t('Projekty')}</Text>
          <FolderKanban size={18} color="#93c5fd" />
        </View>

        <Text style={styles.title}>{t('Realizované riešenia pre skutočné potreby.')}</Text>

        {projects.map((project) => (
          <View key={project.name} style={styles.card}>
            <View style={[styles.accent, { backgroundColor: project.color }]} />
            <View style={styles.cardBody}>
              <Text style={styles.projectName}>{project.name}</Text>
              <Text style={styles.summary}>{t(project.summary)}</Text>
              <View style={styles.stackRow}>
                {project.stack.map((item) => (
                  <View key={item} style={styles.stackPill}>
                    <Text style={styles.stackText}>{t(item)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.footerRow}>
                <Text style={styles.meta}>{t('Mobilný produkt')}</Text>
                <ExternalLink size={16} color="#bfdbfe" />
              </View>
            </View>
          </View>
        ))}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  eyebrow: {
    color: '#93c5fd',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
    marginBottom: 16,
  },
  accent: {
    width: 8,
    borderRadius: 12,
    marginRight: 14,
  },
  cardBody: {
    flex: 1,
  },
  projectName: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  summary: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  stackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  stackPill: {
    backgroundColor: '#172033',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#23314d',
    marginRight: 8,
    marginBottom: 8,
  },
  stackText: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
