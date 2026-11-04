export type FundamentalMetrics = Pick<StockEstimates,
  'currentPE' | 'peThisYear' | 'peNextYear' |
  'epsGrowthTTM' | 'epsGrowthThisYear' | 'epsGrowthNextYear' |
  'revenueGrowthTTM' | 'revenueGrowthThisYear' | 'revenueGrowthNextYear'
>;

export type Fundamentals = FundamentalMetrics & {
  symbol: string;
  marketCap: number | null;
};

type RawValue = { raw?: number } | undefined;

// Yahoo neposkytuje fundamenty indexu, preto trh aproximujeme veľkými firmami S&P 500.
export const marketBasket = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'JPM', 'LLY',
  'V', 'XOM', 'UNH', 'MA', 'COST', 'WMT', 'PG', 'HD', 'JNJ', 'ORCL',
  'BRK-B', 'NFLX', 'ABBV', 'KO', 'CVX', 'BAC', 'CRM', 'AMD', 'TMUS', 'WFC',
  'CSCO', 'MCD', 'ACN', 'LIN', 'ABT', 'DHR', 'PM', 'IBM', 'GE', 'NOW',
  'TMO', 'CAT', 'INTU', 'TXN', 'QCOM', 'AMGN', 'DIS', 'MS', 'NEE', 'GS',
];

const USER_AGENT = 'Mozilla/5.0';
export const YAHOO_USER_AGENT = USER_AGENT;
let crumbPromise: Promise<string> | null = null;

export async function yahooQuoteSummary<T>(symbol: string, modules: string): Promise<T | undefined> {
  const crumb = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401) crumbPromise = null;
    if (!response.ok) throw new Error(`Zdroj dát vrátil HTTP ${response.status}.`);
    const data = await response.json() as { quoteSummary?: { result?: T[] | null } };
    return data.quoteSummary?.result?.[0];
  } finally {
    clearTimeout(timeout);
  }
}

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
  return fetchStockEstimates(symbol);
}

export type StockEstimates = {
  symbol: string;
  name: string;
  marketCap: number | null;
  currentPE: number | null;
  forwardPE: number | null;
  peThisYear: number | null;
  peNextYear: number | null;
  epsThisYear: number | null;
  epsNextYear: number | null;
  revenueGrowthThisYear: number | null;
  revenueGrowthNextYear: number | null;
  epsGrowthThisYear: number | null;
  epsGrowthNextYear: number | null;
  revenueGrowthTTM: number | null;
  epsGrowthTTM: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  priceToSalesTTM: number | null;
  cy0End: string;
  cy1End: string;
  calendarApproximate: boolean;
};

type EstimatesResponse = {
  quoteSummary?: {
    result?: Array<{
      price?: { regularMarketPrice?: RawValue; shortName?: string; longName?: string };
      summaryDetail?: { trailingPE?: RawValue; forwardPE?: RawValue; priceToSalesTrailing12Months?: RawValue; marketCap?: RawValue };
      defaultKeyStatistics?: { forwardPE?: RawValue };
      financialData?: { grossMargins?: RawValue; profitMargins?: RawValue };
      earningsTrend?: {
        trend?: Array<{
          period?: string;
          endDate?: string;
          revenueEstimate?: { avg?: RawValue; growth?: RawValue; yearAgoRevenue?: RawValue };
          earningsEstimate?: { avg?: RawValue; growth?: RawValue; yearAgoEps?: RawValue };
        }>;
      };
    }> | null;
  };
};

