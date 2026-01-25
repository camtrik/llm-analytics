import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowRight, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addLocaleToPath } from "@/i18n/locale-path";
import { getRequestLocale } from "@/i18n/server-locale";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

type Params = { strategyId: string };

const strategyMap: Record<
  string,
  { titleKey: string; descriptionKey: string; pages: { href: string; labelKey: string }[] }
> = {
  "low-volume-pullback": {
    titleKey: "strategy.lvp.name",
    descriptionKey: "strategy.lvp.detail",
    pages: [
      { href: "/dashboard/strategy/low-volume-pullback/screener", labelKey: "strategy.lvp.tabs.screener" },
      { href: "/dashboard/strategy/low-volume-pullback/backtest", labelKey: "strategy.lvp.tabs.backtest" },
      { href: "/dashboard/strategy/low-volume-pullback/range", labelKey: "strategy.lvp.tabs.range" },
    ],
  },
};

function t(locale: "en" | "zh", key: string, fallback: string) {
  const messages = locale === "zh" ? (zhMessages as any) : (enMessages as any);
  return key.split(".").reduce((acc: any, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), messages) ?? fallback;
}

export default async function StrategyEntryPage({ params }: { params: Promise<Params> }) {
  const { strategyId } = await params;
  const strategy = strategyMap[strategyId];
  if (!strategy) notFound();
  const locale = await getRequestLocale();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t(locale, strategy.titleKey, "Low-Volume Pullback")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, strategy.descriptionKey, "Low-volume pullback: screener, backtest, range stats.")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {strategy.pages.map((page) => (
          <Card key={page.href} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t(locale, page.labelKey, page.labelKey)}</CardTitle>
              <CardDescription>
                {t(locale, "strategy.lvp.detailCardDesc", "Go to {page}").replace("{page}", t(locale, page.labelKey, page.labelKey))}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="outline" className="w-full">
                <Link href={addLocaleToPath(locale, page.href)} className="flex items-center justify-between">
                  <span>{t(locale, page.labelKey, page.labelKey)}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
