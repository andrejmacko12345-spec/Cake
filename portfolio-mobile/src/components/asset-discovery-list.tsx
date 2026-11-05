import { useThemedStyles } from '../data/theme';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChartNoAxesCombined, Check, ChevronRight, Plus } from 'lucide-react-native';
import { useLocale } from '../context/locale';
import { Asset, colors } from '../data/portfolio';
import { AssetCategory, assetCategories, getDiscoveryAssets } from '../data/asset-discovery';
import { rememberDiscoveryAsset, useDiscoveryVisits } from '../data/asset-discovery-history';
import { AssetLogo } from './asset-logo';

const previewCount = 3;
const categoryLabels: Record<AssetCategory, string> = { stocks: 'Akcie', etfs: 'ETF', indexes: 'Indexy' };

type Props = {
  category?: AssetCategory;
  categories?: AssetCategory[];
  onCategoryChange: (category: AssetCategory | undefined) => void;
  query: string;
  results: Asset[];
  loading: boolean;
  error?: string;
  selectedSymbols?: string[];
  onSelect: (asset: Asset) => void;
  action?: 'add' | 'select';
};

export function AssetDiscoveryList({
  category, categories = assetCategories, onCategoryChange, query, results, loading, error,
  selectedSymbols = [], onSelect, action = 'select',
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { t, errorText } = useLocale();
  const visits = useDiscoveryVisits();
  const normalizedQuery = query.trim();
  const searching = normalizedQuery.length >= 2;
  const sections: { key: AssetCategory | 'results'; title?: string; assets: Asset[]; more?: boolean }[] = searching
    ? [{ key: category ?? 'results', title: category ? categoryLabels[category] : undefined, assets: results }]
    : category
      ? [{ key: category, title: categoryLabels[category], assets: getDiscoveryAssets(category, visits) }]
      : categories.map((item) => ({
        key: item,
        title: categoryLabels[item],
        assets: getDiscoveryAssets(item, visits).slice(0, previewCount),
        more: true,
      }));

  const renderAsset = (asset: Asset) => {
    const alreadyAdded = selectedSymbols.includes(asset.symbol);
    return (
      <Pressable
        key={asset.symbol}
        accessibilityRole="button"
        accessibilityLabel={`${asset.symbol} · ${asset.name}`}
        accessibilityState={{ disabled: alreadyAdded }}
        disabled={alreadyAdded}
        onPress={() => {
          rememberDiscoveryAsset(asset);
          onSelect(asset);
        }}
        style={[styles.assetRow, alreadyAdded && styles.assetRowDisabled]}
      >
        {asset.category === 'indexes' ? (
          <View style={[styles.indexLogo, { backgroundColor: asset.color }]}>
            <ChartNoAxesCombined size={19} color={colors.surface} />
          </View>
        ) : <AssetLogo symbol={asset.symbol} color={asset.color} size={42} />}
        <View style={styles.assetCopy}>
          <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
          <Text style={styles.assetSymbol} numberOfLines={1}>{asset.symbol}</Text>
        </View>
        {alreadyAdded
          ? <Check size={19} color={colors.muted} />
          : action === 'add'
            ? <Plus size={21} color={colors.green} />
            : <ChevronRight size={19} color={colors.muted} />}
      </Pressable>
    );
  };

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
        {categories.map((item) => {
          const label = categoryLabels[item];
          const selected = category === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onCategoryChange(selected ? undefined : item)}
              style={[styles.categoryChip, selected && styles.categoryChipSelected]}
            >
              <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{t(label)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading && !sections[0]?.title ? <ActivityIndicator style={styles.loader} size="small" color={colors.green} /> : null}
      {error ? <Text style={styles.status} accessibilityRole="alert">{errorText(error)}</Text> : null}
      {!loading && !error && searching && !results.length
        ? <Text style={styles.status}>{t('Nenašli sa žiadne výsledky. Skús iný názov alebo symbol.')}</Text>
        : null}
      {sections.map((section) => (
        <View key={section.key}>
          {section.title ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t(section.title)}</Text>
              {section.more ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('Viac')} · ${t(section.title)}`}
                  hitSlop={8}
                  onPress={() => onCategoryChange(section.key as AssetCategory)}
                >
                  <Text style={styles.moreText}>{t('Viac')}</Text>
                </Pressable>
              ) : loading ? <ActivityIndicator size="small" color={colors.green} /> : null}
            </View>
          ) : null}
          {section.assets.map(renderAsset)}
        </View>
      ))}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  categories: { gap: 8, paddingVertical: 8, paddingRight: 4 },
  categoryChip: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 15, borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryChipSelected: { borderColor: colors.green, backgroundColor: colors.surfaceRaised },
  categoryText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  categoryTextSelected: { color: colors.green },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 4 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  moreText: { color: colors.green, fontSize: 14, fontWeight: '800' },
  loader: { marginTop: 14 },
  status: { color: colors.muted, fontSize: 12, paddingVertical: 12 },
  assetRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  assetRowDisabled: { opacity: 0.6 },
  indexLogo: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 11,
  },
  assetCopy: { flex: 1, minWidth: 0, gap: 3 },
  assetName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  assetSymbol: { color: colors.muted, fontSize: 12, fontWeight: '600' },
});
