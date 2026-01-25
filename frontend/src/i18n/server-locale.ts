import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  return isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
}
