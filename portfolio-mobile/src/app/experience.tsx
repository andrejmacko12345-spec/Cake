import { Link } from 'expo-router';
import { ArrowLeft, Briefcase, Clock3, Rocket } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const timeline = [
  {
    period: '2022 – teraz',
    title: 'Senior mobile developer',
    description: 'Vedenie mobilných projektov od konceptu po produkčné nasadenie, spolupráca s designérmi a product teamami.',
  },
  {
    period: '2020 – 2022',
    title: 'Frontend specialist',
    description: 'Budovanie používateľských rozhraní, komponentových systémov a vývoj produktových workflowov pre náročné aplikácie.',
  },
  {
    period: '2018 – 2020',
    title: 'UI/UX developer',
    description: 'Práca na dizajne, prototypoch a interaktívnych konceptoch so zameraním na výnimočný používateľský zážitok.',
  },
];

const highlights = [
  { icon: Rocket, label: 'Launches', value: '18+' },
  { icon: Briefcase, label: 'Produktov', value: '24' },
  { icon: Clock3, label: 'Rýchlosť', value: '2x' },
];

export default function ExperienceScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Link href="/" asChild>
          <Pressable style={styles.backButton}>
            <ArrowLeft size={18} color="#dbeafe" />
            <Text style={styles.backText}>Späť</Text>
          </Pressable>
        </Link>

        <Text style={styles.eyebrow}>Skúsenosti</Text>
        <Text style={styles.title}>Rozvoj produktov, ktorý mení používateľský zážitok.</Text>

        <View style={styles.highlightsRow}>
          {highlights.map(({ icon: Icon, label, value }) => (
            <View key={label} style={styles.highlightCard}>
              <Icon size={18} color="#dbeafe" />
              <Text style={styles.highlightLabel}>{label}</Text>
              <Text style={styles.highlightValue}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.timeline}>
          {timeline.map((item) => (
            <View key={item.title} style={styles.timelineItem}>
              <View style={styles.dot} />
              <View style={styles.content}>
                <Text style={styles.period}>{item.period}</Text>
                <Text style={styles.role}>{item.title}</Text>
                <Text style={styles.description}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 22,
  },
  highlightsRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  highlightCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginRight: 10,
    alignItems: 'center',
  },
  highlightLabel: {
    color: '#94a3b8',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 4,
    fontWeight: '700',
  },
  highlightValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  timeline: {
    marginTop: 6,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#93c5fd',
    marginTop: 8,
    marginRight: 14,
  },
  content: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
  },
  period: {
    color: '#93c5fd',
    fontSize: 12,
    letterSpacing: 0.8,
    fontWeight: '700',
    marginBottom: 6,
  },
  role: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  description: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 20,
  },
});
