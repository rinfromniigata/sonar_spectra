// 疑似ロケール（開発時のみ）。原文の文字列を約35%伸ばし、⟦…⟧で囲む。
// 直書きの取りこぼし（囲まれていない文字列）と、文字列が伸びたときの崩れを画面で確かめるために使う。
// `bun run dev:pseudo` で起動したときだけ読み込まれ、公開版には含まれない。
import type { MessageSchema } from "./locales/ja";

const EXPAND_RATIO = 0.35;
const PAD_CHAR = "～";
const PLACEHOLDER = /\{[^{}]*\}/g;

export function pseudoString(source: string): string {
  // プレースホルダは伸ばす長さの計算から外し、そのまま残す
  const visibleLength = source.replace(PLACEHOLDER, "").length;
  const padding = PAD_CHAR.repeat(Math.max(1, Math.ceil(visibleLength * EXPAND_RATIO)));
  return `⟦${source}${padding}⟧`;
}

type Messages = { [key: string]: string | Messages };

function transform<T extends Messages>(messages: T): T {
  const result: Messages = {};
  for (const [key, value] of Object.entries(messages)) {
    result[key] = typeof value === "string" ? pseudoString(value) : transform(value);
  }
  return result as T;
}

export function createPseudoMessages(source: MessageSchema): MessageSchema {
  return transform(source);
}
