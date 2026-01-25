"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

type RangeParams = {
  timeframe: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  horizonBars: string;
  entryExecution: "close" | "next_open";
  volRatioMax: string;
  minBodyPct: string;
};

type RangeSummary = {
  sampleCountByDay: Record<number, number>;
  winRateByDay: Record<number, number>;
  bucketRateByDay: Record<number, { down_gt_5: number; down_0_5: number; up_0_5: number; up_gt_5: number }>;
};

type RangeResponse = {
  timeframe: string;
  startTs: number;
  endTs: number;
  horizonBars: number;
  summary: RangeSummary;
};

const preferredTimeframe = "6M_1d";

const defaultStartDate = () => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const defaultEndDate = () => new Date().toISOString().slice(0, 10);

const DEFAULT_PARAMS: RangeParams = {
  timeframe: "",
  startDate: defaultStartDate(),
  endDate: defaultEndDate(),
  horizonBars: "5",
  entryExecution: "close",
  volRatioMax: "0.5",
  minBodyPct: "0.002",
};

const normalizeParams = (params: RangeParams): RangeParams => ({
  ...DEFAULT_PARAMS,
  ...params,
  horizonBars: Number.isNaN(parseInt(params.horizonBars, 10)) ? DEFAULT_PARAMS.horizonBars : params.horizonBars,
  volRatioMax: Number.isNaN(parseFloat(params.volRatioMax)) ? DEFAULT_PARAMS.volRatioMax : params.volRatioMax,
  minBodyPct: Number.isNaN(parseFloat(params.minBodyPct)) ? DEFAULT_PARAMS.minBodyPct : params.minBodyPct,
});

const parseSearchParams = (searchParams: URLSearchParams): RangeParams =>
  normalizeParams({
    timeframe: searchParams.get("timeframe") || DEFAULT_PARAMS.timeframe,
    startDate: searchParams.get("startDate") || DEFAULT_PARAMS.startDate,
    endDate: searchParams.get("endDate") || DEFAULT_PARAMS.endDate,
    horizonBars: searchParams.get("horizonBars") || DEFAULT_PARAMS.horizonBars,
    entryExecution: (searchParams.get("entryExecution") as RangeParams["entryExecution"]) || DEFAULT_PARAMS.entryExecution,
    volRatioMax: searchParams.get("volRatioMax") || DEFAULT_PARAMS.volRatioMax,
    minBodyPct: searchParams.get("minBodyPct") || DEFAULT_PARAMS.minBodyPct,
  });

const buildSearchParams = (current: URLSearchParams, updates: Partial<RangeParams>): URLSearchParams => {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    next.set(key, value);
  });
  return next;
};

export default function LowVolumeRangePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, startTransition] = useTransition();

  const params = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const [universe, setUniverse] = useState<UniverseResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RangeResponse | null>(null);

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Ensure timeframe has a default once universe is known (URL as single source of truth)
  useEffect(() => {
    if (!universe || params.timeframe) return;
    const fallback = universe.timeframes?.[0] ?? "";
    const nextTimeframe = universe.timeframes?.includes(preferredTimeframe) ? preferredTimeframe : fallback;
    if (!nextTimeframe) return;

    const next = buildSearchParams(searchParams, { timeframe: nextTimeframe });
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [universe, params.timeframe, router, pathname, searchParams]);

  const updateParams = useCallback(
    (updates: Partial<RangeParams>) => {
      startTransition(() => {
        const next = buildSearchParams(searchParams, updates);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        timeframe: params.timeframe,
        startDate: params.startDate,
        endDate: params.endDate,
        tickers: null,
        horizonBars: parseInt(params.horizonBars, 10),
        entryExecution: params.entryExecution,
        params: {
          volRatioMax: parseFloat(params.volRatioMax),
          minBodyPct: parseFloat(params.minBodyPct),
        },
      };
      const res = await fetch(`${API_BASE}/api/strategy/low_volume_pullback/backtest/range`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`区间统计失败 (${res.status})`);
      const json = (await res.json()) as RangeResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">Low-Volume Pullback · 区间统计</h1>
          <p className="text-muted-foreground text-sm">区间内每日检测命中日的 forward 胜率分布</p>
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
          <CardDescription>区间 + horizon + 执行价</CardDescription>
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
            <Label>Start Date</Label>
            <Input type="date" value={params.startDate} onChange={(e) => updateParams({ startDate: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input type="date" value={params.endDate} onChange={(e) => updateParams({ endDate: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Horizon Bars</Label>
            <Input value={params.horizonBars} onChange={(e) => updateParams({ horizonBars: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Entry Execution</Label>
            <select
              value={params.entryExecution}
              onChange={(e) => updateParams({ entryExecution: e.target.value as RangeParams["entryExecution"] })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="close">close</option>
              <option value="next_open">next_open</option>
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
          <div className="md:col-span-2 lg:col-span-3">
            <Button onClick={run} disabled={loading || isTransitioning}>
              {loading ? "统计中..." : "运行区间统计"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">总结</CardTitle>
            <CardDescription>
              Horizon {data.horizonBars} · {new Date(data.startTs * 1000).toISOString().slice(0,10)} → {new Date(data.endTs * 1000).toISOString().slice(0,10)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 text-muted-foreground text-sm">
              {Object.entries(data.summary.winRateByDay || {}).map(([day, rate]) => (
                <Badge key={day} variant="outline">
                  Day {day}: {(rate * 100).toFixed(1)}% win · samples {data.summary.sampleCountByDay[+day] ?? 0}
                </Badge>
              ))}
            </div>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Samples</TableHead>
                    <TableHead>Win Rate</TableHead>
                    <TableHead>Bucket 分布</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(data.summary.sampleCountByDay || {})
                    .map(Number)
                    .sort((a, b) => a - b)
                    .map((day) => {
                      const buckets = data.summary.bucketRateByDay[day] || {
                        down_gt_5: 0,
                        down_0_5: 0,
                        up_0_5: 0,
                        up_gt_5: 0,
                      };
                      return (
                        <TableRow key={day}>
                          <TableCell>Day {day}</TableCell>
                          <TableCell>{data.summary.sampleCountByDay[day] ?? 0}</TableCell>
                          <TableCell>{((data.summary.winRateByDay[day] ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell className="space-x-2 text-muted-foreground text-xs">
                            <Badge variant="outline">↓&gt;5% {(buckets.down_gt_5 * 100).toFixed(1)}%</Badge>
                            <Badge variant="outline">↓0~5% {(buckets.down_0_5 * 100).toFixed(1)}%</Badge>
                            <Badge variant="outline">↑0~5% {(buckets.up_0_5 * 100).toFixed(1)}%</Badge>
                            <Badge variant="outline">↑&gt;5% {(buckets.up_gt_5 * 100).toFixed(1)}%</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
