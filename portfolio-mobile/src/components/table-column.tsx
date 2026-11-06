import { useThemedStyles } from '../data/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../data/portfolio';

export type TableColumnTone = 'neutral' | 'green' | 'cyan' | 'blue' | 'violet' | 'amber' | 'slate';

type Props = {
  children: ReactNode;
  tone?: TableColumnTone;
  header?: boolean;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const tableToneBackgrounds: Record<TableColumnTone, string> = {
  neutral: 'transparent',
  green: 'rgba(35,100,60,0.32)',
  cyan: 'rgba(90,143,170,0.22)',
  blue: 'rgba(103,170,90,0.22)',
  violet: 'rgba(157,90,170,0.22)',
  amber: 'rgba(135,85,25,0.32)',
  slate: 'rgba(170,117,90,0.22)',
};

export const tableToneAccents = {
  cyan: 'rgb(90,143,170)',
  blue: 'rgb(103,170,90)',
  violet: 'rgb(157,90,170)',
  slate: 'rgb(170,117,90)',
};

export function TableColumn({ children, tone = 'neutral', header = false, first = false, style }: Props) {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={[
        styles.column,
        { backgroundColor: tone === 'neutral' && header ? colors.surfaceRaised : tableToneBackgrounds[tone] },
        first && styles.firstColumn,
        header && { borderLeftWidth: first ? 0 : 2 },
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
    borderLeftColor: colors.border,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  firstColumn: { borderLeftWidth: 0 },
});
