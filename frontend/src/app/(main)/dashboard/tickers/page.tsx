import { Suspense } from "react";

import Link from "next/link";

import { ArrowUpRight } from "lucide-react";

import { RefreshButton } from "@/components/tickers/watchlist-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

function formatLabel(ticker: string, info: Record<string, string>) {
  const name = info[ticker];
  return name ? `${ticker} · ${name}` : ticker;
}

export default function TickersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          默认读取后端配置的 watchlist.yaml，可点击跳转到详情页查看 K 线与信息。
        </p>
      </div>
      <Suspense fallback={<SkeletonSection />}>
        <TickersSection />
      </Suspense>
    </div>
  );
}

async function TickersSection() {
  const universe = await fetchUniverse();
  const tickers = universe.watchlist?.length ? universe.watchlist : universe.tickers || [];
  const labelMap = universe.tickerInfo || {};
  const defaultTf = "6M_1d";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>关注列表</CardTitle>
          <CardDescription>
            {tickers.length} 个标的 · 默认 timeframe：{defaultTf}
          </CardDescription>
        </div>
        <RefreshButton tickers={tickers} label="刷新缓存" />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tickers.map((ticker) => (
          <Link
            key={ticker}
            href={`/dashboard/tickers/${encodeURIComponent(ticker)}`}
            className="group rounded-lg border bg-card/50 p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-base font-medium leading-tight">{formatLabel(ticker, labelMap)}</div>
                <div className="text-xs text-muted-foreground">默认 timeframe：{universe.timeframes?.[0] ?? "—"}</div>
              </div>
              <Badge variant="outline" className="gap-1">
                查看
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Badge>
            </div>
          </Link>
        ))}
        {!tickers.length && <div className="text-sm text-muted-foreground">暂无配置的 ticker</div>}
      </CardContent>
    </Card>
  );
}

function SkeletonSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>关注列表</CardTitle>
        <CardDescription>加载中...</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="h-20 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </CardContent>
    </Card>
  );
}
