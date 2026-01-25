import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { type BarPoint, TickerChart } from "@/components/tickers/ticker-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { addLocaleToPath } from "@/i18n/locale-path";
import { getJson } from "@/lib/api";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

type Params = { symbol: string };

type BarsResponse = {
  ticker: string;
  timeframe: string;
  bars: { time: string | null; t: number; c: number }[];
};

async function fetchBars(ticker: string, timeframe: string): Promise<BarsResponse> {
  const params = new URLSearchParams({ ticker, timeframe, limit: "200" });
  return getJson<BarsResponse>(`/api/bars?${params.toString()}`);
}

export default async function TickerDetailPage({ params }: { params: Promise<Params> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol || "").toUpperCase();
  const cookieStore = await cookies();
  const locale = cookieStore.get("NEXT_LOCALE")?.value || "en";
  const universe = await fetchUniverse();
  const timeframe = universe.timeframes.includes("6M_1d") ? "6M_1d" : universe.timeframes[0] || "6M_1d";
  const barsRes = await fetchBars(symbol, timeframe);
  const labelMap = universe.tickerInfo || {};
  const name = labelMap[symbol] ?? symbol;

  const chartData: BarPoint[] =
    barsRes.bars?.map((b) => ({
      time: b.time ?? formatDate(b.t, locale),
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
            <Link href={addLocaleToPath(locale, "/dashboard/tickers")}>返回列表</Link>
          </Button>
          {change !== null && (
            <Badge variant={change >= 0 ? "default" : "destructive"}>
              {change >= 0 ? "+" : ""}
              {formatPercent(change / 100, locale)}
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
              <span className="font-medium">{formatNumber(latest?.c, locale, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最新日期</span>
              <span className="font-medium">{formatDate(latest?.t, locale)}</span>
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
