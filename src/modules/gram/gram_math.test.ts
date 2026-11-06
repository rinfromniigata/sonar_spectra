import { describe, expect, it } from "vitest";
import { SPECTRUM_BANDS } from "../../frame_client";
import { bandCenterHz, tiltDb } from "../spec/spec_math";
import { GRAM_GAIN, GRAM_HOT, GRAM_THRESHOLD, cellStyle, columnStep, displayRow, rangeLevel, rowRanges, visibleColumns } from "./gram_math";

describe("流れる速さ", () => {
  it("1行を流す幅は、×1.00 で 2px（モックと同じ）、速さに比例し、最低 1px", () => {
    expect(columnStep(1)).toBe(2);
    expect(columnStep(2)).toBe(4);
    expect(columnStep(3)).toBe(6);
    expect(columnStep(0.5)).toBe(1);
    expect(columnStep(0.25)).toBe(1);
  });

  it("範囲の外や不正な値は、×0.25〜×3.00 に収める（不正な値は ×1.00）", () => {
    expect(columnStep(100)).toBe(6);
    expect(columnStep(0)).toBe(1);
    expect(columnStep(-3)).toBe(1);
    expect(columnStep(Number.NaN)).toBe(2);
  });

  it("幅を埋めるのに要る列の数", () => {
    expect(visibleColumns(400, 2)).toBe(200);
    expect(visibleColumns(401, 2)).toBe(201);
    expect(visibleColumns(5, 6)).toBe(1);
  });
});

describe("rowRanges（縦の帯と周波数の帯域）", () => {
  it("帯は上から 2px ごとで、最後の帯は余りの高さ", () => {
    const ranges = rowRanges(11);
    expect(ranges.map((r) => r.y)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ranges.map((r) => r.height)).toEqual([2, 2, 2, 2, 2, 1]);
  });

  it("下が低域：いちばん上の帯が最高域の帯域を、いちばん下の帯が最低域の帯域を含む", () => {
    const ranges = rowRanges(200);
    expect(ranges[0].hi).toBe(SPECTRUM_BANDS);
    expect(ranges[ranges.length - 1].lo).toBe(0);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].hi).toBeLessThanOrEqual(ranges[i - 1].hi);
  });

  it("帯が帯域より粗いとき（低い枠）は、すべての帯域をどれかの帯が受け持つ（取りこぼさない）", () => {
    const ranges = rowRanges(40);
    const covered = new Set<number>();
    for (const r of ranges) for (let b = r.lo; b < r.hi; b++) covered.add(b);
    expect(covered.size).toBe(SPECTRUM_BANDS);
    expect(ranges.some((r) => r.hi - r.lo > 1)).toBe(true);
  });

  it("帯が帯域より細かいとき（高い枠）は、各帯が少なくとも1つの帯域を受け持つ", () => {
    const ranges = rowRanges(1000);
    expect(ranges).toHaveLength(500);
    for (const r of ranges) {
      expect(r.hi).toBeGreaterThan(r.lo);
      expect(r.lo).toBeGreaterThanOrEqual(0);
      expect(r.hi).toBeLessThanOrEqual(SPECTRUM_BANDS);
    }
  });

  it("帯の高さをデバイスピクセルで指定できる。高さ0・帯の高さ0では空", () => {
    expect(rowRanges(100, 4)).toHaveLength(25);
    expect(rowRanges(0)).toEqual([]);
    expect(rowRanges(-5)).toEqual([]);
    expect(rowRanges(10, 0)).toEqual([]);
  });
});

describe("値の換算", () => {
  it("rangeLevel：受け持つ帯域の表示の高さの最大", () => {
    const display = new Float32Array(SPECTRUM_BANDS);
    display[10] = 0.3;
    display[12] = 0.9;
    expect(rangeLevel(display, { y: 0, height: 2, lo: 10, hi: 13 })).toBeCloseTo(0.9, 6);
    expect(rangeLevel(display, { y: 0, height: 2, lo: 13, hi: 20 })).toBe(0);
  });

  it("displayRow：スペクトラムと同じ換算で、無音は 0、フルスケールは 1", () => {
    const out = new Float32Array(SPECTRUM_BANDS);
    displayRow(new Float32Array(SPECTRUM_BANDS), out);
    expect(out.every((v) => v === 0)).toBe(true);
    displayRow(new Float32Array(SPECTRUM_BANDS).fill(1), out);
    expect(out.every((v) => v === 1)).toBe(true);
    // 短い行は、足りない帯域を 0 として扱う
    displayRow([1], out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(0);
  });

  it("displayRow：同じ振幅でも高域ほど高い（傾きの補正）", () => {
    const out = new Float32Array(SPECTRUM_BANDS);
    displayRow(new Float32Array(SPECTRUM_BANDS).fill(10 ** (-50 / 20)), out);
    expect(out[90]).toBeGreaterThan(out[10]);
    expect(tiltDb(bandCenterHz(90))).toBeGreaterThan(tiltDb(bandCenterHz(10)));
  });

  it("cellStyle：0.25 以下は色が付かず、0.72 までは主色で濃さが 1.4 倍の傾きで増え、それより上は強調色", () => {
    expect(cellStyle(0)).toBeNull();
    expect(cellStyle(GRAM_THRESHOLD)).toBeNull();
    const mid = cellStyle(0.5)!;
    expect(mid.hot).toBe(false);
    expect(mid.alpha).toBeCloseTo((0.5 - GRAM_THRESHOLD) * GRAM_GAIN, 9);
    expect(cellStyle(GRAM_HOT)!.hot).toBe(false);
    const hot = cellStyle(0.8)!;
    expect(hot.hot).toBe(true);
    expect(hot.alpha).toBeCloseTo((0.8 - GRAM_THRESHOLD) * GRAM_GAIN, 9);
    // 濃さは 1 で頭打ち
    expect(cellStyle(1)!.alpha).toBe(1);
  });
});
