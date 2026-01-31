import { getJson } from "@/lib/api";

export type ChartBar = {
  time: string | null;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  maFast?: number | null;
  maSlow?: number | null;
  maLong?: number | null;
};

export type BarsIndicatorsResponse = {
  ticker: string;
  timeframe: string;
  ma: {
    fast: number;
    slow: number;
    long: number;
  };
  bars: ChartBar[];
};

export type FetchTickerIndicatorsParams = {
  ticker: string;
  timeframe: string;
  limit?: number;
  maFast?: number;
  maSlow?: number;
  maLong?: number;
};

export async function fetchTickerIndicators({
  ticker,
  timeframe,
  limit,
  maFast,
  maSlow,
  maLong,
}: FetchTickerIndicatorsParams): Promise<BarsIndicatorsResponse> {
  const params = new URLSearchParams({ ticker, timeframe });
  if (limit !== undefined) params.set("limit", `${limit}`);
  if (maFast !== undefined) params.set("maFast", `${maFast}`);
  if (maSlow !== undefined) params.set("maSlow", `${maSlow}`);
  if (maLong !== undefined) params.set("maLong", `${maLong}`);
  return getJson<BarsIndicatorsResponse>(`/api/bars/indicators?${params.toString()}`);
}
