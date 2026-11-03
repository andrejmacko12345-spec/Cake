import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Pencil, Plus, TrendingDown, TrendingUp, X } from 'lucide-react-native';
import { colors, formatMoney, formatPercent } from '../data/portfolio';
import { Position, positionCostEUR, positionValueEUR, Transaction } from '../hooks/use-positions';
import { AssetLogo } from './asset-logo';

type Props = {
  visible: boolean;
  position?: Position;
  onClose: () => void;
  onAdd: (type: 'BUY' | 'SELL') => void;
  onEdit: (transaction: Transaction) => void;
};

export function TransactionHistoryModal({ visible, position, onClose, onAdd, onEdit }: Props) {
  if (!position) return null;

  const value = positionValueEUR(position);
  const cost = positionCostEUR(position);
  const unrealized = value - cost;
  const totalReturn = position.realizedProfitEUR + unrealized;
  const returnPercent = position.totalInvestedEUR > 0 ? totalReturn / position.totalInvestedEUR * 100 : 0;

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.identity}>
              <AssetLogo symbol={position.symbol} color={position.color} size={40} />
              <View style={styles.headingCopy}>
                <Text style={styles.title}>{position.symbol}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{position.name}</Text>
              </View>
            </View>
            <Pressable accessibilityLabel="Zavrieť" onPress={onClose} style={styles.closeButton}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <View>
                <Text style={styles.summaryLabel}>Aktuálna hodnota</Text>
                <Text style={styles.summaryValue}>{formatMoney(value)}</Text>
              </View>
              <View style={styles.summaryRight}>
                <Text style={styles.summaryLabel}>Vlastníš</Text>
                <Text style={styles.summaryShares}>{position.shares.toLocaleString('sk-SK')} ks</Text>
              </View>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTop}>
              <View>
                <Text style={styles.summaryLabel}>Nerealizovaný výsledok</Text>
                <Text style={[styles.resultValue, { color: unrealized >= 0 ? colors.green : colors.red }]}>
                  {unrealized >= 0 ? '+' : ''}{formatMoney(unrealized)}
                </Text>
              </View>
              <View style={styles.summaryRight}>
                <Text style={styles.summaryLabel}>Realizovaný výsledok</Text>
                <Text style={[styles.resultValue, { color: position.realizedProfitEUR >= 0 ? colors.green : colors.red }]}>
                  {position.realizedProfitEUR >= 0 ? '+' : ''}{formatMoney(position.realizedProfitEUR)}
                </Text>
              </View>
            </View>
            <Text style={styles.returnCaption}>
              Celkový výsledok {formatPercent(returnPercent)} · metóda váženého priemeru
            </Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Pohyby ({position.transactions.length})</Text>
            <View style={styles.actionButtons}>
              <Pressable accessibilityLabel="Pridať nákup" onPress={() => onAdd('BUY')} style={styles.addButton}>
                <Plus size={14} color={colors.surface} />
                <Text style={styles.addButtonText}>Nákup</Text>
              </Pressable>
              <Pressable accessibilityLabel="Pridať predaj" onPress={() => onAdd('SELL')} style={styles.sellButton}>
                <Plus size={14} color={colors.red} />
                <Text style={styles.sellButtonText}>Predaj</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {position.transactions.map((transaction) => {
              const isBuy = transaction.type === 'BUY';
              return (
                <Pressable
                  accessibilityLabel={`Upraviť ${isBuy ? 'nákup' : 'predaj'} ${position.symbol} z ${transaction.date}`}
                  accessibilityRole="button"
                  key={transaction.id}
                  onPress={() => onEdit(transaction)}
                  style={styles.transactionRow}
                >
                  <View style={[styles.transactionIcon, { backgroundColor: isBuy ? 'rgba(107,220,84,0.12)' : 'rgba(255,90,98,0.12)' }]}>
                    {isBuy
                      ? <TrendingUp size={16} color={colors.green} />
                      : <TrendingDown size={16} color={colors.red} />}
                  </View>
                  <View style={styles.transactionCopy}>
                    <Text style={styles.transactionTitle}>{isBuy ? 'Nákup' : 'Predaj'} · {transaction.shares.toLocaleString('sk-SK')} ks</Text>
                    <Text style={styles.transactionDate}>
                      {new Date(`${transaction.date}T12:00:00`).toLocaleDateString('sk-SK')}
                      {transaction.dateEstimated ? ' · približný dátum' : ''}
                    </Text>
                  </View>
                  <View style={styles.transactionAmounts}>
                    <Text style={styles.transactionTotal}>
                      {formatMoney(transaction.shares * transaction.price * transaction.fxToEur)}
                    </Text>
                    <Text style={styles.transactionPrice}>
                      {transaction.price.toLocaleString('sk-SK', { maximumFractionDigits: 4 })} {transaction.currency}/ks
                    </Text>
                  </View>
                  <Pencil size={14} color={colors.muted} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    height: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headingCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 19, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 18 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  summaryShares: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 5 },
  summaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 12 },
  resultValue: { fontSize: 12, fontWeight: '800', marginTop: 5 },
  returnCaption: { color: colors.muted, fontSize: 9, marginTop: 11 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  actionButtons: { flexDirection: 'row', gap: 7 },
  addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  addButtonText: { color: colors.surface, fontSize: 10, fontWeight: '900', marginLeft: 3 },
  sellButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,90,98,0.12)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  sellButtonText: { color: colors.red, fontSize: 10, fontWeight: '900', marginLeft: 3 },
  list: { paddingBottom: 18 },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  transactionIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  transactionCopy: { flex: 1 },
  transactionTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  transactionDate: { color: colors.muted, fontSize: 9, marginTop: 4 },
  transactionAmounts: { alignItems: 'flex-end', marginRight: 8 },
  transactionTotal: { color: colors.text, fontSize: 11, fontWeight: '800' },
  transactionPrice: { color: colors.muted, fontSize: 8, marginTop: 4 },
});
