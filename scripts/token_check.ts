// トークンの直書き検査（bun run check:tokens）
// src/theme/ 以外の .vue・.ts・.css にある、色（#…、rgb( など）と px 値の直書きを検出する。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findHardcodedValues } from "./token_check_core";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const THEME = join(SRC, "theme");
const EXTENSIONS = [".vue", ".ts", ".css"];

const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((file) => !file.startsWith(THEME + sep) && !file.endsWith(".test.ts"));

let count = 0;
for (const file of files) {
  for (const finding of findHardcodedValues(readFileSync(file, "utf8"))) {
    const label = finding.kind === "color" ? "色" : "px値";
    console.error(`  ${relative(ROOT, file)}:${finding.line}:${finding.column} ${label}の直書き「${finding.text}」`);
    count += 1;
  }
}

if (count > 0) {
  console.error(
    `トークンの直書きが ${count} 件あります。src/theme/tokens.css のカスタムプロパティ（var(--…)）か、トークンから読んだ値を使ってください。`,
  );
  process.exit(1);
}
console.log(`トークンの検査を通過しました（${files.length} ファイル）。`);
