// 開発用ギャラリーを動かす合成信号（モックのダミー信号に合わせる）。
// 実際の解析（Rust）が送るのと同じ並びのセクションを作るので、モジュールは本物の音と同じ経路で描く。
// 乱数は使わず、時刻だけで決まる（見比べるとき、どの表示方式にも同じ信号が入る）。

import {
  CHROMA_BINS,
  ChordQuality,
  KeyMode,
  LISSAJOUS_POINTS,
  LOUDNESS_FLOOR_DB,
  PAN_BANDS,
  SPECTRUM_BANDS,
  SectionId,
  WAVE_NOW_POINTS,
} from "../frame_client";
import { SPEC_CEIL_DB, SPEC_FLOOR_DB, bandCenterHz, tiltDb } from "../modules/spec/spec_math";
import { panBandCenterHz } from "../modules/stereo/stereo_math";

/** 1拍の長さ（秒）。モックの BPM 128 */
export const BEAT = 60 / 128;
/** 今の波形が表す時間（秒） */
const NOW_SECONDS = 0.02;
/** リサージュの点の間隔（秒。モックの 0.00009） */
const LISSAJOUS_STEP = 0.00009;

const TAU = Math.PI * 2;

/** 決まった値を返す疑似乱数（0〜1） */
function hash(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const kickEnv = (time: number) => Math.exp(-((time % BEAT) / BEAT) * 9);

/** 表示の高さ v（0〜1）に当たる線形の振幅。表示の換算（spec_math.ts）の逆 */
export function amplitudeForDisplay(v: number, hz: number): number {
  if (!(v > 0)) return 0;
  const db = SPEC_FLOOR_DB + Math.min(1, v) * (SPEC_CEIL_DB - SPEC_FLOOR_DB) - tiltDb(hz);
  return 10 ** (db / 20);
}

/** 波形用の信号（キックの間は静かにする、疎なスパイク）。ch は 0（L）か 1（R） */
export function waveSig(time: number, ch: number): number {
  const k = kickEnv(time);
  const hp = (time / (BEAT / 2)) % 1;
  const hat = hp < 0.08 ? Math.exp(-hp * 60) : 0;
  return (
    Math.sin(TAU * 55 * time) * k * 0.85 +
    Math.sin(TAU * 220 * time + ch * 0.6) * 0.07 +
    Math.sin(TAU * 330.5 * time + ch) * 0.05 +
    Math.sin(TAU * 2400 * time + ch) * hat * 0.3
  );
}

function waveEnv(time: number, ch: number): number {
  const k = kickEnv(time);
  const hp = (time / (BEAT / 2)) % 1;
  return k ** 2.2 * 0.9 + (hp < 0.08 ? Math.exp(-hp * 60) * 0.25 : 0) + 0.012 + 0.006 * Math.sin(time * 3 + ch);
}

/** スペクトラムの形（帯域ごとの表示の高さ 0〜1） */
function spectrumDisplay(time: number, band: number): number {
  const x = band / (SPECTRUM_BANDS - 1);
  const k = kickEnv(time);
  let v = 0.78 - x * 0.45;
  v += Math.exp(-((x - 0.08) ** 2) / 0.002) * 0.35 * k;
  v += Math.exp(-((x - 0.38) ** 2) / 0.0015) * 0.22 * (0.7 + 0.3 * Math.sin(time * 1.3));
  v += Math.exp(-((x - 0.47) ** 2) / 0.0008) * 0.16;
  v += Math.exp(-((x - 0.82) ** 2) / 0.01) * 0.18 * ((time / (BEAT / 2)) % 1 < 0.12 ? 1 : 0.25);
  v += (hash(band, Math.floor(time * 60)) - 0.5) * 0.06;
  return Math.max(0, Math.min(1, v));
}

const stereoWidth = (time: number) => 0.04 + 0.3 * (0.5 + 0.5 * Math.sin(time * 0.9)) ** 2;

function stereoPair(time: number): [number, number] {
  const wd = stereoWidth(time);
  const a = Math.sin(TAU * 660 * time) + 0.6 * Math.sin(TAU * 1530 * time + 1.1);
  const b = Math.sin(TAU * 660 * time + 0.5 + time * 3) + 0.6 * Math.sin(TAU * 1530 * time + 2.3);
  return [waveSig(time, 0) * 0.8 + a * wd, waveSig(time, 1) * 0.8 - b * wd];
}

/** コード進行（モックの PROGRESSION）：Am → F → C → G。各コードの構成音（先頭が根音）と種類。2小節（8拍）ごとに変わる */
const PROGRESSION: { notes: number[]; quality: ChordQuality }[] = [
  { notes: [9, 0, 4], quality: ChordQuality.Minor },
  { notes: [5, 9, 0], quality: ChordQuality.Major },
  { notes: [0, 4, 7], quality: ChordQuality.Major },
  { notes: [7, 11, 2], quality: ChordQuality.Major },
];
/** この進行のキー：A マイナー */
const SYNTHETIC_KEY: [number, KeyMode] = [9, KeyMode.Minor];

/** クロマ：音名ごとの強さ（モックの drawChroma の値）、コードの根音と種類、キーの主音と調 */
function chromaPayload(time: number): number[] {
  const chord = PROGRESSION[Math.floor(time / (BEAT * 8)) % PROGRESSION.length];
  const strengths = Array.from({ length: CHROMA_BINS }, (_, n) => {
    let v = 0.08 + 0.05 * Math.sin(time * 2 + n);
    if (chord.notes.includes(n)) v += n === chord.notes[0] ? 0.85 : 0.6;
    if (n === 9) v += 0.15 * kickEnv(time);
    return Math.max(0, Math.min(1, v));
  });
  return [...strengths, chord.notes[0], chord.quality, ...SYNTHETIC_KEY];
}

/** 解析のセクション（レベル・波形・スペクトラム・位相・ラウドネス・VU・クロマ・重心と変化量）を、時刻 `time`（秒）の信号から作る */
export function syntheticSections(time: number): [number, number[]][] {
  // レベル：ピークとRMS（L・R）
  const peakL = Math.min(1, 0.55 * kickEnv(time) + 0.3 + 0.05 * Math.sin(time * 2));
  const peakR = Math.min(1, 0.5 * kickEnv(time) + 0.3 + 0.05 * Math.sin(time * 2.3));
  const level = [peakL, peakR, peakL * 0.5, peakR * 0.5];

  // 波形：履歴用の要約（包絡と3つの帯域）と、今の波形（直近 20ms）
  const k = kickEnv(time);
  const hat = (time / (BEAT / 2)) % 1 < 0.08 ? 1 : 0;
  const nowL: number[] = [];
  const nowR: number[] = [];
  for (let i = 0; i < WAVE_NOW_POINTS; i++) {
    const t = time - NOW_SECONDS + (i / (WAVE_NOW_POINTS - 1)) * NOW_SECONDS;
    nowL.push(waveSig(t, 0));
    nowR.push(waveSig(t, 1));
  }
  const waveform = [waveEnv(time, 0), waveEnv(time, 1), 0.05 + 0.6 * k, 0.1 + 0.05 * Math.sin(time), 0.02 + 0.2 * hat, ...nowL, ...nowR];

  // スペクトラム
  const spectrum = Array.from({ length: SPECTRUM_BANDS }, (_, band) => amplitudeForDisplay(spectrumDisplay(time, band), bandCenterHz(band)));

  // 位相：相関、リサージュの点（横 (R − L)/√2・縦 (L + R)/√2）、周波数別の定位と振幅
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < LISSAJOUS_POINTS; i++) {
    const [l, r] = stereoPair(time - (LISSAJOUS_POINTS - 1 - i) * LISSAJOUS_STEP);
    x.push((r - l) * Math.SQRT1_2);
    y.push((l + r) * Math.SQRT1_2);
  }
  const width = stereoWidth(time) * 2.4;
  const frame = Math.floor(time * 24);
  const pan: number[] = [];
  const panLevel: number[] = [];
  for (let i = 0; i < PAN_BANDS; i++) {
    const f = i / (PAN_BANDS - 1);
    const edge = Math.sin(Math.PI * f);
    let p: number;
    let lvl: number;
    if (f < 0.28) {
      p = width * 0.35 * Math.sin(f * 30 + time * 2.2) * edge;
      lvl = 0.9 - f;
    } else if (f < 0.8) {
      p = width * (0.55 * (hash(i, frame) * 2 - 1) + 0.2 * Math.sin(f * 40 + time * 3)) * edge;
      lvl = 0.55 - (f - 0.28) * 0.6;
    } else {
      p = width * 0.08 * (hash(i, frame) * 2 - 1) * edge;
      lvl = 0.18;
    }
    lvl *= 0.75 + 0.25 * k * (f < 0.3 ? 1 : 0.2);
    pan.push(Math.max(-1, Math.min(1, p)));
    panLevel.push(amplitudeForDisplay(lvl, panBandCenterHz(i)));
  }
  const stereo = [0.62 + Math.sin(time * 0.7) * 0.12, ...x, ...y, ...pan, ...panLevel];

  // ラウドネス：モーメンタリ・ショートターム・ピーク（dB）
  const shortTerm = -9.8 + Math.sin(time * 0.9) * 1.6 + k * 0.8;
  const loudness = [shortTerm + k * 2, shortTerm, Math.max(LOUDNESS_FLOOR_DB, -1.2 - 0.4 * (1 - k))];

  // VU：L・R の針の位置（dB）。キックで振れる
  const vu = [-9 + 7 * k + 1.5 * Math.sin(time * 2), -9.5 + 6.5 * k + 1.5 * Math.sin(time * 2.3)];

  // 重心と変化量：明るさがゆっくり動き、キックとハイハットの立ち上がりでフラックスが上がる
  const centroid = [1200 + 900 * (0.5 + 0.5 * Math.sin(time * 0.5)) + 700 * hat, 0.06 + 0.4 * k ** 3 + 0.2 * hat];

  return [
    [SectionId.Level, level],
    [SectionId.Waveform, waveform],
    [SectionId.Spectrum, spectrum],
    [SectionId.Stereo, stereo],
    [SectionId.Loudness, loudness],
    [SectionId.Vu, vu],
    [SectionId.Chroma, chromaPayload(time)],
    [SectionId.Centroid, centroid],
  ];
}
