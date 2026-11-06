// 波形のモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawWave に合わせる。

import type { WaveOptions } from "../options";

/** 履歴の1行（約1/60秒）を流す幅（px）。速めに流してスパイクを鋭く見せる（モックの HIST_SCROLL） */
export const HISTORY_SCROLL_PX = 4;
/** 境目の割合の範囲（%）。モックのスライダーと同じ */
export const SPLIT_MIN = 10;
export const SPLIT_MAX = 90;
/** 履歴の振幅の、枠の半分の高さに対する割合と、無音でも残す細い線の太さ */
export const HISTORY_GAIN = 0.92;
export const HISTORY_MIN_PX = 0.6;
/** 今の波形：外縁と芯の、枠の半分の高さに対する割合 */
export const OUTER_GAIN = 0.9;
export const CORE_GAIN = 0.35;
/** 芯をならす幅（今の波形の幅に対する割合と、最小の px） */
export const CORE_SMOOTH_RATIO = 0.04;
export const CORE_SMOOTH_MIN = 6;

export interface WaveLayout {
  /** 履歴と今の波形の境目の x（今の波形を出さないときは右端） */
  split: number;
  /** 履歴の1行の幅 */
  step: number;
}

export function waveLayout(width: number, options: WaveOptions): WaveLayout {
  const ratio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, options.split)) / 100;
  return {
    split: options.showNow ? Math.round(width * ratio) : width,
    step: Math.max(1, Math.round(HISTORY_SCROLL_PX * options.speed)),
  };
}

/** 境目までを埋めるのに要る履歴の行数 */
export function historyColumns(split: number, step: number): number {
  return Math.ceil(split / step) + 1;
}

/** 履歴の値（線形の振幅）を、中心からの高さにする */
export function historyAmplitude(value: number, mid: number): number {
  return Math.max(HISTORY_MIN_PX, Math.min(1, Math.max(0, value)) * mid * HISTORY_GAIN);
}

/** 帯域別の色：その列で強い帯域の役割（低＝主色、高＝副色、中＝強調色）。モックの閾値と同じ */
export function bandRole(low: number, mid: number, high: number): "main" | "sub" | "accent" {
  const total = low + mid + high + 1e-6;
  if (low / total > 0.5) return "main";
  if (high / total > 0.35) return "sub";
  return "accent";
}

/** `source` を `out` の長さに直線で補間して写す（両端はそろえる） */
export function resampleLinear(source: ArrayLike<number>, out: Float32Array): Float32Array {
  const n = out.length;
  const m = source.length;
  if (m === 0) return out.fill(0);
  if (n === 1 || m === 1) return out.fill(source[0]);
  const scale = (m - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const position = i * scale;
    const j = Math.min(m - 2, Math.floor(position));
    const t = position - j;
    out[i] = source[j] * (1 - t) + source[j + 1] * t;
  }
  return out;
}

/** 前後 `radius` 点の平均（端は、範囲内の点だけで平均する） */
export function movingAverage(source: ArrayLike<number>, radius: number, out: Float32Array): Float32Array {
  const n = source.length;
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(n - 1, i + radius);
    while (hi < to) sum += source[++hi];
    while (lo < from) sum -= source[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** 両端の固定：今の波形の位置 u（0〜span）での振幅の倍率。両端で0、中央で1 */
export function endWindow(u: number, span: number): number {
  if (span <= 0) return 0;
  return Math.pow(Math.max(0, Math.sin((Math.PI * u) / span)), 0.8);
}

/** 芯をならす半径（px） */
export function coreRadius(points: number): number {
  return Math.max(CORE_SMOOTH_MIN, Math.round(points * CORE_SMOOTH_RATIO));
}
