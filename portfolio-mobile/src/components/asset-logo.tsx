import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../data/portfolio';

type Props = {
  symbol: string;
  color: string;
  size?: number;
};

export function AssetLogo({ symbol, color, size = 38 }: Props) {
  const [failedSymbol, setFailedSymbol] = useState<string>();
  const imageFailed = failedSymbol === symbol;

  return (
    <View
      accessibilityLabel={`${symbol} logo`}
      accessible
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          backgroundColor: imageFailed ? color : 'transparent',
        },
      ]}
    >
      {imageFailed ? (
        <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.4) }]}>
          {symbol.slice(0, 1)}
        </Text>
      ) : (
        <Image
          onError={() => setFailedSymbol(symbol)}
          resizeMode="cover"
          source={{ uri: `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png` }}
          style={{ width: size, height: size }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
