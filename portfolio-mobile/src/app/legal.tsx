import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Header, Page, Surface } from '../components/finapp';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { useThemedStyles } from '../data/theme';
import details from '../../store/public-details.json';
import content from '../../store/privacy-content.json';

export default function LegalScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { language, t } = useLocale();
  const copy = content[language];
  const [linkError, setLinkError] = useState(false);
  const fields: Array<[string, string | number | null]> = [
    [copy.operator, details.operatorName], [copy.contact, details.supportEmail],
  ];
  const incomplete = fields.some(([, value]) => !value) || !details.privacyUrl || !details.deletionUrl;
  const open = async (url: string) => {
    setLinkError(false);
    try { await Linking.openURL(url); }
    catch (error) {
      console.warn('Legal link failed:', error);
      setLinkError(true);
    }
  };
  return (
    <Page>
      <Header title={t('Súkromie a podpora')} action={
        <Pressable accessibilityRole="button" accessibilityLabel={t('Späť')}
          onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={18} color={colors.text} />
        </Pressable>
      } />
      {incomplete ? <Text accessibilityRole="alert" style={styles.warning}>{copy.draft}</Text> : null}
      <Surface>
        <Text style={styles.title}>{copy.privacyTitle}</Text>
        {copy.sections.map((section) => <View key={section.title} style={styles.section}>
          <Text style={styles.heading}>{section.title}</Text>
          <Text selectable style={styles.body}>{section.body}</Text>
        </View>)}
      </Surface>
      <Surface>
        <Text style={styles.title}>{copy.deletionTitle}</Text>
        {copy.deletion.map((section) => <View key={section.title} style={styles.section}>
          <Text style={styles.heading}>{section.title}</Text>
          <Text selectable style={styles.body}>{section.body}</Text>
        </View>)}
      </Surface>
      <Surface>
        {fields.map(([label, value]) => <View key={label} style={styles.section}>
          <Text style={styles.heading}>{label}</Text>
          <Text selectable style={styles.body}>{value || copy.missing}</Text>
        </View>)}
        {[
          { label: t('Zásady ochrany súkromia na webe'), url: details.privacyUrl },
          { label: t('Žiadosť o vymazanie údajov na webe'), url: details.deletionUrl },
          { label: t('Kontaktovať podporu'), url: details.supportEmail ? `mailto:${details.supportEmail}` : '' },
        ].filter((link) => link.url).map((link) => (
          <Pressable key={link.label} accessibilityRole="link"
            style={styles.link} onPress={() => { void open(link.url); }}>
            <Text style={styles.linkText}>{link.label}</Text>
          </Pressable>
        ))}
        {linkError ? <Text accessibilityRole="alert" style={styles.warning}>{t('Odkaz sa nepodarilo otvoriť. Skús to znova.')}</Text> : null}
      </Surface>
    </Page>
  );
}

const createStyles = () => StyleSheet.create({
  back: { padding: 10, borderRadius: 12, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  heading: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  section: { marginBottom: 14 },
  warning: { color: colors.red, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  link: { paddingVertical: 12 },
  linkText: { color: colors.green, fontSize: 13, fontWeight: '600' },
});
