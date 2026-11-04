import { useThemedStyles } from '../data/theme';
import { Link } from 'expo-router';
import { ArrowLeft, Briefcase, Code2, Mail, MapPin } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale } from '../context/locale';

const contactMethods = [
  { label: 'Email', value: 'hello@andrej.dev', icon: Mail },
  { label: 'GitHub', value: '@andrej-dev', icon: Code2 },
  { label: 'Portfólio projektov', value: 'projektový stack', icon: Briefcase },
  { label: 'Lokalita', value: 'Bratislava, SK', icon: MapPin },
];

export default function ContactScreen() {
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

        <Text style={styles.eyebrow}>{t('Kontakt')}</Text>
        <Text style={styles.title}>{t('Nechajme z projektu niečo výnimočné.')}</Text>
        <Text style={styles.description}>
          {t('Ak potrebuješ partnera na vývoj mobilných produktov, rozšírenie funkcionality alebo redesign produktu, rád pomôžem.')}
        </Text>

        <View style={styles.contactList}>
          {contactMethods.map(({ label, value, icon: Icon }) => (
            <View key={label} style={styles.contactCard}>
              <View style={styles.iconWrap}>
                <Icon size={18} color="#dbeafe" />
              </View>
              <View style={styles.contactBody}>
                <Text style={styles.label}>{t(label)}</Text>
                <Text style={styles.value}>{t(value)}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryButton}>
          <Mail size={18} color="#08111f" />
          <Text style={styles.primaryButtonText}>{t('Napísať mail')}</Text>
        </Pressable>
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
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
    marginBottom: 12,
  },
  description: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 22,
  },
  contactList: {
    marginBottom: 22,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
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
  contactBody: {
    flex: 1,
  },
  label: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 4,
  },
  value: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#93c5fd',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: '#08111f',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 8,
  },
});
