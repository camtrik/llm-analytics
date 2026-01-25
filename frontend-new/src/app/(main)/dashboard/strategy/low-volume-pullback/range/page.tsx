"use client";

import { useEffect, useState } from "react";
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

export default function LowVolumeRangePage() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [timeframe, setTimeframe] = useState("");
  const [startDate, setStartDate] = useState<string>(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [horizonBars, setHorizonBars] = useState("5");
  const [entryExecution, setEntryExecution] = useState<"close" | "next_open">("close");
  const [volRatioMax, setVolRatioMax] = useState("0.5");
  const [minBodyPct, setMinBodyPct] = useState("0.002");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RangeResponse | null>(null);

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
        startDate,
        endDate,
        tickers: null,
        horizonBars: parseInt(horizonBars, 10),
        entryExecution,
        params: {
          volRatioMax: parseFloat(volRatioMax),
          minBodyPct: parseFloat(minBodyPct),
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
          <h1 className="text-2xl font-semibold">Low-Volume Pullback · 区间统计</h1>
          <p className="text-sm text-muted-foreground">区间内每日检测命中日的 forward 胜率分布</p>
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
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
          <div className="md:col-span-2 lg:col-span-3">
            <Button onClick={run} disabled={loading}>
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
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
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
                          <TableCell className="space-x-2 text-xs text-muted-foreground">
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
