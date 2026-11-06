import { describe, expect, it } from "vitest";
import type { WaveOptions } from "../options";
import {
  HISTORY_MIN_PX,
  bandRole,
  coreRadius,
  endWindow,
  historyAmplitude,
  historyColumns,
  movingAverage,
  resampleLinear,
  waveLayout,
} from "./wave_math";

const DEFAULTS: WaveOptions = { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 };

describe("waveLayout", () => {
  it("境目は幅の split%、今の波形を出さなければ右端", () => {
    expect(waveLayout(1000, DEFAULTS).split).toBe(720);
    expect(waveLayout(1000, { ...DEFAULTS, showNow: false }).split).toBe(1000);
  });

  it("境目の割合は 10〜90% に収める", () => {
    expect(waveLayout(1000, { ...DEFAULTS, split: 3 }).split).toBe(100);
    expect(waveLayout(1000, { ...DEFAULTS, split: 99 }).split).toBe(900);
  });

  it("履歴の1行の幅は 4px × 流れる速さ（1px 以上）", () => {
    expect(waveLayout(1000, DEFAULTS).step).toBe(4);
    expect(waveLayout(1000, { ...DEFAULTS, speed: 3 }).step).toBe(12);
    expect(waveLayout(1000, { ...DEFAULTS, speed: 0.25 }).step).toBe(1);
  });

  it("境目までを埋める行数", () => {
    expect(historyColumns(720, 4)).toBe(181);
    expect(historyColumns(10, 4)).toBe(4);
  });
});

describe("historyAmplitude", () => {
  it("中心からの高さにし、1 を上限、無音でも細い線を残す", () => {
    expect(historyAmplitude(0.5, 100)).toBeCloseTo(46, 6);
    expect(historyAmplitude(3, 100)).toBeCloseTo(92, 6);
    expect(historyAmplitude(0, 100)).toBe(HISTORY_MIN_PX);
  });
});

describe("bandRole", () => {
  it("低域が強ければ主色、高域が強ければ副色、それ以外は強調色", () => {
    expect(bandRole(0.8, 0.1, 0.1)).toBe("main");
    expect(bandRole(0.1, 0.4, 0.5)).toBe("sub");
    expect(bandRole(0.2, 0.7, 0.1)).toBe("accent");
    expect(bandRole(0, 0, 0)).toBe("accent");
  });
});

describe("resampleLinear", () => {
  it("両端をそろえて直線で補間する", () => {
    expect(Array.from(resampleLinear([0, 10], new Float32Array(5)))).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(Array.from(resampleLinear([0, 4, 8, 12, 16], new Float32Array(3)))).toEqual([0, 8, 16]);
  });

  it("点が1つ・0個のとき", () => {
    expect(Array.from(resampleLinear([3], new Float32Array(3)))).toEqual([3, 3, 3]);
    expect(Array.from(resampleLinear([], new Float32Array(2)))).toEqual([0, 0]);
  });
});

describe("movingAverage", () => {
  it("前後 radius 点の平均。端は範囲内の点だけで平均する", () => {
    const out = movingAverage([0, 3, 6, 9, 12], 1, new Float32Array(5));
    expect(Array.from(out)).toEqual([1.5, 3, 6, 9, 10.5]);
  });

  it("一定の値はそのまま", () => {
    const out = movingAverage(new Float32Array(50).fill(0.25), 6, new Float32Array(50));
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });
});

describe("endWindow と coreRadius", () => {
  it("両端で0、中央で1", () => {
    expect(endWindow(0, 100)).toBe(0);
    expect(endWindow(100, 100)).toBeCloseTo(0, 6);
    expect(endWindow(50, 100)).toBeCloseTo(1, 6);
    expect(endWindow(10, 0)).toBe(0);
  });

  it("芯をならす半径は幅の4%、6px 以上", () => {
    expect(coreRadius(100)).toBe(6);
    expect(coreRadius(500)).toBe(20);
  });
});
