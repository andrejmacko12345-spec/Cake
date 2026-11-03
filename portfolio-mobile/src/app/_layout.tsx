import '../data/theme-init';
import { Tabs } from 'expo-router';
import {
  Bookmark,
  CalendarDays,
  ChartNoAxesCombined,
  House,
  Scale,
  Sparkles,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PositionsProvider } from '../hooks/use-positions';
import { colors } from '../data/portfolio';
import { useLocale, LocaleProvider } from '../context/locale';

export default function RootLayout() {
  return (
    <PositionsProvider>
      <LocaleProvider>
        <AppTabs />
      </LocaleProvider>
    </PositionsProvider>
  );
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
            paddingTop: 7,
            paddingBottom: insets.bottom + 14,
            height: 56 + insets.bottom + 14,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('Portfólio'),
            tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: t('Udalosti'),
            tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="watchlist"
          options={{
            title: 'Watchlist',
            tabBarIcon: ({ color, size }) => <Bookmark color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: t('Analytika'),
            tabBarIcon: ({ color, size }) => <ChartNoAxesCombined color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="compare"
          options={{
            title: t('Porovnanie'),
            tabBarIcon: ({ color, size }) => <Scale color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="forecast"
          options={{
            title: t('Výhľad'),
            tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
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
