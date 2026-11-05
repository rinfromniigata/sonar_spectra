// アイコン一式の生成（bun run icons）
// roadmap/specs/ の最新版のマスターSVGから、tauri icon で src-tauri/icons/ を作り直し、ファビコンを public/ に置く。
// 初版はデスクトップ（Windows。macOSは後で対応）だけなので、モバイル向け（android/・ios/）は残さない。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SPECS = join(ROOT, "roadmap", "specs");
const ICONS = join(ROOT, "src-tauri", "icons");
const PUBLIC = join(ROOT, "public");
const BRAND_COPY = join(ROOT, "docs", "brand", "icon_master.svg");
const MASTER_PATTERN = /^sonar_spectra_icon_master_v(\d+)\.svg$/;

function latestMaster(): string {
  const candidates = readdirSync(SPECS)
    .map((name) => ({ name, version: Number(MASTER_PATTERN.exec(name)?.[1] ?? Number.NaN) }))
    .filter((c) => Number.isInteger(c.version))
    .sort((a, b) => b.version - a.version);
  if (candidates.length === 0) throw new Error(`マスターSVGが ${relative(ROOT, SPECS)} にありません`);
  return join(SPECS, candidates[0].name);
}

const master = latestMaster();
console.log(`マスターSVG: ${relative(ROOT, master)}`);

if (!existsSync(BRAND_COPY) || !readFileSync(BRAND_COPY).equals(readFileSync(master))) {
  console.error(`${relative(ROOT, BRAND_COPY)} がマスターSVGと一致しません。先にコピーを最新にしてください。`);
  process.exit(1);
}

const result = spawnSync("bun", ["x", "tauri", "icon", master, "--output", ICONS], { stdio: "inherit", cwd: ROOT });
if (result.status !== 0) process.exit(result.status ?? 1);

for (const mobile of ["android", "ios"]) rmSync(join(ICONS, mobile), { recursive: true, force: true });

// ファビコン：ベクターはマスターSVGをそのまま、ラスターは複数の大きさを持つ icon.ico を使う
mkdirSync(PUBLIC, { recursive: true });
copyFileSync(master, join(PUBLIC, "favicon.svg"));
copyFileSync(join(ICONS, "icon.ico"), join(PUBLIC, "favicon.ico"));

console.log("アイコン一式を src-tauri/icons/ に、ファビコンを public/ に作りました。");
