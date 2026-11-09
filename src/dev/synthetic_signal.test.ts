import { describe, expect, it } from "vitest";
import {
  CENTROID_LEN,
  CHROMA_LEN,
  ChordQuality,
  FrameClient,
  LEVEL_LEN,
  LOUDNESS_LEN,
  SPECTRUM_LEN,
  STEREO_LEN,
  SectionId,
  VU_LEN,
  WAVE_LEN,
  readCentroid,
  readChroma,
  readLevel,
  readLoudness,
  readSpectrum,
  readStereo,
  readVu,
  readWaveform,
} from "../frame_client";
import { encodeTestFrame } from "../frame_client/test_frames";
import { bandCenterHz, toDisplay } from "../modules/spec/spec_math";
import { panBandCenterHz, panLevel } from "../modules/stereo/stereo_math";
import { amplitudeForDisplay, syntheticSections } from "./synthetic_signal";

describe("amplitudeForDisplay", () => {
  it("スペクトラムの表示の換算（toDisplay）の逆：表示の高さ v に戻る", () => {
    for (const band of [0, 10, 48, 95]) {
      for (const v of [0.1, 0.5, 0.9]) {
        expect(toDisplay(amplitudeForDisplay(v, bandCenterHz(band)), band)).toBeCloseTo(v, 4);
      }
    }
  });

  it("位相の定位の強さの換算でも戻る。0 以下は振幅 0", () => {
    expect(panLevel(amplitudeForDisplay(0.6, panBandCenterHz(40)), 40)).toBeCloseTo(0.6, 4);
    expect(amplitudeForDisplay(0, 1000)).toBe(0);
    expect(amplitudeForDisplay(-1, 1000)).toBe(0);
  });
});

