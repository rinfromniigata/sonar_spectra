// 流れる方向：モジュールの枠側で Canvas の座標系を回し、描画側は常に既定の向きで描く。
// 目盛りや文字も Canvas に描くので、座標系と一緒に回る（モックの withDirection と同じ回し方）。

import type { Direction } from "./options";

/** 時計回りの順 */
const CLOCKWISE: readonly Direction[] = ["right", "down", "left", "up"];

/**
 * 既定の向き `base` から `direction` まで、時計回りに何回 90° 回すか。
 * どちらかが null（方向のないモジュール）なら回さない
 */
export function quarterTurns(base: Direction | null, direction: Direction | null): 0 | 1 | 2 | 3 {
  if (base === null || direction === null) return 0;
  return ((CLOCKWISE.indexOf(direction) - CLOCKWISE.indexOf(base) + 4) % 4) as 0 | 1 | 2 | 3;
}

/** 枠の大きさから、描画の座標系（既定の向き）での大きさを求める。90°・270° なら縦横が入れ替わる */
export function logicalSize(width: number, height: number, turns: 0 | 1 | 2 | 3): { width: number; height: number } {
  return turns % 2 === 0 ? { width, height } : { width: height, height: width };
}

/** Canvas の setTransform に渡す行列 [a, b, c, d, e, f] */
export type Transform = [number, number, number, number, number, number];

/**
 * 描画の座標系（既定の向き）から、枠の座標（デバイスピクセル）への変換。
 * `width`・`height` は枠の大きさ（CSS ピクセル、回す前）
 */
export function directionTransform(
  turns: 0 | 1 | 2 | 3,
  width: number,
  height: number,
  devicePixelRatio: number,
): Transform {
  const s = devicePixelRatio;
  switch (turns) {
    case 0:
      return [s, 0, 0, s, 0, 0];
    case 1: // translate(W, 0) rotate(90°)
      return [0, s, -s, 0, width * s, 0];
    case 2: // translate(W, H) rotate(180°)
      return [-s, 0, 0, -s, width * s, height * s];
    case 3: // translate(0, H) rotate(-90°)
      return [0, -s, s, 0, 0, height * s];
  }
}

/** 行列で点を写す（テストと、枠の上の位置を求めるときに使う） */
export function applyTransform([a, b, c, d, e, f]: Transform, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}
