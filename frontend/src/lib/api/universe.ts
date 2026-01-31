import { getJson } from "@/lib/api";

export type UniverseResponse = {
  tickers: string[];
  watchlist: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

export async function fetchUniverse(): Promise<UniverseResponse> {
  return getJson<UniverseResponse>("/api/universe");
}
