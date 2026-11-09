// 重心と変化量のモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawCentroid に合わせる。
//
// 解析（Rust）は、スペクトルの重心（Hz。線形のまま振幅で重み付けした平均）と、フラックス（0〜1。前回から増えた分の割合）を送る。
// 受信側が、新しいサンプルのあるフレームごとに [重心, フラックス] の1行を履歴（histories.centroid）に積む。
// ここで決めるのは、重心の対数の軸への写し方、ならし方、フラックスの見え方、配置、数値の表記、流れる幅。

import type { RowHistory } from "../../frame_client";

/** 重心の軸：下端と上端（Hz。対数。モックが数値の表示に使う 50 Hz〜16 kHz） */
export const AXIS_MIN_HZ = 50;
export const AXIS_MAX_HZ = 16_000;

/** 履歴の1行（約1/60秒）を流す幅（px。モックの 3）。流れる速さに比例し、最低1ピクセル */
export const COLUMN_PX = 3;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;

/** フラックスが棒の高さいっぱいになる値と、強調色に変わる高さ（棒の高さに対する割合。モックの 0.55） */
export const FLUX_FULL = 0.5;
export const FLUX_HOT = 0.55;
/** 棒の不透明度：0.3 + 0.7 × 高さ（モック） */
export const BAR_ALPHA_BASE = 0.3;
export const BAR_ALPHA_GAIN = 0.7;

/** 重心の線をならす時定数（秒）と、履歴の1行の間隔（秒）。ならしの始まりの影響が見える範囲に出ないよう、手前の行から走らせる */
export const SMOOTH_TAU = 0.1;
export const ROW_SECONDS = 1 / 60;
export const WARMUP_ROWS = 30;

/** 数値の読み取り：直近の何行の平均にするか、何秒ごとに書き換えるか */
export const READOUT_ROWS = 15;
export const READOUT_INTERVAL = 0.25;
/** 無音のときの数値の表示（モックの「—」） */
export const NO_VALUE = "—";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 流れる速さに合わせた、履歴の1行の幅（px） */
export function columnStep(speed: number): number {
  const clamped = clamp(Number.isFinite(speed) ? speed : 1, SPEED_MIN, SPEED_MAX);
  return Math.max(1, Math.round(COLUMN_PX * clamped));
}

/** 幅 width を埋めるのに要る列の数 */
export function visibleColumns(width: number, step: number): number {
  return Math.ceil(width / step);
}

/** 重心（Hz）の、対数の軸の上の位置（0 = 下端、1 = 上端）。無音（0 以下）と計算できない値は下端 */
export function axisPosition(hz: number): number {
  if (!Number.isFinite(hz) || hz <= AXIS_MIN_HZ) return 0;
  return clamp(Math.log(hz / AXIS_MIN_HZ) / Math.log(AXIS_MAX_HZ / AXIS_MIN_HZ), 0, 1);
}

/** フラックスの棒の高さ（0〜1）。計算できない値は 0 */
export function fluxLevel(flux: number): number {
  return Number.isFinite(flux) ? clamp(flux / FLUX_FULL, 0, 1) : 0;
}

/** 棒の不透明度と、強調色にするか */
export function barStyle(level: number): { alpha: number; hot: boolean } {
  return { alpha: BAR_ALPHA_BASE + BAR_ALPHA_GAIN * level, hot: level > FLUX_HOT };
}

/**
 * 履歴の新しい側 count 行の、重心の位置（0〜1）をならして out[0..count) に書く。
 * 時間方向に時定数 SMOOTH_TAU で近づける。見える範囲の手前の WARMUP_ROWS 行から走らせ、窓が動いても左端の値がぶれないようにする
 */
export function smoothedPositions(history: RowHistory, count: number, out: Float32Array): void {
  const n = Math.min(count, history.length, out.length);
  if (n <= 0) return;
  const first = history.length - n;
  const warmStart = Math.max(0, first - WARMUP_ROWS);
  const k = 1 - Math.exp(-ROW_SECONDS / SMOOTH_TAU);
  let value = axisPosition(history.row(warmStart)[0]);
  for (let i = warmStart; i < history.length; i++) {
    value += (axisPosition(history.row(i)[0]) - value) * k;
    if (i >= first) out[i - first] = value;
  }
}

/** 数値の読み取り：直近の行の平均。重心が無音（最新の行が 0）なら hz は null */
export interface Readout {
  hz: number | null;
  /** フラックスの棒の高さ（0〜1）の平均 */
  flux: number;
}

export function readoutOf(history: RowHistory): Readout {
  const rows = Math.min(READOUT_ROWS, history.length);
  if (rows === 0) return { hz: null, flux: 0 };
  let hzSum = 0;
  let hzCount = 0;
  let fluxSum = 0;
  for (let i = history.length - rows; i < history.length; i++) {
    const row = history.row(i);
    if (row[0] > 0 && Number.isFinite(row[0])) {
      hzSum += row[0];
      hzCount++;
    }
    fluxSum += fluxLevel(row[1]);
  }
  const latest = history.row(history.length - 1)[0];
  const silent = !(latest > 0) || hzCount === 0;
  return { hz: silent ? null : hzSum / hzCount, flux: fluxSum / rows };
}

/** 重心の表記：1 kHz 以上は kHz で小数1桁、それ未満は Hz の整数（モックと同じ） */
export function formatHz(hz: number): string {
  const rounded = Math.round(hz);
  return rounded >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${rounded} Hz`;
}

/** 変化量の表記（Δ 0.27） */
export function formatFlux(level: number): string {
  return `Δ ${level.toFixed(2)}`;
}

/** 配置：変化量の棒の高さ、線の領域（モックの fluxH・top・cenH）、文字の大きさ */
export interface CentroidLayout {
  fluxHeight: number;
  top: number;
  lineHeight: number;
  fontSize: number;
}

export function centroidLayout(height: number): CentroidLayout {
  const fluxHeight = height * 0.28;
  const top = 14;
  return { fluxHeight, top, lineHeight: Math.max(0, height - fluxHeight - top - 6), fontSize: clamp(height / 10, 8, 11) };
}

/** 重心の位置（0〜1）に当たる y */
export function lineY(layout: CentroidLayout, position: number): number {
  return layout.top + layout.lineHeight - position * layout.lineHeight;
}
