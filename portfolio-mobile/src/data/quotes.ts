import { Platform } from 'react-native';
import { availableAssets, Asset, colors } from './portfolio';

type YahooChartResponse = {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      meta?: {
        currency?: string;
        shortName?: string;
        longName?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }> | null;
  };
};

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
  }>;
};

export type HistoricalQuotePoint = {
  timestamp: number;
  price: number;
};

export type HistoricalQuoteSeries = {
  symbol: string;
  currency: 'EUR' | 'USD';
  points: HistoricalQuotePoint[];
};

export type HistoricalQuote = {
  symbol: string;
  date: string;
  price: number;
  currency: 'EUR' | 'USD';
  fxToEur: number;
};

export type LiveQuote = {
  symbol: string;
  name: string;
  price: number;
  currency: 'EUR' | 'USD';
  fxToEur: number;
  change: number;
  color: string;
  updatedAt: string;
  isMarketQuote: boolean;
};

export async function searchAssets(inputQuery: string): Promise<Asset[]> {
  const query = inputQuery.trim();
  if (query.length < 2) return [];

  const url = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  url.searchParams.set('q', query);
  url.searchParams.set('quotesCount', '50');
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('enableFuzzyQuery', 'true');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Vyhľadávanie akcií vypršalo. Skús to znova.');
    }
    if (error instanceof TypeError) {
      throw new Error('Nepodarilo sa vyhľadať akcie. Skontroluj internetové pripojenie.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Vyhľadávanie akcií vrátilo HTTP ${response.status}.`);

  const result = await response.json() as YahooSearchResponse;
  const knownAssets = new Map(availableAssets.map((asset) => [asset.symbol, asset]));
  const seen = new Set<string>();
  return (result.quotes ?? []).flatMap((quote) => {
    const symbol = quote.symbol?.trim().toUpperCase();
    if (
      !symbol ||
      !/^[A-Z0-9.^=-]{1,20}$/.test(symbol) ||
      (quote.quoteType && quote.quoteType !== 'EQUITY' && quote.quoteType !== 'ETF') ||
      seen.has(symbol)
    ) return [];
    seen.add(symbol);
    const knownAsset = knownAssets.get(symbol);
    return [{
      symbol,
      name: quote.longname ?? quote.shortname ?? knownAsset?.name ?? symbol,
      price: 0,
      change: 0,
      color: knownAsset?.color ?? colors.violet,
    }];
  });
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function fetchChart(symbol: string): Promise<YahooChartResponse> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Zdroj cien vrátil HTTP ${response.status}.`);
    }
    return await response.json() as YahooChartResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHistoricalQuoteSeries(
  inputSymbol: string,
  startDate: string,
  interval: '5m' | '15m' | '1d' | '1wk',
): Promise<HistoricalQuoteSeries> {
  if (Platform.OS === 'web') {
    throw new Error('Historické kotácie nie sú dostupné v prehliadači. Otvor aplikáciu v Expo Go na mobile.');
  }
  const symbol = inputSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    throw new Error(`Neplatný symbol ${inputSymbol}.`);
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) throw new Error(`Neplatný začiatok obdobia: ${startDate}.`);
  const end = new Date();
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('period1', String(Math.floor(start.getTime() / 1000)));
  url.searchParams.set('period2', String(Math.floor(end.getTime() / 1000)));
  url.searchParams.set('interval', interval);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let chart: YahooChartResponse;
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Zdroj historických cien pre ${symbol} vrátil HTTP ${response.status}.`);
    chart = await response.json() as YahooChartResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Načítanie historických cien pre ${symbol} vypršalo.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Nepodarilo sa načítať historické ceny pre ${symbol}. Skontroluj internetové pripojenie.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const result = chart.chart?.result?.[0];
  if (!result || chart.chart?.error) {
    throw new Error(chart.chart?.error?.description ?? `Historické ceny pre ${symbol} sa nepodarilo nájsť.`);
  }
  const currency = result.meta?.currency;
  if (currency !== 'EUR' && currency !== 'USD') {
    throw new Error(`Historická mena ${currency ?? 'neznáma'} pri ${symbol} nie je podporovaná.`);
  }
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps.flatMap((timestamp, index) => {
    const price = closes[index];
    return isValidPrice(price) ? [{ timestamp, price }] : [];
  });
  if (!points.length) throw new Error(`Pre ${symbol} nie sú dostupné historické ceny vo vybranom období.`);
  return { symbol, currency, points };
}

