// 日付・数値の整形。Intl に現在のロケールを渡す（文字列の連結で数値や日付を組み立てない）。
import { currentLanguageTag } from "./index";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = currentLanguageTag();
  const key = `n|${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    cache.set(key, format);
  }
  return format;
}

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = currentLanguageTag();
  const key = `d|${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(key, format);
  }
  return format;
}

/** 構成の保存日など（ISO 8601 の文字列か Date）。ja では "2026/11/04" */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return dateTimeFormat({ year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** dB の値（小数1桁、マイナスは符号つき）。単位は辞書側のプレースホルダの外に置く */
export function formatDecibel(value: number): string {
  return numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/** 流れる速さなどの倍率（小数2桁）。"×" は辞書の common.speed_value に置く */
export function formatMultiplier(value: number): string {
  return numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** 割合。0〜100 の値を受け取り、"72%" のように整形する */
export function formatPercent(value: number): string {
  return numberFormat({ style: "percent", maximumFractionDigits: 0 }).format(value / 100);
}

/** 個数などの整数 */
export function formatInteger(value: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(value);
}
