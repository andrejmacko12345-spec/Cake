import { useThemedStyles } from '../data/theme';
import { useState } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useLocale } from '../context/locale';
import { colors } from '../data/portfolio';
import { AssetCategory, assetCategories } from '../data/asset-discovery';
import { useAssetSearch } from '../hooks/use-asset-search';
import { usePopupAnimation } from '../hooks/use-popup-animation';
import { AssetDiscoveryList } from './asset-discovery-list';

export function StockSearchModal({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (symbol: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory | undefined>();
  const { results, loading, error } = useAssetSearch(query, category ?? 'all');
  const animation = usePopupAnimation(true);
  const close = () => animation.close(onClose);
  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.scrim} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, animation.backdrop]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} />
        <Animated.View style={[styles.sheet, animation.sheet]}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('Hľadať akciu')}</Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('Zavrieť')} style={styles.close}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <Search size={18} color={colors.muted} />
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t('Hľadať akciu')}
              placeholder={t('Názov firmy alebo ticker')}
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              style={styles.input}
            />
            {loading ? <ActivityIndicator size="small" color={colors.green} /> : null}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.results}>
            <AssetDiscoveryList
              category={category}
              categories={assetCategories}
              onCategoryChange={setCategory}
              query={query}
              results={results}
              loading={loading}
              error={error}
              onSelect={(asset) => animation.close(() => onSelect(asset.symbol))}
            />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = () => StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { height: '70%', backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surfaceRaised, minHeight: 46 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  results: { marginTop: 10 },
});
