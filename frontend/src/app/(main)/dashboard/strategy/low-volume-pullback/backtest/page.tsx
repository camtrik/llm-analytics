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
import { useI18n } from "@/components/providers/i18n-provider";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";
import { parseBacktestSearchParams, preferredTimeframe, type BacktestParams } from "./params";

type BacktestResult = {
  symbol: string;
  name?: string | null;
  triggered: boolean;
  signal?: {
    asOfTs: number;
    entryPrice: number;
    volRatio?: number | null;
    bodyPct?: number | null;
  } | null;
  forward: { day: number; close: number; return: number }[];
  error?: string | null;
};

type BacktestResponse = {
  timeframe: string;
  asOfTs: number;
  horizonBars: number;
  summary: {
    triggeredCount: number;
    avgReturnByDay: Record<number, number>;
    winRateByDay: Record<number, number>;
  };
  results: BacktestResult[];
};

const buildSearchParams = (current: URLSearchParams, updates: Partial<BacktestParams>): URLSearchParams => {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    next.set(key, value);
  });
  return next;
};

export default function LowVolumeBacktestPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, startTransition] = useTransition();

  const params = useMemo(() => parseBacktestSearchParams(searchParams), [searchParams]);

  const [universe, setUniverse] = useState<UniverseResponse | null>(null);

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
      })
      .catch((err) => console.error(err));
  }, []);

  // Ensure timeframe default is set once universe is known; URL is single source of truth
  useEffect(() => {
    if (!universe || params.timeframe) return;
    const fallback = universe.timeframes?.[0] ?? "";
    const nextTimeframe = universe.timeframes?.includes(preferredTimeframe) ? preferredTimeframe : fallback;
    if (!nextTimeframe) return;

    const next = buildSearchParams(searchParams, { timeframe: nextTimeframe });
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [universe, params.timeframe, router, pathname, searchParams]);

  const updateParams = useCallback(
    (updates: Partial<BacktestParams>) => {
      startTransition(() => {
        const next = buildSearchParams(searchParams, updates);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  const run = async () => {
    if (!params.timeframe) return;
    await backtestQuery.refetch();
  };

  const backtestQuery = useQuery({
    queryKey: ["low-volume", "backtest", params],
    queryFn: async (): Promise<BacktestResponse> => {
      const payload = {
        timeframe: params.timeframe,
        asOfDate: params.asOfDate,
        tickers: null,
        onlyTriggered: params.onlyTriggered === "1",
        horizonBars: parseInt(params.horizonBars, 10),
        entryExecution: params.entryExecution,
        params: {
          volRatioMax: parseFloat(params.volRatioMax),
          minBodyPct: parseFloat(params.minBodyPct),
        },
      };
      const res = await fetch(`${API_BASE}/api/strategy/low_volume_pullback/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t("strategy.lvp.backtest.error", "Backtest failed ({status})").replace("{status}", `${res.status}`));
      return (await res.json()) as BacktestResponse;
    },
    enabled: false,
  });

  const errorMessage = backtestQuery.error instanceof Error ? backtestQuery.error.message : null;
  const data = backtestQuery.data;
  const isLoading = backtestQuery.isFetching || isTransitioning;

  const tickerInfo = universe?.tickerInfo ?? {};
  const triggered = data?.results?.filter((r) => r.triggered) || [];
  const onlyTriggeredValue = params.onlyTriggered === "1";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">{t("strategy.lvp.backtest.title", "Low-Volume Pullback · Single-Day Backtest")}</h1>
          <p className="text-muted-foreground text-sm">{t("strategy.lvp.backtest.desc", "asOf + horizon expected return / win rate")}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/strategy">{t("strategy.lvp.backtest.back", "Back to strategies")}</Link>
        </Button>
      </div>

      {errorMessage && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("strategy.lvp.backtest.paramsTitle", "Parameters")}</CardTitle>
          <CardDescription>{t("strategy.lvp.backtest.paramsDesc", "Pick asOf / horizon / execution price")}</CardDescription>
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
            <Label>As Of Date</Label>
            <Input type="date" value={params.asOfDate} onChange={(e) => updateParams({ asOfDate: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Horizon Bars</Label>
            <Input value={params.horizonBars} onChange={(e) => updateParams({ horizonBars: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Entry Execution</Label>
            <select
              value={params.entryExecution}
              onChange={(e) => updateParams({ entryExecution: e.target.value as BacktestParams["entryExecution"] })}
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
          <div className="space-y-2">
            <Label>{t("strategy.lvp.backtest.onlyHit", "Only hits")}</Label>
            <Badge
              variant={onlyTriggeredValue ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => updateParams({ onlyTriggered: onlyTriggeredValue ? "0" : "1" })}
            >
              {onlyTriggeredValue ? t("strategy.lvp.backtest.onlyHitOn", "Only hits") : t("strategy.lvp.backtest.onlyHitOff", "All")}
            </Badge>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Button onClick={run} disabled={isLoading}>
              {isLoading ? t("strategy.lvp.backtest.running", "Running backtest...") : t("strategy.lvp.backtest.run", "Run backtest")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("strategy.lvp.backtest.resultTitle", "Results")}</CardTitle>
            <CardDescription>
              {t("strategy.lvp.backtest.resultSummary", "Hits {hits}/{total} · asOf {asOf}")
                .replace("{hits}", `${triggered.length}`)
                .replace("{total}", `${data.results.length}`)
                .replace("{asOf}", new Date(data.asOfTs * 1000).toISOString().slice(0, 10))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 text-muted-foreground text-sm">
              {Object.entries(data.summary.winRateByDay || {}).map(([day, rate]) => (
                <Badge key={day} variant="outline">
                  Day {day}: {(rate * 100).toFixed(1)}% win · avg {(data.summary.avgReturnByDay[+day] * 100).toFixed(2)}
                  %
                </Badge>
              ))}
            </div>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Hit</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Return D1</TableHead>
                    <TableHead>Return D{data.horizonBars}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.results.map((r, idx) => {
                    const day1 = r.forward.find((f) => f.day === 1)?.return ?? null;
                    const dayN = r.forward.find((f) => f.day === data.horizonBars)?.return ?? null;
                    return (
                      <TableRow key={`${r.symbol}-${idx}`}>
                        <TableCell>
                          <div className="font-medium">{r.symbol}</div>
                          <div className="text-muted-foreground text-xs">{r.name ?? tickerInfo[r.symbol]}</div>
                        </TableCell>
                        <TableCell>
                        <Badge variant={r.triggered ? "default" : "outline"}>{r.triggered ? "Yes" : "No"}</Badge>
                      </TableCell>
                        <TableCell>{r.signal ? `${r.signal.entryPrice.toFixed(2)}` : "-"}</TableCell>
                        <TableCell>{day1 !== null ? `${(day1 * 100).toFixed(2)}%` : "-"}</TableCell>
                        <TableCell>{dayN !== null ? `${(dayN * 100).toFixed(2)}%` : "-"}</TableCell>
                        <TableCell>
                          <Link
                            className="inline-flex items-center text-primary text-sm hover:underline"
                            href={`/dashboard/tickers/${encodeURIComponent(r.symbol)}`}
                          >
                            {t("strategy.lvp.backtest.detail", "Detail")} <ArrowRight className="ml-1 h-3 w-3" />
                          </Link>
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