describe("syntheticSections", () => {
  const sections = (time: number) => new Map(syntheticSections(time));

  it("8つのセクションを、解析（Rust）と同じ長さで作る", () => {
    const all = sections(1.234);
    expect([...all.keys()]).toEqual([
      SectionId.Level,
      SectionId.Waveform,
      SectionId.Spectrum,
      SectionId.Stereo,
      SectionId.Loudness,
      SectionId.Vu,
      SectionId.Chroma,
      SectionId.Centroid,
    ]);
    expect(all.get(SectionId.Vu)).toHaveLength(VU_LEN);
    expect(all.get(SectionId.Chroma)).toHaveLength(CHROMA_LEN);
    expect(all.get(SectionId.Centroid)).toHaveLength(CENTROID_LEN);
    expect(all.get(SectionId.Level)).toHaveLength(LEVEL_LEN);
    expect(all.get(SectionId.Waveform)).toHaveLength(WAVE_LEN);
    expect(all.get(SectionId.Spectrum)).toHaveLength(SPECTRUM_LEN);
    expect(all.get(SectionId.Stereo)).toHaveLength(STEREO_LEN);
    expect(all.get(SectionId.Loudness)).toHaveLength(LOUDNESS_LEN);
  });

  it("どの時刻でも、値は有限。振幅は 0 以上、定位は −1〜1", () => {
    for (let time = 0; time < 6; time += 0.137) {
      const all = sections(time);
      for (const values of all.values()) expect(values.every(Number.isFinite)).toBe(true);
      expect(all.get(SectionId.Spectrum)!.every((v) => v >= 0)).toBe(true);
      expect(all.get(SectionId.Level)!.every((v) => v >= 0 && v <= 1)).toBe(true);
      const stereo = all.get(SectionId.Stereo)!;
      const pan = stereo.slice(1 + 2 * 256, 1 + 2 * 256 + 120);
      expect(pan.every((v) => v >= -1 && v <= 1)).toBe(true);
    }
  });

  it("時刻だけで決まる（乱数を使わない）ので、同じ時刻なら同じ値になる。時刻が進めば変わる", () => {
    expect(syntheticSections(2.5)).toEqual(syntheticSections(2.5));
    expect(syntheticSections(2.5)).not.toEqual(syntheticSections(2.6));
  });

  it("受信側（FrameClient）が、5つとも型つきで読める。波形とスペクトラムは履歴にも積まれる", () => {
    const client = new FrameClient();
    client.receive(encodeTestFrame({ sections: syntheticSections(0.3) }));
    const frame = client.latest!;
    expect(readLevel(frame)).not.toBeNull();
    expect(readWaveform(frame)).not.toBeNull();
    expect(readSpectrum(frame)).not.toBeNull();
    expect(readStereo(frame)).not.toBeNull();
    expect(readLoudness(frame)).not.toBeNull();
    expect(client.histories.wave.length).toBe(1);
    expect(client.histories.gram.length).toBe(1);
  });

  it("VU・クロマ・重心と変化量も、型つきで読める。重心は履歴にも積まれる", () => {
    const client = new FrameClient();
    client.receive(encodeTestFrame({ sections: syntheticSections(0.3) }));
    const frame = client.latest!;
    expect(readVu(frame)).not.toBeNull();
    expect(readChroma(frame)).not.toBeNull();
    expect(readCentroid(frame)).not.toBeNull();
    expect(client.histories.centroid.length).toBe(1);
  });

  it("クロマは Am → F → C → G と 8 拍ごとに変わり、キーは A マイナー。根音がいちばん強い", () => {
    const beats8 = (60 / 128) * 8;
    const chords = [0.5, 1.5, 2.5, 3.5, 4.5].map((n) => readChroma(encodeAndRead(n * beats8))!);
    expect(chords.map((c) => c.chord)).toEqual([
      { root: 9, quality: ChordQuality.Minor },
      { root: 5, quality: ChordQuality.Major },
      { root: 0, quality: ChordQuality.Major },
      { root: 7, quality: ChordQuality.Major },
      { root: 9, quality: ChordQuality.Minor },
    ]);
    expect(chords.every((c) => c.key?.tonic === 9 && c.key.mode === 1)).toBe(true);
    for (const c of chords) {
      const root = c.chord!.root;
      expect(Math.max(...c.chroma)).toBe(c.chroma[root]);
    }
  });

  it("VU は目盛りの範囲（−20〜+3）に収まる。フラックスは 0〜1", () => {
    for (let time = 0; time < 6; time += 0.137) {
      const frame = encodeAndRead(time);
      const vu = readVu(frame)!;
      expect(vu.left).toBeGreaterThan(-20);
      expect(vu.left).toBeLessThan(3);
      expect(vu.right).toBeGreaterThan(-20);
      expect(vu.right).toBeLessThan(3);
      const centroid = readCentroid(frame)!;
      expect(centroid.centroidHz).toBeGreaterThan(0);
      expect(centroid.flux).toBeGreaterThanOrEqual(0);
      expect(centroid.flux).toBeLessThanOrEqual(1);
    }
  });

  it("スペクトラムは低域が高く、キックの直後は低域が持ち上がる（モックの形）", () => {
    const at = (time: number) => readSpectrum(encodeAndRead(time))!.bands;
    const kick = at(0.001);
    const quiet = at(0.4);
    expect(kick[8]).toBeGreaterThan(quiet[8]);
    expect(kick[8]).toBeGreaterThan(kick[90]);
  });

  it("ラウドネスは、モックの数値（−9.8 付近）で動く。ピークは床より上", () => {
    const loudness = readLoudness(encodeAndRead(1))!;
    expect(loudness.shortTerm).toBeGreaterThan(-13);
    expect(loudness.shortTerm).toBeLessThan(-7);
    expect(loudness.peak).toBeLessThan(0);
    expect(loudness.peak).toBeGreaterThan(-20);
  });
});

function encodeAndRead(time: number) {
  const client = new FrameClient();
  client.receive(encodeTestFrame({ sections: syntheticSections(time) }));
  return client.latest!;
}
