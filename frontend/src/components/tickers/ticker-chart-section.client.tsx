"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TickerChartSectionProps } from "@/components/tickers/ticker-chart";

const TickerChartSection = dynamic(
  () => import("@/components/tickers/ticker-chart").then((mod) => mod.TickerChartSection),
  {
    ssr: false,
    loading: () => <TickerChartSectionSkeleton />,
  },
);

export function TickerChartSectionClient(props: TickerChartSectionProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <TickerChartSectionSkeleton />;
  }

  return <TickerChartSection {...props} />;
}

function TickerChartSectionSkeleton() {
  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[320px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    </>
  );
}
