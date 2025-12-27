"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

const palette = [
  "#2962FF",
  "rgb(225, 87, 90)",
  "rgb(242, 142, 44)",
  "rgb(164, 89, 209)",
];

type RangeSwitcherChartProps = {
  seriesByTimeframe: Record<string, Bar[]>;
  timeframes: string[];
  activeTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
};

function formatTimeframeLabel(timeframe: string) {
  const parts = timeframe.split("_");
  return parts[0] || timeframe;
}

function getIntervalToken(timeframe: string) {
  const parts = timeframe.split("_");
  return parts[1] || "";
}

function isIntradayInterval(interval: string) {
  return interval.endsWith("m") || interval.endsWith("h");
}

function parsePeriod(timeframe: string) {
  const prefix = timeframe.split("_")[0] || "";
  const match = prefix.match(/^(\d+)([DMY])$/i);
  if (!match) return null;
  return { count: Number(match[1]), unit: match[2].toUpperCase() };
}

export default function RangeSwitcherChart({
  seriesByTimeframe,
  timeframes,
  activeTimeframe,
  onTimeframeChange,
}: RangeSwitcherChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const baseData = useMemo(() => {
    const bars = seriesByTimeframe[activeTimeframe] ?? [];
    const sorted = [...bars].sort((a, b) => a.t - b.t);
    return sorted.map((bar) => ({
      time: bar.t as UTCTimestamp,
      value: bar.c,
    }));
  }, [seriesByTimeframe, activeTimeframe]);

  const colorByTimeframe = useMemo(() => {
    const mapping: Record<string, string> = {};
    timeframes.forEach((timeframe, index) => {
      mapping[timeframe] = palette[index % palette.length];
    });
    return mapping;
  }, [timeframes]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 600,
      height: 320,
      layout: {
        textColor: "#0f172a",
        background: { type: ColorType.Solid, color: "#ffffff" },
      },
      rightPriceScale: {
        borderColor: "#e2e8f0",
      },
      timeScale: {
        borderColor: "#e2e8f0",
      },
      grid: {
        horzLines: { color: "#f1f5f9" },
        vertLines: { color: "#f1f5f9" },
      },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: colorByTimeframe[activeTimeframe] ?? palette[0],
      lineWidth: 2,
    });

    chartRef.current = chart;
    lineSeriesRef.current = lineSeries;

    const resize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: 320,
      });
    };

    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!lineSeriesRef.current || !chartRef.current) return;
    lineSeriesRef.current.setData(baseData);
    lineSeriesRef.current.applyOptions({
      color: colorByTimeframe[activeTimeframe] ?? palette[0],
    });
    const interval = getIntervalToken(activeTimeframe);
    const intraday = isIntradayInterval(interval);
    const period = parsePeriod(activeTimeframe);
    chartRef.current.applyOptions({
      timeScale: {
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkFormatter: (time) => {
          const ts = typeof time === "number" ? time : undefined;
          if (!ts) return "";
          const date = new Date(ts * 1000);
          if (intraday && period && period.unit === "D" && period.count <= 1) {
            return date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
          }
          if (period?.unit === "M" && period.count > 1) {
            return date.toLocaleDateString([], {
              year: "numeric",
              month: "2-digit",
            });
          }
          if (period?.unit === "Y") {
            return date.toLocaleDateString([], { year: "numeric" });
          }
          return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
        },
      },
    });
    chartRef.current.timeScale().fitContent();
  }, [activeTimeframe, baseData, colorByTimeframe]);

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="h-[320px] w-full" />
      <div className="flex flex-wrap gap-2">
        {timeframes.map((timeframe) => (
          <button
            key={timeframe}
            type="button"
            onClick={() => onTimeframeChange(timeframe)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              activeTimeframe === timeframe
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {formatTimeframeLabel(timeframe)}
          </button>
        ))}
      </div>
    </div>
  );
}
