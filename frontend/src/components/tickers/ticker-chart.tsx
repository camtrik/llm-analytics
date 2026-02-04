"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  HistogramSeries,
  type LineData,
  LineSeries,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { fetchTickerIndicators, type BarsIndicatorsResponse, type ChartBar } from "@/lib/api/bars";
import { formatTimeframeLabel, sortTimeframes } from "@/lib/timeframe";
import { cn } from "@/lib/utils";

export type ChartType = "candle" | "line";

type IndicatorKey = "maFast" | "maSlow" | "maLong";

type IndicatorState = Record<IndicatorKey, boolean>;

type HoverPayload = {
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

export type TickerChartSectionProps = {
  symbol: string;
  timeframes: string[];
  defaultTimeframe?: string;
  className?: string;
};

export function TickerChartSection({
  symbol,
  timeframes,
  defaultTimeframe,
  className,
}: TickerChartSectionProps) {
  const { t, locale } = useI18n();
  const sortedTimeframes = useMemo(() => sortTimeframes(timeframes), [timeframes]);
  const initialTimeframe =
    defaultTimeframe && timeframes.includes(defaultTimeframe)
      ? defaultTimeframe
      : sortedTimeframes[0] ?? "6M_1d";
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [indicatorKeys, setIndicatorKeys] = useState<IndicatorKey[]>(["maFast", "maSlow", "maLong"]);
  const [hoverData, setHoverData] = useState<HoverPayload | null>(null);

  const activeTimeframe = timeframes.includes(timeframe) ? timeframe : initialTimeframe;

  useEffect(() => {
    setHoverData(null);
  }, [activeTimeframe]);

  const { data, isLoading, isFetching, isError, error } = useQuery<BarsIndicatorsResponse>({
    queryKey: ["ticker-chart", symbol, activeTimeframe],
    queryFn: () => fetchTickerIndicators({ ticker: symbol, timeframe: activeTimeframe }),
    placeholderData: (previous) => previous,
  });

  const indicatorState = useMemo<IndicatorState>(
    () => ({
      maFast: indicatorKeys.includes("maFast"),
      maSlow: indicatorKeys.includes("maSlow"),
      maLong: indicatorKeys.includes("maLong"),
    }),
    [indicatorKeys],
  );

  const bars = data?.bars ?? [];
  const latest = bars.at(-1);
  const first = bars.at(0);
  const change = latest && first ? ((latest.c - first.c) / first.c) * 100 : null;
  const displayBar = hoverData ?? latest;

  return (
    <>
      <Card className={cn("lg:col-span-2 border-0 bg-transparent shadow-none", className)}>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{t("ticker.chartTitle", "Price Chart")}</CardTitle>
              <CardDescription>
                {t("ticker.latestCount", "Latest {count} bars")?.replace("{count}", `${bars.length}`) ??
                  `Latest ${bars.length} bars`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {change !== null && (
                <Badge variant={change >= 0 ? "default" : "destructive"}>
                  {change >= 0 ? "+" : ""}
                  {formatPercent(change / 100, locale)}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto pb-1">
              <ToggleGroup
                type="single"
                size="sm"
                value={activeTimeframe}
                onValueChange={(value) => value && setTimeframe(value)}
                className="w-max"
              >
                {sortedTimeframes.map((tf) => (
                  <ToggleGroupItem key={tf} value={tf} aria-label={tf}>
                    {formatTimeframeLabel(tf)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <ToggleGroup
              type="single"
              size="sm"
              value={chartType}
              onValueChange={(value) => value && setChartType(value as ChartType)}
            >
              <ToggleGroupItem value="candle" aria-label={t("ticker.chartTypeCandle", "Candle")}>
                {t("ticker.chartTypeCandle", "Candle")}
              </ToggleGroupItem>
              <ToggleGroupItem value="line" aria-label={t("ticker.chartTypeLine", "Line")}>
                {t("ticker.chartTypeLine", "Line")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">{t("ticker.indicators", "Indicators")}</span>
            <ToggleGroup
              type="multiple"
              size="sm"
              value={indicatorKeys}
              onValueChange={(value) => setIndicatorKeys(value as IndicatorKey[])}
            >
              <ToggleGroupItem value="maFast" aria-label={t("ticker.maFast", "MA Fast")}>
                {t("ticker.maFast", "MA Fast")}
              </ToggleGroupItem>
              <ToggleGroupItem value="maSlow" aria-label={t("ticker.maSlow", "MA Slow")}>
                {t("ticker.maSlow", "MA Slow")}
              </ToggleGroupItem>
              <ToggleGroupItem value="maLong" aria-label={t("ticker.maLong", "MA Long")}>
                {t("ticker.maLong", "MA Long")}
              </ToggleGroupItem>
            </ToggleGroup>
            {isFetching && !isLoading ? (
              <span className="text-muted-foreground text-xs">{t("ticker.loading", "Loading...")}</span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : isError ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              {(error as Error)?.message ?? "Failed to load"}
            </div>
          ) : bars.length ? (
            <TickerChartView
              data={bars}
              chartType={chartType}
              indicators={indicatorState}
              onHover={setHoverData}
            />
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              {t("ticker.none", "No data")}
            </div>
          )}

          <div className="space-y-3">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.open", "Open")}</div>
                <div className="text-base font-semibold tracking-tight">
                  {formatNumber(displayBar?.o, locale, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.high", "High")}</div>
                <div className="text-base font-semibold tracking-tight">
                  {formatNumber(displayBar?.h, locale, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.low", "Low")}</div>
                <div className="text-base font-semibold tracking-tight">
                  {formatNumber(displayBar?.l, locale, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.close", "Close")}</div>
                <div className="text-base font-semibold tracking-tight">
                  {formatNumber(displayBar?.c, locale, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.volume", "Volume")}</div>
                <div className="text-base font-semibold tracking-tight">{formatNumber(displayBar?.v, locale)}</div>
              </div>
              {indicatorState.maFast ? (
                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.maFast", "MA Fast")}</div>
                  <div className="text-base font-semibold tracking-tight">
                    {formatNumber(displayBar?.maFast, locale, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ) : null}
              {indicatorState.maSlow ? (
                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.maSlow", "MA Slow")}</div>
                  <div className="text-base font-semibold tracking-tight">
                    {formatNumber(displayBar?.maSlow, locale, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ) : null}
              {indicatorState.maLong ? (
                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-xs tracking-wide">{t("ticker.maLong", "MA Long")}</div>
                  <div className="text-base font-semibold tracking-tight">
                    {formatNumber(displayBar?.maLong, locale, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("ticker.overview", "Overview")}</CardTitle>
          <CardDescription>{t("ticker.fromCache", "From cached data")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("ticker.latestClose", "Latest Close")}</span>
            <span className="font-medium">{formatNumber(latest?.c, locale, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("ticker.latestDate", "Latest Date")}</span>
            <span className="font-medium">{formatDate(latest?.t, locale)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("ticker.count", "Bars Count")}</span>
            <span className="font-medium">{bars.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("ticker.chartType", "Chart Type")}</span>
            <span className="font-medium">
              {chartType === "candle"
                ? t("ticker.chartTypeCandle", "Candle")
                : t("ticker.chartTypeLine", "Line")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("ticker.timeframe", "Timeframe")}</span>
            <span className="font-medium">{formatTimeframeLabel(activeTimeframe)}</span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

type ChartViewProps = {
  data: ChartBar[];
  chartType: ChartType;
  indicators: IndicatorState;
  onHover?: (payload: HoverPayload | null) => void;
};

function readCssVar(name: string) {
  const fallback = "rgba(0, 0, 0, 1)";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

type ChartTheme = {
  up: string;
  down: string;
  line: string;
  lineTop: string;
  lineBottom: string;
  volume: string;
  grid: string;
  text: string;
  maFast: string;
  maSlow: string;
  maLong: string;
};

function readChartTheme(): ChartTheme {
  return {
    up: readCssVar("--chart-up"),
    down: readCssVar("--chart-down"),
    line: readCssVar("--chart-line"),
    lineTop: readCssVar("--chart-line-top"),
    lineBottom: readCssVar("--chart-line-bottom"),
    volume: readCssVar("--chart-volume"),
    grid: readCssVar("--chart-grid"),
    text: readCssVar("--chart-text"),
    maFast: readCssVar("--chart-ma-fast"),
    maSlow: readCssVar("--chart-ma-slow"),
    maLong: readCssVar("--chart-ma-long"),
  };
}

function TickerChartView({ data, chartType, indicators, onHover }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maFastSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maSlowSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maLongSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hoverCallbackRef = useRef(onHover);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<HoverPayload | null>(null);
  const barMapRef = useRef<Map<number, ChartBar>>(new Map());
  const applyColorsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    hoverCallbackRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    barMapRef.current = new Map(data.map((bar) => [bar.t, bar]));
  }, [data]);

  const candleData = useMemo<CandlestickData[]>(
    () =>
      data.map((bar) => ({
        time: bar.t as UTCTimestamp,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      })),
    [data],
  );

  const lineData = useMemo<LineData[]>(
    () =>
      data.map((bar) => ({
        time: bar.t as UTCTimestamp,
        value: bar.c,
      })),
    [data],
  );

  const maFastData = useMemo<LineData[]>(
    () =>
      data
        .filter((bar) => typeof bar.maFast === "number")
        .map((bar) => ({ time: bar.t as UTCTimestamp, value: bar.maFast as number })),
    [data],
  );

  const maSlowData = useMemo<LineData[]>(
    () =>
      data
        .filter((bar) => typeof bar.maSlow === "number")
        .map((bar) => ({ time: bar.t as UTCTimestamp, value: bar.maSlow as number })),
    [data],
  );

  const maLongData = useMemo<LineData[]>(
    () =>
      data
        .filter((bar) => typeof bar.maLong === "number")
        .map((bar) => ({ time: bar.t as UTCTimestamp, value: bar.maLong as number })),
    [data],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = readChartTheme();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: theme.text,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false,
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (price) => price.toFixed(2) },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      borderVisible: false,
    });
    const lineSeries = chart.addSeries(AreaSeries, {
      lineColor: theme.line,
      lineWidth: 2,
      topColor: theme.lineTop,
      bottomColor: theme.lineBottom,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: theme.volume,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const maFastSeries = chart.addSeries(LineSeries, {
      color: theme.maFast,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const maSlowSeries = chart.addSeries(LineSeries, {
      color: theme.maSlow,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const maLongSeries = chart.addSeries(LineSeries, {
      color: theme.maLong,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    maFastSeriesRef.current = maFastSeries;
    maSlowSeriesRef.current = maSlowSeries;
    maLongSeriesRef.current = maLongSeries;

    const applyTheme = (next: ChartTheme) => {
      chart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: next.text,
        },
        grid: {
          vertLines: { visible: false, color: next.grid },
          horzLines: { visible: false, color: next.grid },
        },
      });

      candleSeries.applyOptions({
        upColor: next.up,
        downColor: next.down,
        wickUpColor: next.up,
        wickDownColor: next.down,
      });
      lineSeries.applyOptions({
        lineColor: next.line,
        topColor: next.lineTop,
        bottomColor: next.lineBottom,
      });
      volumeSeries.applyOptions({ color: next.volume });
      maFastSeries.applyOptions({ color: next.maFast });
      maSlowSeries.applyOptions({ color: next.maSlow });
      maLongSeries.applyOptions({ color: next.maLong });

    };

    applyColorsRef.current = () => {
      applyTheme(readChartTheme());
    };

    const scheduleHover = (payload: HoverPayload | null) => {
      hoverPendingRef.current = payload;
      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        hoverCallbackRef.current?.(hoverPendingRef.current);
      });
    };

    const handleCrosshair = (param: MouseEventParams) => {
      if (!param?.time || typeof param.time !== "number") {
        scheduleHover(null);
        return;
      }
      const bar = barMapRef.current.get(param.time);
      if (!bar) {
        scheduleHover(null);
        return;
      }
      scheduleHover({
        t: bar.t,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        maFast: bar.maFast,
        maSlow: bar.maSlow,
        maLong: bar.maLong,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshair);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width && entry.contentRect.height) {
          chart.applyOptions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    const observer = new MutationObserver(() => {
      applyColorsRef.current?.();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme-preset"],
    });

    applyColorsRef.current?.();

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      resizeObserver.disconnect();
      observer.disconnect();
      chart.remove();
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.setData(candleData);
    lineSeriesRef.current?.setData(lineData);
    const volumeData: HistogramData[] = data.map((bar) => ({
      time: bar.t as UTCTimestamp,
      value: bar.v,
    }));
    volumeSeriesRef.current?.setData(volumeData);
    maFastSeriesRef.current?.setData(maFastData);
    maSlowSeriesRef.current?.setData(maSlowData);
    maLongSeriesRef.current?.setData(maLongData);
    chartRef.current?.timeScale().fitContent();
    applyColorsRef.current?.();
  }, [candleData, lineData, data, maFastData, maSlowData, maLongData]);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === "candle" });
    lineSeriesRef.current?.applyOptions({ visible: chartType === "line" });
  }, [chartType]);

  useEffect(() => {
    maFastSeriesRef.current?.applyOptions({ visible: indicators.maFast });
    maSlowSeriesRef.current?.applyOptions({ visible: indicators.maSlow });
    maLongSeriesRef.current?.applyOptions({ visible: indicators.maLong });
  }, [indicators]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
