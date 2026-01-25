export type RangeParams = {
  timeframe: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  horizonBars: string;
  entryExecution: "close" | "next_open";
  volRatioMax: string;
  minBodyPct: string;
};

const preferredTimeframe = "6M_1d";

const defaultStartDate = () => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const defaultEndDate = () => new Date().toISOString().slice(0, 10);

export const RANGE_DEFAULT_PARAMS: RangeParams = {
  timeframe: "",
  startDate: defaultStartDate(),
  endDate: defaultEndDate(),
  horizonBars: "5",
  entryExecution: "close",
  volRatioMax: "0.5",
  minBodyPct: "0.002",
};

export const normalizeRangeParams = (params: RangeParams): RangeParams => ({
  ...RANGE_DEFAULT_PARAMS,
  ...params,
  horizonBars: Number.isNaN(parseInt(params.horizonBars, 10)) ? RANGE_DEFAULT_PARAMS.horizonBars : params.horizonBars,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? RANGE_DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? RANGE_DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
  entryExecution: params.entryExecution === "next_open" ? "next_open" : "close",
});

export const parseRangeSearchParams = (searchParams: URLSearchParams): RangeParams =>
  normalizeRangeParams({
    timeframe: searchParams.get("timeframe") || RANGE_DEFAULT_PARAMS.timeframe,
    startDate: searchParams.get("startDate") || RANGE_DEFAULT_PARAMS.startDate,
    endDate: searchParams.get("endDate") || RANGE_DEFAULT_PARAMS.endDate,
    horizonBars: searchParams.get("horizonBars") || RANGE_DEFAULT_PARAMS.horizonBars,
    entryExecution:
      (searchParams.get("entryExecution") as RangeParams["entryExecution"]) || RANGE_DEFAULT_PARAMS.entryExecution,
    volRatioMax: searchParams.get("volRatioMax") || RANGE_DEFAULT_PARAMS.volRatioMax,
    minBodyPct: searchParams.get("minBodyPct") || RANGE_DEFAULT_PARAMS.minBodyPct,
  });

export { preferredTimeframe, defaultStartDate, defaultEndDate };
