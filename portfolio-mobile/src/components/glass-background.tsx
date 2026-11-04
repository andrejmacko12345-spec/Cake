import { createContext, useContext } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../data/theme';

export const GlassTargetContext = createContext<RefObject<ComponentRef<typeof View> | null> | undefined>(undefined);
export const FLOATING_NAVIGATION_GAP = 16;

export function GlassBackground({ radius = 30 }: { radius?: number }) {
  const blurTarget = useContext(GlassTargetContext);
  const light = useTheme() === 'light';
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, {
        borderRadius: radius,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: light ? 'rgba(227,194,142,0.75)' : 'rgba(220,235,255,0.38)',
      }]}
    >
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        tint={light ? 'light' : 'dark'}
        intensity={45}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, {
        zIndex: 1,
        backgroundColor: light ? 'rgba(255,240,214,0.94)' : 'rgba(44,61,82,0.88)',
      }]} />
    </View>
  );
}
