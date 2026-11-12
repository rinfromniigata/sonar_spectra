// Info.plist の文言の検査の中身（scripts/info_plist_check.ts から使う。単体テストできるように分ける）

/** Info.plist の文字列のキーと、同じ値を持つ原文の辞書のキー */
export const INFO_PLIST_MESSAGES: Readonly<Record<string, string>> = {
  NSAudioCaptureUsageDescription: "bundle.audio_capture_usage",
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** plist の最上位の辞書から、`key` の文字列の値を取り出す。ないか、文字列でなければ undefined */
export function readPlistString(xml: string, key: string): string | undefined {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`).exec(withoutComments);
  return match ? unescapeXml(match[1]) : undefined;
}

export type PlistIssue =
  | { kind: "missing_in_plist"; plistKey: string }
  | { kind: "missing_in_messages"; plistKey: string; messageKey: string }
  | { kind: "mismatch"; plistKey: string; messageKey: string; plist: string; message: string };

/** Info.plist の文言が、原文の辞書の値と一致しているかを調べる */
export function checkInfoPlist(
  xml: string,
  messages: ReadonlyMap<string, string>,
  pairs: Readonly<Record<string, string>> = INFO_PLIST_MESSAGES,
): PlistIssue[] {
  const issues: PlistIssue[] = [];
  for (const [plistKey, messageKey] of Object.entries(pairs)) {
    const plist = readPlistString(xml, plistKey);
    const message = messages.get(messageKey);
    if (plist === undefined) {
      issues.push({ kind: "missing_in_plist", plistKey });
    } else if (message === undefined) {
      issues.push({ kind: "missing_in_messages", plistKey, messageKey });
    } else if (plist !== message) {
      issues.push({ kind: "mismatch", plistKey, messageKey, plist, message });
    }
  }
  return issues;
}

export function formatPlistIssue(issue: PlistIssue): string {
  switch (issue.kind) {
    case "missing_in_plist":
      return `Info.plist に ${issue.plistKey} がありません`;
    case "missing_in_messages":
      return `${issue.plistKey} に対応する辞書のキー ${issue.messageKey} がありません`;
    case "mismatch":
      return `${issue.plistKey} が辞書の ${issue.messageKey} と一致しません\n    Info.plist: ${issue.plist}\n    辞書      : ${issue.message}`;
  }
}
