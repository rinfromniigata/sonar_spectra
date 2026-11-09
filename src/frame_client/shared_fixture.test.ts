// 送出と受信で共有するテスト用データ（src-tauri/src/frame_transport/fixtures/frame_format_v1.json）を、
// 受信側で検査する。送出側（src-tauri/src/frame_transport/shared_fixture.rs）は同じデータで
// 「値を符号化するとバイト列になる」を、こちらは「バイト列を復元すると値になる」を確かめる。
import { describe, expect, it } from "vitest";
import fixture from "../../src-tauri/src/frame_transport/fixtures/frame_format_v1.json";
import { FrameClient } from "./client";
import { FLAG_STALE, FORMAT_VERSION, decodeFrame, type AnalysisFrame } from "./format";
import {
  CENTROID_LEN,
  CHROMA_BINS,
  CHROMA_LEN,
  ChordQuality,
  LEVEL_LEN,
  LOUDNESS_LEN,
  PAN_BANDS,
  PAN_MAX_HZ,
  PAN_MIN_HZ,
  SPECTRUM_BANDS,
  SPECTRUM_LEN,
  SPECTRUM_MAX_HZ,
  SPECTRUM_MIN_HZ,
  STEREO_LEN,
  SectionId,
  VU_LEN,
  WAVE_LEN,
  WAVE_SUMMARY_LEN,
  readCentroid,
  readChroma,
  readLevel,
  readLoudness,
  readSpectrum,
  readStereo,
  readVu,
  readWaveform,
} from "./sections";

/** 対数の帯域のうち、周波数 hz を含むもの */
function bandOf(hz: number, count: number, minHz: number, maxHz: number): number {
  return Math.floor((Math.log(hz / minHz) / Math.log(maxHz / minHz)) * count);
}

