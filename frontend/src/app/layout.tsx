import type { ReactNode } from "react";

import type { Metadata } from "next";
import { cookies } from "next/headers";

import { QueryClientRoot } from "@/components/providers/query-client-provider";
import { Toaster } from "@/components/ui/sonner";
import { APP_CONFIG } from "@/config/app-config";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";
import { fontVars } from "@/lib/fonts/registry";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { ThemeBootScript } from "@/scripts/theme-boot";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_CONFIG.meta.title,
  description: APP_CONFIG.meta.description,
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { theme_mode, theme_preset, content_layout, navbar_style, sidebar_variant, sidebar_collapsible, font } =
    PREFERENCE_DEFAULTS;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const messages = locale === "zh" ? zhMessages : enMessages;

  return (
    <html
      lang={locale}
      data-locale={locale}
      data-theme-mode={theme_mode}
      data-theme-preset={theme_preset}
      data-content-layout={content_layout}
      data-navbar-style={navbar_style}
      data-sidebar-variant={sidebar_variant}
      data-sidebar-collapsible={sidebar_collapsible}
      data-font={font}
      suppressHydrationWarning
    >
      <head>
        {/* Applies theme and layout preferences on load to avoid flicker and unnecessary server rerenders. */}
        <ThemeBootScript />
      </head>
      <body className={`${fontVars} min-h-screen antialiased`}>
        <QueryClientRoot>
          <I18nProvider locale={locale} messages={messages}>
            <PreferencesStoreProvider
              themeMode={theme_mode}
              themePreset={theme_preset}
              contentLayout={content_layout}
              navbarStyle={navbar_style}
              font={font}
            >
              {children}
              <Toaster />
            </PreferencesStoreProvider>
          </I18nProvider>
        </QueryClientRoot>
      </body>
    </html>
  );
}
