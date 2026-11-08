// 推奨の形との適合判定：モジュールの枠の縦横比と流れる方向が、そのモジュールの推奨の形に合っているか
// （S03の見出しのバッジ。imple 4.3）。枠の大きさだけを見る純粋関数で、DOMには依存しない。
// 規則と閾値はモックの fitOf と同じ。

import type { Instance } from "../config/types";
import type { Direction, ModuleKind, Shape } from "../modules/options";

/** 判定の結果。辞書のキー `shape_fit.{結果}` にそのまま対応する */
export type ShapeFit = "good" | "warn_short" | "warn_axis" | "warn_long" | "warn_tall";

/** 細長い形に求める縦横比（長辺÷短辺）の下限。これ未満は「もっと細長く」 */
export const LONG_MIN_RATIO = 1.6;
/** 正方形に近い形に許す縦横比の上限。これを超えると「もっと正方形に」 */
export const COMPACT_MAX_RATIO = 1.8;
/** 縦長の形に求める、高さ÷幅の下限。これ未満は「もっと縦長に」 */
export const TALL_MIN_RATIO = 1.3;

/**
 * 判定に使う形の指定。
 * - `long`：細長い。`longSide` は、長辺が流れの方向に沿うか（`along`：波形・重心と変化量）、
 *   流れと直角か（`across`：レベル・スペクトラム。上向きに伸びるので横に長い枠が合う）
 * - `compact`：正方形に近い
 * - `tall`：縦長（周波数別の定位）
 * - `free`：形を選ばない
 */
export type FitProfile = { shape: "long"; longSide: "along" | "across" } | { shape: "compact" } | { shape: "tall" } | { shape: "free" };

/** 流れの方向が横（左右）か。方向なしは横ではない */
function isHorizontal(direction: Direction | null): boolean {
  return direction === "left" || direction === "right";
}

/**
 * 推奨の形との適合を判定する。`width`・`height` は枠の見た目の大きさ（比だけを使うので、単位は問わない）。
 * 「もっと細長く」は、向きの確認より先に判定する（細さが足りなければ向きは問わない）
 */
export function shapeFit(profile: FitProfile, direction: Direction | null, width: number, height: number): ShapeFit {
  if (profile.shape === "free") return "good";
  if (profile.shape === "tall") return height >= width * TALL_MIN_RATIO ? "good" : "warn_tall";
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (profile.shape === "compact") return ratio <= COMPACT_MAX_RATIO ? "good" : "warn_long";
  if (ratio < LONG_MIN_RATIO) return "warn_short";
  const wantWide = profile.longSide === "along" ? isHorizontal(direction) : !isHorizontal(direction);
  return width >= height === wantWide ? "good" : "warn_axis";
}

/** 細長い枠の長辺が、流れと直角になる種類（上向きに伸びるもの） */
const ACROSS_KINDS: readonly ModuleKind[] = ["level", "spec"];

/**
 * インスタンスの判定に使う形の指定。`shape` はその種類の推奨の形（モジュールの定義の `shape`）。
 * 周波数別の定位（位相の表示方式が `pan`）は、推奨の形によらず縦長を求める
 */
export function fitProfileOf(instance: Pick<Instance, "kind" | "options">, shape: Shape): FitProfile {
  if (instance.kind === "stereo" && (instance.options as { mode?: string }).mode === "pan") return { shape: "tall" };
  if (shape === "long") return { shape, longSide: ACROSS_KINDS.includes(instance.kind) ? "across" : "along" };
  return { shape };
}
