import { ArrowUpRight, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getJson, API_BASE } from "@/lib/api";
import { RefreshButton } from "@/components/tickers/watchlist-refresh";

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

async function fetchOptions(): Promise<OptionsResponse> {
  return getJson<OptionsResponse>("/api/options");
}

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
          默认读取后端配置的 tickers.yaml，可点击跳转到详情页查看 K 线与信息。
        </p>
      </div>
      <Suspense fallback={<SkeletonSection />}>
        <TickersSection />
      </Suspense>
    </div>
  );
}

async function TickersSection() {
  const options = await fetchOptions();
  const tickers = options.tickers || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>关注列表</CardTitle>
          <CardDescription>{tickers.length} 个标的</CardDescription>
        </div>
        <RefreshButton tickers={tickers} />
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
                <div className="text-base font-medium leading-tight">
                  {formatLabel(ticker, options.tickerInfo || {})}
                </div>
                <div className="text-xs text-muted-foreground">
                  默认 timeframe：{options.timeframes?.[0] ?? "—"}
                </div>
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
          <div
            key={idx}
            className="h-20 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </CardContent>
    </Card>
  );
}