export async function fetchHistoricalQuoteForDate(
  inputSymbol: string,
  inputDate: string,
): Promise<HistoricalQuote> {
  if (Platform.OS === 'web') {
    throw new Error('Historické ceny nie sú dostupné v prehliadači. Otvor aplikáciu v Expo Go na mobile.');
  }
  const symbol = inputSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    throw new Error(`Neplatný symbol ${inputSymbol}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
    throw new Error('Dátum musí byť vo formáte RRRR-MM-DD.');
  }
  const target = new Date(`${inputDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(target.getTime()) ||
    target.toISOString().slice(0, 10) !== inputDate ||
    inputDate > new Date().toISOString().slice(0, 10)
  ) {
    throw new Error('Zadaj platný dátum v minulosti alebo dnešný dátum.');
  }
  const start = new Date(target);
  start.setUTCDate(start.getUTCDate() - 5);
  const end = new Date(target);
  end.setUTCDate(end.getUTCDate() + 2);

  const fetchDailyPoints = async (quoteSymbol: string) => {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}`);
    url.searchParams.set('period1', String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set('period2', String(Math.floor(end.getTime() / 1000)));
    url.searchParams.set('interval', '1d');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Zdroj historických cien pre ${quoteSymbol} vrátil HTTP ${response.status}.`);
      }
      const chart = await response.json() as YahooChartResponse;
      const result = chart.chart?.result?.[0];
      if (!result || chart.chart?.error) {
        throw new Error(chart.chart?.error?.description ?? `Historickú cenu pre ${quoteSymbol} sa nepodarilo nájsť.`);
      }
      const timestamps = result.timestamp ?? [];
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const points = timestamps.flatMap((timestamp, index) => {
        const price = closes[index];
        return isValidPrice(price) ? [{ timestamp, price }] : [];
      });
      return { result, points };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Načítanie historickej ceny pre ${quoteSymbol} vypršalo.`);
      }
      if (error instanceof TypeError) {
        throw new Error(`Nepodarilo sa načítať historickú cenu pre ${quoteSymbol}. Skontroluj internetové pripojenie.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const { result, points } = await fetchDailyPoints(symbol);
  const datedPoints = points
    .map((point) => ({ ...point, date: new Date(point.timestamp * 1000).toISOString().slice(0, 10) }))
    .filter((point) => point.date <= inputDate && point.date >= start.toISOString().slice(0, 10))
    .sort((a, b) => b.timestamp - a.timestamp);
  const selected = datedPoints[0];
  if (!selected || (new Date(`${inputDate}T00:00:00.000Z`).getTime() - new Date(`${selected.date}T00:00:00.000Z`).getTime()) > 4 * 24 * 60 * 60 * 1000) {
    throw new Error(`Pre ${symbol} nie je dostupná historická cena k ${inputDate}.`);
  }

  const currencyCode = result.meta?.currency;
  if (currencyCode !== 'EUR' && currencyCode !== 'USD') {
    throw new Error(`Historická mena ${currencyCode ?? 'neznáma'} pri ${symbol} nie je podporovaná.`);
  }

  let fxToEur = 1;
  if (currencyCode === 'USD') {
    const fx = await fetchDailyPoints('EURUSD=X');
    const fxPoint = fx.points
      .filter((point) => point.timestamp <= selected.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (fx.result.meta?.currency !== 'USD' || !fxPoint) {
      throw new Error(`Historický kurz USD/EUR k ${selected.date} nie je dostupný.`);
    }
    fxToEur = 1 / fxPoint.price;
  }

  return {
    symbol,
    date: selected.date,
    price: selected.price,
    currency: currencyCode,
    fxToEur,
  };
}

export async function fetchLiveQuote(inputSymbol: string): Promise<LiveQuote> {
  if (Platform.OS === 'web') {
    throw new Error('Webový prehliadač blokuje priame kotácie. Live ceny načítaj v mobilnej aplikácii Expo Go.');
  }

  const symbol = inputSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    throw new Error('Zadaj platný burzový symbol, napríklad AAPL alebo MSFT.');
  }

  let chart: YahooChartResponse;
  try {
    chart = await fetchChart(symbol);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Načítanie ceny vypršalo. Skús to znova.');
    }
    if (error instanceof TypeError) {
      throw new Error('Nepodarilo sa pripojiť k Yahoo Finance. Skontroluj internetové pripojenie.');
    }
    throw error;
  }

  const result = chart.chart?.result?.[0];
  if (!result || chart.chart?.error) {
    throw new Error(chart.chart?.error?.description ?? `Symbol ${symbol} sa nepodarilo nájsť.`);
  }

  const meta = result.meta;
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const lastClose = [...closes].reverse().find(isValidPrice);
  const price = isValidPrice(meta?.regularMarketPrice)
    ? meta.regularMarketPrice
    : isValidPrice(lastClose) ? lastClose : null;
  if (price === null) {
    throw new Error(`Pre ${symbol} nie je dostupná aktuálna cena.`);
  }

  const currencyCode = meta?.currency;
  if (currencyCode !== 'EUR' && currencyCode !== 'USD') {
    throw new Error(
      `Kotácie v mene ${currencyCode ?? 'neznámej'} zatiaľ nie sú podporované. Podporované sú EUR a USD.`,
    );
  }

  let fxToEur = 1;
  if (currencyCode === 'USD') {
    const fxChart = await fetchChart('EURUSD=X');
    const fxResult = fxChart.chart?.result?.[0];
    const fxMeta = fxResult?.meta;
    const fxPrice = fxMeta?.regularMarketPrice;
    if (fxMeta?.currency !== 'USD' || !isValidPrice(fxPrice)) {
      throw new Error('Nepodarilo sa načítať menový kurz USD/EUR. Zadaj cenu ručne a skús obnoviť kotáciu neskôr.');
    }
    fxToEur = 1 / fxPrice;
  }

  const asset = availableAssets.find((item) => item.symbol === symbol);
  const previousClose = meta?.chartPreviousClose ?? meta?.previousClose;
  const change = isValidPrice(previousClose) ? ((price - previousClose) / previousClose) * 100 : 0;

  return {
    symbol,
    name: meta?.longName ?? meta?.shortName ?? asset?.name ?? symbol,
    price,
    currency: currencyCode,
    fxToEur,
    change,
    color: asset?.color ?? colors.violet,
    updatedAt: new Date().toISOString(),
    isMarketQuote: true,
  };
}
