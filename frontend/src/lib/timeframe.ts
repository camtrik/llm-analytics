type TimeframeUnit = "D" | "W" | "M" | "Y";
type BarUnit = "m" | "h" | "d" | "wk";

export type TimeframeParts = {
  range: { n: number; u: TimeframeUnit };
  bar: { n: number; u: BarUnit };
};

const TIMEFRAME_RE = /^(\d+)([DWMY])_(\d+)(m|h|d|wk)$/i;

const RANGE_ORDER: Record<TimeframeUnit, number> = {
  D: 1,
  W: 7,
  M: 30,
  Y: 365,
};

const BAR_ORDER: Record<BarUnit, number> = {
  m: 1,
  h: 60,
  d: 1440,
  wk: 10080,
};

export function parseTimeframe(id: string): TimeframeParts | null {
  const match = TIMEFRAME_RE.exec(id);
  if (!match) return null;
  const rangeCount = Number.parseInt(match[1] ?? "", 10);
  const rangeUnit = (match[2] ?? "").toUpperCase() as TimeframeUnit;
  const barCount = Number.parseInt(match[3] ?? "", 10);
  const barUnit = (match[4] ?? "").toLowerCase() as BarUnit;
  if (!rangeCount || !barCount) return null;
  if (!(rangeUnit in RANGE_ORDER) || !(barUnit in BAR_ORDER)) return null;
  return { range: { n: rangeCount, u: rangeUnit }, bar: { n: barCount, u: barUnit } };
}

function formatBarUnit(unit: BarUnit) {
  if (unit === "wk") return "W";
  return unit.toUpperCase();
}

export function formatTimeframeLabel(id: string): string {
  const parsed = parseTimeframe(id);
  if (!parsed) return id;
  return `${parsed.range.n}${parsed.range.u} · ${parsed.bar.n}${formatBarUnit(parsed.bar.u)}`;
}

export function timeframeSortKey(id: string): number {
  const parsed = parseTimeframe(id);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  const rangeScore = parsed.range.n * RANGE_ORDER[parsed.range.u];
  const barScore = parsed.bar.n * BAR_ORDER[parsed.bar.u];
  return rangeScore * 1_000_000 + barScore;
}

export function sortTimeframes(ids: string[]): string[] {
  return [...ids].sort((a, b) => timeframeSortKey(a) - timeframeSortKey(b));
}
