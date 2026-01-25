import Link from "next/link";

import { ListChecks, Waypoints } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addLocaleToPath } from "@/i18n/locale-path";
import { getRequestLocale } from "@/i18n/server-locale";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

const strategies = [
  {
    id: "low-volume-pullback",
    titleKey: "strategy.lvp.name",
    descriptionKey: "strategy.lowVolumeDesc",
    icon: ListChecks,
  },
];

function t(locale: "en" | "zh", key: string, fallback: string) {
  const messages = locale === "zh" ? (zhMessages as any) : (enMessages as any);
  return key.split(".").reduce((acc: any, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), messages) ?? fallback;
}

export default async function StrategyHubPage() {
  const locale = await getRequestLocale();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Waypoints className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t(locale, "strategy.hubTitle", "Strategy Hub")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, "strategy.hubDesc", "Choose a strategy to run screener / backtest / range stats.")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {strategies.map((item) => (
          <Card key={item.id} className="flex flex-col">
            <CardHeader className="flex flex-row items-start gap-3 pb-3">
              <item.icon className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">
                  {t(locale, item.titleKey, "Low-Volume Pullback")}
                </CardTitle>
                <CardDescription>
                  {t(locale, item.descriptionKey, "Low-volume pullback screener & backtest (backend ready)")}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="default">
                <Link href={addLocaleToPath(locale, `/dashboard/strategy/${item.id}`)}>
                  {t(locale, "strategy.enter", "Enter")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
