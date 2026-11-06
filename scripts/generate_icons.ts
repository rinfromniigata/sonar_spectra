// アイコン一式の生成（bun run icons）
// roadmap/specs/ の最新版のマスターSVGから、形式ごとに角丸と余白を足したSVGを作り、tauri icon で src-tauri/icons/ を作り直す。
// マスターSVGは角のない正方形で、角丸と余白は持たない（SPEC 6節「アイコンの余白ルール」）。
//   Windows（.ico・PNG）とファビコン：1024四方のまま、角丸半径200で切り抜く。余白は足さない
//   macOSの従来形式（.icns）：824四方に縮めて中央に置き（四辺100）、角丸半径185.4で切り抜く
// 初版はデスクトップ（Windows。macOSは後で対応）だけなので、モバイル向け（android/・ios/）は残さない。
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SPECS = join(ROOT, "roadmap", "specs");
const ICONS = join(ROOT, "src-tauri", "icons");
const PUBLIC = join(ROOT, "public");
const BRAND_COPY = join(ROOT, "docs", "brand", "icon_master.svg");
const MASTER_PATTERN = /^sonar_spectra_icon_master_v(\d+)\.svg$/;

const CANVAS = 1024;
const WINDOWS_RADIUS = 200;
const MAC_TILE = 824;
const MAC_MARGIN = (CANVAS - MAC_TILE) / 2; // 四辺100
const MAC_RADIUS = 185.4;

function latestMaster(): string {
  const candidates = readdirSync(SPECS)
    .map((name) => ({ name, version: Number(MASTER_PATTERN.exec(name)?.[1] ?? Number.NaN) }))
    .filter((c) => Number.isInteger(c.version))
    .sort((a, b) => b.version - a.version);
  if (candidates.length === 0) throw new Error(`マスターSVGが ${relative(ROOT, SPECS)} にありません`);
  return join(SPECS, candidates[0].name);
}

/** マスターSVGの<svg>要素の中身を取り出す。マスターは1024四方のviewBoxを持つ前提 */
function masterBody(svg: string): string {
  if (!/viewBox="0 0 1024 1024"/.test(svg)) throw new Error("マスターSVGのviewBoxが0 0 1024 1024ではありません");
  const open = /<svg\b[^>]*>/.exec(svg);
  const close = svg.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error("マスターSVGの<svg>要素が読み取れません");
  return svg.slice(open.index + open[0].length, close).trim();
}

function wrap(body: string, tile: { x: number; y: number; size: number; radius: number }): string {
  const scale = tile.size / CANVAS;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">
  <clipPath id="tile"><rect x="${tile.x}" y="${tile.y}" width="${tile.size}" height="${tile.size}" rx="${tile.radius}"/></clipPath>
  <g clip-path="url(#tile)">
    <g transform="translate(${tile.x} ${tile.y}) scale(${scale})">
${body}
    </g>
  </g>
</svg>
`;
}

function tauriIcon(input: string, output: string): void {
  const result = spawnSync("bun", ["x", "tauri", "icon", input, "--output", output], { stdio: "inherit", cwd: ROOT });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const master = latestMaster();
console.log(`マスターSVG: ${relative(ROOT, master)}`);

if (!existsSync(BRAND_COPY) || !readFileSync(BRAND_COPY).equals(readFileSync(master))) {
  console.error(`${relative(ROOT, BRAND_COPY)} がマスターSVGと一致しません。先にコピーを最新にしてください。`);
  process.exit(1);
}

const body = masterBody(readFileSync(master, "utf8"));
const windowsSvg = wrap(body, { x: 0, y: 0, size: CANVAS, radius: WINDOWS_RADIUS });
const macSvg = wrap(body, { x: MAC_MARGIN, y: MAC_MARGIN, size: MAC_TILE, radius: MAC_RADIUS });

const work = mkdtempSync(join(tmpdir(), "sonar_spectra_icons_"));
try {
  const windowsInput = join(work, "windows.svg");
  const macInput = join(work, "mac.svg");
  writeFileSync(windowsInput, windowsSvg);
  writeFileSync(macInput, macSvg);

  const windowsOut = join(work, "windows");
  const macOut = join(work, "mac");
  tauriIcon(windowsInput, windowsOut);
  tauriIcon(macInput, macOut);

  // src-tauri/icons/ を作り直す。Windows用の一式から、.icns とモバイル向けを除いて集め、.icns だけmacOS用から取る
  rmSync(ICONS, { recursive: true, force: true });
  mkdirSync(ICONS, { recursive: true });
  for (const name of readdirSync(windowsOut)) {
    if (name === "icon.icns" || name === "android" || name === "ios") continue;
    copyFileSync(join(windowsOut, name), join(ICONS, name));
  }
  copyFileSync(join(macOut, "icon.icns"), join(ICONS, "icon.icns"));

  // ファビコン：ベクターはWindows用（角丸で切り抜いたもの）、ラスターは複数の大きさを持つ icon.ico を使う
  mkdirSync(PUBLIC, { recursive: true });
  writeFileSync(join(PUBLIC, "favicon.svg"), windowsSvg);
  copyFileSync(join(ICONS, "icon.ico"), join(PUBLIC, "favicon.ico"));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("アイコン一式を src-tauri/icons/ に、ファビコンを public/ に作りました。");
