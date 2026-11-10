// 方向の変換（imple 4.6）：モジュールの描画の座標系（既定の向き、CSS ピクセル）から、枠のビューポートのクリップ座標
// （-1〜1、上が +1）への行列。枠の quarterTurns を、Canvas 2D の文字の層と同じ回し方（modules/direction）で当てる。
// 文字の層と同じ位置に写す：文字の層は、CSS ピクセルに DPR を掛けた座標で、画素数が「枠の CSS の大きさ × DPR」を丸めた
// キャンバスに描かれ、画面上で丸めた枠の大きさ（デバイスピクセル）に合わせて表示される（両者は 1 ピクセル違うことがある）。
// そこで、描画の座標系 → キャンバスの画素 → ビューポート全体、の順に写す（キャンバスの画素数をビューポートに合わせて伸び縮みさせる）。

import { directionTransform, logicalSize } from "../../modules/direction";

/** 3×3 の行列（列優先。WebGL の uniformMatrix3fv にそのまま渡せる） */
export type Mat3 = Float32Array;

/** 文字の層のキャンバスの画素数（ModuleFrame と同じ丸め）。size は CSS ピクセル */
export function canvasPixels(size: number, devicePixelRatio: number): number {
  return Math.max(1, Math.round(size * devicePixelRatio));
}

/**
 * 描画の座標系（幅 logicalWidth × 高さ logicalHeight、既定の向き）から、枠のクリップ座標への行列。
 * turns は既定の向きから時計回りに何回 90° 回したか
 */
export function frameClipMatrix(turns: 0 | 1 | 2 | 3, logicalWidth: number, logicalHeight: number, devicePixelRatio = 1): Mat3 {
  // 回した後の枠の大きさ（CSS ピクセル）と、文字の層のキャンバスの画素数
  const box = logicalSize(logicalWidth, logicalHeight, turns);
  const w = canvasPixels(box.width, devicePixelRatio);
  const h = canvasPixels(box.height, devicePixelRatio);
  // 描画の座標系 → キャンバスの画素（左上が原点。文字の層の Canvas 2D と同じ行列）
  const [a, b, c, d, e, f] = directionTransform(turns, box.width, box.height, devicePixelRatio);
  // キャンバスの画素 → クリップ座標：X = 2x/w − 1、Y = 1 − 2y/h
  return new Float32Array([(2 * a) / w, (-2 * b) / h, 0, (2 * c) / w, (-2 * d) / h, 0, (2 * e) / w - 1, 1 - (2 * f) / h, 1]);
}

/** 行列で点を写す（テスト用） */
export function applyMat3(m: Mat3, x: number, y: number): [number, number] {
  return [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]];
}