function loudest(values: Float32Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function decodeOk(bytes: Uint8Array<ArrayBuffer>): AnalysisFrame {
  const result = decodeFrame(bytes.buffer);
  if (!result.ok) throw new Error(`decode failed: ${result.error.kind}`);
  return result.frame;
}

const analysisFrame = fixture.frames[0];
const sectionValues = (id: number) => analysisFrame.sections.find((s) => s.id === id)!.values;

describe("共有のテスト用データ（受信側）", () => {
  it("データの形式の版が、受信側の FORMAT_VERSION と同じ", () => {
    expect(fixture.format_version).toBe(FORMAT_VERSION);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：復元したヘッダが一致する", (_name, frame) => {
    const decoded = decodeOk(fromHex(frame.bytes_hex));
    expect(decoded.seq).toBe(frame.seq);
    expect(decoded.sampleRate).toBe(frame.sample_rate);
    expect(decoded.flags).toBe(frame.flags);
    expect(decoded.stale).toBe((frame.flags & FLAG_STALE) !== 0);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：復元したセクションの値が、f32 として厳密に一致する", (_name, frame) => {
    const decoded = decodeOk(fromHex(frame.bytes_hex));
    expect([...decoded.sections.keys()]).toEqual(frame.sections.map((s) => s.id));
    for (const section of frame.sections) {
      const values = decoded.sections.get(section.id)!;
      expect(values.length).toBe(section.values.length);
      const mismatches = section.values.flatMap((v, i) => (values[i] === Math.fround(v) ? [] : [i]));
      expect(mismatches, `section ${section.id}`).toEqual([]);
    }
  });

  it("両側の対応表がそろっている（セクションIDとペイロードの長さ）", () => {
    expect(sectionValues(SectionId.Level)).toHaveLength(LEVEL_LEN);
    expect(sectionValues(SectionId.Waveform)).toHaveLength(WAVE_LEN);
    expect(sectionValues(SectionId.Spectrum)).toHaveLength(SPECTRUM_LEN);
    expect(sectionValues(SectionId.Stereo)).toHaveLength(STEREO_LEN);
    expect(sectionValues(SectionId.Loudness)).toHaveLength(LOUDNESS_LEN);
    expect(sectionValues(SectionId.Vu)).toHaveLength(VU_LEN);
    expect(sectionValues(SectionId.Chroma)).toHaveLength(CHROMA_LEN);
    expect(sectionValues(SectionId.Centroid)).toHaveLength(CENTROID_LEN);
    const decoded = decodeOk(fromHex(analysisFrame.bytes_hex));
    expect(readLevel(decoded)).not.toBeNull();
    expect(readWaveform(decoded)).not.toBeNull();
    expect(readSpectrum(decoded)).not.toBeNull();
    expect(readStereo(decoded)).not.toBeNull();
    expect(readLoudness(decoded)).not.toBeNull();
    expect(readVu(decoded)).not.toBeNull();
    expect(readChroma(decoded)).not.toBeNull();
    expect(readCentroid(decoded)).not.toBeNull();
  });

  // テスト用データの信号：L に 1 kHz・振幅 0.5、R に 3 kHz・振幅 0.25 の正弦波
  it("スペクトラム：山が 1 kHz の帯域に来る", () => {
    const spectrum = readSpectrum(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    expect(spectrum.bands).toHaveLength(SPECTRUM_BANDS);
    expect(loudest(spectrum.bands)).toBe(bandOf(1_000, SPECTRUM_BANDS, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ));
  });

  it("位相：並びどおりに読め、1 kHz は左、3 kHz は右に定位する", () => {
    const stereo = readStereo(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    const values = sectionValues(SectionId.Stereo).map(Math.fround);
    expect(stereo.correlation).toBe(values[0]);
    expect(Array.from(stereo.x)).toEqual(values.slice(1, 257));
    expect(Array.from(stereo.y)).toEqual(values.slice(257, 513));
    expect(stereo.pan).toHaveLength(PAN_BANDS);
    expect(stereo.panLevel).toHaveLength(PAN_BANDS);

    const band = (hz: number) => bandOf(hz, PAN_BANDS, PAN_MIN_HZ, PAN_MAX_HZ);
    const nearest = (hz: number) => [band(hz) - 1, band(hz), band(hz) + 1].reduce((a, b) => (stereo.panLevel[b] > stereo.panLevel[a] ? b : a));
    expect(stereo.pan[nearest(1_000)]).toBeCloseTo(-1, 3);
    expect(stereo.pan[nearest(3_000)]).toBeCloseTo(1, 3);
  });

  it("長さが対応表と合わないセクションは読まない", () => {
    const frame: AnalysisFrame = {
      seq: 0,
      sampleRate: 48_000,
      flags: 0,
      stale: false,
      sections: new Map([
        [SectionId.Spectrum, new Float32Array(SPECTRUM_LEN - 1)],
        [SectionId.Stereo, new Float32Array(STEREO_LEN + 1)],
        [SectionId.Loudness, new Float32Array(LOUDNESS_LEN - 1)],
        [SectionId.Vu, new Float32Array(VU_LEN + 1)],
        [SectionId.Chroma, new Float32Array(CHROMA_LEN - 1)],
        [SectionId.Centroid, new Float32Array(CENTROID_LEN + 1)],
      ]),
    };
    expect(readSpectrum(frame)).toBeNull();
    expect(readStereo(frame)).toBeNull();
    expect(readLoudness(frame)).toBeNull();
    expect(readVu(frame)).toBeNull();
    expect(readChroma(frame)).toBeNull();
    expect(readCentroid(frame)).toBeNull();
  });

  it("ラウドネス：値は dB で、ピークは L の振幅 0.5（約 −6 dBFS）", () => {
    const loudness = readLoudness(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    const values = sectionValues(SectionId.Loudness).map(Math.fround);
    expect([loudness.momentary, loudness.shortTerm, loudness.peak]).toEqual(values);
    expect(loudness.peak).toBeCloseTo(20 * Math.log10(0.5), 2);
  });

  it("VU：並びどおりに読め、1回分の解析では針がまだ振れきらない（L の方が大きい）", () => {
    const vu = readVu(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    const values = sectionValues(SectionId.Vu).map(Math.fround);
    expect([vu.left, vu.right]).toEqual(values);
    expect(vu.left).toBeLessThan(0);
    expect(vu.left).toBeGreaterThan(vu.right);
  });

  it("クロマ：1 kHz は B、3 kHz は F♯ に入り、1回分の解析ではコードとキーはまだ推定できない", () => {
    const chroma = readChroma(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    expect(chroma.chroma).toHaveLength(CHROMA_BINS);
    expect(loudest(chroma.chroma)).toBe(11);
    const others = Array.from(chroma.chroma).filter((_, i) => i !== 11 && i !== 6);
    expect(Math.max(...others)).toBe(0);
    expect(chroma.chroma[6]).toBeGreaterThan(0);
    expect(chroma.chord).toBeNull();
    expect(chroma.key).toBeNull();
  });

  it("クロマ：コードとキーの値は、範囲内の整数だけを読む", () => {
    const values = new Float32Array(CHROMA_LEN);
    values.set([9, ChordQuality.Minor, 0, 0], CHROMA_BINS);
    const frame = (v: Float32Array): AnalysisFrame => ({ seq: 0, sampleRate: 48_000, flags: 0, stale: false, sections: new Map([[SectionId.Chroma, v]]) });
    expect(readChroma(frame(values))).toMatchObject({ chord: { root: 9, quality: ChordQuality.Minor }, key: { tonic: 0, mode: 0 } });
    values.set([-1, -1, 12, 0.5], CHROMA_BINS);
    expect(readChroma(frame(values))).toMatchObject({ chord: null, key: null });
  });

  it("重心と変化量：重心は 1 kHz と 3 kHz の間で、振幅の大きい 1 kHz 寄り", () => {
    const centroid = readCentroid(decodeOk(fromHex(analysisFrame.bytes_hex)))!;
    expect([centroid.centroidHz, centroid.flux]).toEqual(sectionValues(SectionId.Centroid).map(Math.fround));
    expect(centroid.centroidHz).toBeGreaterThan(1_000);
    expect(centroid.centroidHz).toBeLessThan(2_000);
  });

  it("4バイト境界にそろったセクション（レベル）はビュー、そろっていないセクション（波形）はコピーで読み、どちらも同じ値になる", () => {
    const bytes = fromHex(analysisFrame.bytes_hex);
    const decoded = decodeOk(bytes);
    const level = decoded.sections.get(SectionId.Level)!;
    const wave = decoded.sections.get(SectionId.Waveform)!;
    expect(level.buffer).toBe(bytes.buffer);
    expect(wave.buffer).not.toBe(bytes.buffer);
    expect(readLevel(decoded)!.peakL).toBe(Math.fround(sectionValues(SectionId.Level)[0]));
  });

  it("受信（FrameClient）を通すと、波形の要約が履歴に積まれ、知らないセクションは無視される", () => {
    const client = new FrameClient();
    expect(client.receive(fromHex(analysisFrame.bytes_hex))).toBe(true);
    const expected = sectionValues(SectionId.Waveform).slice(0, WAVE_SUMMARY_LEN).map(Math.fround);
    expect(Array.from(client.histories.wave.latest()!)).toEqual(expected);
    expect(client.latest!.sections.has(200)).toBe(true);

    // STALE の空のフレームは、最新の値にはなるが、履歴には積まない
    expect(client.receive(fromHex(fixture.frames[1].bytes_hex))).toBe(true);
    expect(client.histories.wave.length).toBe(1);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：形式の版を変えたバイト列は受け付けず、食い違いを記録する", (_name, frame) => {
    const bytes = fromHex(frame.bytes_hex);
    bytes[2] = FORMAT_VERSION + 1;
    expect(decodeFrame(bytes.buffer)).toEqual({ ok: false, error: { kind: "version", version: FORMAT_VERSION + 1 } });

    const client = new FrameClient();
    expect(client.receive(bytes)).toBe(false);
    expect(client.stats.incompatibleVersion).toBe(FORMAT_VERSION + 1);
    expect(client.latest).toBeNull();
  });
});
