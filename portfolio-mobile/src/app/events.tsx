import { useState } from 'react';
import { Bell, CalendarDays, Clock3, Newspaper } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DemoNotice, Header, Page, SectionTitle, Surface } from '../components/finapp';
import { colors } from '../data/portfolio';
import { useLocale } from '../context/locale';

type EventCategory = 'Výsledky' | 'Dividendy' | 'Správy';
type EventFilter = 'Všetko' | EventCategory;

const events: {
  day: string;
  month: string;
  time: string;
  symbol: string;
  title: string;
  category: EventCategory;
  note: string;
  color: string;
}[] = [
  {
    day: '05',
    month: 'NOV',
    time: 'po zatvorení trhu',
    symbol: 'META',
    title: 'Výsledky za 3. štvrťrok',
    category: 'Výsledky',
    note: 'Očakávané zverejnenie hospodárskych výsledkov.',
    color: colors.violet,
  },
  {
    day: '08',
    month: 'NOV',
    time: '09:00',
    symbol: 'GOOG',
    title: 'Rozhodujúci deň pre dividendu',
    category: 'Dividendy',
    note: 'Orientačný dátum podľa ukážkového kalendára.',
    color: colors.cyan,
  },
  {
    day: '12',
    month: 'NOV',
    time: 'po zatvorení trhu',
    symbol: 'TSLA',
    title: 'Výsledky za 3. štvrťrok',
    category: 'Výsledky',
    note: 'Očakávané zverejnenie hospodárskych výsledkov.',
    color: colors.red,
  },
  {
    day: '18',
    month: 'NOV',
    time: '10:30',
    symbol: 'NVDA',
    title: 'Novinka v sektore polovodičov',
    category: 'Správy',
    note: 'Pripomienka k sledovanej spoločnosti.',
    color: '#80c342',
  },
];

const filters: EventFilter[] = ['Všetko', 'Výsledky', 'Dividendy', 'Správy'];

export default function EventsScreen() {
  const { t } = useLocale();
  const [filter, setFilter] = useState<EventFilter>('Všetko');
  const visibleEvents = filter === 'Všetko' ? events : events.filter((event) => event.category === filter);

  return (
    <Page>
      <Header title={t('Udalosti')} subtitle={t('Kalendár trhu')} action={<Bell size={20} color={colors.text} />} />
      <DemoNotice label={t('Ukážkový kalendár · termíny si over u emitenta')} />
      <Surface style={styles.monthCard}>
        <View style={styles.monthIcon}>
          <CalendarDays size={20} color={colors.green} />
        </View>
        <View style={styles.monthCopy}>
          <Text style={styles.monthTitle}>{t('November 2026')}</Text>
          <Text style={styles.monthSubtitle}>{t('4 udalosti v tvojom prehľade')}</Text>
        </View>
        <Text style={styles.monthCount}>04</Text>
      </Surface>

      <SectionTitle title={t('Sledované udalosti')} />
      <View style={styles.filterRow}>
        {filters.map((item) => {
          const selected = filter === item;
          return (
            <Pressable
              key={item}
              onPress={() => setFilter(item)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.filterChip, selected && styles.filterChipSelected]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{t(item)}</Text>
            </Pressable>
          );
        })}
      </View>

      {visibleEvents.map((event) => (
        <Surface key={`${event.symbol}-${event.category}`} style={styles.eventCard}>
          <View style={styles.dateBadge}>
            <Text style={styles.dateDay}>{event.day}</Text>
            <Text style={styles.dateMonth}>{event.month}</Text>
          </View>
          <View style={[styles.eventAccent, { backgroundColor: event.color }]} />
          <View style={styles.eventBody}>
            <View style={styles.eventTopline}>
              <Text style={styles.symbol}>{event.symbol}</Text>
              <Text style={styles.category}>{t(event.category)}</Text>
            </View>
            <Text style={styles.eventTitle}>{t(event.title)}</Text>
            <Text style={styles.eventNote}>{t(event.note)}</Text>
            <View style={styles.eventTime}>
              {event.category === 'Správy' ? (
                <Newspaper size={13} color={colors.muted} />
              ) : (
                <Clock3 size={13} color={colors.muted} />
              )}
              <Text style={styles.eventTimeText}>{t(event.time)}</Text>
            </View>
          </View>
        </Surface>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  monthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  monthIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  monthCopy: {
    flex: 1,
  },
  monthTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  monthSubtitle: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  monthCount: {
    color: colors.green,
    fontSize: 22,
    fontWeight: '900',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  filterChipSelected: {
    backgroundColor: colors.green,
  },
  filterText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  filterTextSelected: {
    color: colors.surface,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
  },
  dateBadge: {
    width: 44,
    height: 50,
    borderRadius: 13,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  dateDay: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  dateMonth: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 1,
  },
  eventAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 4,
    marginRight: 11,
  },
  eventBody: {
    flex: 1,
  },
  eventTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  symbol: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  category: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
  },
  eventTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 5,
  },
  eventNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  eventTime: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 9,
  },
  eventTimeText: {
    color: colors.muted,
    fontSize: 10,
    marginLeft: 5,
  },
});
