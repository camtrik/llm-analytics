"use client";

import { useEffect, useMemo, useState } from "react";
import RangeSwitcherChart from "./RangeSwitcherChart";

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
  dataset: {
    source: string;
    rowCount: number;
    minDatetime: number | null;
    maxDatetime: number | null;
  };
};

type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type BarsBatchResponse = {
  timeframe: string;
  series: Record<string, Bar[]>;
};

async function safeParseError(res: Response) {
  try {
    const payload = await res.json();
    if (payload?.message) {
      return `${payload.message} (${res.status})`;
    }
  } catch {
    // Ignore JSON parsing errors.
  }
  return `请求失败 (${res.status})`;
}

function formatTimestamp(ts: number | null) {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function formatTickerLabel(ticker: string, info?: Record<string, string>) {
  const name = info?.[ticker];
  return name ? `${ticker} (${name})` : ticker;
}

export default function DisplayPage() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [activeTimeframe, setActiveTimeframe] = useState("");
  const [barsByTicker, setBarsByTicker] = useState<
    Record<string, Record<string, Bar[]>>
  >({});
  const [activeTicker, setActiveTicker] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setOptionsLoading(true);
        const res = await fetch(`${apiBase}/api/options`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`加载选项失败 (${res.status})`);
        }
        const data = (await res.json()) as OptionsResponse;
        setOptions(data);
        if (data.tickers.length) {
          setSelectedTickers([data.tickers[0]]);
          setActiveTicker(data.tickers[0]);
        }
        if (data.timeframes.length) {
          setActiveTimeframe(data.timeframes[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载选项失败。");
      } finally {
        setOptionsLoading(false);
      }
    };
    fetchOptions();
  }, [apiBase]);

  const filteredTickers = useMemo(() => {
    if (!options) return [];
    const query = search.trim().toLowerCase();
    if (!query) return options.tickers;
    return options.tickers.filter((ticker) => {
      const name = options.tickerInfo?.[ticker] ?? "";
      return (
        ticker.toLowerCase().includes(query) ||
        name.toLowerCase().includes(query)
      );
    });
  }, [options, search]);

  const toggleTicker = (ticker: string) => {
    setSelectedTickers((prev) => {
      if (prev.includes(ticker)) {
        const next = prev.filter((item) => item !== ticker);
        if (activeTicker === ticker && next.length) {
          setActiveTicker(next[0]);
        }
        return next;
      }
      if (!prev.length) {
        setActiveTicker(ticker);
      }
      return [...prev, ticker];
    });
  };

  const loadBars = async () => {
    if (selectedTickers.length === 0) {
      setError("请选择至少一个 ticker。");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const refreshRes = await fetch(`${apiBase}/api/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: selectedTickers }),
      });
      if (!refreshRes.ok) {
        const detail = await safeParseError(refreshRes);
        throw new Error(detail);
      }
      const refreshStats = (await refreshRes.json()) as {
        rowCount: number;
        minDatetime: number | null;
        maxDatetime: number | null;
      };
      setOptions((prev) =>
        prev
          ? {
              ...prev,
              dataset: {
                ...prev.dataset,
                rowCount: refreshStats.rowCount,
                minDatetime: refreshStats.minDatetime,
                maxDatetime: refreshStats.maxDatetime,
              },
            }
          : prev
      );

      if (!options) {
        throw new Error("选项尚未加载完成。");
      }

      const timeframes = options.timeframes;
      const responses = await Promise.all(
        timeframes.map(async (timeframe) => {
          const res = await fetch(`${apiBase}/api/bars/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tickers: selectedTickers,
              timeframe,
            }),
          });
          if (!res.ok) {
            const detail = await safeParseError(res);
            throw new Error(detail);
          }
          const data = (await res.json()) as BarsBatchResponse;
          return { timeframe: data.timeframe, series: data.series };
        })
      );

      const nextBars: Record<string, Record<string, Bar[]>> = {};
      responses.forEach(({ timeframe, series }) => {
        Object.entries(series).forEach(([ticker, bars]) => {
          if (!nextBars[ticker]) {
            nextBars[ticker] = {};
          }
          nextBars[ticker][timeframe] = bars;
        });
      });

      setBarsByTicker(nextBars);
      setActiveTicker(selectedTickers[0]);
      if (timeframes.length) {
        setActiveTimeframe(timeframes[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败。");
    } finally {
      setLoading(false);
    }
  };

  const activeBars =
    activeTicker && activeTimeframe
      ? barsByTicker[activeTicker]?.[activeTimeframe] || []
      : [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 lg:flex-row">
        <aside className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:max-w-xs">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Display Data</h1>
            <span className="text-xs text-slate-500">MVP</span>
          </div>

          <div className="mt-6">
            <label className="text-sm font-medium text-slate-700">Tickers</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 ticker"
              disabled={!options || optionsLoading}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <p className="mt-2 text-xs text-slate-500">
              在上方输入关键字过滤列表，下方勾选 ticker。
            </p>
            <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2">
              {optionsLoading ? (
                <div className="text-xs text-slate-400">加载中...</div>
              ) : options ? (
                <>
                  {filteredTickers.map((ticker) => (
                    <label
                      key={ticker}
                      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTickers.includes(ticker)}
                        onChange={() => toggleTicker(ticker)}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span>{formatTickerLabel(ticker, options.tickerInfo)}</span>
                    </label>
                  ))}
                  {!filteredTickers.length && (
                    <div className="text-xs text-slate-400">无匹配 ticker</div>
                  )}
                </>
              ) : (
                <div className="text-xs text-rose-400">未加载到 ticker 列表</div>
              )}
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (options) {
                    setSelectedTickers(options.tickers.slice(0, 10));
                    setActiveTicker(options.tickers[0] || "");
                  }
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:border-slate-300"
              >
                选前 10
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTickers([]);
                  setActiveTicker("");
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:border-slate-300"
              >
                清空
              </button>
            </div>
          </div>

          <div className="mt-6">
            <label className="text-sm font-medium text-slate-700">Timeframes</label>
            <p className="mt-2 text-xs text-slate-500">
              由后端配置控制，点击 Load 会一次性拉取全部 timeframe 数据。
            </p>
          </div>

          <button
            type="button"
            onClick={loadBars}
            disabled={loading || optionsLoading || !options}
            className="mt-6 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "加载中..." : "Load"}
          </button>

          {error && <p className="mt-4 text-xs text-rose-500">{error}</p>}

          {options && (
            <div className="mt-6 text-xs text-slate-400">
              <div>Rows: {options.dataset.rowCount}</div>
              <div>Min: {formatTimestamp(options.dataset.minDatetime)}</div>
              <div>Max: {formatTimestamp(options.dataset.maxDatetime)}</div>
            </div>
          )}
        </aside>

        <main className="flex-1 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Charts</h2>
              <p className="text-xs text-slate-500">
            {activeTimeframe
              ? `Timeframe: ${activeTimeframe}`
              : "请选择 timeframe"}
          </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedTickers.map((ticker) => (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => setActiveTicker(ticker)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    activeTicker === ticker
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  {formatTickerLabel(ticker, options?.tickerInfo)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            {activeTicker ? (
              activeBars.length ? (
                <RangeSwitcherChart
                  seriesByTimeframe={barsByTicker[activeTicker] || {}}
                  timeframes={options?.timeframes || []}
                  activeTimeframe={activeTimeframe}
                  onTimeframeChange={setActiveTimeframe}
                />
              ) : (
                <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                  暂无数据，点击 Load 拉取。
                </div>
              )
            ) : (
              <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                请选择 ticker 进行查看。
              </div>
            )}
          </div>

          {activeTicker && (
            <div className="mt-4 text-xs text-slate-500">
              {activeBars.length
                ? `${formatTickerLabel(
                    activeTicker,
                    options?.tickerInfo
                  )} 共 ${activeBars.length} 根K线，范围 ${formatTimestamp(
                    activeBars[0]?.t ?? null
                  )} ~ ${formatTimestamp(
                    activeBars[activeBars.length - 1]?.t ?? null
                  )}`
                : `${formatTickerLabel(
                    activeTicker,
                    options?.tickerInfo
                  )} 在该 timeframe 下无数据`}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
