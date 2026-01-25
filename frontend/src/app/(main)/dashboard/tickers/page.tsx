import { Suspense } from "react";

import Link from "next/link";

import { ArrowUpRight } from "lucide-react";

import { RefreshButton } from "@/components/tickers/watchlist-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { addLocaleToPath } from "@/i18n/locale-path";
import { getRequestLocale } from "@/i18n/server-locale";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { fetchUniverse, type UniverseResponse } from "@/lib/universe";

const messagesMap = {
  en: enMessages,
  zh: zhMessages,
};

function t(locale: Locale, key: string, fallback: string) {
  const parts = key.split(".");
  let current: any = messagesMap[locale] ?? messagesMap[DEFAULT_LOCALE];
  for (const part of parts) {
    if (!current || typeof current !== "object") return fallback;
    current = current[part];
  }
  return typeof current === "string" ? current : fallback;
}

function formatLabel(ticker: string, info: Record<string, string>) {
  const name = info[ticker];
  return name ? `${ticker} · ${name}` : ticker;
}

export default async function TickersPage() {
  const locale: Locale = await getRequestLocale();
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t(locale, "ticker.watchlistTitle", "Watchlist")}</h1>
        <p className="text-sm text-muted-foreground">{t(locale, "ticker.watchlistDesc", "Loads watchlist.yaml.")}</p>
      </div>
      <Suspense fallback={<SkeletonSection locale={locale} />}>
        <TickersSection locale={locale} />
      </Suspense>
    </div>
  );
}

async function TickersSection({ locale }: { locale: Locale }) {
  const universe = await fetchUniverse();
  const tickers = universe.watchlist?.length ? universe.watchlist : universe.tickers || [];
  const labelMap = universe.tickerInfo || {};
  const defaultTf = "6M_1d";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{t(locale, "ticker.watchlistTitle", "Watchlist")}</CardTitle>
          <CardDescription>
            {tickers.length} · {t(locale, "ticker.defaultTimeframe", "Default timeframe")}：{defaultTf}
          </CardDescription>
        </div>
        <RefreshButton tickers={tickers} label={t(locale, "ticker.refresh", "Refresh cache")} />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tickers.map((ticker) => (
          <Link
            key={ticker}
            href={addLocaleToPath(locale, `/dashboard/tickers/${encodeURIComponent(ticker)}`)}
            className="group rounded-lg border bg-card/50 p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-base font-medium leading-tight">{formatLabel(ticker, labelMap)}</div>
                <div className="text-xs text-muted-foreground">
                  {t(locale, "ticker.defaultTimeframe", "Default timeframe")}：{universe.timeframes?.[0] ?? "—"}
                </div>
              </div>
              <Badge variant="outline" className="gap-1">
                {t(locale, "ticker.view", "View")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Badge>
            </div>
          </Link>
        ))}
        {!tickers.length && (
          <div className="text-sm text-muted-foreground">{t(locale, "ticker.none", "No tickers configured")}</div>
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonSection({ locale }: { locale: Locale }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, "ticker.watchlistTitle", "Watchlist")}</CardTitle>
        <CardDescription>{t(locale, "ticker.loading", "Loading...")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="h-20 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </CardContent>
    </Card>
  );
}
