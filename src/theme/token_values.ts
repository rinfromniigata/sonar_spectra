// tokens.css（値の正本）の宣言を、テーマを問わずに読む。
// 画面に効いている値は getComputedStyle で読めるが、それは今のテーマの値だけになる。
// 自分で作った配色はダーク用の値で持つため、ライトテーマの間でもダークの発光色（複製・新規作成の初期値）と、
// ライトの地の色（見本のライト用の色）が要る。値を写さずに済むよう、tokens.css の本文から読む。

import tokensCss from "./tokens.css?raw";

/** CSS の本文から、セレクタで始まるブロックの宣言（`--x: 値;`）を、プロパティ名 → 値の表にする */
export function parseTokenBlock(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) return new Map();
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
  const entries = [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const);
  return new Map(entries);
}

/** ダーク（既定。`:root {`）の宣言 */
const dark = parseTokenBlock(tokensCss, ":root {");
/** ライト（明示指定。`:root[data-theme="light"]`）の宣言 */
const light = parseTokenBlock(tokensCss, ':root[data-theme="light"]');

function pick(table: Map<string, string>, name: string, theme: string): string {
  const value = table.get(name);
  if (value === undefined) throw new Error(`tokens.css has no ${name} in the ${theme} theme`);
  return value;
}

/** ダークのトークンの値（例：`darkToken("--color-neon-a")`） */
export function darkToken(name: string): string {
  return pick(dark, name, "dark");
}

/** ライトのトークンの値（例：`lightToken("--color-bg")`） */
export function lightToken(name: string): string {
  return pick(light, name, "light");
}
