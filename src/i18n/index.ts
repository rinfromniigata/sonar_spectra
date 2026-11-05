// 国際化の入口。createI18n、ロケールの確定と切り替え、<html lang> の更新を受け持つ。
import { createI18n } from "vue-i18n";
import ja, { type MessageSchema } from "./locales/ja";
import {
  type AppLocale,
  type SupportedLocale,
  PSEUDO_LOCALE,
  SOURCE_LOCALE,
  languageTagOf,
  loadSavedLocale,
  resolveLocale,
  saveLocale,
} from "./locale";

// ja.ts の型を vue-i18n の辞書の型にする（補完用）。キーとプレースホルダの型検査は use_t.ts の useT() が受け持つ
declare module "vue-i18n" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 型の拡張（宣言のマージ）に必要
  export interface DefineLocaleMessage extends MessageSchema {}
}

/** `bun run dev:pseudo`（Viteの mode が pseudo）のときだけ真。公開版のビルドでは false に置き換わる */
const PSEUDO_ENABLED = import.meta.env.MODE === "pseudo";

export const i18n = createI18n<[MessageSchema], AppLocale, false>({
  legacy: false,
  // $t をコンポーネントに注入しない。文言は型つきの useT()（use_t.ts）から引く
  globalInjection: false,
  locale: SOURCE_LOCALE,
  fallbackLocale: SOURCE_LOCALE,
  messages: { [SOURCE_LOCALE]: ja } as Record<AppLocale, MessageSchema>,
});

function applyHtmlLang(locale: AppLocale): void {
  // tokens.css の :lang() で --font-ui が切り替わる
  document.documentElement.lang = languageTagOf(locale);
}

/** 現在のロケール（疑似ロケールを含む） */
export function currentLocale(): AppLocale {
  return i18n.global.locale.value;
}

/** Intl に渡す言語タグ（疑似ロケールでは原文の言語） */
export function currentLanguageTag(): SupportedLocale {
  return languageTagOf(currentLocale());
}

/** ロケールを切り替えて保持する（初版は切り替えUIを出さない） */
export function setLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale;
  saveLocale(locale);
  applyHtmlLang(locale);
}

/** 起動時にロケールを確定する。マウント前に呼ぶ */
export async function initLocale(): Promise<void> {
  if (PSEUDO_ENABLED) {
    const { createPseudoMessages } = await import("./pseudo");
    i18n.global.setLocaleMessage(PSEUDO_LOCALE, createPseudoMessages(ja));
    i18n.global.locale.value = PSEUDO_LOCALE;
    applyHtmlLang(PSEUDO_LOCALE);
    return;
  }
  const locale = resolveLocale(loadSavedLocale(), navigator.languages ?? [navigator.language]);
  i18n.global.locale.value = locale;
  applyHtmlLang(locale);
}
