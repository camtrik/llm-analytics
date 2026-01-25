"use client";

import { type ReactNode, useState } from "react";

import { type DefaultOptions, QueryClient, QueryClientProvider } from "@tanstack/react-query";

const DEFAULT_QUERY_OPTIONS: DefaultOptions["queries"] = {
  staleTime: 5 * 60 * 1000, // 5m: 避免重复拉取，提升返回体验
  gcTime: 10 * 60 * 1000, // 10m: 控制内存占用
  retry: 1,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
};

export function QueryClientRoot({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: DEFAULT_QUERY_OPTIONS,
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
