export type ScreenerParams = {
  timeframe: string;
  volRatioMax: string;
  minBodyPct: string;
  recentBars: string;
  onlyTriggered: "1" | "0";
};

export const preferredTimeframe = "6M_1d";

export const SCREENER_DEFAULT_PARAMS: ScreenerParams = {
  timeframe: "",
  volRatioMax: "0.5",
  minBodyPct: "0.002",
  recentBars: "3",
  onlyTriggered: "1",
};

export const normalizeScreenerParams = (params: ScreenerParams): ScreenerParams => ({
  ...SCREENER_DEFAULT_PARAMS,
  ...params,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? SCREENER_DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? SCREENER_DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
  recentBars: Number.isNaN(parseInt(params.recentBars, 10)) ? SCREENER_DEFAULT_PARAMS.recentBars : params.recentBars,
  onlyTriggered: params.onlyTriggered === "0" ? "0" : "1",
});

export const parseScreenerSearchParams = (searchParams: URLSearchParams): ScreenerParams =>
  normalizeScreenerParams({
    timeframe: searchParams.get("timeframe") || SCREENER_DEFAULT_PARAMS.timeframe,
    volRatioMax: searchParams.get("volRatioMax") || SCREENER_DEFAULT_PARAMS.volRatioMax,
    minBodyPct: searchParams.get("minBodyPct") || SCREENER_DEFAULT_PARAMS.minBodyPct,
    recentBars: searchParams.get("recentBars") || SCREENER_DEFAULT_PARAMS.recentBars,
    onlyTriggered: (searchParams.get("onlyTriggered") as ScreenerParams["onlyTriggered"]) || SCREENER_DEFAULT_PARAMS.onlyTriggered,
  });
