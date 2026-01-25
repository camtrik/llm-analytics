import Link from "next/link";

import { ListChecks, Waypoints } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addLocaleToPath } from "@/i18n/locale-path";
import { getRequestLocale } from "@/i18n/server-locale";

const strategies = [
  {
    id: "low-volume-pullback",
    title: "Low-Volume Pullback",
    description: "缩量回调阴线筛选与回测（已实现后端接口）",
    icon: ListChecks,
  },
];

export default async function StrategyHubPage() {
  const locale = await getRequestLocale();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Waypoints className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">策略入口</h1>
          <p className="text-sm text-muted-foreground">选择策略进入筛选 / 回测 / 区间统计</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {strategies.map((item) => (
          <Card key={item.id} className="flex flex-col">
            <CardHeader className="flex flex-row items-start gap-3 pb-3">
              <item.icon className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="default">
                <Link href={addLocaleToPath(locale, `/dashboard/strategy/${item.id}`)}>进入</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
