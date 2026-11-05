// ロケールの判定・保持・フォールバック。vue-i18n に依存しない純粋な部分。

/** 公開版で使える言語。原文の言語を先頭に置く */
export const SUPPORTED_LOCALES = ["ja"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 原文の言語。どの言語でも見つからないキーはここへフォールバックする */
export const SOURCE_LOCALE: SupportedLocale = "ja";

/** 疑似ロケール（開発時のみ）。<html lang> と Intl には原文の言語を使う */
export const PSEUDO_LOCALE = "ja-x-pseudo";
export type AppLocale = SupportedLocale | typeof PSEUDO_LOCALE;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * OSの言語タグ（例: "ja-JP"、"zh-Hans-CN"）を、対応している言語に寄せる。
 * 完全一致 → 先頭から部分タグを1つずつ落として一致、の順で探す。
 */
export function matchLocale(tag: string): SupportedLocale | null {
  const parts = tag.split("-");
  while (parts.length > 0) {
    const candidate = parts.join("-");
    const found = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
    parts.pop();
  }
  return null;
}

/** 判定の順：保存値 → OSの言語（優先順） → 原文の言語 */
export function resolveLocale(saved: string | null, osLocales: readonly string[]): SupportedLocale {
  if (isSupportedLocale(saved)) return saved;
  for (const tag of osLocales) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return SOURCE_LOCALE;
}

/** <html lang> と Intl に渡す言語タグ */
export function languageTagOf(locale: AppLocale): SupportedLocale {
  return locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
}

// 保持：初版は言語が1つで切り替えUIを出さないため、WebViewの localStorage に小さく保持する。
// 言語を追加する仕様変更のときに、state.json（settings_store）へ移す。
const STORAGE_KEY = "sonar_spectra.locale";

export function loadSavedLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLocale(locale: SupportedLocale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // 保持できなくても、次回は OSの言語 → 原文の言語 で判定できる
  }
}
