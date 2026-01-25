"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

type ScreenerParams = {
  timeframe: string;
  volRatioMax: string;
  minBodyPct: string;
  recentBars: string;
  onlyTriggered: "1" | "0";
};

type LowVolumeResult = {
  symbol: string;
  name?: string | null;
  triggered: boolean;
  asOf?: number | null;
  volRatio?: number | null;
  bodyPct?: number | null;
  error?: string | null;
};

type LowVolumeResponse = {
  timeframe: string;
  results: LowVolumeResult[];
};

const preferredTimeframe = "6M_1d";

const DEFAULT_PARAMS: ScreenerParams = {
  timeframe: "",
  volRatioMax: "0.5",
  minBodyPct: "0.002",
  recentBars: "3",
  onlyTriggered: "1",
};

const normalizeParams = (params: ScreenerParams): ScreenerParams => ({
  ...DEFAULT_PARAMS,
  ...params,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
  recentBars: Number.isNaN(parseInt(params.recentBars, 10)) ? DEFAULT_PARAMS.recentBars : params.recentBars,
  onlyTriggered: params.onlyTriggered === "0" ? "0" : "1",
});

const parseSearchParams = (searchParams: URLSearchParams): ScreenerParams =>
  normalizeParams({
    timeframe: searchParams.get("timeframe") || DEFAULT_PARAMS.timeframe,
    volRatioMax: searchParams.get("volRatioMax") || DEFAULT_PARAMS.volRatioMax,
    minBodyPct: searchParams.get("minBodyPct") || DEFAULT_PARAMS.minBodyPct,
    recentBars: searchParams.get("recentBars") || DEFAULT_PARAMS.recentBars,
    onlyTriggered: (searchParams.get("onlyTriggered") as ScreenerParams["onlyTriggered"]) || DEFAULT_PARAMS.onlyTriggered,
  });

const buildSearchParams = (current: URLSearchParams, updates: Partial<ScreenerParams>): URLSearchParams => {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    next.set(key, value);
  });
  return next;
};

export default function LowVolumeScreenerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, startTransition] = useTransition();

  const params = useMemo(() => parseSearchParams(searchParams), [searchParams]);

  const [universe, setUniverse] = useState<UniverseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LowVolumeResult[]>([]);

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Ensure timeframe default once universe is known; URL is the single source of truth
  useEffect(() => {
    if (!universe || params.timeframe) return;
    const fallback = universe.timeframes?.[0] ?? "";
    const nextTimeframe = universe.timeframes?.includes(preferredTimeframe) ? preferredTimeframe : fallback;
    if (!nextTimeframe) return;

    const next = buildSearchParams(searchParams, { timeframe: nextTimeframe });
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [universe, params.timeframe, router, pathname, searchParams]);

  const updateParams = useCallback(
    (updates: Partial<ScreenerParams>) => {
      startTransition(() => {
        const next = buildSearchParams(searchParams, updates);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  const run = async () => {
    if (!params.timeframe) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        timeframe: params.timeframe,
        tickers: null,
        onlyTriggered: params.onlyTriggered === "1",
        recentBars: parseInt(params.recentBars, 10) || undefined,
        params: {
          volRatioMax: parseFloat(params.volRatioMax),
          minBodyPct: parseFloat(params.minBodyPct),
        },
      };
      const res = await fetch(`${API_BASE}/api/strategy/low_volume_pullback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`筛选失败 (${res.status})`);
      const data = (await res.json()) as LowVolumeResponse;
      setResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const tickerInfo = universe?.tickerInfo ?? {};

  const triggered = useMemo(() => results.filter((r) => r.triggered), [results]);
  const onlyTriggeredValue = params.onlyTriggered === "1";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">Low-Volume Pullback · 筛选</h1>
          <p className="text-muted-foreground text-sm">调用 /api/strategy/low_volume_pullback</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/strategy">返回策略入口</Link>
        </Button>
      </div>

      {error && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参数</CardTitle>
          <CardDescription>最常用参数已暴露，其他保持默认</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Timeframe</Label>
            <select
              value={params.timeframe}
              onChange={(e) => updateParams({ timeframe: e.target.value })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {(universe?.timeframes || []).map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>volRatioMax</Label>
            <Input value={params.volRatioMax} onChange={(e) => updateParams({ volRatioMax: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>minBodyPct</Label>
            <Input value={params.minBodyPct} onChange={(e) => updateParams({ minBodyPct: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>recentBars</Label>
            <Input value={params.recentBars} onChange={(e) => updateParams({ recentBars: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>仅显示命中</Label>
            <Badge
              variant={onlyTriggeredValue ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => updateParams({ onlyTriggered: onlyTriggeredValue ? "0" : "1" })}
            >
              {onlyTriggeredValue ? "只看命中" : "全部"}
            </Badge>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Button onClick={run} disabled={loading || isTransitioning}>
              {loading ? "筛选中..." : "运行筛选"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">结果</CardTitle>
          <CardDescription>共 {results.length} 条 · 命中 {triggered.length}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Hit</TableHead>
                <TableHead>volRatio</TableHead>
                <TableHead>bodyPct</TableHead>
                <TableHead>asOf</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => (
                <TableRow key={`${r.symbol}-${idx}`}>
                  <TableCell>
                    <div className="font-medium">{r.symbol}</div>
                    <div className="text-muted-foreground text-xs">{r.name ?? tickerInfo[r.symbol]}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.triggered ? "default" : "outline"}>
                      {r.triggered ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.volRatio !== null ? r.volRatio?.toFixed(3) : "-"}</TableCell>
                  <TableCell>{r.bodyPct != null ? `${(r.bodyPct * 100).toFixed(2)}%` : "-"}</TableCell>
                  <TableCell>{r.asOf ? new Date(r.asOf * 1000).toISOString().slice(0, 10) : "-"}</TableCell>
                  <TableCell>
                    <Link
                      className="inline-flex items-center text-primary text-sm hover:underline"
                      href={`/dashboard/tickers/${encodeURIComponent(r.symbol)}`}
                    >
                      详情 <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!results.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground text-sm">
                    尚未运行
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
