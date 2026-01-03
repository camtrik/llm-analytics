"use client";

import { useEffect, useMemo, useState } from "react";
import RangeSwitcherChart from "./RangeSwitcherChart";
import JsonView from "@uiw/react-json-view";
import { githubLightTheme } from "@uiw/react-json-view/githubLight";

import { useRef } from "react";

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

type Bar = {
  time?: string;
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

type FeedBar = {
  time: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type Position = {
  ticker: string;
  qty: number;
  avg_cost?: number | null;
  currency?: string | null;
  market?: string | null;
  name?: string | null;
};

type ImportResult = {
  positions: Position[];
  importedAt: string;
  skipped: number;
};

type FeedResponse = {
  date: string;
  positions: Position[];
  tradableTickers: string[];
  ohlcv: Record<string, Record<string, FeedBar[]>>;
  meta: {
    source: string;
    generatedAt: string;
    version: string;
    timeframes: Record<
      string,
      {
        minTs: number | null;
        maxTs: number | null;
        barCount: number;
      }
    >;
  };
};

type ProviderInfo = {
  name: string;
  defaultModel: string;
  baseUrl: string;
  available: boolean;
};

type ProvidersResponse = {
  providers: ProviderInfo[];
  defaultProvider: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AnalysisAction = {
  ticker: string;
  action: "BUY" | "SELL" | "HOLD" | "REDUCE" | "INCREASE";
  timeframe: string;
  qty?: number | null;
  targetWeight?: number | null;
  deltaWeight?: number | null;
  rationale: string;
  risk?: string | null;
  confidence: number;
};

type AnalysisResult = {
  meta: {
    asOf: string;
    provider: string;
    model: string;
    promptVersion: string;
    feedMeta: Record<string, unknown>;
  };
  summary: string;
  actions: AnalysisAction[];
  doNotTradeIf: string[];
};

type AnalysisRunResponse = {
  id: number;
  result: AnalysisResult;
  raw?: string | null;
  messages?: ChatMessage[] | null;
  feed?: FeedResponse | null;
  constraints?: {
    cash?: number | null;
    maxOrders?: number;
    allowBuy?: boolean;
    allowSell?: boolean;
    allowShort?: boolean;
    lotSize?: number | null;
    feesBps?: number | null;
    slippageBps?: number | null;
    riskBudget?: number | null;
  } | null;
};

type AnalysisRecordResponse = {
  id: number;
  createdAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  error?: string | null;
  result?: AnalysisResult | null;
  raw?: string | null;
  messages?: ChatMessage[] | null;
};

type AnalysisHistoryItem = {
  id: number;
  createdAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  tickers: string[];
  summary?: string | null;
  status: string;
  error?: string | null;
};

type AnalysisHistoryResponse = {
  items: AnalysisHistoryItem[];
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

function formatIsoDatetime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function formatTickerLabel(ticker: string, info?: Record<string, string>) {
  const name = info?.[ticker];
  return name ? `${ticker} (${name})` : ticker;
}

function formatActionSize(action: AnalysisAction) {
  if (action.qty !== null && action.qty !== undefined) {
    return `${action.qty}`;
  }
  if (action.targetWeight !== null && action.targetWeight !== undefined) {
    return `${(action.targetWeight * 100).toFixed(2)}% target`;
  }
  if (action.deltaWeight !== null && action.deltaWeight !== undefined) {
    return `${(action.deltaWeight * 100).toFixed(2)}% change`;
  }
  return "-";
}

function formatConfidence(value: number) {
  if (Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function timeframeOrderValue(timeframe: string) {
  const prefix = timeframe.split("_")[0] || timeframe;
  const match = prefix.match(/^(\d+)([DMY])$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const count = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = unit === "D" ? 1 : unit === "M" ? 30 : 365;
  return count * multiplier;
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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisRaw, setAnalysisRaw] = useState<string | null>(null);
  const [analysisRunId, setAnalysisRunId] = useState<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [cashInput, setCashInput] = useState<string>("1000000");
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [analysisView, setAnalysisView] = useState<"result" | "history">("result");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

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
          const sorted = [...data.timeframes].sort(
            (a, b) => timeframeOrderValue(a) - timeframeOrderValue(b)
          );
          setActiveTimeframe(sorted[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载选项失败。");
      } finally {
        setOptionsLoading(false);
      }
    };
    fetchOptions();
  }, [apiBase]);

  useEffect(() => {
    fetchHistory();
  }, [apiBase]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setProvidersLoading(true);
        const res = await fetch(`${apiBase}/api/analysis/providers`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`加载 provider 失败 (${res.status})`);
        }
        const data = (await res.json()) as ProvidersResponse;
        setProviders(data.providers);
        const defaultName =
          data.defaultProvider || data.providers[0]?.name || "";
        setSelectedProvider(defaultName);
        setAnalysisError(null);
      } catch (err) {
        setAnalysisError(
          err instanceof Error ? err.message : "加载 provider 失败。"
        );
      } finally {
        setProvidersLoading(false);
      }
    };
    fetchProviders();
  }, [apiBase]);

  useEffect(() => {
    fetchHistory();
  }, [apiBase]);

  useEffect(() => {
    setCacheReady(false);
    setFeed(null);
    setFeedError(null);
    setAnalysisResult(null);
    setAnalysisRaw(null);
    setAnalysisRunId(null);
    setAnalysisError(null);
    setChatMessages([]);
    setChatInput("");
  }, [selectedTickers]);

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

  const sortedTimeframes = useMemo(() => {
    if (!options) return [];
    return [...options.timeframes].sort(
      (a, b) => timeframeOrderValue(a) - timeframeOrderValue(b)
    );
  }, [options]);

  const activeProviderInfo = useMemo(
    () => providers.find((item) => item.name === selectedProvider) || null,
    [providers, selectedProvider]
  );

  const parsedAnalysisRaw = useMemo(() => {
    if (!analysisRaw) return analysisResult;
    try {
      return JSON.parse(analysisRaw);
    } catch (err) {
      return analysisResult;
    }
  }, [analysisRaw, analysisResult]);

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
    setCacheReady(false);
    setFeed(null);
    setFeedError(null);
    setAnalysisResult(null);
    setAnalysisRaw(null);
    setAnalysisRunId(null);
    setAnalysisError(null);
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
      const refreshPayload = (await refreshRes.json()) as {
        requested: string[];
        succeeded: string[];
        failed: { ticker: string; reason: string }[];
      };
      if (refreshPayload.failed.length) {
        const failedTickers = refreshPayload.failed.map((item) => item.ticker);
        throw new Error(`以下 ticker 拉取失败：${failedTickers.join(", ")}`);
      }

      if (!options) {
        throw new Error("选项尚未加载完成。");
      }

      const timeframes = sortedTimeframes;
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
      setCacheReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败。");
    } finally {
      setLoading(false);
    }
  };

  const importSbi = async () => {
    if (!importFile) {
      setImportError("请选择需要导入的 CSV 文件。");
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await fetch(`${apiBase}/api/portfolio/import/sbi`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as ImportResult;
      setImportResult(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "导入失败。");
    } finally {
      setImporting(false);
    }
  };

  const loadFeed = async () => {
    if (!selectedTickers.length) {
      setFeedError("请选择至少一个 ticker。");
      return;
    }
    setFeedError(null);
    setFeedLoading(true);
    try {
      const payload: {
        includePositions: boolean;
        tradableTickers: string[];
      } = {
        includePositions: true,
        tradableTickers: selectedTickers,
      };
      const res = await fetch(`${apiBase}/api/analysis/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as FeedResponse;
      setFeed(data);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : "请求失败。");
    } finally {
      setFeedLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (!selectedTickers.length) {
      setAnalysisError("请选择至少一个 ticker。");
      return;
    }
    if (!cacheReady) {
      setAnalysisError("请先点击 Load 完成缓存，再进行分析。");
      return;
    }
    const providerInfo = providers.find(
      (item) => item.name === selectedProvider
    );
    if (providerInfo && !providerInfo.available) {
      setAnalysisError("所选 provider 尚未配置 API Key。");
      return;
    }
    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      const cashValue = Number.parseFloat(cashInput.replace(/,/g, ""));
      const providerInfo = providers.find(
        (item) => item.name === selectedProvider
      );
      const modelValue =
        providerInfo?.defaultModel && providerInfo.defaultModel.trim()
          ? providerInfo.defaultModel.trim()
          : undefined;
      const payload = {
        provider: selectedProvider || providers[0]?.name || "gpt",
        model: modelValue,
        feedRef: {
          tradableTickers: selectedTickers,
          includePositions: true,
        },
        constraints: {
          cash: Number.isFinite(cashValue) ? cashValue : 1000000,
        },
        promptVersion: "v1",
      };
      const res = await fetch(`${apiBase}/api/analysis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as AnalysisRunResponse;
      setAnalysisResult(data.result);
      setAnalysisRaw(data.raw ?? JSON.stringify(data.result, null, 2));
      setAnalysisRunId(data.id);
      setChatMessages(data.messages || []);
      setAnalysisView("result");
      fetchHistory();
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "分析失败。");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const res = await fetch(`${apiBase}/api/analysis/history?limit=20`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as AnalysisHistoryResponse;
      setHistory(data.items || []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "加载历史失败。");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadHistoryItem = async (id: number) => {
    try {
      setAnalysisLoading(true);
      setAnalysisView("result");
      setAnalysisError(null);
      const res = await fetch(`${apiBase}/api/analysis/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as AnalysisRecordResponse;
      if (data.result) {
        setAnalysisResult(data.result);
        setAnalysisRaw(data.raw ?? JSON.stringify(data.result, null, 2));
        setAnalysisRunId(data.id);
        setChatMessages(data.messages || []);
        setAnalysisView("result");
      } else {
        setAnalysisError("该记录没有可用的结果。");
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "加载历史失败。");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const sendChat = async () => {
    if (!analysisRunId) {
      setAnalysisError("请先运行或加载一条分析记录。");
      return;
    }
    const content = chatInput.trim();
    if (!content) return;
    // Optimistic append user message
    setChatMessages((prev) => [...prev, { role: "user", content }]);
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`${apiBase}/api/analysis/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: analysisRunId, userMessage: content }),
      });
      if (!res.ok) {
        const detail = await safeParseError(res);
        throw new Error(detail);
      }
      const data = (await res.json()) as AnalysisRunResponse;
      setAnalysisResult(data.result);
      setAnalysisRaw(data.raw ?? JSON.stringify(data.result, null, 2));
      setChatMessages(data.messages || []);
      setChatInput("");
      setAnalysisView("result");
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "发送失败。");
    } finally {
      setAnalysisLoading(false);
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

          <div className="mt-6">
            <label className="text-sm font-medium text-slate-700">
              SBI 持仓导入
            </label>
            <p className="mt-2 text-xs text-slate-500">
              上传从 SBI 证券导出的 CSV 持仓文件。
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null);
                setImportResult(null);
                setImportError(null);
              }}
              className="mt-2 w-full text-xs text-slate-600"
            />
            <button
              type="button"
              onClick={importSbi}
              disabled={!importFile || importing}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {importing ? "导入中..." : "导入 CSV"}
            </button>
            {importError && (
              <p className="mt-2 text-xs text-rose-500">{importError}</p>
            )}
            {importResult && (
              <div className="mt-2 text-xs text-slate-500">
                <div>已导入 {importResult.positions.length} 条持仓</div>
                <div>跳过 {importResult.skipped} 条</div>
                <div>时间 {formatIsoDatetime(importResult.importedAt)}</div>
              </div>
            )}
          </div>

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
                  timeframes={sortedTimeframes}
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

          <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Feed Preview</h3>
                <p className="text-xs text-slate-500">
                  查看喂给模型的结构化输入，包含持仓与两套时间尺度。
                </p>
              </div>
              <button
                type="button"
                onClick={loadFeed}
                disabled={feedLoading || !cacheReady}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {feedLoading ? "生成中..." : "生成 Feed"}
              </button>
            </div>

            {feedError && <p className="mt-3 text-xs text-rose-500">{feedError}</p>}

            {!feed && !feedLoading && (
              <div className="mt-4 text-xs text-slate-500">
                {cacheReady
                  ? "选择 ticker 后点击“生成 Feed”预览输入。"
                  : "请先点击 Load 完成缓存。"}
              </div>
            )}

            {feed && (
              <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-white p-3">
                <JsonView
                  value={feed}
                  collapsed={2}
                  displayDataTypes={false}
                  displayObjectSize={false}
                  enableClipboard={true}
                  keyName="feed"
                  style={githubLightTheme}
                />
              </div>
            )}
          </section>

          <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">LLM Analysis</h3>
              <p className="text-xs text-slate-500">
                选择 provider，基于当前 feed 生成可执行的结构化建议。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedProvider}
                disabled={providersLoading || !providers.length}
                onChange={(event) => setSelectedProvider(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-400"
                >
                  {providers.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} ({item.defaultModel})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <label className="text-xs font-medium text-slate-700">
                    可用现金
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    value={cashInput}
                    onChange={(event) => setCashInput(event.target.value)}
                    className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={
                    analysisLoading ||
                    !cacheReady ||
                    !selectedProvider ||
                    providersLoading ||
                    (activeProviderInfo && !activeProviderInfo.available)
                  }
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {analysisLoading ? "分析中..." : "Analyze"}
                </button>
            </div>
          </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>
                需先点击 Load 准备缓存；未准备好时按钮将置灰。
              </span>
                <div className="flex items-center gap-2 rounded-full border border-slate-200 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setAnalysisView("result")}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                    analysisView === "result"
                      ? "bg-slate-900 text-white"
                      : "text-slate-700"
                  }`}
                  >
                    Result
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalysisView("history")}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      analysisView === "history"
                        ? "bg-slate-900 text-white"
                        : "text-slate-700"
                    }`}
                  >
                    History
                  </button>
                </div>
              </div>
            {analysisError && (
              <p className="mt-3 text-xs text-rose-500">{analysisError}</p>
            )}
            {activeProviderInfo && !activeProviderInfo.available && (
              <p className="mt-3 text-xs text-amber-600">
                Provider {activeProviderInfo.name} 尚未配置 API Key。
              </p>
            )}
            {!analysisResult && !analysisLoading && (
              <div className="mt-4 text-xs text-slate-500">
                {cacheReady
                  ? "生成 feed 后点击 Analyze 运行一次模型。"
                  : "请先点击 Load，等待缓存就绪。"}
              </div>
            )}

            {analysisView === "result" && analysisResult && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">
                        Summary
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {analysisResult.summary}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>ID: #{analysisRunId ?? "-"}</div>
                      <div>
                        As of: {formatIsoDatetime(analysisResult.meta.asOf)}
                      </div>
                      <div>Provider: {analysisResult.meta.provider}</div>
                      <div>Model: {analysisResult.meta.model}</div>
                      <div>Prompt: {analysisResult.meta.promptVersion}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800">
                      Actions
                    </h4>
                    <span className="text-xs text-slate-500">
                      {analysisResult.actions.length} 项
                    </span>
                  </div>
                  {analysisResult.actions.length ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {analysisResult.actions.map((action, index) => (
                        <div
                          key={`${action.ticker}-${index}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-slate-800">
                              {formatTickerLabel(action.ticker, options?.tickerInfo)}
                            </div>
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                              {action.action}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                            <div>Timeframe: {action.timeframe}</div>
                            <div>信心: {formatConfidence(action.confidence)}</div>
                            <div>Size: {formatActionSize(action)}</div>
                            <div>
                              Weight:
                              {action.targetWeight !== null &&
                              action.targetWeight !== undefined
                                ? ` ${(action.targetWeight * 100).toFixed(2)}%`
                                : " -"}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-slate-700">
                            理由：{action.rationale}
                          </div>
                          {action.risk && (
                            <div className="mt-1 text-xs text-amber-700">
                              风险：{action.risk}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-slate-500">
                      暂无具体操作，保持观察。
                    </div>
                  )}
                </div>

                {analysisResult.doNotTradeIf.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                    <div className="font-semibold">Do not trade if</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {analysisResult.doNotTradeIf.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800">
                      Chat（续聊当前会话）
                    </h4>
                    <span className="text-xs text-slate-500">
                      {analysisRunId ? `Run #${analysisRunId}` : "未选择会话"}
                    </span>
                  </div>
                  {!chatMessages.length && (
                    <p className="text-xs text-slate-500">
                      先运行 Analyze 或在历史中点击“查看”加载会话，再继续对话。
                    </p>
                  )}
                  {chatMessages.length > 0 && (
                    <div
                      className="max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-100 p-3"
                      ref={chatContainerRef}
                    >
                      {chatMessages
                        .filter((msg) => msg.role !== "system")
                        .map((msg, index) => (
                          <div
                            key={`${msg.role}-${index}`}
                            className={`text-sm ${
                              msg.role === "assistant" ? "text-slate-800" : "text-slate-600"
                            }`}
                          >
                            <span className="mr-2 text-xs font-semibold uppercase text-slate-500">
                              {msg.role}
                            </span>
                            <span className="whitespace-pre-wrap">{msg.content}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      rows={3}
                      placeholder={
                        analysisRunId
                          ? "输入你的追问或补充说明..."
                          : "请先运行一次 Analyze 或从历史加载记录。"
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={sendChat}
                        disabled={!analysisRunId || analysisLoading || !chatInput.trim()}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {analysisLoading ? "发送中..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800">
                      History
                    </h4>
                    <button
                      type="button"
                      onClick={fetchHistory}
                      disabled={historyLoading}
                      className="text-xs text-slate-600 underline hover:text-slate-800 disabled:opacity-60"
                    >
                      {historyLoading ? "刷新中..." : "刷新"}
                    </button>
                  </div>
                  {historyError && (
                    <p className="mt-2 text-xs text-rose-500">{historyError}</p>
                  )}
                  {!historyLoading && !history.length && !historyError && (
                    <p className="mt-2 text-xs text-slate-500">暂无历史记录。</p>
                  )}
                  {history.length > 0 && (
                    <div className="mt-3 divide-y divide-slate-100">
                      {history.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2"
                        >
                          <div>
                            <div className="text-sm font-semibold text-slate-800">
                              #{item.id} · {item.provider}/{item.model}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatIsoDatetime(item.createdAt)} ·{" "}
                              {item.tickers.join(", ")}
                            </div>
                            <div className="text-xs text-slate-600">
                              {item.summary || item.error || "无摘要"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${
                                item.status === "succeeded"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : item.status === "running"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {item.status}
                            </span>
                            <button
                              type="button"
                              onClick={() => loadHistoryItem(item.id)}
                              className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:border-slate-300"
                            >
                              查看
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold text-slate-700">
                    Raw JSON
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-100">
                    <JsonView
                      value={parsedAnalysisRaw || analysisResult || {}}
                      collapsed={2}
                      displayDataTypes={false}
                      displayObjectSize={false}
                      enableClipboard={true}
                      keyName="analysis"
                      style={githubLightTheme}
                    />
                  </div>
                </div>
              </div>
            )}

            {analysisView === "result" && !analysisResult && !analysisLoading && (
              <div className="mt-4 text-xs text-slate-500">
                {cacheReady
                  ? "生成 feed 后点击 Analyze 运行一次模型。"
                  : "请先点击 Load，等待缓存就绪。"}
              </div>
            )}

            {analysisView === "history" && (
              <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-800">
                    History (最近 20 条)
                  </h4>
                  <button
                    type="button"
                    onClick={fetchHistory}
                    disabled={historyLoading}
                    className="text-xs text-slate-600 underline hover:text-slate-800 disabled:opacity-60"
                  >
                    {historyLoading ? "刷新中..." : "刷新"}
                  </button>
                </div>
                {historyError && (
                  <p className="text-xs text-rose-500">{historyError}</p>
                )}
                {!historyLoading && !history.length && !historyError && (
                  <p className="text-xs text-slate-500">暂无历史记录。</p>
                )}
                {history.length > 0 && (
                  <div className="divide-y divide-slate-100">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-2"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-800">
                            #{item.id} · {item.provider}/{item.model}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatIsoDatetime(item.createdAt)} ·{" "}
                            {item.tickers.join(", ")}
                          </div>
                          <div className="text-xs text-slate-600">
                            {item.summary || item.error || "无摘要"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase ${
                              item.status === "succeeded"
                                ? "bg-emerald-100 text-emerald-700"
                                : item.status === "running"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-rose-100 text-rose-700"
                            }`}
                          >
                            {item.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => loadHistoryItem(item.id)}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:border-slate-300"
                          >
                            查看
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
