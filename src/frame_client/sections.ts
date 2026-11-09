// セクションIDと、ペイロードの読み方。送出側の対応表（src-tauri/src/frame_transport/format.rs の冒頭）と、
// 各解析の並び（src-tauri/src/analysis/level.rs・waveform.rs・spectrum.rs・stereo.rs・loudness.rs・vu.rs・chroma.rs・
// centroid.rs）に合わせる。

import type { AnalysisFrame } from "./format";

/** セクションID（値は Rust の analysis::SectionId と同じ。変えない） */
export const SectionId = {
  Level: 1,
  Waveform: 2,
  Spectrum: 3,
  Stereo: 4,
  Loudness: 5,
  Vu: 6,
  Chroma: 7,
  Centroid: 8,
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

/** スペクトラムの帯域の数 */
export const SPECTRUM_BANDS = 96;
/** スペクトラムのいちばん低い帯域の下端（Hz）。帯域は下端〜上端を対数で等分したもの */
export const SPECTRUM_MIN_HZ = 30;
/** スペクトラムのいちばん高い帯域の上端（Hz） */
export const SPECTRUM_MAX_HZ = 20_000;
/** スペクトラムのペイロードの長さ */
export const SPECTRUM_LEN = SPECTRUM_BANDS;

/** スペクトラム。帯域ごとの振幅（線形、1.0 がフルスケール、低い順）。スペクトログラムも使う */
export interface SpectrumValues {
  bands: Float32Array;
}

export function readSpectrum(frame: AnalysisFrame): SpectrumValues | null {
  const v = frame.sections.get(SectionId.Spectrum);
  if (!v || v.length !== SPECTRUM_LEN) return null;
  return { bands: v };
}

/** リサージュの点の数 */
export const LISSAJOUS_POINTS = 256;
/** 周波数別の定位の帯域の数 */
export const PAN_BANDS = 120;
/** 周波数別の定位のいちばん低い帯域の下端（Hz） */
export const PAN_MIN_HZ = 30;
/** 周波数別の定位のいちばん高い帯域の上端（Hz） */
export const PAN_MAX_HZ = 20_000;
/** 位相のペイロードの長さ（相関・リサージュの横と縦・定位・振幅） */
export const STEREO_LEN = 1 + 2 * LISSAJOUS_POINTS + 2 * PAN_BANDS;

/** 位相 */
export interface StereoValues {
  /** 相関（−1〜1。1 = L と R が同じ、0 = 無関係・片側だけ・無音、−1 = 逆位相） */
  correlation: number;
  /** リサージュの点の横（(R − L)/√2。右が正。直近 20ms を古い順に `LISSAJOUS_POINTS` 点） */
  x: Float32Array;
  /** リサージュの点の縦（(L + R)/√2。上が正） */
  y: Float32Array;
  /** 周波数別の定位（−1 = 左だけ、0 = 中央、1 = 右だけ。低い順に `PAN_BANDS` 個） */
  pan: Float32Array;
  /** 周波数別の振幅（線形、1.0 がフルスケール） */
  panLevel: Float32Array;
}

export function readStereo(frame: AnalysisFrame): StereoValues | null {
  const v = frame.sections.get(SectionId.Stereo);
  if (!v || v.length !== STEREO_LEN) return null;
  const x = 1;
  const y = x + LISSAJOUS_POINTS;
  const pan = y + LISSAJOUS_POINTS;
  const panLevel = pan + PAN_BANDS;
  return {
    correlation: v[0],
    x: v.subarray(x, y),
    y: v.subarray(y, pan),
    pan: v.subarray(pan, panLevel),
    panLevel: v.subarray(panLevel),
  };
}

/** ラウドネスのペイロードの長さ */
export const LOUDNESS_LEN = 3;
/** 計算できないとき（無音など）の値（dB）。この値以下は −∞ として表示する */
export const LOUDNESS_FLOOR_DB = -120;

/** ラウドネス（LOUD）の近似とピーク。値は dB */
export interface LoudnessValues {
  /** 直近 0.4 秒のラウドネス（LUFS に近い値） */
  momentary: number;
  /** 直近 3 秒のラウドネス（LOUD の表示に使う） */
  shortTerm: number;
  /** 直近 3 秒の L・R のサンプルの最大値（dBFS） */
  peak: number;
}

export function readLoudness(frame: AnalysisFrame): LoudnessValues | null {
  const v = frame.sections.get(SectionId.Loudness);
  if (!v || v.length !== LOUDNESS_LEN) return null;
  return { momentary: v[0], shortTerm: v[1], peak: v[2] };
}

/** VU のペイロードの長さ */
export const VU_LEN = 2;
/** 針が振れていないときの値（dB）。目盛りの範囲（−20〜+3）への切り詰めは表示側で行う */
export const VU_FLOOR_DB = -120;

/** VU。L・R の針の位置（VU。0 が基準で、ピークが −18 dBFS の正弦波。dB の目盛り）。針の動きは解析側でまねてある */
export interface VuValues {
  left: number;
  right: number;
}

export function readVu(frame: AnalysisFrame): VuValues | null {
  const v = frame.sections.get(SectionId.Vu);
  if (!v || v.length !== VU_LEN) return null;
  return { left: v[0], right: v[1] };
}

/** 音名の数（C, C♯, D, … , B の順） */
export const CHROMA_BINS = 12;
/** クロマのペイロードの長さ（音名ごとの強さ・コードの根音と種類・キーの主音と調） */
export const CHROMA_LEN = CHROMA_BINS + 4;

/** コードの種類 */
export const ChordQuality = { Major: 0, Minor: 1 } as const;
export type ChordQuality = (typeof ChordQuality)[keyof typeof ChordQuality];
/** キーの調 */
export const KeyMode = { Major: 0, Minor: 1 } as const;
export type KeyMode = (typeof KeyMode)[keyof typeof KeyMode];

/** クロマ。近似で、正確な和声分析ではない */
export interface ChromaValues {
  /** 音名ごとの強さ（0〜1。C から半音ずつ `CHROMA_BINS` 個。時間方向に平滑化してあり、無音では 0 に戻る） */
  chroma: Float32Array;
  /** 今のコード。推定できないときは null */
  chord: { root: number; quality: ChordQuality } | null;
  /** 推定したキー。推定できないときは null */
  key: { tonic: number; mode: KeyMode } | null;
}

/** 音名の番号（0〜11）。範囲外・整数でなければ null */
function pitchClass(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value < CHROMA_BINS ? value : null;
}

/** 2種類の選択肢（0・1）。範囲外なら null */
function binary(value: number): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

export function readChroma(frame: AnalysisFrame): ChromaValues | null {
  const v = frame.sections.get(SectionId.Chroma);
  if (!v || v.length !== CHROMA_LEN) return null;
  const root = pitchClass(v[CHROMA_BINS]);
  const quality = binary(v[CHROMA_BINS + 1]);
  const tonic = pitchClass(v[CHROMA_BINS + 2]);
  const mode = binary(v[CHROMA_BINS + 3]);
  return {
    chroma: v.subarray(0, CHROMA_BINS),
    chord: root !== null && quality !== null ? { root, quality } : null,
    key: tonic !== null && mode !== null ? { tonic, mode } : null,
  };
}

/** 重心と変化量のペイロードの長さ */
export const CENTROID_LEN = 2;

/** 重心と変化量 */
export interface CentroidValues {
  /** スペクトルの重心（Hz。周波数を線形のまま振幅で重み付けした平均）。無音のときは 0 */
  centroidHz: number;
  /** フラックス（0〜1。前回の解析から増えた分の割合。0 = 変化なし）。無音のときは 0 */
  flux: number;
}

export function readCentroid(frame: AnalysisFrame): CentroidValues | null {
  const v = frame.sections.get(SectionId.Centroid);
  if (!v || v.length !== CENTROID_LEN) return null;
  return { centroidHz: v[0], flux: v[1] };
}
