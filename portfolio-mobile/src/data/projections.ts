import { yahooQuoteSummary, YAHOO_USER_AGENT } from './fundamentals';

export type ProjectionBase = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  shares: number;
  revenue: number;
  netIncome: number;
  periodEnd: string;
  period: 'TTM' | 'annual';
  revenueGrowth?: number | null;
  incomeGrowth?: number | null;
  currentPE?: number | null;
  averagePE?: number | null;
  peHistoryUnavailable?: boolean;
};

export type ProjectionInputs = {
  revenueGrowth: number;
  incomeGrowth: number;
  peLow: number;
  peHigh: number;
};

export function projectionDefaults(base: ProjectionBase): Record<keyof ProjectionInputs, string> {
  const format = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(Number(value.toFixed(2)));
  return {
    revenueGrowth: format(base.revenueGrowth),
    incomeGrowth: format(base.incomeGrowth),
    peLow: format(base.averagePE == null ? null : base.averagePE * 0.75),
    peHigh: format(base.averagePE == null ? null : base.averagePE * 1.25),
  };
}

export type ProjectionYear = {
  year: number;
  revenue: number;
  netIncome: number;
  margin: number;
  eps: number;
  priceLow: number | null;
  priceHigh: number | null;
  cagrLow: number | null;
  cagrHigh: number | null;
};

export function parseProjectionNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function projectStock(base: ProjectionBase, inputs: ProjectionInputs[]): ProjectionYear[] {
  if (![base.price, base.shares, base.revenue].every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(base.netIncome)) {
    throw new Error('Východiskové údaje projekcie nie sú platné.');
  }
  let revenue = base.revenue;
  let netIncome = base.netIncome;
  return inputs.map((input, index) => {
    if (!Object.values(input).every(Number.isFinite)
      || input.revenueGrowth <= -100 || input.incomeGrowth < -100
      || input.peLow <= 0 || input.peHigh < input.peLow) {
      throw new Error('Zadaj platné rasty a kladné P/E. Horné P/E nesmie byť nižšie než dolné.');
    }
    revenue *= 1 + input.revenueGrowth / 100;
    netIncome *= 1 + input.incomeGrowth / 100;
    const eps = netIncome / base.shares;
    const priceLow = eps > 0 ? eps * input.peLow : null;
    const priceHigh = eps > 0 ? eps * input.peHigh : null;
    const year = index + 1;
    const result = {
      year, revenue, netIncome, margin: netIncome / revenue, eps, priceLow, priceHigh,
      cagrLow: priceLow === null ? null : (priceLow / base.price) ** (1 / year) - 1,
      cagrHigh: priceHigh === null ? null : (priceHigh / base.price) ** (1 / year) - 1,
    };
    if (Object.values(result).some((value) => value !== null && !Number.isFinite(value))) {
      throw new Error('Predpoklady sú príliš vysoké na výpočet projekcie.');
    }
    return result;
  });
}

type Raw = { raw?: number };
type Summary = {
  price?: { regularMarketPrice?: Raw; currency?: string; shortName?: string; longName?: string };
  financialData?: { financialCurrency?: string };
};
type FinancialRow = { asOfDate?: string; currencyCode?: string; reportedValue?: Raw };
const finite = (value: Raw | undefined) =>
  typeof value?.raw === 'number' && Number.isFinite(value.raw) ? value.raw : null;

export function revenueGrowthEstimate(
  quarterly: FinancialRow[], trailing: FinancialRow[], annual: FinancialRow[],
  currency: string, anchor: string, today = new Date(),
): number | null {
  const comparable = (history: FinancialRow[]) => history.filter((row) =>
    row.asOfDate && Number.isFinite(Date.parse(row.asOfDate)) && row.asOfDate <= anchor
    && Date.parse(row.asOfDate) <= today.getTime() && row.currencyCode === currency
    && finite(row.reportedValue) !== null)
    .sort((a, b) => b.asOfDate!.localeCompare(a.asOfDate!));
  const change = (history: FinancialRow[], years: number, maxAge: number) => {
    const rows = comparable(history);
    const latest = rows[0];
    if (!latest?.asOfDate || today.getTime() - Date.parse(latest.asOfDate) > maxAge * 86400000) return null;
    const target = new Date(`${latest.asOfDate}T00:00:00Z`);
    target.setUTCFullYear(target.getUTCFullYear() - years);
    const prior = rows.filter((row) => row.asOfDate! < latest.asOfDate!)
      .sort((a, b) => Math.abs(Date.parse(a.asOfDate!) - target.getTime())
        - Math.abs(Date.parse(b.asOfDate!) - target.getTime()))
      .find((row) => Math.abs(Date.parse(row.asOfDate!) - target.getTime()) < 35 * 86400000);
    const currentValue = finite(latest.reportedValue);
    const priorValue = finite(prior?.reportedValue);
    if (currentValue === null || currentValue < 0 || priorValue === null || priorValue <= 0) return null;
    const value = (Math.pow(currentValue / priorValue, 1 / years) - 1) * 100;
    return Number.isFinite(value) ? value : null;
  };
  const components = [
    { value: change(quarterly, 1, 190), weight: 0.5 },
    { value: change(trailing, 1, 190), weight: 0.3 },
    { value: change(annual, 3, 550), weight: 0.2 },
  ];
  let total = 0;
  let weight = 0;
  for (const component of components) {
    if (component.value === null) continue;
    total += component.value * component.weight;
    weight += component.weight;
  }
  return weight ? total / weight : null;
}

