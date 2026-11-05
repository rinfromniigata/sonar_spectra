// i18n の自動検査の中身（純粋関数）。CLI は scripts/i18n_check.ts。
import { baseCompile } from "@intlify/message-compiler";

export type Messages = { [key: string]: string | Messages };

export interface Issue {
  kind:
    | "missing_key"
    | "extra_key"
    | "placeholder_mismatch"
    | "invalid_syntax"
    | "unused_key"
    | "pending_key_used"
    | "pending_key_unknown";
  locale?: string;
  key: string;
  detail?: string;
}

/** 入れ子の辞書を "a.b.c" → 文字列 の表にする */
export function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = `${prefix}${key}`;
    if (typeof value === "string") {
      result.set(path, value);
    } else {
      for (const [k, v] of flatten(value, `${path}.`)) result.set(k, v);
    }
  }
  return result;
}

/** 文字列に含まれるプレースホルダの名前（{name}） */
export function placeholdersOf(message: string): Set<string> {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([^{}\s]+)\s*\}/g)) names.add(match[1]);
  return names;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** vue-i18n のメッセージ構文として読めるか（"@" は連結キー、"{" は補間として解釈される） */
export function syntaxErrorsOf(message: string): string[] {
  const errors: string[] = [];
  baseCompile(message, { onError: (e) => errors.push(e.message) });
  return errors;
}

/** 原文の辞書に対する、ほかのロケールのキーの過不足とプレースホルダの食い違い */
export function compareLocale(source: Map<string, string>, target: Map<string, string>, locale: string): Issue[] {
  const issues: Issue[] = [];
  for (const [key, message] of source) {
    const translated = target.get(key);
    if (translated === undefined) {
      issues.push({ kind: "missing_key", locale, key });
      continue;
    }
    const expected = placeholdersOf(message);
    const actual = placeholdersOf(translated);
    if (!sameSet(expected, actual)) {
      issues.push({
        kind: "placeholder_mismatch",
        locale,
        key,
        detail: `原文 {${[...expected].join("}, {")}} ／ ${locale} {${[...actual].join("}, {")}}`,
      });
    }
  }
  for (const key of target.keys()) {
    if (!source.has(key)) issues.push({ kind: "extra_key", locale, key });
  }
  return issues;
}

/** すべての文字列の構文 */
export function checkSyntax(messages: Map<string, string>, locale: string): Issue[] {
  const issues: Issue[] = [];
  for (const [key, message] of messages) {
    const errors = syntaxErrorsOf(message);
    if (errors.length > 0) issues.push({ kind: "invalid_syntax", locale, key, detail: errors.join(" / ") });
  }
  return issues;
}

/**
 * ソースコードの中で、文字列リテラルとして現れるキーを集める。
 * キーは "title_bar.settings" のように、引用符で囲んだ文字列のまま書く（組み立てない）。
 */
export function findUsedKeys(sources: readonly string[], keys: ReadonlySet<string>): Set<string> {
  const used = new Set<string>();
  const literal = /(["'`])([a-z0-9_]+(?:\.[a-z0-9_]+)+)\1/g;
  for (const source of sources) {
    for (const match of source.matchAll(literal)) {
      if (keys.has(match[2])) used.add(match[2]);
    }
  }
  return used;
}

/**
 * 未使用キーの検査。まだ画面ができていないキーは「使用予定」（pending）に挙げておく。
 * - 使われておらず、使用予定にもないキー → エラー
 * - 使用予定に挙げたまま使われ始めたキー → エラー（使用予定から外す）
 * - 使用予定に挙げたが、辞書にないキー → エラー
 */
export function checkUsage(keys: ReadonlySet<string>, used: ReadonlySet<string>, pending: readonly string[]): Issue[] {
  const issues: Issue[] = [];
  const pendingSet = new Set(pending);
  for (const key of keys) {
    if (!used.has(key) && !pendingSet.has(key)) issues.push({ kind: "unused_key", key });
  }
  for (const key of pendingSet) {
    if (!keys.has(key)) issues.push({ kind: "pending_key_unknown", key });
    else if (used.has(key)) issues.push({ kind: "pending_key_used", key });
  }
  return issues;
}

const LABELS: Record<Issue["kind"], string> = {
  missing_key: "キーが不足しています",
  extra_key: "原文にないキーがあります",
  placeholder_mismatch: "プレースホルダが原文と一致しません",
  invalid_syntax: "メッセージの構文が正しくありません（@ や { は vue-i18n の記法として解釈されます）",
  unused_key: "使われていないキーです（不要なら辞書から消し、画面がまだなら scripts/i18n_pending_keys.ts に挙げます）",
  pending_key_used: "使用予定のキーが使われ始めました。scripts/i18n_pending_keys.ts から外してください",
  pending_key_unknown: "scripts/i18n_pending_keys.ts に、辞書にないキーがあります",
};

export function formatIssue(issue: Issue): string {
  const where = issue.locale ? `[${issue.locale}] ` : "";
  const detail = issue.detail ? `（${issue.detail}）` : "";
  return `${where}${issue.key}: ${LABELS[issue.kind]}${detail}`;
}
