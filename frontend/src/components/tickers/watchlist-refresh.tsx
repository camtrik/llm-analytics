"use client";

import { useState } from "react";

import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { useI18n } from "@/components/providers/i18n-provider";

type Props = { tickers: string[]; label?: string };

export function RefreshButton({ tickers, label }: Props) {
  const { t } = useI18n();
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
      if (!res.ok) throw new Error(t("ticker.refreshFail", "Refresh failed").replace("{status}", `${res.status}`));
      setMsg(t("ticker.refreshDone", "Refresh completed"));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("ticker.refreshFail", "Refresh failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={refresh} disabled={loading || !tickers.length}>
        <RefreshCcw className="mr-2 h-4 w-4" />
        {loading ? t("ticker.refreshing", "Refreshing...") : label ?? t("ticker.refresh", "Refresh cache")}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
