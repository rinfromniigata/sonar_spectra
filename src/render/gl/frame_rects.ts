// 枠の範囲（imple 4.6）：共有キャンバスの上で、各モジュールの枠が占める矩形（デバイスピクセル）を、配置の状態
// （インスタンスの格子の位置）と、格子の列・行の大きさ（格子の要素を測った値から求める）から求める（枠の DOM は毎回は測らない）。
// 端は、ブラウザが枠を画面に描くときと同じく、画面上のデバイスピクセルに丸める（地の塗りと文字の層の枠がずれないように）。

import type { GridRect } from "../../config/types";

/** 格子の要素の計測値（CSS ピクセル）。大きさ・余白・すき間が変わったときに測り直す */
export interface GridMetrics {
  /** 格子の要素（共有キャンバスの左上）の、画面上の位置 */
  left: number;
  top: number;
  paddingLeft: number;
  paddingTop: number;
  /** 列・行の大きさ */
  columns: readonly number[];
  rows: readonly number[];
  columnGap: number;
  rowGap: number;
}

/** 共有キャンバスの上の矩形（デバイスピクセル、左上が原点） */
export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 等しい大きさの列・行（格子は minmax(0, 1fr) の等分）。total は余白を除いた幅（高さ） */
export function equalTracks(total: number, count: number, gap: number): number[] {
  const size = Math.max(0, (total - gap * (count - 1)) / count);
  return Array.from({ length: count }, () => size);
}

/** 1始まりの start から span 本の、始まりの位置と大きさ（余白を含めた格子の要素の左上から） */
function span(tracks: readonly number[], gap: number, padding: number, start: number, count: number): [number, number] {
  const first = Math.min(Math.max(1, start), tracks.length) - 1;
  const last = Math.min(tracks.length, first + Math.max(1, count)) - 1;
  let offset = padding;
  for (let i = 0; i < first; i++) offset += tracks[i] + gap;
  let size = 0;
  for (let i = first; i <= last; i++) size += tracks[i];
  size += gap * (last - first);
  return [offset, size];
}

/** 格子の位置の枠の矩形（CSS ピクセル、格子の要素の左上から） */
export function frameCssRect(metrics: GridMetrics, rect: GridRect): { x: number; y: number; width: number; height: number } {
  const [x, width] = span(metrics.columns, metrics.columnGap, metrics.paddingLeft, rect.c, rect.cs);
  const [y, height] = span(metrics.rows, metrics.rowGap, metrics.paddingTop, rect.r, rect.rs);
  return { x, y, width, height };
}

/**
 * 格子の位置の枠の矩形を、共有キャンバスのデバイスピクセルにする。端を画面上のデバイスピクセルに丸めてから、
 * キャンバスの左上（同じく丸めた位置）を引く
 */
export function frameDeviceRect(metrics: GridMetrics, rect: GridRect, devicePixelRatio: number): DeviceRect {
  const css = frameCssRect(metrics, rect);
  const snap = (v: number) => Math.round(v * devicePixelRatio);
  const originX = snap(metrics.left);
  const originY = snap(metrics.top);
  const x0 = snap(metrics.left + css.x) - originX;
  const y0 = snap(metrics.top + css.y) - originY;
  const x1 = snap(metrics.left + css.x + css.width) - originX;
  const y1 = snap(metrics.top + css.y + css.height) - originY;
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}
