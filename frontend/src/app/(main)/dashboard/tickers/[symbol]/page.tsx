import Link from "next/link";
import { cookies } from "next/headers";

import { TickerChartSectionClient } from "@/components/tickers/ticker-chart-section.client";
import { Button } from "@/components/ui/button";
import { addLocaleToPath } from "@/i18n/locale-path";
import { fetchUniverse } from "@/lib/api/universe";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

type Params = { symbol: string };

export default async function TickerDetailPage({ params }: { params: Promise<Params> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol || "").toUpperCase();
  const cookieStore = await cookies();
  const locale = cookieStore.get("NEXT_LOCALE")?.value || "en";
  const t = (key: string, fallback: string) => {
    const messages = locale === "zh" ? (zhMessages as any) : (enMessages as any);
    return key.split(".").reduce((acc: any, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), messages) ?? fallback;
  };
  const universe = await fetchUniverse();
  const labelMap = universe.tickerInfo || {};
  const name = labelMap[symbol] ?? symbol;
  const defaultTimeframe = universe.timeframes.includes("6M_1d") ? "6M_1d" : universe.timeframes[0] || "6M_1d";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">{symbol}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={addLocaleToPath(locale, "/dashboard/tickers")}>{t("ticker.backToList", "Back to list")}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TickerChartSectionClient
          symbol={symbol}
          timeframes={universe.timeframes}
          defaultTimeframe={defaultTimeframe}
        />
      </div>
    </div>
  );
}
