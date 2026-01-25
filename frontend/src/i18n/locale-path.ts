import type { Locale } from "./config";

export function addLocaleToPath(_locale: Locale, href: string): string {
  if (!href) return "/";
  if (href.startsWith("http")) return href;
  return href.startsWith("/") ? href : `/${href}`;
}

export function stripLocaleFromPath(pathname: string): string {
  return pathname || "/";
}
