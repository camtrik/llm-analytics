"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  const chartApiRef = useRef<{ fitContent: () => void } | null>(null);

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
  const prev = bars.at(-2);
  const change = latest && prev ? ((latest.c - prev.c) / prev.c) * 100 : null;
  const displayBar = hoverData ?? latest;

  const handleReset = useCallback(() => {
    chartApiRef.current?.fitContent();
  }, []);

  const chartReady = useCallback((api: { fitContent: () => void }) => {
    chartApiRef.current = api;
  }, []);

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
              <Button variant="outline" size="sm" onClick={handleReset}>
                {t("ticker.resetView", "Reset view")}
              </Button>
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
              onReady={chartReady}
            />
          ) : (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              {t("ticker.none", "No data")}
            </div>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.latestDate", "Latest Date")}</span>
              <span className="font-medium">
                {displayBar ? formatDate(displayBar.t, locale) : t("ticker.none", "No data")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.open", "Open")}</span>
              <span className="font-medium">{formatNumber(displayBar?.o, locale, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.high", "High")}</span>
              <span className="font-medium">{formatNumber(displayBar?.h, locale, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.low", "Low")}</span>
              <span className="font-medium">{formatNumber(displayBar?.l, locale, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.close", "Close")}</span>
              <span className="font-medium">{formatNumber(displayBar?.c, locale, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("ticker.volume", "Volume")}</span>
              <span className="font-medium">{formatNumber(displayBar?.v, locale)}</span>
            </div>
            {indicatorState.maFast ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("ticker.maFast", "MA Fast")}</span>
                <span className="font-medium">{formatNumber(displayBar?.maFast, locale, { minimumFractionDigits: 2 })}</span>
              </div>
            ) : null}
            {indicatorState.maSlow ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("ticker.maSlow", "MA Slow")}</span>
                <span className="font-medium">{formatNumber(displayBar?.maSlow, locale, { minimumFractionDigits: 2 })}</span>
              </div>
            ) : null}
            {indicatorState.maLong ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("ticker.maLong", "MA Long")}</span>
                <span className="font-medium">{formatNumber(displayBar?.maLong, locale, { minimumFractionDigits: 2 })}</span>
              </div>
            ) : null}
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
  onReady?: (api: { fitContent: () => void }) => void;
};

function resolveColor(variable: string, fallback: string) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (!raw) return fallback;
  const normalized = normalizeColor(raw);
  if (normalized) return normalized;
  const normalizedHsl = normalizeColor(`hsl(${raw})`);
  return normalizedHsl ?? fallback;
}

function normalizeColor(value: string): string | null {
  if (!value) return null;
  const el = document.createElement("span");
  el.style.color = value;
  if (!el.style.color) return null;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  if (!computed) return null;
  const lowered = computed.toLowerCase();
  if (lowered.startsWith("lab(") || lowered.startsWith("oklab(") || lowered.startsWith("lch(") || lowered.startsWith("oklch(")) {
    return null;
  }
  if (lowered.startsWith("rgb") || lowered.startsWith("hsl") || lowered.startsWith("#")) {
    return computed;
  }
  return null;
}

export function TickerChartView({ data, chartType, indicators, onHover, onReady }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maFastSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maSlowSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maLongSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hoverCallbackRef = useRef(onHover);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverPendingRef = useRef<HoverPayload | null>(null);
  const barMapRef = useRef<Map<number, ChartBar>>(new Map());
  const paletteRef = useRef<{ up: string; down: string }>({ up: "#22c55e", down: "#ef4444" });

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

    const upColor = resolveColor("--chart-1", "#22c55e");
    const downColor = resolveColor("--destructive", "#ef4444");
    const lineColor = resolveColor("--primary", "#0ea5e9");
    const gridColor = resolveColor("--border", "#e5e7eb");
    const textColor = resolveColor("--muted-foreground", "#6b7280");
    const maFastColor = resolveColor("--chart-2", "#f59e0b");
    const maSlowColor = resolveColor("--chart-3", "#8b5cf6");
    const maLongColor = resolveColor("--chart-4", "#10b981");

    paletteRef.current = { up: upColor, down: downColor };

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (price) => price.toFixed(2) },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
      borderVisible: false,
    });
    const lineSeries = chart.addSeries(LineSeries, {
      color: lineColor,
      lineWidth: 2,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: upColor,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const maFastSeries = chart.addSeries(LineSeries, {
      color: maFastColor,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const maSlowSeries = chart.addSeries(LineSeries, {
      color: maSlowColor,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const maLongSeries = chart.addSeries(LineSeries, {
      color: maLongColor,
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

    onReady?.({ fitContent: () => chart.timeScale().fitContent() });

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

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      resizeObserver.disconnect();
      chart.remove();
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, [onReady]);

  useEffect(() => {
    candleSeriesRef.current?.setData(candleData);
    lineSeriesRef.current?.setData(lineData);
    const palette = paletteRef.current;
    const volumeData: HistogramData[] = data.map((bar) => ({
      time: bar.t as UTCTimestamp,
      value: bar.v,
      color: bar.c >= bar.o ? palette.up : palette.down,
    }));
    volumeSeriesRef.current?.setData(volumeData);
    maFastSeriesRef.current?.setData(maFastData);
    maSlowSeriesRef.current?.setData(maSlowData);
    maLongSeriesRef.current?.setData(maLongData);
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
