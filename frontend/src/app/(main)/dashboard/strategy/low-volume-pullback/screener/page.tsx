"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";
import { parseScreenerSearchParams, preferredTimeframe, type ScreenerParams } from "./params";

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

  const params = useMemo(() => parseScreenerSearchParams(searchParams), [searchParams]);

  const [universe, setUniverse] = useState<UniverseResponse | null>(null);

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
      })
      .catch((err) => console.error(err));
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
    await screenerQuery.refetch();
  };

  const screenerQuery = useQuery({
    queryKey: ["low-volume", "screener", params],
    queryFn: async (): Promise<LowVolumeResponse> => {
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
      return (await res.json()) as LowVolumeResponse;
    },
    enabled: false,
  });

  const tickerInfo = universe?.tickerInfo ?? {};

  const results = screenerQuery.data?.results ?? [];
  const triggered = useMemo(() => results.filter((r) => r.triggered), [results]);
  const onlyTriggeredValue = params.onlyTriggered === "1";
  const errorMessage = screenerQuery.error instanceof Error ? screenerQuery.error.message : null;
  const isLoading = screenerQuery.isFetching || isTransitioning;

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

      {errorMessage && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
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
            <Button onClick={run} disabled={isLoading}>
              {isLoading ? "筛选中..." : "运行筛选"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">结果</CardTitle>
          <CardDescription>
            共 {results.length} 条 · 命中 {triggered.length}
          </CardDescription>
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
                    <Badge variant={r.triggered ? "default" : "outline"}>{r.triggered ? "Yes" : "No"}</Badge>
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
