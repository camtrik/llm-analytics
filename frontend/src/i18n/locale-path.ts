/**
 * NOTE: We currently use a “no path prefix + NEXT_LOCALE cookie” setup.
 * - addLocaleToPath / stripLocaleFromPath DO NOT add/remove /en|/zh prefixes; they only normalize paths.
 * - If we switch to prefix-based routing later, re-enable prefix logic here.
 */
import type { Locale } from "./config";

export function addLocaleToPath(_locale: Locale, href: string): string {
  if (!href) return "/";
  if (href.startsWith("http")) return href;
  return href.startsWith("/") ? href : `/${href}`;
}

export function stripLocaleFromPath(pathname: string): string {
  return pathname || "/";
}
