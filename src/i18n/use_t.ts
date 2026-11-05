// 型つきの翻訳関数。コンポーネントの文言は、すべてこの useT() の t から引く。
// vue-i18n の t と $t は、補完のためにキーの型を持つが、任意の文字列も受け付けてしまう。
// ここで辞書の型からキーとプレースホルダを決め、存在しないキーや足りないプレースホルダを型検査で検出する。
import { useI18n } from "vue-i18n";
import type { SourceMessages } from "./locales/ja";

/** 辞書の末端（文字列）までのキー。例: "title_bar.settings" */
export type MessageKey = LeafPaths<SourceMessages>;

type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : LeafPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

/** キーごとの引数。プレースホルダがなければ引数なし、あればその名前をすべて持つオブジェクト */
export type MessageArgs<K extends MessageKey> = [Placeholders<ValueAt<SourceMessages, K>>] extends [never]
  ? []
  : [params: Record<Placeholders<ValueAt<SourceMessages, K>>, string | number>];

export type Translate = <K extends MessageKey>(key: K, ...args: MessageArgs<K>) => string;

export function useT(): { t: Translate } {
  const { t } = useI18n({ useScope: "global" });
  const typed: Translate = (key, ...args) => (args.length > 0 ? t(key, args[0] as Record<string, unknown>) : t(key));
  return { t: typed };
}
