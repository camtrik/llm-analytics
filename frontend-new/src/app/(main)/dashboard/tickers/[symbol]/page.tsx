import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickerChart, type BarPoint } from "@/components/tickers/ticker-chart";
import { getJson } from "@/lib/api";

type Params = { symbol: string };

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

type BarsResponse = {
  ticker: string;
  timeframe: string;
  bars: { time: string | null; t: number; c: number }[];
};

async function fetchOptions(): Promise<OptionsResponse> {
  return getJson<OptionsResponse>("/api/options");
}

async function fetchBars(ticker: string, timeframe: string): Promise<BarsResponse> {
  const params = new URLSearchParams({ ticker, timeframe, limit: "200" });
  return getJson<BarsResponse>(`/api/bars?${params.toString()}`);
}

function formatDateLabel(ts: number) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function TickerDetailPage({ params }: { params: Promise<Params> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol || "").toUpperCase();
  const options = await fetchOptions();
  if (!symbol || !options.tickers.includes(symbol)) {
    notFound();
  }
  const timeframe = options.timeframes[0] || "6M_1d";
  const barsRes = await fetchBars(symbol, timeframe);
  const name = options.tickerInfo?.[symbol] ?? symbol;

  const chartData: BarPoint[] =
    barsRes.bars?.map((b) => ({
      time: b.time ?? formatDateLabel(b.t),
      c: b.c,
    })) ?? [];

  const latest = barsRes.bars?.at(-1);
  const prev = barsRes.bars?.at(-2);
  const change = latest && prev ? ((latest.c - prev.c) / prev.c) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {symbol} · timeframe: {barsRes.timeframe}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/tickers">返回列表</Link>
          </Button>
          {change !== null && (
            <Badge variant={change >= 0 ? "default" : "destructive"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">收盘价走势</CardTitle>
            <CardDescription>最近 {chartData.length} 根</CardDescription>
          </CardHeader>
          <CardContent>
            <TickerChart data={chartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">概览</CardTitle>
            <CardDescription>来自缓存数据</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最新收盘</span>
              <span className="font-medium">
                {latest ? latest.c.toFixed(2) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最新日期</span>
              <span className="font-medium">
                {latest ? formatDateLabel(latest.t) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">数据条数</span>
              <span className="font-medium">{barsRes.bars?.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
