// 位相のモジュールの計算（描画から切り離した純粋関数）。数値の多くはモックの drawStereo に合わせる。
//
// 解析（Rust）は、リサージュの点（横 (R − L)/√2・縦 (L + R)/√2）、相関、周波数別の定位（−1〜1）と
// 帯域ごとの振幅（線形）を送る。画面への写し方、振幅の表示の高さへの換算、残光の濃さはここで決める。

import { PAN_BANDS, PAN_MAX_HZ, PAN_MIN_HZ } from "../../frame_client";
import { amplitudeToDisplay } from "../spec/spec_math";

/** 基準のフレームレート。モックの「1フレームあたり」を経過時間に直すのに使う */
const REFERENCE_FPS = 60;

/** 残光：毎フレーム地の色を重ねる不透明度（モックの値。リサージュ、周波数別の定位のブラーあり・なし） */
export const TRAIL_ALPHA_LISSAJOUS = 0.3;
export const TRAIL_ALPHA_PAN_BLUR = 0.32;
export const TRAIL_ALPHA_PAN = 0.55;

/**
 * 1フレーム（1/60秒）あたりの不透明度 alpha を、経過時間 dt の分に直す。
 * 重ねた結果の残り方が、画面のリフレッシュ周波数によらず同じになる
 */
export function trailAlpha(alpha: number, dt: number): number {
  return 1 - (1 - alpha) ** (Math.max(0, dt) * REFERENCE_FPS);
}

/** 相関の表示をならす時定数（秒）。解析の 0.1 秒の値の細かい揺れを抑える */
export const CORRELATION_TAU = 0.15;

/** 相関の表示：目標の値に、時定数 CORRELATION_TAU で近づける。前の値がなければそのまま */
export function smoothCorrelation(previous: number | null, target: number, dt: number): number {
  if (previous === null) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / CORRELATION_TAU);
  return previous + (target - previous) * k;
}

/** 下端の相関のバーの配置（モックの bx・bw・by） */
export function correlationBar(width: number, height: number): { x: number; width: number; y: number } {
  return { x: width * 0.12, width: width * 0.76, y: height - 6 };
}

/** 相関の印の中心の横の位置（−1 が左端、1 が右端） */
export function correlationX(width: number, height: number, correlation: number): number {
  const bar = correlationBar(width, height);
  const c = Math.min(1, Math.max(-1, correlation));
  return bar.x + bar.width / 2 + (c * bar.width) / 2;
}

// --- リサージュ ---

/** リサージュの配置：中心と、振幅 1 が届く半径（外周の円） */
export interface LissajousLayout {
  cx: number;
  cy: number;
  r: number;
}

export function lissajousLayout(width: number, height: number): LissajousLayout {
  return { cx: width / 2, cy: height * 0.47, r: Math.min(width, height * 0.86) * 0.42 };
}

/** 平面上の点（横：(R − L)/√2、縦：(L + R)/√2）を画面に写す */
export function project(layout: LissajousLayout, x: number, y: number): [number, number] {
  return [layout.cx + x * layout.r, layout.cy - y * layout.r];
}

/** 点列の線を、不透明度の近いものどうしでまとめて描く数（古い点ほど薄い。モックは1本ずつ） */
export const TRAIL_GROUPS = 16;

/** i 番目（1〜n−1）の線分の不透明度（モックの 0.25 + 0.75 × i/n） */
export function segmentAlpha(i: number, n: number): number {
  return 0.25 + 0.75 * (i / n);
}

/**
 * 線分 1〜n−1 を TRAIL_GROUPS 個にまとめた区切り。各組は [start, end)（線分の番号）と、その組の不透明度。
 * 1つの組は、点 start−1 から点 end−1 までの1本の折れ線になる
 */
