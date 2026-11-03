import '../data/theme-init';
import { Tabs } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  Bookmark,
  CalendarDays,
  House,
  Scale,
  Sparkles,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PositionsProvider } from '../hooks/use-positions';
import { usePositions } from '../hooks/use-positions';
import { preloadCompanyEvents } from '../data/events-cache';
import { colors } from '../data/portfolio';
import { useLocale, LocaleProvider } from '../context/locale';

export default function RootLayout() {
  return (
    <PositionsProvider>
      <LocaleProvider>
        <EventDataPreloader />
        <AppTabs />
      </LocaleProvider>
    </PositionsProvider>
  );
}

function EventDataPreloader() {
  const { positions, loading } = usePositions();
  const symbols = useMemo(
    () => [...new Set(positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol))],
    [positions],
  );
  const symbolKey = symbols.join(',');

  useEffect(() => {
    if (!loading && symbols.length) void preloadCompanyEvents(symbols);
  }, [loading, symbolKey]);

  return null;
}

function AppTabs() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingTop: 5,
            paddingBottom: insets.bottom + 14,
            height: 52 + insets.bottom + 14,
          },
          tabBarLabelStyle: {
            fontSize: 9,
            fontWeight: '700',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('Portfólio'),
            tabBarIcon: ({ color }) => <House color={color} size={21} />,
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: t('Udalosti'),
            tabBarIcon: ({ color }) => <CalendarDays color={color} size={21} />,
          }}
        />
        <Tabs.Screen
          name="watchlist"
          options={{
            title: 'Watchlist',
            tabBarIcon: ({ color }) => <Bookmark color={color} size={21} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: t('Analytika'),
            tabBarItemStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="compare"
          options={{
            title: t('Porovnanie'),
            tabBarIcon: ({ color }) => <Scale color={color} size={21} />,
          }}
        />
        <Tabs.Screen
          name="forecast"
          options={{
            title: t('Výhľad'),
            tabBarIcon: ({ color }) => <Sparkles color={color} size={21} />,
          }}
        />
        <Tabs.Screen name="about" options={{ href: null }} />
        <Tabs.Screen name="projects" options={{ href: null }} />
        <Tabs.Screen name="experience" options={{ href: null }} />
        <Tabs.Screen name="contact" options={{ href: null }} />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('Nastavenia'),
            tabBarItemStyle: { display: 'none' },
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="position"
          options={{
            title: 'Detail akcie',
            tabBarItemStyle: { display: 'none' },
            tabBarStyle: { display: 'none' },
          }}
        />
      </Tabs>
  );
}
