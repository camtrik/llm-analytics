"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/components/providers/i18n-provider";
import { API_BASE } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";
import { parseRangeSearchParams, type RangeParams, preferredTimeframe } from "./params";

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

const buildSearchParams = (current: URLSearchParams, updates: Partial<RangeParams>): URLSearchParams => {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    next.set(key, value);
  });
  return next;
};

export default function LowVolumeRangePage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, startTransition] = useTransition();

  const params = useMemo(() => parseRangeSearchParams(searchParams), [searchParams]);
  const [universe, setUniverse] = useState<UniverseResponse | null>(null);

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
      })
      .catch((err) => console.error(err));
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
    if (!params.timeframe) return;
    await rangeQuery.refetch();
  };

  const rangeQuery = useQuery({
    queryKey: ["low-volume", "range", params],
    queryFn: async (): Promise<RangeResponse> => {
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
      if (!res.ok) throw new Error(t("strategy.lvp.range.error", "Range stats failed ({status})").replace("{status}", `${res.status}`));
      return (await res.json()) as RangeResponse;
    },
    enabled: false,
  });

  const errorMessage = rangeQuery.error instanceof Error ? rangeQuery.error.message : null;
  const data = rangeQuery.data;
  const isLoading = rangeQuery.isFetching || isTransitioning;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">{t("strategy.lvp.range.title", "Low-Volume Pullback · Range Stats")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("strategy.lvp.range.desc", "Forward win-rate distribution on hit days within range")}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/strategy">{t("strategy.lvp.range.back", "Back to strategies")}</Link>
        </Button>
      </div>

      {errorMessage && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("strategy.lvp.range.paramsTitle", "Parameters")}</CardTitle>
          <CardDescription>{t("strategy.lvp.range.paramsDesc", "Range + horizon + execution price")}</CardDescription>
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
            <Button onClick={run} disabled={isLoading}>
              {isLoading ? t("strategy.lvp.range.running", "Running stats...") : t("strategy.lvp.range.run", "Run range stats")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("strategy.lvp.range.summaryTitle", "Summary")}</CardTitle>
            <CardDescription>
              Horizon {data.horizonBars} · {new Date(data.startTs * 1000).toISOString().slice(0, 10)} →{" "}
              {new Date(data.endTs * 1000).toISOString().slice(0, 10)}
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
                    <TableHead>{t("strategy.lvp.range.bucket", "Bucket Distribution")}</TableHead>
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
