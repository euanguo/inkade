import i18next, { type i18n as I18nInstance, type TFunction } from "i18next";
import React, { useCallback, useEffect, useState } from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { enUS } from "./locales/en-US.ts";
import { type InkadeTranslationSchema, zhCN } from "./locales/zh-CN.ts";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type InkadeLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: InkadeLocale = "zh-CN";
export const LOCALE_STORAGE_KEY = "inkade:locale";

export const inkadeResources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
} as const;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: InkadeTranslationSchema;
    };
  }
}

export function normalizeInkadeLocale(raw: string | null | undefined): InkadeLocale {
  if (!raw) return DEFAULT_LOCALE;
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("en")) return "en-US";
  if (lower.startsWith("zh")) return "zh-CN";
  return DEFAULT_LOCALE;
}

export function detectInitialLocale(): InkadeLocale {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
      if (stored === "zh-CN" || stored === "en-US") {
        return stored;
      }
    } catch {
      // ignore storage errors
    }
    if (typeof navigator !== "undefined" && navigator.language) {
      return normalizeInkadeLocale(navigator.language);
    }
  }
  return DEFAULT_LOCALE;
}

function syncDocumentLang(locale: InkadeLocale): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = locale;
  }
}

export const inkadeI18n: I18nInstance = i18next.createInstance();

void inkadeI18n.use(initReactI18next).init({
  resources: inkadeResources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
  showSupportNotice: false,
  initImmediate: false,
});

syncDocumentLang(normalizeInkadeLocale(inkadeI18n.language));

export function initInkadeI18n(locale?: InkadeLocale): InkadeLocale {
  const target = locale ?? detectInitialLocale();
  if (inkadeI18n.language !== target) {
    void inkadeI18n.changeLanguage(target);
  }
  syncDocumentLang(target);
  return target;
}

export function getInkadeLocale(): InkadeLocale {
  return normalizeInkadeLocale(inkadeI18n.language);
}

export function setInkadeLocale(locale: InkadeLocale): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore storage errors
    }
  }
  syncDocumentLang(locale);
  void inkadeI18n.changeLanguage(locale);
}

export const t = ((...args: unknown[]) =>
  (inkadeI18n.t as unknown as (...inner: unknown[]) => string)(...args)) as unknown as TFunction<
  "translation",
  undefined
>;

export function useInkadeTranslation() {
  return useTranslation("translation", { i18n: inkadeI18n });
}

export function useInkadeLocale(): {
  readonly locale: InkadeLocale;
  readonly setLocale: (next: InkadeLocale) => void;
  readonly locales: readonly InkadeLocale[];
} {
  const [locale, setLocaleState] = useState<InkadeLocale>(() => getInkadeLocale());

  useEffect(() => {
    const onChanged = (lng: string) => {
      setLocaleState(normalizeInkadeLocale(lng));
    };
    inkadeI18n.on("languageChanged", onChanged);
    return () => {
      inkadeI18n.off("languageChanged", onChanged);
    };
  }, []);

  const updateLocale = useCallback((next: InkadeLocale) => {
    setInkadeLocale(next);
  }, []);

  return {
    locale,
    setLocale: updateLocale,
    locales: SUPPORTED_LOCALES,
  };
}

export function InkadeI18nProvider({
  children,
  locale,
}: {
  readonly children: React.ReactNode;
  readonly locale?: InkadeLocale | undefined;
}): React.ReactElement {
  useEffect(() => {
    if (locale) {
      setInkadeLocale(locale);
    }
  }, [locale]);

  return React.createElement(I18nextProvider, { i18n: inkadeI18n }, children);
}

export { enUS, zhCN };
export type { InkadeTranslationSchema };
