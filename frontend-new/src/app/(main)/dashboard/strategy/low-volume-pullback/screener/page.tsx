"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

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

export default function LowVolumeScreenerPage() {
  const [universe, setUniverse] = useState<UniverseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LowVolumeResult[]>([]);

  const [timeframe, setTimeframe] = useState<string>("");
  const [onlyTriggered, setOnlyTriggered] = useState(true);
  const [volRatioMax, setVolRatioMax] = useState("0.5");
  const [minBodyPct, setMinBodyPct] = useState("0.002");
  const [recentBars, setRecentBars] = useState("3");

  useEffect(() => {
    fetchUniverse()
      .then((res) => {
        setUniverse(res);
        const preferred = "6M_1d";
        const fallback = res.timeframes?.[0] ?? "";
        setTimeframe(res.timeframes?.includes(preferred) ? preferred : fallback);
      })
      .catch((err) => setError(err.message));
  }, []);

  const run = async () => {
    if (!timeframe) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        timeframe,
        tickers: null,
        onlyTriggered,
        recentBars: parseInt(recentBars, 10) || undefined,
        params: {
          volRatioMax: parseFloat(volRatioMax),
          minBodyPct: parseFloat(minBodyPct),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Low-Volume Pullback · 筛选</h1>
          <p className="text-sm text-muted-foreground">调用 /api/strategy/low_volume_pullback</p>
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
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
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
            <Input value={volRatioMax} onChange={(e) => setVolRatioMax(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>minBodyPct</Label>
            <Input value={minBodyPct} onChange={(e) => setMinBodyPct(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>recentBars</Label>
            <Input value={recentBars} onChange={(e) => setRecentBars(e.target.value)} />
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
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => (
                <TableRow key={`${r.symbol}-${idx}`}>
                  <TableCell>
                    <div className="font-medium">{r.symbol}</div>
                    <div className="text-xs text-muted-foreground">{r.name ?? tickerInfo[r.symbol]}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.triggered ? "default" : "outline"}>
                      {r.triggered ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.volRatio !== null ? r.volRatio?.toFixed(3) : "-"}</TableCell>
                  <TableCell>{r.bodyPct !== null ? (r.bodyPct! * 100).toFixed(2) + "%" : "-"}</TableCell>
                  <TableCell>{r.asOf ? new Date(r.asOf * 1000).toISOString().slice(0, 10) : "-"}</TableCell>
                  <TableCell>
                    <Link
                      className="inline-flex items-center text-sm text-primary hover:underline"
                      href={`/dashboard/tickers/${encodeURIComponent(r.symbol)}`}
                    >
                      详情 <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!results.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
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
