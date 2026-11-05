import { useThemedStyles } from '../data/theme';
import '../data/theme-init';
import { Tabs, usePathname } from 'expo-router';
import { createRef, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon, LucideProps } from 'lucide-react-native';
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
import { useEventPrefs } from '../data/event-prefs';
import { resolveEventSymbols } from '../data/event-symbols';
import { useWatchlists } from '../hooks/use-watchlists';
import { colors } from '../data/portfolio';
import { FLOATING_NAVIGATION_GAP, GlassBackground, GlassTargetContext } from '../components/glass-background';
import { useLocale, LocaleProvider } from '../context/locale';
import { AmountVisibilityProvider } from '../context/amount-visibility';

const NAVIGATION_ROUTES = ['/', '/events', '/watchlist', '/compare', '/forecast'];

export default function RootLayout() {
  return (
    <LocaleProvider>
      <AmountVisibilityProvider>
        <PositionsProvider>
          <EventDataPreloader />
          <AppTabs />
        </PositionsProvider>
      </AmountVisibilityProvider>
    </LocaleProvider>
  );
}

function EventDataPreloader() {
  const { positions, loading } = usePositions();
  const prefs = useEventPrefs();
  const watchlists = useWatchlists();
  const symbols = useMemo(
    () => resolveEventSymbols(
      positions.filter((position) => position.shares > 1e-8).map((position) => position.symbol),
      watchlists.lists.flatMap((list) => list.symbols),
      prefs.symbols,
    ),
    [positions, watchlists.lists, prefs.symbols],
  );
  const symbolKey = symbols.join(',');

  useEffect(() => {
    if (!loading && symbols.length) void preloadCompanyEvents(symbols);
  }, [loading, symbolKey]);

  return null;
}

function TabIcon({ icon: Icon, color, focused }: { icon: LucideIcon; color: LucideProps['color']; focused: boolean }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.tabIcon}>
      <Icon color={color} size={23} strokeWidth={focused ? 2.4 : 1.8} />
    </View>
  );
}

function AppTabs() {
  const styles = useThemedStyles(createStyles);
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const barWidth = Math.min(width - 64, 304);
  const pathname = usePathname();
  const activeIndex = NAVIGATION_ROUTES.indexOf(pathname);
  const slotWidth = (barWidth - 12) / NAVIGATION_ROUTES.length;
  const highlightPosition = useRef(new Animated.Value(Math.max(0, activeIndex) * slotWidth)).current;
  const highlightScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (activeIndex < 0) return undefined;
    const animation = Animated.parallel([
      Animated.timing(highlightPosition, {
        toValue: activeIndex * slotWidth,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(highlightScale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
        Animated.timing(highlightScale, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [activeIndex, slotWidth, highlightPosition, highlightScale]);
  const blurTargets = useRef(new Map<string, ReturnType<typeof createRef<ComponentRef<typeof View>>>>());
  const targetFor = (key: string) => {
    let target = blurTargets.current.get(key);
    if (!target) {
      target = createRef<ComponentRef<typeof View>>();
      blurTargets.current.set(key, target);
    }
    return target;
  };
  return (
    <View style={styles.navigation}>
      <Tabs
        backBehavior="history"
        screenListeners={({ route }) => ({
          tabPress: () => {
            const target = route.name === 'index' ? '/' : `/${route.name}`;
            if (pathname === target) return;
            const feedback = Platform.OS === 'android'
              ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
              : Platform.OS === 'ios'
                ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                : Promise.resolve();
            void feedback.catch((error: unknown) => console.warn('Navigation haptics failed:', error));
          },
        })}
        screenLayout={({ route, children }) => (
          <GlassTargetContext.Provider value={targetFor(route.name)}>
            {children}
          </GlassTargetContext.Provider>
        )}
        screenOptions={({ route }) => ({
          headerShown: false,
          animation: 'fade',
          transitionSpec: { animation: 'timing', config: { duration: 180 } },
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.muted,
          tabBarShowLabel: false,
          tabBarBackground: () => (
            <GlassTargetContext.Provider value={targetFor(route.name)}>
              <GlassBackground />
              {activeIndex >= 0 ? (
                <Animated.View pointerEvents="none" style={[styles.tabHighlight, {
                  left: 6 + (slotWidth - 44) / 2,
                  transform: [{ translateX: highlightPosition }, { scale: highlightScale }],
                }]} />
              ) : null}
            </GlassTargetContext.Provider>
          ),
          tabBarStyle: {
            position: 'absolute',
            start: (width - barWidth) / 2,
            end: (width - barWidth) / 2,
            bottom: insets.bottom + FLOATING_NAVIGATION_GAP,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            borderRadius: 30,
            paddingHorizontal: 6,
            paddingTop: 8,
            paddingBottom: 8,
            height: 60,
            elevation: 0,
          },
          tabBarItemStyle: { borderRadius: 18, height: 44, padding: 0, alignItems: 'center', justifyContent: 'center' },
          tabBarIconStyle: { position: 'absolute', top: 0, width: 44, height: 44, margin: 0 },
        })}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('Portfólio'),
            tabBarAccessibilityLabel: t('Portfólio'),
            tabBarIcon: ({ color, focused }) => <TabIcon icon={House} color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: t('Udalosti'),
            tabBarAccessibilityLabel: t('Udalosti'),
            tabBarIcon: ({ color, focused }) => <TabIcon icon={CalendarDays} color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="watchlist"
          options={{
            title: t('Sledované'),
            tabBarAccessibilityLabel: t('Sledované'),
            tabBarIcon: ({ color, focused }) => <TabIcon icon={Bookmark} color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="analytics"
          options={{
            title: t('Analytika'),
            tabBarItemStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen name="dividends" options={{
          title: t('Dividendy'),
          tabBarItemStyle: { display: 'none' },
        }} />
        <Tabs.Screen
          name="compare"
          options={{
            title: t('Analýza'),
            tabBarAccessibilityLabel: t('Analýza'),
            tabBarIcon: ({ color, focused }) => <TabIcon icon={Scale} color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="forecast"
          options={{
            title: t('Výhľad'),
            tabBarAccessibilityLabel: t('Výhľad'),
            tabBarIcon: ({ color, focused }) => <TabIcon icon={Sparkles} color={color} focused={focused} />,
          }}
        />
        <Tabs.Screen name="about" options={{ href: null }} />
        <Tabs.Screen name="projects" options={{ href: null }} />
        <Tabs.Screen name="experience" options={{ href: null }} />
        <Tabs.Screen name="contact" options={{ href: null }} />
        <Tabs.Screen name="projections" options={{
          title: t('Projekcie'),
          tabBarItemStyle: { display: 'none' },
        }} />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('Nastavenia'),
            tabBarItemStyle: { display: 'none' },
            headerShown: false,
          }}
        />
        <Tabs.Screen name="legal" options={{
          title: t('Súkromie a podpora'),
          tabBarItemStyle: { display: 'none' },
        }} />
        <Tabs.Screen
          name="position"
          options={{
            title: t('Detail akcie'),
            tabBarItemStyle: { display: 'none' },
            tabBarStyle: { display: 'none' },
          }}
        />
      </Tabs>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  navigation: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabIcon: {
    width: 44,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabHighlight: {
    position: 'absolute',
    top: 10,
    width: 44,
    height: 40,
    borderRadius: 16,
    backgroundColor: `${colors.green}18`,
  },
});
