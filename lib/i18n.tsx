"use client";

import { createContext, useContext, useMemo } from "react";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import zh from "@/messages/zh.json";
import vi from "@/messages/vi.json";
import ko from "@/messages/ko.json";

// UI strings, driven by owners.preferredLanguage. English is the fallback for
// missing keys and unknown languages. Keys are typed from en.json.

export type MessageKey = keyof typeof en;
type Messages = Partial<Record<MessageKey, string>>;

const MESSAGES: Record<string, Messages> = { en, es, zh, vi, ko };

export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeT(language: string): T {
  const messages = MESSAGES[language] ?? en;
  return (key, vars) => {
    const template = messages[key] ?? en[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

/** Translated name for a docType; never shows a raw code unless the type is new. */
export function docTypeName(t: T, docType: string): string {
  const key = `docType.${docType}` as MessageKey;
  return key in en ? t(key) : docType;
}

const I18nContext = createContext<{ language: string; t: T }>({
  language: "en",
  t: makeT("en"),
});

export function I18nProvider({
  language,
  children,
}: {
  language: string;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ language, t: makeT(language) }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
