// クロマのモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawChroma に合わせる。
//
// 解析（Rust）は、音名ごとの強さ（0〜1。0.15 秒で平滑化済み）、今のコード（根音と長・短）、推定したキー（主音と長・短）を送る。
// ここで決めるのは、円環の配置、音名・コード・キーの表記、受信が途切れたときの戻り方。

import { ChordQuality, CHROMA_BINS, KeyMode } from "../../frame_client";

/** 音名（C から半音ずつ。モックの NOTE_NAMES）。音楽の記法なので、辞書には入れない */
export const NOTE_NAMES: readonly string[] = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** 円環の外半径に対する内半径（モックの r0 = R * 0.45） */
export const INNER_RATIO = 0.45;
/** 1つの音名の扇が占める幅（音名の間隔を 1 として。モックの ±0.42 で、隙間は 0.16） */
export const SEGMENT_HALF = 0.42;
/** 音名の文字を置く距離（外半径に対する倍率。モックの 1 + 0.14） */
export const NOTE_LABEL_DISTANCE = 1.14;
/** 強さに応じた不透明度（モックの 0.25 + 0.75 v）と発光（モックの 12 v） */
export const ALPHA_BASE = 0.25;
export const ALPHA_GAIN = 0.75;
export const GLOW_GAIN = 12;
/** 音名の文字を「濃い色」にするしきい値（モックの v > 0.5） */
export const LABEL_BRIGHT_ABOVE = 0.5;
/** 受信が途切れたとき、各音名が 0 へ戻る時定数（秒。モックの 1 フレームあたり 0.12 に当たる） */
export const FALL_TAU = 0.14;
/** コードが推定できないときの主表示（モックの「—」） */
export const NO_CHORD = "—";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 強さ（0〜1）に切り詰める。計算できない値（NaN）は 0 */
export function clampStrength(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

/** 音名の名前。範囲外は空 */
export function noteName(pitchClass: number): string {
  return NOTE_NAMES[pitchClass] ?? "";
}

/** コードの表記：根音の音名に、短調なら「m」を付ける（C、Am、F♯m） */
export function formatChord(root: number, quality: ChordQuality): string {
  return `${noteName(root)}${quality === ChordQuality.Minor ? "m" : ""}`;
}

/** キーの調（辞書に「{tonic} major」「{tonic} minor」がある）。キーを表す辞書キーと、主音の音名 */
export function keyParts(tonic: number, mode: KeyMode): { mode: "major" | "minor"; tonic: string } {
  return { mode: mode === KeyMode.Minor ? "minor" : "major", tonic: noteName(tonic) };
}

/** 受信が途切れたとき、強さを 0 へ時定数 FALL_TAU で近づける */
export function fallToZero(previous: number, dt: number): number {
  return previous * Math.exp(-Math.max(0, dt) / FALL_TAU);
}

/** 音名 n の扇の角度（ラジアン。C が真上で、時計回り） */
export function segmentAngles(n: number): { start: number; end: number } {
  return {
    start: -Math.PI / 2 + ((n - SEGMENT_HALF) / CHROMA_BINS) * Math.PI * 2,
    end: -Math.PI / 2 + ((n + SEGMENT_HALF) / CHROMA_BINS) * Math.PI * 2,
  };
}

/** 音名 n の文字を置く角度（扇の真ん中） */
export function labelAngle(n: number): number {
  return -Math.PI / 2 + (n / CHROMA_BINS) * Math.PI * 2;
}

/** 配置：円環の中心と半径、文字の大きさ（モックの cx・cy・R・r0 とフォントの式） */
export interface ChromaLayout {
  centerX: number;
  centerY: number;
  outer: number;
  inner: number;
  noteFont: number;
  chordFont: number;
  keyFont: number;
  chordY: number;
  keyY: number;
}

export function chromaLayout(width: number, height: number): ChromaLayout {
  const outer = Math.min(width, height) * 0.42;
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    centerX,
    centerY,
    outer,
    inner: outer * INNER_RATIO,
    noteFont: clamp(outer / 7, 8, 12),
    chordFont: clamp(outer / 3.2, 11, 26),
    keyFont: clamp(outer / 8, 8, 11),
    chordY: centerY - outer * 0.06,
    keyY: centerY + outer * 0.2,
  };
}

/** 強さ v のときの扇の外側の半径 */
export function strengthRadius(layout: ChromaLayout, strength: number): number {
  return layout.inner + (layout.outer - layout.inner) * clampStrength(strength);
}

/** 強さ v のときの扇の不透明度 */
export function strengthAlpha(strength: number): number {
  return ALPHA_BASE + ALPHA_GAIN * clampStrength(strength);
}
