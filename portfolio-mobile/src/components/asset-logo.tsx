import { useThemedStyles } from '../data/theme';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../data/portfolio';

type Props = {
  symbol: string;
  color: string;
  size?: number;
};

export function AssetLogo({ symbol, color, size = 44 }: Props) {
  const styles = useThemedStyles(createStyles);
  const [failedLogo, setFailedLogo] = useState<{ symbol: string; index: number }>({ symbol: '', index: 0 });
  const logoIndex = failedLogo.symbol === symbol ? failedLogo.index : 0;
  const encodedSymbol = encodeURIComponent(symbol);
  const logoSources = [
    `https://financialmodelingprep.com/image-stock/${encodedSymbol}.png`,
    `https://assets.parqet.com/logos/symbol/${encodedSymbol}?format=png`,
  ];
  const imageFailed = logoIndex >= logoSources.length;

  return (
    <View
      accessibilityLabel={`${symbol} logo`}
      accessible
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: imageFailed ? color : colors.surfaceRaised,
        },
      ]}
    >
      {imageFailed ? (
        <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.4) }]}>
          {symbol.slice(0, 1)}
        </Text>
      ) : (
        <Image
          key={`${symbol}-${logoIndex}`}
          onError={() => setFailedLogo({ symbol, index: logoIndex + 1 })}
          resizeMode="contain"
          source={{ uri: logoSources[logoIndex] }}
          style={{ width: size * 0.72, height: size * 0.72 }}
        />
      )}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    overflow: 'hidden',
  },
  fallbackText: {
    color: colors.surface,
    fontWeight: '900',
  },
});
