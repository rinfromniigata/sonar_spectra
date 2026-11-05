// i18n の自動検査（bun run check:i18n）
// - ロケール間のキーの過不足と、プレースホルダの一致
// - メッセージの構文
// - 未使用キー（画面がまだのキーは scripts/i18n_pending_keys.ts に挙げる）
// 存在しないキーの参照は、vue-tsc（src/i18n/use_t.ts の型）で検出する。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Issue,
  type Messages,
  checkSyntax,
  checkUsage,
  compareLocale,
  findUsedKeys,
  flatten,
  formatIssue,
} from "./i18n_check_core";
import { PENDING_KEYS } from "./i18n_pending_keys";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "i18n", "locales");
const SOURCE_LOCALE = "ja";

function listFiles(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => join(entry.parentPath, entry.name));
}

async function loadLocale(file: string): Promise<Messages> {
  const module = (await import(pathToFileURL(file).href)) as { default: Messages };
  return module.default;
}

const issues: Issue[] = [];

const source = flatten(await loadLocale(join(LOCALES, `${SOURCE_LOCALE}.ts`)));
issues.push(...checkSyntax(source, SOURCE_LOCALE));

for (const file of listFiles(LOCALES, [".ts"])) {
  const locale = relative(LOCALES, file).replace(/\.ts$/, "");
  if (locale === SOURCE_LOCALE) continue;
  const target = flatten(await loadLocale(file));
  issues.push(...compareLocale(source, target, locale));
  issues.push(...checkSyntax(target, locale));
}

// 開発時だけの画面（src/dev/：部品ギャラリーなど）での使用は、dev_gallery.* のキーだけを数える。
// ほかのキーは、本物の画面で使われるまで「使用予定」に残す（ギャラリーで見本に使っただけで外れないように）
const DEV = join(SRC, "dev");
const DEV_ONLY_PREFIX = "dev_gallery.";
const codeFiles = listFiles(SRC, [".ts", ".vue"]).filter(
  (file) => !file.startsWith(LOCALES + sep) && !file.endsWith(".test.ts"),
);
const allKeys = new Set(source.keys());
const read = (files: string[]) => files.map((file) => readFileSync(file, "utf8"));
const used = new Set([
  ...findUsedKeys(read(codeFiles.filter((file) => !file.startsWith(DEV + sep))), allKeys),
  ...[...findUsedKeys(read(codeFiles.filter((file) => file.startsWith(DEV + sep))), allKeys)].filter((key) =>
    key.startsWith(DEV_ONLY_PREFIX),
  ),
]);
issues.push(...checkUsage(allKeys, used, PENDING_KEYS));

const pendingCount = PENDING_KEYS.filter((key) => source.has(key) && !used.has(key)).length;
if (issues.length > 0) {
  console.error(`i18n の検査で ${issues.length} 件の問題が見つかりました。`);
  for (const issue of issues) console.error(`  ${formatIssue(issue)}`);
  process.exit(1);
}
console.log(`i18n の検査を通過しました（キー ${source.size} 件、使用中 ${used.size} 件、使用予定 ${pendingCount} 件）。`);
