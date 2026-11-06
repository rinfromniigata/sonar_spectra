import { describe, expect, it } from "vitest";
import { SPECTRUM_BANDS } from "../../frame_client";
import {
  BAR_COUNT,
  FREQUENCY_TICKS,
  PEAK_FALL_PER_FRAME,
  SMOOTH_DECAY_PER_FRAME,
  TILT_REFERENCE_HZ,
  bandCenterHz,
  barValue,
  radialBand,
  radialLayout,
  toDisplay,
  toDisplayBands,
  updatePeakHold,
  updateSmooth,
  xOfBand,
  xOfHz,
} from "./spec_math";

/** 中心が基準の周波数（傾きの補正が 0）にいちばん近い帯域 */
const REFERENCE_BAND = Array.from({ length: SPECTRUM_BANDS }, (_, i) => i).reduce((best, i) =>
  Math.abs(Math.log(bandCenterHz(i) / TILT_REFERENCE_HZ)) < Math.abs(Math.log(bandCenterHz(best) / TILT_REFERENCE_HZ)) ? i : best,
);

describe("帯域の周波数", () => {
  it("中心の周波数は 30 Hz〜20 kHz を対数で等分した並びで、低い順に増える", () => {
    expect(bandCenterHz(0)).toBeGreaterThan(30);
    expect(bandCenterHz(SPECTRUM_BANDS - 1)).toBeLessThan(20_000);
    const ratios = Array.from({ length: SPECTRUM_BANDS - 1 }, (_, i) => bandCenterHz(i + 1) / bandCenterHz(i));
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 9);
    expect(ratios[0]).toBeGreaterThan(1);
  });
});

describe("toDisplay（振幅 → 表示の高さ）", () => {
  it("無音・不正な値は 0。フルスケールは 1 で、範囲の外は収める", () => {
    expect(toDisplay(0, 10)).toBe(0);
    expect(toDisplay(-1, 10)).toBe(0);
    expect(toDisplay(Number.NaN, 10)).toBe(0);
    expect(toDisplay(1, REFERENCE_BAND)).toBe(1);
    expect(toDisplay(1e-9, REFERENCE_BAND)).toBe(0);
  });

  it("基準の周波数の付近では、dB に比例する（−80 dB で 0、−10 dB で 1）", () => {
    const at = (db: number) => toDisplay(10 ** (db / 20), REFERENCE_BAND);
    expect(at(-80)).toBeCloseTo(0, 1);
    expect(at(-45)).toBeCloseTo(0.5, 1);
    expect(at(-10)).toBeCloseTo(1, 1);
    expect(at(-30)).toBeGreaterThan(at(-50));
  });

  it("同じ振幅でも、高域ほど高く表示する（傾きの補正）", () => {
    const amplitude = 10 ** (-50 / 20);
    expect(toDisplay(amplitude, 90)).toBeGreaterThan(toDisplay(amplitude, REFERENCE_BAND));
    expect(toDisplay(amplitude, 2)).toBeLessThan(toDisplay(amplitude, REFERENCE_BAND));
  });

  it("toDisplayBands：null は全帯域 0", () => {
    const out = new Float32Array(SPECTRUM_BANDS).fill(0.5);
    toDisplayBands(null, out);
    expect(out.every((v) => v === 0)).toBe(true);
    const bands = new Float32Array(SPECTRUM_BANDS).fill(1);
    toDisplayBands(bands, out);
    expect(out.every((v) => v === 1)).toBe(true);
  });
});

describe("平滑化とピークの残像", () => {
  it("平滑化：上がるときは即座に、下がるときは1/60秒ごとに 0.88 倍", () => {
    const smooth = new Float32Array([0, 1]);
    updateSmooth(smooth, new Float32Array([0.7, 0.2]), 1 / 60);
    expect(smooth[0]).toBeCloseTo(0.7, 6);
    expect(smooth[1]).toBeCloseTo(SMOOTH_DECAY_PER_FRAME, 6);
  });

  it("平滑化：下がる速さは画面のリフレッシュ周波数によらない（1/60秒1回 = 1/120秒2回）", () => {
    const once = new Float32Array([1]);
    const twice = new Float32Array([1]);
    const silent = new Float32Array([0]);
    updateSmooth(once, silent, 1 / 60);
    updateSmooth(twice, silent, 1 / 120);
    updateSmooth(twice, silent, 1 / 120);
    expect(twice[0]).toBeCloseTo(once[0], 6);
    updateSmooth(once, silent, 0);
    expect(once[0]).toBeCloseTo(SMOOTH_DECAY_PER_FRAME, 6);
  });

  it("ピークの残像：平滑化した値に追いつき、そこから 1/60秒ごとに 0.004 下がり、0 より下がらない", () => {
    const peak = new Float32Array([0, 0]);
    updatePeakHold(peak, new Float32Array([0.8, 0]), 1 / 60);
    expect(peak[0]).toBeCloseTo(0.8, 6);
    updatePeakHold(peak, new Float32Array([0.2, 0]), 1 / 60);
    expect(peak[0]).toBeCloseTo(0.8 - PEAK_FALL_PER_FRAME, 6);
    expect(peak[1]).toBe(0);
    updatePeakHold(peak, new Float32Array([0.2, 0]), 60);
    expect(peak[0]).toBeCloseTo(0.2, 6);
  });
});

describe("横の位置", () => {
  it("両端の帯域が枠の両端に来る", () => {
    expect(xOfBand(0, 400)).toBe(0);
    expect(xOfBand(SPECTRUM_BANDS - 1, 400)).toBe(400);
  });

  it("周波数の目盛りの位置は、モックの 6・30・55・80・97% に近く、左から右へ並ぶ", () => {
    const mock = [0.06, 0.3, 0.55, 0.8, 0.97];
    const positions = FREQUENCY_TICKS.map((t) => xOfHz(t.hz, 1));
    positions.forEach((p, i) => expect(Math.abs(p - mock[i])).toBeLessThan(0.04));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(xOfHz(1, 100)).toBe(0);
    expect(xOfHz(1e6, 100)).toBe(100);
  });
});

describe("バーと円形", () => {
  it("バー：受け持つ帯域の最大を取る（山を取りこぼさない）", () => {
    const values = new Float32Array(SPECTRUM_BANDS);
    values[3] = 0.9; // 1本目は帯域 2・3
    values[95] = 0.4;
    expect(barValue(values, 0)).toBe(0);
    expect(barValue(values, 1)).toBeCloseTo(0.9, 6);
    expect(barValue(values, BAR_COUNT - 1)).toBeCloseTo(0.4, 6);
  });

  it("円形：右半分は低→高、左半分は折り返して左右対称", () => {
    expect(radialBand(0)).toBe(0);
    expect(radialBand(SPECTRUM_BANDS)).toBe(SPECTRUM_BANDS - 1);
    expect(radialBand(SPECTRUM_BANDS + 1)).toBe(SPECTRUM_BANDS - 1);
    expect(radialBand(SPECTRUM_BANDS * 2)).toBe(0);
    for (let k = 0; k <= SPECTRUM_BANDS * 2; k++) {
      expect(radialBand(k)).toBeGreaterThanOrEqual(0);
      expect(radialBand(k)).toBeLessThan(SPECTRUM_BANDS);
    }
  });

  it("円形の配置：短い辺に合わせ、内側の円は 16%、外側までは 48%", () => {
    const { cx, cy, r0, r1 } = radialLayout(400, 200);
    expect(cx).toBe(200);
    expect(cy).toBe(100);
    expect(r0).toBeCloseTo(32, 6);
    expect(r0 + r1).toBeCloseTo(96, 6);
  });
});
