export function formatNumber(value: number | null | undefined, locale: string, options?: Intl.NumberFormatOptions) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale, options ?? { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number | null | undefined, locale: string, options?: Intl.NumberFormatOptions) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatDate(
  value: Date | number | string | null | undefined,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
) {
  if (value === null || value === undefined) return "—";
  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : typeof value === "string"
        ? new Date(value)
        : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, options ?? { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
