import { useThemedStyles } from '../data/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../data/portfolio';

export type TableColumnTone = 'neutral' | 'green' | 'cyan' | 'violet' | 'amber';

type Props = {
  children: ReactNode;
  tone?: TableColumnTone;
  header?: boolean;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
};

const toneStyles = {
  neutral: { backgroundColor: 'rgba(255,255,255,0.025)', borderLeftColor: 'rgba(170,180,195,0.16)' },
  green: { backgroundColor: 'rgba(120,216,79,0.045)', borderLeftColor: 'rgba(120,216,79,0.38)' },
  cyan: { backgroundColor: 'rgba(22,196,216,0.045)', borderLeftColor: 'rgba(22,196,216,0.38)' },
  violet: { backgroundColor: 'rgba(100,121,255,0.05)', borderLeftColor: 'rgba(100,121,255,0.4)' },
  amber: { backgroundColor: 'rgba(255,180,90,0.045)', borderLeftColor: 'rgba(255,180,90,0.38)' },
} satisfies Record<TableColumnTone, ViewStyle>;

const headerColors: Record<Exclude<TableColumnTone, 'neutral'>, string> = {
  green: 'rgba(120,216,79,0.12)',
  cyan: 'rgba(22,196,216,0.12)',
  violet: 'rgba(100,121,255,0.13)',
  amber: 'rgba(255,180,90,0.12)',
};

export function TableColumn({ children, tone = 'neutral', header = false, first = false, style }: Props) {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={[
        styles.column,
        toneStyles[tone],
        first && styles.firstColumn,
        header && { backgroundColor: tone === 'neutral' ? colors.surfaceRaised : headerColors[tone], borderLeftWidth: first ? 0 : 2 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  column: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  firstColumn: { borderLeftWidth: 0 },
});
