import { describe, expect, it } from "vitest";
import { PAN_BANDS } from "../../frame_client";
import {
  CORRELATION_TAU,
  PAN_WEIGHT_FROM,
  PAN_WEIGHT_TO,
  TRAIL_GROUPS,
  blurAlpha,
  correlationBar,
  correlationX,
  dotAlpha,
  dotStyle,
  lissajousLayout,
  panBandCenterHz,
  panDotSize,
  panLayout,
  panLevel,
  panPoint,
  panWeight,
  project,
  segmentAlpha,
  segmentGroups,
  smoothCorrelation,
  trailAlpha,
} from "./stereo_math";

describe("残光と相関", () => {
  it("残光の濃さは、1/60秒で元の値、2回の1/120秒で同じだけ残る。経過0では重ねない", () => {
    expect(trailAlpha(0.3, 1 / 60)).toBeCloseTo(0.3, 9);
    const half = trailAlpha(0.3, 1 / 120);
    expect(1 - (1 - half) ** 2).toBeCloseTo(0.3, 9);
    expect(trailAlpha(0.3, 0)).toBe(0);
  });

  it("相関：最初はそのまま、その後は時定数で近づく", () => {
    expect(smoothCorrelation(null, 0.8, 1 / 60)).toBe(0.8);
    const next = smoothCorrelation(0, 1, CORRELATION_TAU);
    expect(next).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(smoothCorrelation(0.5, 1, 0)).toBe(0.5);
  });

  it("相関のバー：−1 が左端、0 が中央、1 が右端。範囲の外は収める", () => {
    const bar = correlationBar(100, 50);
    expect(bar).toEqual({ x: 12, width: 76, y: 44 });
    expect(correlationX(100, 50, -1)).toBeCloseTo(12, 9);
    expect(correlationX(100, 50, 0)).toBeCloseTo(50, 9);
    expect(correlationX(100, 50, 1)).toBeCloseTo(88, 9);
    expect(correlationX(100, 50, 3)).toBeCloseTo(88, 9);
  });
});

describe("リサージュ", () => {
  it("配置：中心は横の中央・縦の 47%、半径は短い辺（縦は 86%）の 42%", () => {
    expect(lissajousLayout(200, 100)).toEqual({ cx: 100, cy: 47, r: 86 * 0.42 });
    expect(lissajousLayout(100, 400).r).toBeCloseTo(42, 9);
  });

  it("写し方：縦（L + R）は上、横（R − L）は右が正", () => {
    const layout = { cx: 50, cy: 50, r: 40 };
    expect(project(layout, 0, 1)).toEqual([50, 10]);
    expect(project(layout, 1, 0)).toEqual([90, 50]);
    // L だけ（x = −y）は左上
    const [x, y] = project(layout, -0.5, 0.5);
    expect(x).toBeLessThan(50);
    expect(y).toBeLessThan(50);
  });

  it("線分のまとめ：全線分を1度ずつ覆い、古い組ほど薄い", () => {
    const n = 256;
    const groups = segmentGroups(n);
    expect(groups).toHaveLength(TRAIL_GROUPS);
    expect(groups[0].start).toBe(1);
    expect(groups[groups.length - 1].end).toBe(n);
    for (let g = 1; g < groups.length; g++) {
      expect(groups[g].start).toBe(groups[g - 1].end);
      expect(groups[g].alpha).toBeGreaterThan(groups[g - 1].alpha);
    }
    expect(groups[0].alpha).toBeGreaterThanOrEqual(segmentAlpha(1, n));
    expect(groups[groups.length - 1].alpha).toBeLessThanOrEqual(segmentAlpha(n - 1, n));
    expect(segmentGroups(1)).toEqual([]);
    expect(segmentGroups(3)).toHaveLength(2);
  });

  it("点描：なしは描かない。大きく・明るく・両方の組み合わせ", () => {
    expect(dotStyle("none")).toBeNull();
    expect(dotStyle("size")).toEqual({ size: 3.2, glow: 8, bright: false });
    expect(dotStyle("bright")).toEqual({ size: 1.6, glow: 4, bright: true });
    expect(dotStyle("both")).toEqual({ size: 3.2, glow: 8, bright: true });
    expect(dotAlpha(0, 256)).toBeCloseTo(0.3, 9);
    expect(dotAlpha(255, 256)).toBeGreaterThan(dotAlpha(0, 256));
  });
});

describe("周波数別の定位", () => {
  it("配置：上 8・下 12 を空け、左右は横幅の 44% ずつ", () => {
    expect(panLayout(100, 200)).toEqual({ top: 8, bottom: 188, cx: 50, half: 44 });
  });

  it("帯域の中心の周波数は、低い順に増え、30 Hz〜20 kHz に収まる", () => {
    expect(panBandCenterHz(0)).toBeGreaterThan(30);
    expect(panBandCenterHz(PAN_BANDS - 1)).toBeLessThan(20_000);
    expect(panBandCenterHz(60)).toBeGreaterThan(panBandCenterHz(59));
  });

  it("強さ：振幅 0 は 0、フルスケールは 1。同じ振幅なら高域ほど強い（スペクトラムと同じ換算）", () => {
    expect(panLevel(0, 10)).toBe(0);
    expect(panLevel(1, 10)).toBe(1);
    const a = 10 ** (-50 / 20);
    expect(panLevel(a, 100)).toBeGreaterThan(panLevel(a, 20));
  });

  it("重み：弱い帯域は 0（中央）、強い帯域は 1 で、その間はなめらか", () => {
    expect(panWeight(0)).toBe(0);
    expect(panWeight(PAN_WEIGHT_FROM)).toBe(0);
    expect(panWeight(PAN_WEIGHT_TO)).toBe(1);
    expect(panWeight(1)).toBe(1);
    const mid = panWeight((PAN_WEIGHT_FROM + PAN_WEIGHT_TO) / 2);
    expect(mid).toBeCloseTo(0.5, 9);
  });

  it("点の位置：低域が下端・高域が上端、−1 が左端・1 が右端。弱い帯域は中央へ寄せる", () => {
    const layout = panLayout(100, 200);
    expect(panPoint(layout, 0, -1, 1)).toEqual([50 - 44, 188]);
    expect(panPoint(layout, PAN_BANDS - 1, 1, 1)).toEqual([50 + 44, 8]);
    expect(panPoint(layout, 10, 5, 1)[0]).toBe(94);
    expect(panPoint(layout, 10, -1, 0)[0]).toBe(50);
    expect(panPoint(layout, 10, 0, 1)[0]).toBe(50);
  });

  it("点の大きさとブラーの濃さはモックの式", () => {
    expect(panDotSize(0)).toBe(1);
    expect(panDotSize(1)).toBeCloseTo(4.2, 9);
    expect(blurAlpha(0)).toBe(0.25);
    expect(blurAlpha(-20)).toBeCloseTo(0.75, 9);
    expect(blurAlpha(100)).toBe(0.85);
  });
});
