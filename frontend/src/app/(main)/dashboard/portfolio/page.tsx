"use client";

import { useEffect, useState } from "react";

import { Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE, getJson } from "@/lib/api";

type Position = {
  ticker: string;
  qty: number;
  avg_cost?: number | null;
  currency?: string | null;
  name?: string | null;
};

type Portfolio = {
  positions: Position[];
  source: string;
  importedAt: string;
};

type ImportResult = {
  positions: Position[];
  importedAt: string;
  skipped: number;
};

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = () => {
    getJson<Portfolio>("/api/portfolio")
      .then((p) => setPortfolio(p))
      .catch(() => {
        // ignore if empty
      });
  };

  useEffect(() => {
    load();
  }, []);

  const onUpload = async () => {
    if (!file) {
      setError("请选择 CSV 文件");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/portfolio/import/sbi`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`导入失败 (${res.status})`);
      const data = (await res.json()) as ImportResult;
      setInfo(`成功导入 ${data.positions.length} 条，跳过 ${data.skipped}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-muted-foreground">上传 SBI CSV 并查看当前持仓。</p>
      </div>

      {error && (
        <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert className="border-primary/50 bg-primary/5 text-primary">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">导入</CardTitle>
          <CardDescription>选择 SBI 导出的 CSV 文件</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="md:w-2/3"
          />
          <Button onClick={onUpload} disabled={loading} variant="default">
            <Upload className="mr-2 h-4 w-4" />
            {loading ? "导入中..." : "导入"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前持仓</CardTitle>
          <CardDescription>
            {portfolio
              ? `来源: ${portfolio.source} · 导入于 ${new Date(portfolio.importedAt).toISOString().slice(0, 16).replace("T", " ")}`
              : "尚未导入"}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>数量</TableHead>
                <TableHead>成本</TableHead>
                <TableHead>币种</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {portfolio?.positions?.length ? (
                portfolio.positions.map((p, idx) => (
                  <TableRow key={`${p.ticker}-${idx}`}>
                    <TableCell>
                      <div className="font-medium">{p.ticker}</div>
                      <div className="text-xs text-muted-foreground">{p.name}</div>
                    </TableCell>
                    <TableCell>{p.qty}</TableCell>
                    <TableCell>{p.avg_cost ?? "-"}</TableCell>
                    <TableCell>{p.currency ?? "-"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    尚无持仓
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