async function fetchTrailingGrowth(symbol: string, signal: AbortSignal) {
  const now = Math.floor(Date.now() / 1000);
  const types = ['trailingTotalRevenue', 'trailingDilutedEPS', 'annualTotalRevenue', 'annualDilutedEPS'] as const;
  const response = await fetch(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?type=${types.join(',')}&period1=${now - 3 * 366 * 86400}&period2=${now}`,
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal },
  );
  if (!response.ok) throw new Error(`Zdroj TTM dát vrátil HTTP ${response.status}.`);
  type Row = { asOfDate?: string; reportedValue?: RawValue };
  const data = await response.json() as {
    timeseries?: { result?: Array<Partial<Record<typeof types[number], Row[]>>> };
  };
  const growth = (type: typeof types[number]) => {
    const rows = (data.timeseries?.result?.flatMap((entry) => entry[type] ?? []) ?? [])
      .filter((row) => row.asOfDate && finite(row.reportedValue) !== null)
      .sort((a, b) => String(b.asOfDate).localeCompare(String(a.asOfDate)));
    const latest = rows[0];
    if (!latest?.asOfDate) return null;
    const target = new Date(`${latest.asOfDate}T00:00:00Z`);
    target.setUTCFullYear(target.getUTCFullYear() - 1);
    const previous = rows.find((row) =>
      Math.abs(Date.parse(`${row.asOfDate}T00:00:00Z`) - target.getTime()) < 45 * 86400000);
    const base = finite(previous?.reportedValue);
    const value = finite(latest.reportedValue);
    return base !== null && base > 0 && value !== null ? value / base - 1 : null;
  };
  const annual = (type: typeof types[number]) =>
    (data.timeseries?.result?.flatMap((entry) => entry[type] ?? []) ?? [])
      .flatMap((row) => {
        const value = finite(row.reportedValue);
        return row.asOfDate && value !== null ? [{ date: row.asOfDate, value }] : [];
      });
  return {
    revenueGrowthTTM: growth(types[0]),
    epsGrowthTTM: growth(types[1]),
    annualRevenue: annual('annualTotalRevenue'),
    annualEPS: annual('annualDilutedEPS'),
  };
}

export function calendarYearEstimate(
  annual: Array<{ date: string; value: number }>,
  year: number,
  fiscalEndMonth: number,
): number | null {
  const ending = (endYear: number) => annual.find((row) =>
    row.date.startsWith(`${endYear}-`) && Number(row.date.slice(5, 7)) === fiscalEndMonth)?.value;
  const first = ending(year);
  if (fiscalEndMonth === 12) return first ?? null;
  const second = ending(year + 1);
  if (first === undefined || second === undefined) return null;
  // Calendar year spans the end of one fiscal year and the start of the next.
  return first * fiscalEndMonth / 12 + second * (12 - fiscalEndMonth) / 12;
}

// Yahoo zverejňuje odhady len pre aktuálny (0y) a nasledujúci (+1y) fiškálny rok.
export async function fetchStockEstimates(symbol: string): Promise<StockEstimates> {
  const crumb = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend&crumb=${encodeURIComponent(crumb)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const [response, trailing] = await Promise.all([fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    }), fetchTrailingGrowth(symbol, controller.signal)]);
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
    const annualRevenue = [...trailing.annualRevenue];
    const annualEPS = [...trailing.annualEPS];
    const upsert = (rows: Array<{ date: string; value: number }>, date: string, value: number | null) => {
      if (value === null) return;
      const existing = rows.find((row) => row.date === date);
      if (existing) existing.value = value;
      else rows.push({ date, value });
    };
    for (const estimate of [thisYear, nextYear]) {
      if (!estimate?.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(estimate.endDate)) continue;
      const previousDate = `${Number(estimate.endDate.slice(0, 4)) - 1}${estimate.endDate.slice(4)}`;
      const addIfMissing = (rows: Array<{ date: string; value: number }>, value: number | null) => {
        if (!rows.some((row) => row.date === previousDate)) upsert(rows, previousDate, value);
      };
      addIfMissing(annualRevenue, finite(estimate.revenueEstimate?.yearAgoRevenue));
      addIfMissing(annualEPS, finite(estimate.earningsEstimate?.yearAgoEps));
      upsert(annualRevenue, estimate.endDate, finite(estimate.revenueEstimate?.avg));
      upsert(annualEPS, estimate.endDate, finite(estimate.earningsEstimate?.avg));
    }
    const fiscalMonth = thisYear?.endDate ? Number(thisYear.endDate.slice(5, 7)) : null;
    const year = new Date().getFullYear();
    const calendar = (rows: Array<{ date: string; value: number }>, targetYear: number) =>
      fiscalMonth !== null && fiscalMonth >= 1 && fiscalMonth <= 12
        ? calendarYearEstimate(rows, targetYear, fiscalMonth)
        : null;
    const growth = (rows: Array<{ date: string; value: number }>, targetYear: number) => {
      const current = calendar(rows, targetYear);
      const previous = calendar(rows, targetYear - 1);
      return current !== null && previous !== null && previous > 0 ? current / previous - 1 : null;
    };
    return {
      symbol,
      name: result.price?.shortName ?? result.price?.longName ?? symbol,
      marketCap: finite(result.summaryDetail?.marketCap),
      revenueGrowthTTM: trailing.revenueGrowthTTM,
      epsGrowthTTM: trailing.epsGrowthTTM,
      grossMargin: finite(result.financialData?.grossMargins),
      netMargin: finite(result.financialData?.profitMargins),
      priceToSalesTTM: finite(result.summaryDetail?.priceToSalesTrailing12Months),
      cy0End: `${year}-12-31`,
      cy1End: `${year + 1}-12-31`,
      calendarApproximate: fiscalMonth !== null && fiscalMonth !== 12,
      currentPE: finite(result.summaryDetail?.trailingPE),
      forwardPE: finite(result.summaryDetail?.forwardPE) ?? finite(result.defaultKeyStatistics?.forwardPE),
      peThisYear: peFrom(calendar(annualEPS, year)),
      peNextYear: peFrom(calendar(annualEPS, year + 1)),
      epsThisYear: calendar(annualEPS, year),
      epsNextYear: calendar(annualEPS, year + 1),
      revenueGrowthThisYear: growth(annualRevenue, year),
      revenueGrowthNextYear: growth(annualRevenue, year + 1),
      epsGrowthThisYear: growth(annualEPS, year),
      epsGrowthNextYear: growth(annualEPS, year + 1),
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
    currentPE: aggregate(pick('currentPE'), true),
    peThisYear: aggregate(pick('peThisYear'), true),
    peNextYear: aggregate(pick('peNextYear'), true),
    epsGrowthTTM: aggregate(pick('epsGrowthTTM'), false),
    epsGrowthThisYear: aggregate(pick('epsGrowthThisYear'), false),
    epsGrowthNextYear: aggregate(pick('epsGrowthNextYear'), false),
    revenueGrowthTTM: aggregate(pick('revenueGrowthTTM'), false),
    revenueGrowthThisYear: aggregate(pick('revenueGrowthThisYear'), false),
    revenueGrowthNextYear: aggregate(pick('revenueGrowthNextYear'), false),
  };
}

async function settled(symbols: string[]) {
  const results: Array<Fundamentals | null> = [];
  for (let index = 0; index < symbols.length; index += 8) {
    const batch = await Promise.allSettled(
      symbols.slice(index, index + 8).map((symbol) => fetchFundamentals(symbol)),
    );
    results.push(...batch.map((result) => result.status === 'fulfilled' ? result.value : null));
  }
  return results;
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

export type KeyStats = {
  eps: number | null;
  forwardEPS: number | null;
  pe: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  marketCap: number | null;
};

export async function fetchKeyStats(symbol: string): Promise<KeyStats> {
  const result = await yahooQuoteSummary<{
    summaryDetail?: { trailingPE?: RawValue; forwardPE?: RawValue; marketCap?: RawValue; dividendYield?: RawValue; dividendRate?: RawValue };
    defaultKeyStatistics?: { trailingEps?: RawValue; forwardEps?: RawValue; forwardPE?: RawValue };
  }>(symbol, 'summaryDetail,defaultKeyStatistics');
  return {
    eps: finite(result?.defaultKeyStatistics?.trailingEps),
    forwardEPS: finite(result?.defaultKeyStatistics?.forwardEps),
    pe: finite(result?.summaryDetail?.trailingPE),
    forwardPE: finite(result?.summaryDetail?.forwardPE) ?? finite(result?.defaultKeyStatistics?.forwardPE),
    dividendYield: finite(result?.summaryDetail?.dividendYield),
    dividendRate: finite(result?.summaryDetail?.dividendRate),
    marketCap: finite(result?.summaryDetail?.marketCap),
  };
}