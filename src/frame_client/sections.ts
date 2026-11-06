// セクションIDと、ペイロードの読み方。送出側の対応表（src-tauri/src/frame_transport/format.rs の冒頭）と、
// 各解析の並び（src-tauri/src/analysis/level.rs・waveform.rs）に合わせる。

import type { AnalysisFrame } from "./format";

/** セクションID（値は Rust の analysis::SectionId と同じ。変えない） */
export const SectionId = {
  Level: 1,
  Waveform: 2,
} as const;
export type SectionId = (typeof SectionId)[keyof typeof SectionId];

/** レベルのペイロードの長さ */
export const LEVEL_LEN = 4;
/** 今の波形の点数 */
export const WAVE_NOW_POINTS = 512;
/** 波形の履歴用の要約の長さ（env_l, env_r, band_low, band_mid, band_high） */
export const WAVE_SUMMARY_LEN = 5;
/** 波形のペイロードの長さ */
export const WAVE_LEN = WAVE_SUMMARY_LEN + 2 * WAVE_NOW_POINTS;

/** 波形の履歴の1列の並び（`WaveformValues.summary` と同じ） */
export const WaveSummary = {
  EnvL: 0,
  EnvR: 1,
  BandLow: 2,
  BandMid: 3,
  BandHigh: 4,
} as const;

/** レベル。線形の振幅で、1.0 がフルスケール。前回のフレームから新しく届いたサンプルの値 */
export interface LevelValues {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

/** 波形 */
export interface WaveformValues {
  /** 履歴の1列分（`WaveSummary` の並び） */
  summary: Float32Array;
  /** 今の波形（直近 20ms を古い順に `WAVE_NOW_POINTS` 点） */
  nowL: Float32Array;
  nowR: Float32Array;
}

export function readLevel(frame: AnalysisFrame): LevelValues | null {
  const v = frame.sections.get(SectionId.Level);
  if (!v || v.length !== LEVEL_LEN) return null;
  return { peakL: v[0], peakR: v[1], rmsL: v[2], rmsR: v[3] };
}

export function readWaveform(frame: AnalysisFrame): WaveformValues | null {
  const v = frame.sections.get(SectionId.Waveform);
  if (!v || v.length !== WAVE_LEN) return null;
  return {
    summary: v.subarray(0, WAVE_SUMMARY_LEN),
    nowL: v.subarray(WAVE_SUMMARY_LEN, WAVE_SUMMARY_LEN + WAVE_NOW_POINTS),
    nowR: v.subarray(WAVE_SUMMARY_LEN + WAVE_NOW_POINTS),
  };
}
