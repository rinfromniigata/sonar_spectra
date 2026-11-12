// Info.plist の文言の検査（bun run check:plist）
// src-tauri/Info.plist の用途の説明（NSAudioCaptureUsageDescription など）が、原文の辞書の値と一致することを確かめる。
// 文言の正本は辞書なので、直すときは辞書を直してから Info.plist に写す。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ja from "../src/i18n/locales/ja";
import { flatten } from "./i18n_check_core";
import { checkInfoPlist, formatPlistIssue, INFO_PLIST_MESSAGES } from "./info_plist_check_core";

const ROOT = join(import.meta.dirname, "..");
const PLIST = join(ROOT, "src-tauri", "Info.plist");

const issues = checkInfoPlist(readFileSync(PLIST, "utf8"), flatten(ja));
if (issues.length > 0) {
  console.error(`Info.plist の検査で ${issues.length} 件の問題が見つかりました。`);
  for (const issue of issues) console.error(`  ${formatPlistIssue(issue)}`);
  process.exit(1);
}
console.log(`Info.plist の検査を通過しました（文言 ${Object.keys(INFO_PLIST_MESSAGES).length} 件）。`);
