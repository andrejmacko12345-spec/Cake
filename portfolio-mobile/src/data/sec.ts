import { FinancialQuarter } from './quarterly';

type Fact = {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed: string;
  accn?: string;
};
type Concept = { units?: Record<string, Fact[]> };
type MetricFact = Fact & { concept: string };
export type CompanyFacts = { facts?: Record<string, Record<string, Concept>> };
type Ticker = { cik_str: number; ticker: string };

const DAY = 86400;
const headers = { 'User-Agent': 'PortfolioTracker/1.0 (public financial statements)', Accept: 'application/json' };
let tickersPromise: Promise<Ticker[]> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`SEC vrátilo HTTP ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function tickers() {
  if (!tickersPromise) {
    tickersPromise = getJson<Record<string, Ticker>>('https://www.sec.gov/files/company_tickers.json')
      .then(Object.values)
      .catch((error: unknown) => {
        tickersPromise = null;
        throw error;
      });
  }
  return tickersPromise;
}

function timestamp(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

function duration(row: Fact) {
  return row.start ? (timestamp(row.end) - timestamp(row.start)) / DAY + 1 : 0;
}

export function parseSecQuarters(data: CompanyFacts, now = Date.now() / 1000): FinancialQuarter[] {
  const gaap = data.facts?.['us-gaap'] ?? {};
  const valid = (row: Fact) => Number.isFinite(row.val) && Number.isFinite(timestamp(row.end))
    && timestamp(row.end) <= now && timestamp(row.filed) <= now
    && /^(10-[KQ]|20-F|40-F)(\/A)?$/.test(row.form ?? '');
  const rowsFor = (tags: string[], unit: string): MetricFact[] => tags.flatMap((tag) =>
    (gaap[tag]?.units?.[unit] ?? []).filter(valid).map((row) => ({ ...row, concept: tag })));
  // Total consolidated revenue precedes contract-only revenue (banks/insurers).
  const revenueTags = [
    'Revenues', 'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet',
  ];
  const revenueRows = rowsFor(revenueTags, 'USD');
  const revenuePriority = (a: MetricFact, b: MetricFact) =>
    revenueTags.indexOf(a.concept) - revenueTags.indexOf(b.concept) || b.filed.localeCompare(a.filed);
  const epsRows = rowsFor(['EarningsPerShareDiluted'], 'USD/shares');
  const annuals = [...revenueRows, ...epsRows]
    .filter((row) => duration(row) >= 330 && duration(row) <= 380 && row.fy && row.fp === 'FY')
    .sort((a, b) => a.filed.localeCompare(b.filed));
  const label = (end: string) => {
    const time = timestamp(end);
    const anchor = annuals.filter((row) => Math.abs(timestamp(row.end) - time) < 400 * DAY)
      .sort((a, b) => Math.abs(timestamp(a.end) - time) - Math.abs(timestamp(b.end) - time)
        || a.filed.localeCompare(b.filed))[0];
    if (!anchor?.fy) return { fiscalYear: '', period: '' };
    const offset = Math.round((time - timestamp(anchor.end)) / (365.25 / 4 * DAY));
    const ordinal = anchor.fy * 4 + 3 + offset;
    return { fiscalYear: String(Math.floor(ordinal / 4)), period: `Q${ordinal % 4 + 1}` };
  };
  const quarters = new Map<string, FinancialQuarter>();
  const getQuarter = (row: Fact) => {
    let quarter = quarters.get(row.end);
    if (!quarter) {
      quarter = { time: timestamp(row.end), ...label(row.end), revenue: null, eps: null };
      quarters.set(row.end, quarter);
    }
    return quarter;
  };
  const fill = (rows: MetricFact[], field: 'revenue' | 'eps') => {
    // Prefer the most recently filed comparative, which includes restatements/splits.
    const sorted = rows.filter((row) => duration(row) >= 70 && duration(row) <= 110)
      .sort((a, b) => field === 'revenue' ? revenuePriority(a, b) : b.filed.localeCompare(a.filed));
    for (const row of sorted) {
      const quarter = getQuarter(row);
      if (quarter[field] === null) quarter[field] = row.val;
      if (row.fp === quarter.period && String(row.fy) === quarter.fiscalYear) {
        quarter.reportedAt = Math.min(quarter.reportedAt ?? Infinity, timestamp(row.filed));
      }
    }
  };
  fill(revenueRows, 'revenue');
  fill(epsRows, 'eps');
  // Revenue is additive; derive missing Q4 from the annual and matching nine-month
  // statement. EPS is not additive because diluted share counts can change.
  for (const annual of annuals.filter((row) => revenueRows.includes(row))
    .sort(revenuePriority)) {
    const quarter = getQuarter(annual);
    if (quarter.revenue !== null) continue;
    const ytd = revenueRows.filter((row) => row.concept === annual.concept && row.start === annual.start
      && duration(row) >= 240 && duration(row) <= 300
      && (timestamp(annual.end) - timestamp(row.end)) / DAY >= 70
      && (timestamp(annual.end) - timestamp(row.end)) / DAY <= 110
      && timestamp(row.filed) <= timestamp(annual.filed))
      .sort((a, b) => Number(b.accn === annual.accn) - Number(a.accn === annual.accn)
        || b.filed.localeCompare(a.filed))[0];
    if (ytd) {
      quarter.revenue = annual.val - ytd.val;
      if (String(annual.fy) === quarter.fiscalYear) quarter.reportedAt = timestamp(annual.filed);
    }
  }
  return [...quarters.values()].filter((row) => row.time >= now - 4 * 366 * DAY
    && (row.revenue !== null || row.eps !== null))
    .sort((a, b) => b.time - a.time);
}

export async function fetchSecQuarterly(symbol: string): Promise<FinancialQuarter[]> {
  const normalized = symbol.toUpperCase().replace('.', '-');
  const ticker = (await tickers()).find((row) => row.ticker.toUpperCase().replace('.', '-') === normalized);
  if (!ticker) return []; // Non-SEC listings use the other statement providers.
  const cik = String(ticker.cik_str).padStart(10, '0');
  return parseSecQuarters(await getJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`));
}
