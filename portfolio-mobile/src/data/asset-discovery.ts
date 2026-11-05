import { Asset, colors } from './portfolio';

export type AssetCategory = 'stocks' | 'etfs' | 'indexes';

export const assetCategories: AssetCategory[] = ['stocks', 'etfs', 'indexes'];

export type DiscoveryVisit = { asset: Asset; views: number; lastViewedAt: number };

const palette = [colors.green, colors.blue, colors.violet, colors.cyan, colors.red];

function catalog(category: AssetCategory, entries: [string, string][]): Asset[] {
  return entries.map(([symbol, name], index) => ({
    symbol, name, price: 0, change: 0, color: palette[index % palette.length], category,
  }));
}

// Approximate largest companies / funds by size; personal views reorder them at runtime.
const featuredByCategory: Record<AssetCategory, Asset[]> = {
  stocks: catalog('stocks', [
    ["NVDA", "NVIDIA"],
    ["AAPL", "Apple"],
    ["GOOG", "Alphabet"],
    ["MSFT", "Microsoft"],
    ["AMZN", "Amazon"],
    ["TSM", "Taiwan Semiconductor Manufacturing"],
    ["AVGO", "Broadcom"],
    ["META", "Meta Platforms"],
    ["BRK-B", "Berkshire Hathaway"],
    ["TSLA", "Tesla"],
    ["JPM", "JPMorgan Chase"],
    ["V", "Visa"],
    ["LLY", "Eli Lilly"],
    ["WMT", "Walmart"],
    ["ORCL", "Oracle"],
    ["MA", "Mastercard"],
    ["XOM", "Exxon Mobil"],
    ["NFLX", "Netflix"],
    ["COST", "Costco"],
    ["JNJ", "Johnson & Johnson"],
    ["PG", "Procter & Gamble"],
    ["HD", "Home Depot"],
    ["ABBV", "AbbVie"],
    ["BAC", "Bank of America"],
    ["ASML", "ASML Holding"],
    ["SAP", "SAP"],
    ["KO", "Coca-Cola"],
    ["AMD", "Advanced Micro Devices"],
    ["PLTR", "Palantir"],
    ["CVX", "Chevron"],
    ["UNH", "UnitedHealth"],
    ["CRM", "Salesforce"],
    ["CSCO", "Cisco"],
    ["MCD", "McDonald's"],
    ["PEP", "PepsiCo"],
    ["NVO", "Novo Nordisk"],
    ["IBM", "IBM"],
    ["ADBE", "Adobe"],
    ["DIS", "Walt Disney"],
    ["INTC", "Intel"],
    ["O", "Realty Income"],
    ["PYPL", "PayPal"],
    ["UBER", "Uber"],
    ["NKE", "Nike"],
    ["SBUX", "Starbucks"],
  ]),
  etfs: catalog('etfs', [
    ["VOO", "Vanguard S&P 500 ETF"],
    ["IVV", "iShares Core S&P 500 ETF"],
    ["SPY", "SPDR S&P 500 ETF Trust"],
    ["VTI", "Vanguard Total Stock Market ETF"],
    ["QQQ", "Invesco QQQ Trust"],
    ["VUG", "Vanguard Growth ETF"],
    ["VEA", "Vanguard FTSE Developed Markets ETF"],
    ["IEFA", "iShares Core MSCI EAFE ETF"],
    ["VTV", "Vanguard Value ETF"],
    ["BND", "Vanguard Total Bond Market ETF"],
    ["AGG", "iShares Core US Aggregate Bond ETF"],
    ["GLD", "SPDR Gold Shares"],
    ["IWF", "iShares Russell 1000 Growth ETF"],
    ["VWO", "Vanguard FTSE Emerging Markets ETF"],
    ["IJH", "iShares Core S&P Mid-Cap ETF"],
    ["VIG", "Vanguard Dividend Appreciation ETF"],
    ["IEMG", "iShares Core MSCI Emerging Markets ETF"],
    ["IWM", "iShares Russell 2000 ETF"],
    ["VXUS", "Vanguard Total International Stock ETF"],
    ["SCHD", "Schwab U.S. Dividend Equity ETF"],
    ["VGT", "Vanguard Information Technology ETF"],
    ["XLK", "Technology Select Sector SPDR"],
    ["VYM", "Vanguard High Dividend Yield ETF"],
    ["SMH", "VanEck Semiconductor ETF"],
    ["ARKK", "ARK Innovation ETF"],
  ]),
  indexes: catalog('indexes', [
    ["^GSPC", "S&P 500"],
    ["^IXIC", "NASDAQ Composite"],
    ["^DJI", "Dow Jones Industrial Average"],
    ["^NDX", "NASDAQ 100"],
    ["^RUT", "Russell 2000"],
    ["^VIX", "CBOE Volatility Index"],
    ["^STOXX50E", "EURO STOXX 50"],
    ["^GDAXI", "DAX"],
    ["^FTSE", "FTSE 100"],
    ["^FCHI", "CAC 40"],
    ["^N225", "Nikkei 225"],
    ["^HSI", "Hang Seng"],
    ["000001.SS", "SSE Composite"],
    ["^BSESN", "BSE Sensex"],
    ["^GSPTSE", "S&P/TSX Composite"],
    ["^AXJO", "S&P/ASX 200"],
    ["^KS11", "KOSPI"],
    ["^SSMI", "Swiss Market Index"],
  ]),
};

export function getFeaturedAssets(category: AssetCategory, query = ''): Asset[] {
  const normalized = query.trim().toLowerCase();
  return featuredByCategory[category].filter((asset) =>
    !normalized || asset.symbol.toLowerCase().includes(normalized) || asset.name.toLowerCase().includes(normalized));
}

export function getFeaturedAssetBySymbol(symbol: string): Asset | undefined {
  return assetCategories.flatMap((category) => featuredByCategory[category])
    .find((asset) => asset.symbol === symbol);
}

export function getDiscoveryAssets(category: AssetCategory, visits: DiscoveryVisit[], query = ''): Asset[] {
  const personal = visits.filter((visit) => visit.views >= 2 && visit.asset.category === category)
    .sort((a, b) => b.views - a.views || b.lastViewedAt - a.lastViewedAt)
    .slice(0, 3).map((visit) => visit.asset);
  const unique = [...new Map([...personal, ...getFeaturedAssets(category)]
    .map((asset) => [asset.symbol, asset])).values()];
  const normalized = query.trim().toLowerCase();
  return unique.filter((asset) => !normalized || asset.symbol.toLowerCase().includes(normalized)
    || asset.name.toLowerCase().includes(normalized));
}

export function getAssetCategory(quoteType: string | undefined): AssetCategory | undefined {
  if (quoteType === 'EQUITY') return 'stocks';
  if (quoteType === 'ETF') return 'etfs';
  if (quoteType === 'INDEX') return 'indexes';
  return undefined;
}

export function filterAssetsByCategory(assets: Asset[], category?: AssetCategory): Asset[] {
  return category ? assets.filter((asset) => asset.category === category) : assets;
}
