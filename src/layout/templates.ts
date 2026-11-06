// 自動整列のテンプレート：モックの S04 の並び（.layout-t・.layout-auto-*）の fr の比を、12×8 の格子の
// 整数に置き換えたもの。各マス数は「比×12（または×8）を丸め、1マス以上、合計が12（8）」で決めた。

import type { GridRect } from "../config/types";

/** 画面比の帯。境目はモックの値で固定し、設定には出さない（SPEC 委任事項の決定） */
export type Band = "strip" | "wide" | "standard" | "tall";

export const BAND_STRIP_MIN = 2.4;
export const BAND_WIDE_MIN = 1.5;
export const BAND_STANDARD_MIN = 1.1;

/** 画面比（幅÷高さ）から帯を選ぶ */
export function bandFor(aspect: number): Band {
  if (aspect >= BAND_STRIP_MIN) return "strip";
  if (aspect >= BAND_WIDE_MIN) return "wide";
  if (aspect >= BAND_STANDARD_MIN) return "standard";
  return "tall";
}

/** テンプレートの領域。種類の名前のほか、2つ目の位相（周波数別の定位）の専用の位置 "pan" を持つ */
export type AreaKey = "level" | "wave" | "spec" | "stereo" | "gram" | "loud" | "pan";

export type Template = Record<AreaKey, GridRect>;

export const TEMPLATES: Record<Band, Template> = {
  // 横長（1.5〜2.4）：.layout-t
  // 列 0.3 / 0.24 / 0.62 / 1.84 → 1 / 1 / 3 / 7、行 0.9 / 2.2 / 1.3 → 2 / 4 / 2
  // "level wave wave wave" "level pan spec spec" "loud loud stereo gram"
  wide: {
    level: { c: 1, r: 1, cs: 1, rs: 6 },
    wave: { c: 2, r: 1, cs: 11, rs: 2 },
    pan: { c: 2, r: 3, cs: 1, rs: 4 },
    spec: { c: 3, r: 3, cs: 10, rs: 4 },
    loud: { c: 1, r: 7, cs: 2, rs: 2 },
    stereo: { c: 3, r: 7, cs: 3, rs: 2 },
    gram: { c: 6, r: 7, cs: 7, rs: 2 },
  },
  // 標準（1.1〜1.5）：.layout-auto-std（同じ並びで、スペクトラムと下段を縦に広げる）
  // 列 0.32 / 0.26 / 0.62 / 1.8 → 1 / 1 / 3 / 7、行 0.9 / 2.6 / 1.9 → 1 / 4 / 3
  standard: {
    level: { c: 1, r: 1, cs: 1, rs: 5 },
    wave: { c: 2, r: 1, cs: 11, rs: 1 },
    pan: { c: 2, r: 2, cs: 1, rs: 4 },
    spec: { c: 3, r: 2, cs: 10, rs: 4 },
    loud: { c: 1, r: 6, cs: 2, rs: 3 },
    stereo: { c: 3, r: 6, cs: 3, rs: 3 },
    gram: { c: 6, r: 6, cs: 7, rs: 3 },
  },
  // 縦長（1.1未満）：.layout-auto-tall（細長いモジュールを横の帯で積み、レベルは横向き）
  // 列 3 / 1 → 9 / 3、行 0.45 / 1.1 / 3 / 2.4 / 1.5 → 1 / 1 / 3 / 2 / 1
  // "level level" "wave wave" "spec pan" "gram gram" "stereo loud"
  tall: {
    level: { c: 1, r: 1, cs: 12, rs: 1 },
    wave: { c: 1, r: 2, cs: 12, rs: 1 },
    spec: { c: 1, r: 3, cs: 9, rs: 3 },
    pan: { c: 10, r: 3, cs: 3, rs: 3 },
    gram: { c: 1, r: 6, cs: 12, rs: 2 },
    stereo: { c: 1, r: 8, cs: 9, rs: 1 },
    loud: { c: 10, r: 8, cs: 3, rs: 1 },
  },
  // 帯（2.4以上）：.layout-auto-strip（すべてを1列に）
  // 列 0.22 / 0.5 / 1.6 / 0.35 / 1.8 / 0.55 / 1.3 → 1 / 1 / 3 / 1 / 3 / 1 / 2
  // "level loud wave pan spec stereo gram"
  strip: {
    level: { c: 1, r: 1, cs: 1, rs: 8 },
    loud: { c: 2, r: 1, cs: 1, rs: 8 },
    wave: { c: 3, r: 1, cs: 3, rs: 8 },
    pan: { c: 6, r: 1, cs: 1, rs: 8 },
    spec: { c: 7, r: 1, cs: 3, rs: 8 },
    stereo: { c: 10, r: 1, cs: 1, rs: 8 },
    gram: { c: 11, r: 1, cs: 2, rs: 8 },
  },
};

/** テンプレートの並び（空いた領域を埋めるときなどの順） */
export const AREA_KEYS: readonly AreaKey[] = ["level", "wave", "spec", "stereo", "gram", "loud", "pan"];
