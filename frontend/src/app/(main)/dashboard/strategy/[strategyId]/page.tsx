import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Params = { strategyId: string };

const strategyMap = {
  "low-volume-pullback": {
    title: "Low-Volume Pullback",
    description: "缩量回调阴线策略：筛选、单日回测、区间统计。",
    pages: [
      { href: "/dashboard/strategy/low-volume-pullback/screener", label: "筛选" },
      { href: "/dashboard/strategy/low-volume-pullback/backtest", label: "单日回测" },
      { href: "/dashboard/strategy/low-volume-pullback/range", label: "区间统计" },
    ],
  },
} satisfies Record<string, { title: string; description: string; pages: { href: string; label: string }[] }>;

export default async function StrategyEntryPage({ params }: { params: Promise<Params> }) {
  const { strategyId } = await params;
  const strategy = strategyMap[strategyId];
  if (!strategy) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{strategy.title}</h1>
          <p className="text-sm text-muted-foreground">{strategy.description}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {strategy.pages.map((page) => (
          <Card key={page.href} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{page.label}</CardTitle>
              <CardDescription>进入 {page.label}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Button asChild variant="outline" className="w-full">
                <Link href={page.href} className="flex items-center justify-between">
                  <span>{page.label}</span>
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
