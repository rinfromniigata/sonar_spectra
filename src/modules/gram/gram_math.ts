// スペクトログラムのモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawGram に合わせる。
//
// 横が時間（既定では右が新しい）、縦が周波数（下が低域）。履歴の1行（約1/60秒）が、横に `columnStep` px の1列になる。
// 解析（Rust）が送る帯域ごとの振幅（線形）を、スペクトラムと同じ換算（spec_math.ts）で表示の高さにして、色の濃さに写す。

import { SPECTRUM_BANDS } from "../../frame_client";
import { toDisplay } from "../spec/spec_math";

/** 縦の分解能：モックと同じ、CSS ピクセルで2ピクセルごとの帯 */
export const ROW_PX = 2;
/** 履歴の1行を流す幅（px。流れる速さ ×1.00 のとき。モックの 2） */
export const COLUMN_PX = 2;
/** 流れる速さの範囲（SPEC 2節: ×0.25〜×3.00） */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;

/** 色が付き始める強さと、強調色に変わる強さ（モックの 0.25・0.72）、濃さの傾き（モックの 1.4） */
export const GRAM_THRESHOLD = 0.25;
export const GRAM_HOT = 0.72;
export const GRAM_GAIN = 1.4;

/** 履歴の1行を流す幅（px）。流れる速さに比例し、最低1ピクセル */
export function columnStep(speed: number): number {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(speed) ? speed : 1));
  return Math.max(1, Math.round(COLUMN_PX * clamped));
}

/** 幅 width を埋めるのに要る列の数 */
export function visibleColumns(width: number, step: number): number {
  return Math.ceil(width / step);
}

/** 縦の1帯（上から数えた row 番目）が受け持つ帯域 [lo, hi) と、画面の位置 */
export interface RowRange {
  y: number;
  height: number;
  lo: number;
  hi: number;
}

/**
 * 高さ height を rowPx ごとの帯に分け、各帯が受け持つ周波数の帯域を決める（長さの単位は呼ぶ側が決める。
 * 描画側はデバイスピクセルで呼ぶ）。下が低域。帯が帯域より細かいときは隣の帯と同じ帯域を、帯が帯域より粗いときは複数の帯域をまとめて受け持つ
 * （まとめた帯域は最大を取り、細い山を取りこぼさない）
 */
export function rowRanges(height: number, rowPx = ROW_PX, bands = SPECTRUM_BANDS): RowRange[] {
  const ranges: RowRange[] = [];
  if (!(height > 0) || !(rowPx > 0)) return ranges;
  for (let y = 0; y < height; y += rowPx) {
    const rowHeight = Math.min(rowPx, height - y);
    // 上端 y が高い周波数、下端 y + rowHeight が低い周波数
    const lo = Math.max(0, Math.min(bands - 1, Math.floor((1 - (y + rowHeight) / height) * bands)));
    const hi = Math.max(lo + 1, Math.min(bands, Math.ceil((1 - y / height) * bands)));
    ranges.push({ y, height: rowHeight, lo, hi });
  }
  return ranges;
}

/** 履歴の1行（帯域ごとの線形の振幅）を、帯域ごとの表示の高さ（0〜1）にして `out` に書く */
export function displayRow(row: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let b = 0; b < out.length; b++) out[b] = toDisplay(row[b] ?? 0, b);
  return out;
}

/** 帯 range が受け持つ帯域の表示の高さの最大 */
export function rangeLevel(display: ArrayLike<number>, range: RowRange): number {
  let max = 0;
  for (let b = range.lo; b < range.hi; b++) max = Math.max(max, display[b]);
  return max;
}

/** 表示の高さ v の色：濃さと、強調色にするか。色が付かない（背景のまま）なら null */
export function cellStyle(v: number): { alpha: number; hot: boolean } | null {
  const alpha = Math.max(0, v - GRAM_THRESHOLD) * GRAM_GAIN;
  if (alpha <= 0) return null;
  return { alpha: Math.min(1, alpha), hot: v > GRAM_HOT };
}
