"use client";

import { RefreshCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";

type Props = { tickers: string[] };

export function RefreshButton({ tickers }: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    if (!tickers.length) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error(`刷新失败 (${res.status})`);
      setMsg("刷新完成");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={refresh} disabled={loading || !tickers.length}>
        <RefreshCcw className="mr-2 h-4 w-4" />
        {loading ? "刷新中..." : "刷新缓存"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
