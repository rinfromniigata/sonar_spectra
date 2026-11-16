// Apple環境向けアイコンの Assets.car（bun run icons:car、bun run check:appicon）
//
// bun run icons:car（macOS のみ）：src-tauri/macos/AppIcon.icon を actool で Assets.car にし、
//   src-tauri/macos/Assets.car と、元にした AppIcon.icon の指紋 src-tauri/macos/Assets.car.source を書く。
//   tauri-bundler に .icon を渡すと、ビルドの中で actool を呼ぶが、GitHub Actions のランナーでは
//   actool が落ちる（tauri#15315）。そのため、手元で作った Assets.car をリポジトリに置き、
//   tauri.macos.conf.json の bundle.icon で指す（.car はそのまま使われ、ビルドで actool は動かない）
//   actool の引数は、tauri-bundler（2.10.4）の create_assets_car_file と同じにする
// bun run check:appicon（--check。OS を問わない）：Assets.car.source が、今の AppIcon.icon の指紋と
//   一致することを確かめる（AppIcon.icon を作り直したのに、Assets.car を作り直し忘れていないか）
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
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
import { iconFingerprint, type IconFile } from "./app_icon_car_core";

const ROOT = join(import.meta.dirname, "..");
const MACOS = join(ROOT, "src-tauri", "macos");
const ICON = join(MACOS, "AppIcon.icon");
const CAR = join(MACOS, "Assets.car");
const SOURCE = join(MACOS, "Assets.car.source");

function readIconFiles(dir: string): IconFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(dir, path), bytes: readFileSync(path) };
    });
}

const fingerprint = iconFingerprint(readIconFiles(ICON));

if (process.argv.includes("--check")) {
  const recorded = existsSync(SOURCE) ? readFileSync(SOURCE, "utf8").trim() : "";
  if (!existsSync(CAR) || recorded !== fingerprint) {
    console.error(
      "src-tauri/macos/Assets.car が、今の AppIcon.icon から作られていません。macOS で bun run icons:car を実行してください。",
    );
    process.exit(1);
  }
  console.log("Assets.car の検査を通過しました（AppIcon.icon と一致）。");
  process.exit(0);
}

if (process.platform !== "darwin") {
  console.error("bun run icons:car は macOS（Xcode 26 以降）で実行してください。");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "app_icon_car_"));
try {
  // tauri-bundler と同じく、一時フォルダーへ Icon.icon という名前で写してから渡す
  // （アイコンの名前は .icon のフォルダー名で決まり、--app-icon Icon と合わせる。Info.plist の CFBundleIconName になる）
  const icon = join(work, "Icon.icon");
  cpSync(ICON, icon, { recursive: true });
  const out = join(work, "out");
  mkdirSync(out, { recursive: true });
  // stdin を閉じたまま actool を呼ぶと失敗することがある（tauri#16386）ので、/dev/null をつなぐ
  const result = spawnSync(
    "xcrun",
    [
      "actool",
      icon,
      "--compile",
      out,
      "--output-format",
      "human-readable-text",
      "--notices",
      "--warnings",
      "--output-partial-info-plist",
      join(out, "assetcatalog_generated_info.plist"),
      "--app-icon",
      "Icon",
      "--include-all-app-icons",
      "--accent-color",
      "AccentColor",
      "--enable-on-demand-resources",
      "NO",
      "--development-region",
      "en",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  const built = join(out, "Assets.car");
  if (result.status !== 0 || !existsSync(built)) {
    console.error("actool で Assets.car を作れませんでした。");
    console.error(result.stdout, result.stderr);
    process.exit(1);
  }
  copyFileSync(built, CAR);
  writeFileSync(SOURCE, `${fingerprint}\n`);
  console.log("src-tauri/macos/Assets.car と Assets.car.source を書きました。");
} finally {
  rmSync(work, { recursive: true, force: true });
}
