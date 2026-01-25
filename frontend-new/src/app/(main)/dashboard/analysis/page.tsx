"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Send } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getJson, API_BASE } from "@/lib/api";

type ProviderInfo = {
  name: string;
  defaultModel: string;
  baseUrl: string;
  available: boolean;
};

type ProvidersResponse = {
  providers: ProviderInfo[];
  defaultProvider: string;
};

type OptionsResponse = {
  tickers: string[];
  timeframes: string[];
  tickerInfo: Record<string, string>;
};

type ConversationEntry = { role: "assistant" | "user"; content: string };

type AnalysisAction = {
  ticker: string;
  action: string;
  timeframe: string;
  rationale: string;
  confidence: number;
};

type AnalysisResult = {
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    asOf: string;
  };
  summary: string;
  actions: AnalysisAction[];
  doNotTradeIf: string[];
  conversation: ConversationEntry[];
};

type AnalysisRunResponse = {
  id: number;
  result: AnalysisResult;
};

export default function AnalysisPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>("gpt");
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("gpt");
  const [promptLanguage, setPromptLanguage] = useState<"en" | "zh">("en");
  const [runId, setRunId] = useState<number | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<ProvidersResponse>("/api/analysis/providers")
      .then((res) => {
        setProviders(res.providers);
        setDefaultProvider(res.defaultProvider);
        setSelectedProvider(res.defaultProvider);
      })
      .catch((err) => setError(err.message));
    getJson<OptionsResponse>("/api/options")
      .then((res) => setOptions(res))
      .catch((err) => setError(err.message));
  }, []);

  const tickerInfo = options?.tickerInfo ?? {};
  const sortedTickers = options?.tickers ?? [];

  const runAnalysis = async () => {
    if (!selectedTickers.length) {
      setError("请选择至少一个 ticker。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const feed = await getJson("/api/analysis/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradableTickers: selectedTickers,
          includePositions: true,
        }),
      });
      const payload = {
        provider: selectedProvider || defaultProvider,
        promptLanguage,
        feed,
        promptVersion: "v1",
      };
      const res = await fetch(`${API_BASE}/api/analysis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`分析失败 (${res.status})`);
      const data = (await res.json()) as AnalysisRunResponse;
      setRunId(data.id);
      setResult(data.result);
      setConversation(data.result.conversation || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!runId) {
      setError("请先运行一次分析。");
      return;
    }
    const content = message.trim();
    if (!content) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analysis/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, userMessage: content }),
      });
      if (!res.ok) throw new Error(`发送失败 (${res.status})`);
      const data = (await res.json()) as AnalysisRunResponse;
      setResult(data.result);
      setConversation(data.result.conversation || []);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  const currentSummary = result?.summary ?? "尚未生成分析";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">LLM Analysis</h1>
          <p className="text-sm text-muted-foreground">
            选择 ticker + provider，生成结构化建议；对话区仅展示 conversation。
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/tickers">
            返回 Tickers
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {error && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">结构化结果</CardTitle>
            <CardDescription>summary / actions / doNotTradeIf</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Summary</p>
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{currentSummary}</p>
            </div>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">Actions</p>
              {result?.actions?.length ? (
                <div className="grid gap-2">
                  {result.actions.map((a, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{a.ticker}</Badge>
                        <span className="font-semibold">{a.action}</span>
                        <span className="text-muted-foreground">{a.timeframe}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        置信度 {(a.confidence * 100).toFixed(0)}%
                      </div>
                      <div className="w-full text-sm text-muted-foreground mt-1">{a.rationale}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无 actions</p>
              )}
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium">Do not trade if</p>
              {result?.doNotTradeIf?.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {result.doNotTradeIf.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">无</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">参数与运行</CardTitle>
            <CardDescription>选择 provider 与 tickers，然后运行</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Provider</p>
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <Badge
                    key={p.name}
                    variant={selectedProvider === p.name ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setSelectedProvider(p.name)}
                  >
                    {p.name} {p.available ? "" : "(未配置)"}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Prompt Language</p>
              <div className="flex gap-2">
                {(["en", "zh"] as const).map((lang) => (
                  <Badge
                    key={lang}
                    variant={promptLanguage === lang ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setPromptLanguage(lang)}
                  >
                    {lang}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">选择 tickers</p>
              <div className="flex flex-wrap gap-2">
                {sortedTickers.map((t) => {
                  const active = selectedTickers.includes(t);
                  return (
                    <Badge
                      key={t}
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() =>
                        setSelectedTickers((prev) =>
                          active ? prev.filter((x) => x !== t) : [...prev, t],
                        )
                      }
                    >
                      {t} {tickerInfo[t] ? `· ${tickerInfo[t]}` : ""}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <Button className="w-full" onClick={runAnalysis} disabled={loading}>
              {loading ? "运行中..." : "生成分析"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
          <CardDescription>仅展示 user/assistant 消息</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
            {conversation.length ? (
              conversation.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-md border bg-background px-3 py-2 shadow-sm"
                >
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {item.role}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{item.content}</div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">暂无对话</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Textarea
              placeholder="发送新消息（先运行一次分析）"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={loading || !runId}
              className="min-h-[72px]"
            />
            <Button onClick={sendMessage} disabled={loading || !runId} variant="default">
              <Send className="mr-2 h-4 w-4" />
              发送
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
