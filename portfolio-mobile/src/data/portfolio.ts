export type Asset = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  color: string;
};

export const colors = {
  background: '#252d3b',
  surface: '#171e2a',
  surfaceRaised: '#202a3a',
  border: '#364355',
  text: '#f7f8fb',
  muted: '#aab4c3',
  green: '#78d84f',
  red: '#ff5a62',
  cyan: '#16c4d8',
  blue: '#1758b7',
  violet: '#6479ff',
};

export const availableAssets: Asset[] = [
  { symbol: 'META', name: 'Meta Platforms', price: 0, change: 0, color: colors.violet },
  { symbol: 'TSLA', name: 'Tesla', price: 0, change: 0, color: colors.red },
  { symbol: 'GOOG', name: 'Alphabet', price: 0, change: 0, color: colors.cyan },
  { symbol: 'NVDA', name: 'NVIDIA', price: 0, change: 0, color: '#80c342' },
  { symbol: 'AMZN', name: 'Amazon', price: 0, change: 0, color: '#f59d37' },
  { symbol: 'AAPL', name: 'Apple', price: 0, change: 0, color: '#d3d9e2' },
];

export const formatMoney = (value: number, compact = false) =>
  new Intl.NumberFormat('sk-SK', {
    style: 'currency',
    currency: 'EUR',
      maximumFractionDigits: compact ? 2 : Number.isInteger(value) ? 0 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(value);

export const formatPercent = (value: number, digits = 1) =>
  `${value > 0 ? '+' : ''}${value.toLocaleString('sk-SK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
