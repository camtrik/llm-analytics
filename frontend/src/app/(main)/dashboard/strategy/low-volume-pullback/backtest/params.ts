export type BacktestParams = {
  timeframe: string;
  asOfDate: string; // YYYY-MM-DD
  horizonBars: string;
  entryExecution: "close" | "next_open";
  volRatioMax: string;
  minBodyPct: string;
  onlyTriggered: "1" | "0";
};

export const preferredTimeframe = "6M_1d";
const defaultAsOfDate = () => new Date().toISOString().slice(0, 10);

export const BACKTEST_DEFAULT_PARAMS: BacktestParams = {
  timeframe: "",
  asOfDate: defaultAsOfDate(),
  horizonBars: "5",
  entryExecution: "close",
  volRatioMax: "0.5",
  minBodyPct: "0.002",
  onlyTriggered: "1",
};

export const normalizeBacktestParams = (params: BacktestParams): BacktestParams => ({
  ...BACKTEST_DEFAULT_PARAMS,
  ...params,
  horizonBars: Number.isNaN(parseInt(params.horizonBars, 10))
    ? BACKTEST_DEFAULT_PARAMS.horizonBars
    : params.horizonBars,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? BACKTEST_DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? BACKTEST_DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
  entryExecution: params.entryExecution === "next_open" ? "next_open" : "close",
  onlyTriggered: params.onlyTriggered === "0" ? "0" : "1",
});

export const parseBacktestSearchParams = (searchParams: URLSearchParams): BacktestParams =>
  normalizeBacktestParams({
    timeframe: searchParams.get("timeframe") || BACKTEST_DEFAULT_PARAMS.timeframe,
    asOfDate: searchParams.get("asOfDate") || BACKTEST_DEFAULT_PARAMS.asOfDate,
    horizonBars: searchParams.get("horizonBars") || BACKTEST_DEFAULT_PARAMS.horizonBars,
    entryExecution:
      (searchParams.get("entryExecution") as BacktestParams["entryExecution"]) ||
      BACKTEST_DEFAULT_PARAMS.entryExecution,
    volRatioMax: searchParams.get("volRatioMax") || BACKTEST_DEFAULT_PARAMS.volRatioMax,
    minBodyPct: searchParams.get("minBodyPct") || BACKTEST_DEFAULT_PARAMS.minBodyPct,
    onlyTriggered: (searchParams.get("onlyTriggered") as BacktestParams["onlyTriggered"]) || BACKTEST_DEFAULT_PARAMS.onlyTriggered,
  });

export { defaultAsOfDate };
