// トークンの直書き検査の中身（純粋関数）。CLI は scripts/token_check.ts。
// 値（色・サイズ）の正本は src/theme/tokens.css。ほかの場所では var(--…) かトークンから読んだ値を使う。

export interface Finding {
  line: number;
  column: number;
  kind: "color" | "px";
  text: string;
}

/** この印がある行は検査しない。理由を必ず添える（例: token-check-ignore: SVGの座標系のため） */
export const IGNORE_MARKER = /token-check-ignore:\s*(?!\*\/|-->)\S/;

const PATTERNS: { kind: Finding["kind"]; regex: RegExp }[] = [
  // #rgb・#rgba・#rrggbb・#rrggbbaa
  { kind: "color", regex: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g },
  // 色の関数
  { kind: "color", regex: /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi },
  // px の値（0px は対象外）
  { kind: "px", regex: /(?<![\w.-])(?:\d*\.\d+|\d+)px(?![\w-])/g },
];

export function findHardcodedValues(source: string): Finding[] {
  const findings: Finding[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    if (IGNORE_MARKER.test(text)) return;
    for (const { kind, regex } of PATTERNS) {
      for (const match of text.matchAll(regex)) {
        if (kind === "px" && Number.parseFloat(match[0]) === 0) continue;
        findings.push({ line: index + 1, column: (match.index ?? 0) + 1, kind, text: match[0] });
      }
    }
  });
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
