import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const DEFAULT_LOCALE = "en";
const SUPPORTED = new Set(["en", "zh"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // skip static/API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (!cookieLocale || !SUPPORTED.has(cookieLocale)) {
    response.cookies.set("NEXT_LOCALE", DEFAULT_LOCALE, { path: "/" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