export function historicalAveragePE(
  earnings: Array<{ date: string; eps: number }>,
  prices: Array<{ date: string; price: number }>,
  today = new Date(),
): number | null {
  const end = today.getTime();
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  const ratios = new Map<string, number>();
  for (const earning of earnings) {
    const date = Date.parse(earning.date);
    if (!Number.isFinite(date) || date < start.getTime() || date > end
      || !Number.isFinite(earning.eps) || earning.eps <= 0) continue;
    const price = prices.filter((point) => point.date <= earning.date
      && date - Date.parse(point.date) <= 7 * 86400000
      && Number.isFinite(point.price) && point.price > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.price;
    if (price !== undefined) ratios.set(earning.date, price / earning.eps);
  }
  const dates = [...ratios.keys()].sort();
  // Require coverage of all three years, not a few recent observations.
  if (dates.length < 9 || Date.parse(dates[0]) > start.getTime() + 120 * 86400000
    || end - Date.parse(dates[dates.length - 1]) > 190 * 86400000) return null;
  const values = [...ratios.values()];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function fetchPEPrices(symbol: string, signal: AbortSignal) {
  const now = Math.floor(Date.now() / 1000);
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?period1=${now - 3 * 366 * 86400 - 7 * 86400}&period2=${now}&interval=1d`,
  { headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`Zdroj dát vrátil HTTP ${response.status}.`);
  const body = await response.json() as { chart?: { result?: Array<{
    meta?: { currency?: string }; timestamp?: number[];
    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  }> } };
  const chart = body.chart?.result?.[0];
  if (!chart?.timestamp || !chart.meta?.currency) throw new Error('Historické P/E nie je dostupné. Zadaj P/E ručne.');
  const closes = chart.indicators?.quote?.[0]?.close ?? [];
  return {
    currency: chart.meta.currency,
    prices: chart.timestamp.flatMap((timestamp, index) => {
      const price = closes[index];
      return typeof price === 'number' && Number.isFinite(price) && price > 0
        ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), price }] : [];
    }),
  };
}

export async function fetchProjectionBase(symbol: string): Promise<ProjectionBase> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const now = Math.floor(Date.now() / 1000);
    const types = ['trailingTotalRevenue', 'trailingNetIncomeCommonStockholders',
      'annualTotalRevenue', 'annualNetIncomeCommonStockholders', 'trailingDilutedEPS', 'annualDilutedEPS',
      'trailingDilutedAverageShares', 'annualDilutedAverageShares', 'quarterlyTotalRevenue'] as const;
    const [summary, response, priceHistory] = await Promise.all([
      yahooQuoteSummary<Summary>(symbol, 'price,financialData'),
      fetch(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
        + `?type=${types.join(',')}&period1=${now - 6 * 366 * 86400}&period2=${now}`,
      { headers: { 'User-Agent': YAHOO_USER_AGENT, Accept: 'application/json' }, signal: controller.signal }),
      fetchPEPrices(symbol, controller.signal).catch((failure: unknown) => {
        console.warn('Projection P/E history failed:', failure);
        return null;
      }),
    ]);
    if (!response.ok) throw new Error(`Zdroj dát vrátil HTTP ${response.status}.`);
    const body = await response.json() as {
      timeseries?: { result?: Array<Partial<Record<typeof types[number], FinancialRow[]>>> };
    };
    const price = finite(summary?.price?.regularMarketPrice);
    const currency = summary?.price?.currency;
    if (price === null || price <= 0 || !currency) {
      throw new Error('Pre projekciu chýba aktuálna cena, mena alebo počet akcií.');
    }
    const rows = (type: typeof types[number]) =>
      (body.timeseries?.result?.flatMap((entry) => entry[type] ?? []) ?? [])
        .map((row) => ({ ...row, currencyCode: row.currencyCode ?? summary?.financialData?.financialCurrency }))
        .filter((row) => row.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(row.asOfDate)
          && Date.parse(row.asOfDate) <= Date.now() && finite(row.reportedValue) !== null)
        .sort((a, b) => String(b.asOfDate).localeCompare(String(a.asOfDate)));
    for (const period of ['TTM', 'annual'] as const) {
      const revenues = rows(period === 'TTM' ? types[0] : types[2]);
      const incomes = rows(period === 'TTM' ? types[1] : types[3]);
      for (const revenue of revenues) {
        const income = incomes.find((row) => row.asOfDate === revenue.asOfDate);
        const age = Date.now() - Date.parse(revenue.asOfDate!);
        if (!income || age > (period === 'TTM' ? 190 : 550) * 86400000) continue;
        const revenueValue = finite(revenue.reportedValue);
        const incomeValue = finite(income.reportedValue);
        const revenueCurrency = revenue.currencyCode ?? summary?.financialData?.financialCurrency;
        const incomeCurrency = income.currencyCode ?? summary?.financialData?.financialCurrency;
        if (!revenueCurrency || revenueCurrency !== incomeCurrency || revenueCurrency !== currency) {
          throw new Error('Mena výkazov a cena akcie sa líšia. Projekciu nemožno bezpečne vypočítať.');
        }
        if (revenueValue !== null && revenueValue > 0 && incomeValue !== null) {
          const epsRows = rows(period === 'TTM' ? types[4] : types[5]);
          const epsRow = epsRows.find((row) => row.asOfDate === revenue.asOfDate
            && (row.currencyCode ?? summary?.financialData?.financialCurrency) === currency);
          const eps = finite(epsRow?.reportedValue);
          const shareRow = rows(period === 'TTM' ? types[6] : types[7])
            .find((row) => row.asOfDate === revenue.asOfDate);
          // A class-specific share count cannot divide consolidated earnings (GOOG/GOOGL).
          const shares = eps !== null && eps !== 0 ? incomeValue / eps : finite(shareRow?.reportedValue);
          if (shares === null || !Number.isFinite(shares) || shares <= 0) {
            throw new Error('Pre projekciu chýba porovnateľný zisk na akciu. Skús inú akciu.');
          }
          const growth = (history: FinancialRow[], anchor: string) => {
            const values: number[] = [];
            const atYear = (offset: number) => {
              const target = new Date(`${anchor}T00:00:00Z`);
              target.setUTCFullYear(target.getUTCFullYear() - offset);
              return history.find((row) =>
                Math.abs(Date.parse(row.asOfDate!) - target.getTime()) < 35 * 86400000
                && (row.currencyCode ?? summary?.financialData?.financialCurrency) === currency);
            };
            for (let year = 0; year < 3; year++) {
              const current = finite(atYear(year)?.reportedValue);
              const prior = finite(atYear(year + 1)?.reportedValue);
              if (current === null || prior === null || prior <= 0) break;
              const change = (current / prior - 1) * 100;
              if (!Number.isFinite(change)) break;
              values.push(change);
            }
            return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
          };
          const averageGrowth = (annualType: typeof types[number], history: FinancialRow[]) => {
            const annual = rows(annualType).filter((row) => row.asOfDate! <= revenue.asOfDate!);
            const latest = annual[0];
            const annualGrowth = latest?.asOfDate
              && Date.parse(revenue.asOfDate!) - Date.parse(latest.asOfDate) < 550 * 86400000
              ? growth(annual, latest.asOfDate) : null;
            return annualGrowth ?? growth(history, revenue.asOfDate!);
          };
          const currentPE = incomeValue > 0 ? price / (incomeValue / shares) : null;
          const averagePE = priceHistory?.currency === currency ? historicalAveragePE(
            rows(types[4]).flatMap((row) => {
              const value = finite(row.reportedValue);
              return value !== null && (row.currencyCode ?? summary?.financialData?.financialCurrency) === currency
                ? [{ date: row.asOfDate!, eps: value }] : [];
            }), priceHistory.prices,
          ) : null;
          return {
            symbol, name: summary?.price?.longName ?? summary?.price?.shortName ?? symbol,
            price, shares, currency, revenue: revenueValue, netIncome: incomeValue,
            periodEnd: revenue.asOfDate!, period,
            revenueGrowth: revenueGrowthEstimate(
              rows('quarterlyTotalRevenue'), rows('trailingTotalRevenue'), rows('annualTotalRevenue'),
              currency, revenue.asOfDate!,
            ),
            incomeGrowth: averageGrowth(types[3], incomes),
            currentPE: currentPE !== null && Number.isFinite(currentPE) ? currentPE : null,
            averagePE,
            peHistoryUnavailable: averagePE === null,
          };
        }
      }
    }
    throw new Error('Nie sú dostupné aktuálne tržby a čistý zisk za rovnaké obdobie.');
  } finally {
    clearTimeout(timeout);
  }
}
