"use client";

import { createContext, useContext, useMemo } from "react";

import type { Locale } from "@/i18n/config";

type Messages = Record<string, string | Messages>;

type I18nContextValue = {
  locale: Locale;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function lookup(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: string | Messages | undefined = messages;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Messages)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key: string, fallback?: string) => lookup(messages, key) ?? fallback ?? key,
    }),
    [locale, messages],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
