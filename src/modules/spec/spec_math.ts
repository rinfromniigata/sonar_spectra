// スペクトラムのモジュールの計算（描画から切り離した純粋関数）。
// 解析（Rust）は、30 Hz〜20 kHz を対数で 96 等分した帯域ごとの振幅（線形）を送る。
// dB への換算と表示の範囲、傾きの補正、平滑化とピークの残像、周波数の目盛りの位置はここで行う。
// 数値の多くはモックの drawSpec に合わせ、dB の範囲と傾きは実機の見え方に合わせて決めた（委任事項）。

import { SPECTRUM_BANDS, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ } from "../../frame_client";

/** 表示の下端（これ以下は 0）と上端（これ以上は 1）の dB */
export const SPEC_FLOOR_DB = -80;
export const SPEC_CEIL_DB = -10;
/** 傾きの補正：高域ほど弱い音楽のスペクトルを平らに見せるため、1オクターブあたり持ち上げる dB と、補正が 0 になる周波数 */
export const TILT_DB_PER_OCTAVE = 3;
export const TILT_REFERENCE_HZ = 100;

/** 平滑化：1フレーム（1/60秒）あたり、下がるときに残る割合（モックの 0.88） */
export const SMOOTH_DECAY_PER_FRAME = 0.88;
/** ピークの残像が 1フレーム（1/60秒）あたり下がる量（モックの 0.004） */
export const PEAK_FALL_PER_FRAME = 0.004;
/** 基準のフレームレート。モックの「1フレームあたり」を経過時間に直すのに使う */
const REFERENCE_FPS = 60;

/** バー表示の本数（モックの n） */
export const BAR_COUNT = 48;

/** 周波数の目盛り（モックの 50・200・1k・5k・16k）。数字と単位の記号なので辞書は通さない */
export const FREQUENCY_TICKS: readonly { label: string; hz: number }[] = [
  { label: "50", hz: 50 },
  { label: "200", hz: 200 },
  { label: "1k", hz: 1_000 },
  { label: "5k", hz: 5_000 },
  { label: "16k", hz: 16_000 },
];

/** 帯域 band の中心の周波数（Hz） */
export function bandCenterHz(band: number): number {
  const ratio = SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ;
  return SPECTRUM_MIN_HZ * ratio ** ((band + 0.5) / SPECTRUM_BANDS);
}

/** 中心の周波数 hz の帯域の傾きの補正（dB） */
export function tiltDb(hz: number): number {
  return TILT_DB_PER_OCTAVE * Math.log2(hz / TILT_REFERENCE_HZ);
}

/** 各帯域の傾きの補正（dB）。帯域の中心の周波数から決まるので、一度だけ作る */
const TILT_DB: Float32Array = Float32Array.from({ length: SPECTRUM_BANDS }, (_, band) => tiltDb(bandCenterHz(band)));

/** 傾きの補正を加えた dB を、表示の高さ（0〜1）にする */
function dbToDisplay(db: number): number {
  return Math.min(1, Math.max(0, (db - SPEC_FLOOR_DB) / (SPEC_CEIL_DB - SPEC_FLOOR_DB)));
}

/** 線形の振幅（帯域 band）を、表示の高さ（0〜1）にする */
export function toDisplay(amplitude: number, band: number): number {
  if (!(amplitude > 0)) return 0;
  return dbToDisplay(20 * Math.log10(amplitude) + TILT_DB[band]);
}

/**
 * 中心の周波数が hz の帯域の線形の振幅を、スペクトラムと同じ換算で表示の高さ（0〜1）にする。
 * 帯域の分け方が違う解析（位相の周波数別の定位）が使う
 */
export function amplitudeToDisplay(amplitude: number, hz: number): number {
  if (!(amplitude > 0)) return 0;
  return dbToDisplay(20 * Math.log10(amplitude) + tiltDb(hz));
}

/** 解析の帯域ごとの振幅を、表示の高さにして `out` に書く。`bands` が null なら 0 */
export function toDisplayBands(bands: Float32Array | null, out: Float32Array): void {
  for (let i = 0; i < out.length; i++) out[i] = bands ? toDisplay(bands[i], i) : 0;
}

/** 平滑化：上がるときは即座に、下がるときは経過時間に応じて指数で下がる */
export function updateSmooth(smooth: Float32Array, display: Float32Array, dt: number): void {
  const keep = SMOOTH_DECAY_PER_FRAME ** (Math.max(0, dt) * REFERENCE_FPS);
  for (let i = 0; i < smooth.length; i++) smooth[i] = Math.max(display[i], smooth[i] * keep);
}

/** ピークの残像：平滑化した値に追いつき、そこから一定の速さで下がる */
export function updatePeakHold(peak: Float32Array, smooth: Float32Array, dt: number): void {
  const fall = PEAK_FALL_PER_FRAME * Math.max(0, dt) * REFERENCE_FPS;
  for (let i = 0; i < peak.length; i++) peak[i] = Math.max(smooth[i], peak[i] - fall);
}

/** 帯域 band の横の位置（0〜width。両端の帯域が枠の両端に来る） */
export function xOfBand(band: number, width: number): number {
  return (band / (SPECTRUM_BANDS - 1)) * width;
}

/** 周波数 hz の横の位置（帯域の中心の並びに合わせる。範囲の外は両端に収める） */
export function xOfHz(hz: number, width: number): number {
  const position = Math.log(hz / SPECTRUM_MIN_HZ) / Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ);
  const band = Math.min(SPECTRUM_BANDS - 1, Math.max(0, position * SPECTRUM_BANDS - 0.5));
  return xOfBand(band, width);
}

/** バー表示の j 本目の値：その本が受け持つ帯域の最大（帯域を飛ばして山を取りこぼさないため） */
export function barValue(values: Float32Array, bar: number): number {
  const start = Math.floor((bar * values.length) / BAR_COUNT);
  const end = Math.max(start + 1, Math.floor(((bar + 1) * values.length) / BAR_COUNT));
  let max = 0;
  for (let i = start; i < end && i < values.length; i++) max = Math.max(max, values[i]);
  return max;
}

/** 円形表示の配置（モックの r0・r1） */
export function radialLayout(width: number, height: number): { cx: number; cy: number; r0: number; r1: number } {
  const size = Math.min(width, height);
  return { cx: width / 2, cy: height / 2, r0: size * 0.16, r1: size * 0.32 };
}

/** 円形表示の k 番目（0〜2·BANDS）の点が使う帯域。上から右回りに低→高、左半分は折り返して左右対称にする */
export function radialBand(k: number, bands = SPECTRUM_BANDS): number {
  return k <= bands ? Math.min(bands - 1, k) : bands * 2 - k;
}
