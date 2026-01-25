"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson, API_BASE } from "@/lib/api";

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

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

export default function LowVolumeBacktestPage() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [timeframe, setTimeframe] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [horizonBars, setHorizonBars] = useState("5");
  const [entryExecution, setEntryExecution] = useState<"close" | "next_open">("close");
  const [volRatioMax, setVolRatioMax] = useState("0.5");
  const [minBodyPct, setMinBodyPct] = useState("0.002");
  const [onlyTriggered, setOnlyTriggered] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BacktestResponse | null>(null);

  useEffect(() => {
    getJson<OptionsResponse>("/api/options")
      .then((res) => {
        setOptions(res);
        setTimeframe(res.timeframes[0] || "6M_1d");
      })
      .catch((err) => setError(err.message));
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        timeframe,
        asOfDate,
        tickers: null,
        onlyTriggered,
        horizonBars: parseInt(horizonBars, 10),
        entryExecution,
        params: {
          volRatioMax: parseFloat(volRatioMax),
          minBodyPct: parseFloat(minBodyPct),
        },
      };
      const res = await fetch(`${API_BASE}/api/strategy/low_volume_pullback/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`回测失败 (${res.status})`);
      const json = (await res.json()) as BacktestResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const tickerInfo = options?.tickerInfo ?? {};
  const triggered = data?.results?.filter((r) => r.triggered) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Low-Volume Pullback · 单日回测</h1>
          <p className="text-sm text-muted-foreground">asOf + horizon 预期收益/胜率</p>
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
          <CardDescription>选择 asOf / horizon / 执行价</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Timeframe</Label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {(options?.timeframes || []).map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>As Of Date</Label>
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Horizon Bars</Label>
            <Input value={horizonBars} onChange={(e) => setHorizonBars(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Entry Execution</Label>
            <select
              value={entryExecution}
              onChange={(e) => setEntryExecution(e.target.value as "close" | "next_open")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="close">close</option>
              <option value="next_open">next_open</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>volRatioMax</Label>
            <Input value={volRatioMax} onChange={(e) => setVolRatioMax(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>minBodyPct</Label>
            <Input value={minBodyPct} onChange={(e) => setMinBodyPct(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>仅显示命中</Label>
            <Badge
              variant={onlyTriggered ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setOnlyTriggered((v) => !v)}
            >
              {onlyTriggered ? "只看命中" : "全部"}
            </Badge>
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <Button onClick={run} disabled={loading}>
              {loading ? "回测中..." : "运行回测"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">结果</CardTitle>
            <CardDescription>
              命中 {triggered.length}/{data.results.length} · asOf {new Date(data.asOfTs * 1000).toISOString().slice(0,10)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              {Object.entries(data.summary.winRateByDay || {}).map(([day, rate]) => (
                <Badge key={day} variant="outline">
                  Day {day}: {(rate * 100).toFixed(1)}% win · avg {(data.summary.avgReturnByDay[+day] * 100).toFixed(2)}%
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
                    <TableHead></TableHead>
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
                          <div className="text-xs text-muted-foreground">{tickerInfo[r.symbol]}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.triggered ? "default" : "outline"}>
                            {r.triggered ? "Yes" : "No"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.signal ? `${r.signal.entryPrice.toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell>{day1 !== null ? (day1 * 100).toFixed(2) + "%" : "-"}</TableCell>
                        <TableCell>{dayN !== null ? (dayN * 100).toFixed(2) + "%" : "-"}</TableCell>
                        <TableCell>
                          <Link
                            className="inline-flex items-center text-sm text-primary hover:underline"
                            href={`/dashboard/tickers/${encodeURIComponent(r.symbol)}`}
                          >
                            详情 <ArrowRight className="ml-1 h-3 w-3" />
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