export function segmentGroups(n: number, groups = TRAIL_GROUPS): { start: number; end: number; alpha: number }[] {
  const segments = n - 1;
  if (segments <= 0) return [];
  const count = Math.min(groups, segments);
  const result: { start: number; end: number; alpha: number }[] = [];
  for (let g = 0; g < count; g++) {
    const start = 1 + Math.floor((g * segments) / count);
    const end = 1 + Math.floor(((g + 1) * segments) / count);
    result.push({ start, end, alpha: segmentAlpha((start + end - 1) / 2, n) });
  }
  return result;
}

/** 点描の間隔（モックは3点ごと） */
export const DOT_STEP = 3;

/** 点描の描き方。none は点を描かない（モックの data-dots="none"） */
export interface DotStyle {
  /** 点の一辺 */
  size: number;
  /** 発光の大きさ */
  glow: number;
  /** 中心に文字色の明るい芯を重ねるか */
  bright: boolean;
}

export function dotStyle(dots: "none" | "size" | "bright" | "both"): DotStyle | null {
  if (dots === "none") return null;
  const big = dots === "size" || dots === "both";
  return { size: big ? 3.2 : 1.6, glow: big ? 8 : 4, bright: dots === "bright" || dots === "both" };
}

/** i 番目の点の不透明度（モックの 0.3 + 0.7 × i/n） */
export function dotAlpha(i: number, n: number): number {
  return 0.3 + 0.7 * (i / n);
}

// --- 周波数別の定位 ---

/** 周波数別の定位の配置：縦は下端（低域）〜上端（高域）、横は中央から左右に half まで */
export interface PanLayout {
  top: number;
  bottom: number;
  cx: number;
  half: number;
}

export function panLayout(width: number, height: number): PanLayout {
  return { top: 8, bottom: height - 12, cx: width / 2, half: width * 0.44 };
}

/** 帯域 band の中心の周波数（Hz） */
export function panBandCenterHz(band: number): number {
  return PAN_MIN_HZ * (PAN_MAX_HZ / PAN_MIN_HZ) ** ((band + 0.5) / PAN_BANDS);
}

/** 帯域の振幅（線形）を、点の強さ（0〜1）にする。スペクトラムと同じ換算 */
export function panLevel(amplitude: number, band: number): number {
  return amplitudeToDisplay(amplitude, panBandCenterHz(band));
}

/** 強さがこれ以下の帯域は中央に置き、これ以上で定位どおりに置く（その間はなめらかにつなぐ） */
export const PAN_WEIGHT_FROM = 0.05;
export const PAN_WEIGHT_TO = 0.25;

/**
 * 弱い帯域の定位を中央へ寄せる重み（0〜1）。ほぼ無音の帯域の定位は、雑音で左右に大きく振れるため
 * （モックでも、両端の帯域はほぼ中央に置いている）
 */
export function panWeight(level: number): number {
  const t = Math.min(1, Math.max(0, (level - PAN_WEIGHT_FROM) / (PAN_WEIGHT_TO - PAN_WEIGHT_FROM)));
  return t * t * (3 - 2 * t);
}

/** 帯域 band の点の位置。定位は −1〜1 に収め、弱い帯域ほど中央に寄せる */
export function panPoint(layout: PanLayout, band: number, pan: number, level: number): [number, number] {
  const p = Math.min(1, Math.max(-1, pan)) * panWeight(level);
  const f = PAN_BANDS > 1 ? band / (PAN_BANDS - 1) : 0;
  return [layout.cx + p * layout.half, layout.bottom - f * (layout.bottom - layout.top)];
}

/** 強いとみなして強調色にする強さ（モックの 0.45） */
export const PAN_HOT_LEVEL = 0.45;

/** 点の一辺（モックの 1 + lvl × 3.2） */
export function panDotSize(level: number): number {
  return 1 + level * 3.2;
}

/** モーションブラーの尾を引く最小の移動（px。モックの 2） */
export const BLUR_MIN_DX = 2;

/** 尾の不透明度（モックの min(0.85, 0.25 + |dx|/40)） */
export function blurAlpha(dx: number): number {
  return Math.min(0.85, 0.25 + Math.abs(dx) / 40);
}
