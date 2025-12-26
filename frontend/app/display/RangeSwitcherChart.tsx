"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const intervalOptions = [
  { key: "ALL", seconds: null as number | null },
  { key: "1D", seconds: 60 * 60 * 24 },
  { key: "1W", seconds: 60 * 60 * 24 * 7 },
  { key: "1M", seconds: 60 * 60 * 24 * 30 },
  { key: "1Y", seconds: 60 * 60 * 24 * 365 },
];

const intervalColors: Record<string, string> = {
  ALL: "#0f172a",
  "1D": "#2962FF",
  "1W": "rgb(225, 87, 90)",
  "1M": "rgb(242, 142, 44)",
  "1Y": "rgb(164, 89, 209)",
};

export default function RangeSwitcherChart({ bars }: { bars: Bar[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [activeInterval, setActiveInterval] = useState("ALL");

  const baseData = useMemo(() => {
    const sorted = [...bars].sort((a, b) => a.t - b.t);
    return sorted.map((bar) => ({
      time: bar.t as UTCTimestamp,
      value: bar.c,
    }));
  }, [bars]);

  const seriesDataByInterval = useMemo(() => {
    if (!baseData.length) {
      return new Map<string, typeof baseData>();
    }
    const endTime = baseData[baseData.length - 1].time as number;
    const map = new Map<string, typeof baseData>();
    intervalOptions.forEach((interval) => {
      if (!interval.seconds) {
        map.set(interval.key, baseData);
        return;
      }
      const startTime = endTime - interval.seconds;
      const filtered = baseData.filter((point) => point.time >= startTime);
      map.set(interval.key, filtered.length >= 2 ? filtered : baseData);
    });
    return map;
  }, [baseData]);

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
      color: intervalColors[activeInterval] ?? "#2962FF",
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
    setActiveInterval("ALL");
  }, [bars]);

  useEffect(() => {
    if (!lineSeriesRef.current || !chartRef.current) return;
    const data = seriesDataByInterval.get(activeInterval) ?? baseData;
    lineSeriesRef.current.setData(data);
    lineSeriesRef.current.applyOptions({
      color: intervalColors[activeInterval] ?? "#2962FF",
    });
    chartRef.current.timeScale().fitContent();
  }, [activeInterval, baseData, seriesDataByInterval]);

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="h-[320px] w-full" />
      <div className="flex flex-wrap gap-2">
        {intervalOptions.map((interval) => (
          <button
            key={interval.key}
            type="button"
            onClick={() => setActiveInterval(interval.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              activeInterval === interval.key
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {interval.key}
          </button>
        ))}
      </div>
    </div>
  );
}
