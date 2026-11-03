export type Fundamentals = {
  symbol: string;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
};

export type FundamentalMetrics = {
  trailingPE: number | null;
  forwardPE: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
};

type RawValue = { raw?: number } | undefined;

type QuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      summaryDetail?: { trailingPE?: RawValue; forwardPE?: RawValue; marketCap?: RawValue };
      defaultKeyStatistics?: { forwardPE?: RawValue };
      earningsTrend?: {
        trend?: Array<{
          period?: string;
          revenueEstimate?: { growth?: RawValue };
          earningsEstimate?: { growth?: RawValue };
        }>;
      };
    }> | null;
  };
};

// Yahoo neposkytuje fundamenty indexu, preto trh aproximujeme najväčšími firmami S&P 500.
export const marketBasket = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'JPM', 'LLY',
  'V', 'XOM', 'UNH', 'MA', 'COST', 'WMT', 'PG', 'HD', 'JNJ', 'ORCL',
];

const USER_AGENT = 'Mozilla/5.0';
let crumbPromise: Promise<string> | null = null;

async function loadCrumb() {
  try {
    await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': USER_AGENT } });
  } catch {
    // Cookie je nastavená aj pri chybovej odpovedi.
  }
  const response = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Zdroj fundamentov vrátil HTTP ${response.status}.`);
  }
  const crumb = (await response.text()).trim();
  if (!crumb || crumb.includes('<')) {
    throw new Error('Zdroj fundamentov nevrátil platný token.');
  }
  return crumb;
}

function getCrumb() {
  if (!crumbPromise) {
    crumbPromise = loadCrumb().catch((error) => {
      crumbPromise = null;
      throw error;
    });
  }
  return crumbPromise;
}

function finite(value: RawValue) {
  return typeof value?.raw === 'number' && Number.isFinite(value.raw) ? value.raw : null;
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const crumb = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=summaryDetail,defaultKeyStatistics,earningsTrend&crumb=${encodeURIComponent(crumb)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401) {
      crumbPromise = null;
    }
    if (!response.ok) {
      throw new Error(`Zdroj fundamentov vrátil HTTP ${response.status}.`);
    }
    const data = await response.json() as QuoteSummaryResponse;
    const result = data.quoteSummary?.result?.[0];
    const nextYear = result?.earningsTrend?.trend?.find((item) => item.period === '+1y');
    return {
      symbol,
      marketCap: finite(result?.summaryDetail?.marketCap),
      trailingPE: finite(result?.summaryDetail?.trailingPE),
      forwardPE: finite(result?.summaryDetail?.forwardPE) ?? finite(result?.defaultKeyStatistics?.forwardPE),
      revenueGrowth: finite(nextYear?.revenueEstimate?.growth),
      epsGrowth: finite(nextYear?.earningsEstimate?.growth),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type StockEstimates = {
  symbol: string;
  name: string;
  currentPE: number | null;
  forwardPE: number | null;
  peThisYear: number | null;
  peNextYear: number | null;
  revenueGrowthThisYear: number | null;
  revenueGrowthNextYear: number | null;
  epsGrowthThisYear: number | null;
  epsGrowthNextYear: number | null;
};

type EstimatesResponse = {
  quoteSummary?: {
    result?: Array<{
      price?: { regularMarketPrice?: RawValue; shortName?: string; longName?: string };
      summaryDetail?: { trailingPE?: RawValue; forwardPE?: RawValue };
      defaultKeyStatistics?: { forwardPE?: RawValue };
      earningsTrend?: {
        trend?: Array<{
          period?: string;
          revenueEstimate?: { growth?: RawValue };
          earningsEstimate?: { avg?: RawValue; growth?: RawValue };
        }>;
      };
    }> | null;
  };
};

// Yahoo zverejňuje odhady len pre aktuálny (0y) a nasledujúci (+1y) fiškálny rok.
export async function fetchStockEstimates(symbol: string): Promise<StockEstimates> {
  const crumb = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=price,summaryDetail,defaultKeyStatistics,earningsTrend&crumb=${encodeURIComponent(crumb)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401) crumbPromise = null;
    if (!response.ok) throw new Error(`Zdroj fundamentov vrátil HTTP ${response.status}.`);
    const data = await response.json() as EstimatesResponse;
    const result = data.quoteSummary?.result?.[0];
    if (!result) throw new Error(`Fundamenty pre ${symbol} sa nepodarilo nájsť.`);
    const trend = result.earningsTrend?.trend ?? [];
    const thisYear = trend.find((item) => item.period === '0y');
    const nextYear = trend.find((item) => item.period === '+1y');
    const price = finite(result.price?.regularMarketPrice);
    const peFrom = (eps: number | null) => (price !== null && eps !== null && eps > 0 ? price / eps : null);
    return {
      symbol,
      name: result.price?.shortName ?? result.price?.longName ?? symbol,
      currentPE: finite(result.summaryDetail?.trailingPE),
      forwardPE: finite(result.summaryDetail?.forwardPE) ?? finite(result.defaultKeyStatistics?.forwardPE),
      peThisYear: peFrom(finite(thisYear?.earningsEstimate?.avg)),
      peNextYear: peFrom(finite(nextYear?.earningsEstimate?.avg)),
      revenueGrowthThisYear: finite(thisYear?.revenueEstimate?.growth),
      revenueGrowthNextYear: finite(nextYear?.revenueEstimate?.growth),
      epsGrowthThisYear: finite(thisYear?.earningsEstimate?.growth),
      epsGrowthNextYear: finite(nextYear?.earningsEstimate?.growth),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Vážený priemer; P/E sa agreguje cez harmonický priemer (vážené výnosy zisku), rast aritmeticky.
function aggregate(
  items: Array<{ weight: number; value: number | null }>,
  harmonic: boolean,
) {
  const valid = items.filter((item) => item.value !== null && item.weight > 0
    && (!harmonic || (item.value as number) > 0));
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (!valid.length || totalWeight <= 0) {
    return null;
  }
  if (harmonic) {
    const earningsYield = valid.reduce((sum, item) => sum + (item.weight / totalWeight) / (item.value as number), 0);
    return earningsYield > 0 ? 1 / earningsYield : null;
  }
  return valid.reduce((sum, item) => sum + (item.weight / totalWeight) * (item.value as number), 0);
}

export function aggregateFundamentals(
  items: Array<{ weight: number; fundamentals: Fundamentals | null }>,
): FundamentalMetrics {
  const pick = (key: keyof FundamentalMetrics) => items.map((item) => ({
    weight: item.weight,
    value: item.fundamentals?.[key] ?? null,
  }));
  return {
    trailingPE: aggregate(pick('trailingPE'), true),
    forwardPE: aggregate(pick('forwardPE'), true),
    revenueGrowth: aggregate(pick('revenueGrowth'), false),
    epsGrowth: aggregate(pick('epsGrowth'), false),
  };
}

async function settled(symbols: string[]) {
  const results = await Promise.allSettled(symbols.map((symbol) => fetchFundamentals(symbol)));
  return results.map((result) => (result.status === 'fulfilled' ? result.value : null));
}

export async function fetchFundamentalsComparison(
  holdings: Array<{ symbol: string; weight: number }>,
): Promise<{ portfolio: FundamentalMetrics; market: FundamentalMetrics }> {
  const [holdingData, marketData] = await Promise.all([
    settled(holdings.map((holding) => holding.symbol)),
    settled(marketBasket),
  ]);
  if (![...holdingData, ...marketData].some(Boolean)) {
    throw new Error('Fundamentálne dáta sa nepodarilo načítať.');
  }
  return {
    portfolio: aggregateFundamentals(holdings.map((holding, index) => ({
      weight: holding.weight,
      fundamentals: holdingData[index],
    }))),
    market: aggregateFundamentals(marketData.map((fundamentals) => ({
      weight: fundamentals?.marketCap ?? 0,
      fundamentals,
    }))),
  };
}
