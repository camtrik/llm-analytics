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
import { useI18n } from "@/components/providers/i18n-provider";

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
  const { t } = useI18n();
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
      setError(t("portfolio.needFile", "Please choose a CSV file"));
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
      if (!res.ok) throw new Error(t("portfolio.importFail", "Import failed ({status})").replace("{status}", `${res.status}`));
      const data = (await res.json()) as ImportResult;
      setInfo(
        t("portfolio.importSuccess", "Imported {count} items, skipped {skipped}")
          .replace("{count}", `${data.positions.length}`)
          .replace("{skipped}", `${data.skipped}`),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("portfolio.importFailUnknown", "Import failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("portfolio.title", "Portfolio")}</h1>
        <p className="text-sm text-muted-foreground">{t("portfolio.subtitle", "Upload SBI CSV to view current positions.")}</p>
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
          <CardTitle className="text-base">{t("portfolio.import", "Import")}</CardTitle>
          <CardDescription>{t("portfolio.importDesc", "Select the CSV exported from SBI")}</CardDescription>
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
            {loading ? t("portfolio.importing", "Importing...") : t("portfolio.importBtn", "Import")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("portfolio.current", "Current Positions")}</CardTitle>
          <CardDescription>
            {portfolio
              ? t("portfolio.source", "Source: {source} · Imported at {time}")
                  .replace("{source}", portfolio.source)
                  .replace("{time}", new Date(portfolio.importedAt).toISOString().slice(0, 16).replace("T", " "))
              : t("portfolio.notImported", "Not imported yet")}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>{t("portfolio.qty", "Qty")}</TableHead>
                <TableHead>{t("portfolio.cost", "Cost")}</TableHead>
                <TableHead>{t("portfolio.currency", "Currency")}</TableHead>
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
                  {t("portfolio.empty", "No positions")}
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
