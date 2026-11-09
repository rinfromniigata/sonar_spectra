import { describe, expect, it } from "vitest";
import { VU_FLOOR_DB } from "../../frame_client";
import {
  FALL_TAU,
  LABEL_DB,
  MAJOR_TICKS_DB,
  SCALE_MAX_DB,
  SCALE_MIN_DB,
  SWING_RADIANS,
  clampDb,
  fallToFloor,
  formatScale,
  needleAngle,
  pointOnArc,
  scaleTicks,
  vuLayout,
} from "./vu_math";

const UP = -Math.PI / 2;

describe("針の角度（モックの ang）", () => {
  it("−8.5 dB で真上、目盛りの両端で左右に 0.9 ラジアン", () => {
    expect(needleAngle(-8.5)).toBeCloseTo(UP, 10);
    expect(needleAngle(SCALE_MIN_DB)).toBeCloseTo(UP - SWING_RADIANS, 10);
    expect(needleAngle(SCALE_MAX_DB)).toBeCloseTo(UP + SWING_RADIANS, 10);
  });

  it("dB に比例して右へ振れる。目盛りの外は端で止まる", () => {
    expect(needleAngle(0)).toBeGreaterThan(needleAngle(-10));
    expect(needleAngle(0) - needleAngle(-1)).toBeCloseTo(needleAngle(-10) - needleAngle(-11), 10);
    expect(needleAngle(30)).toBe(needleAngle(SCALE_MAX_DB));
    expect(needleAngle(-60)).toBe(needleAngle(SCALE_MIN_DB));
  });

  it("針が振れていない値と、読めない値（床・NaN・±∞）は下端", () => {
    for (const db of [VU_FLOOR_DB, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(clampDb(db)).toBe(SCALE_MIN_DB);
    }
    expect(clampDb(1.5)).toBe(1.5);
    expect(clampDb(30)).toBe(SCALE_MAX_DB);
  });
});

describe("目盛り", () => {
  it("−20〜+3 を 0.5 dB ごとの 47 個。大きな点はモックの 11 個", () => {
    const ticks = scaleTicks();
    expect(ticks).toHaveLength(47);
    expect(ticks[0].db).toBe(-20);
    expect(ticks[ticks.length - 1].db).toBe(3);
    expect(ticks.filter((t) => t.major).map((t) => t.db)).toEqual(MAJOR_TICKS_DB);
  });

  it("数字は数学用のマイナス記号。正の値には「+」", () => {
    expect(LABEL_DB.map(formatScale)).toEqual(["−20", "−10", "−5", "0", "+3"]);
  });
});

describe("配置（モックの px・py・R）", () => {
  it("根元は横の中央・高さの 9 割。半径は幅の 46% と高さの 78% の小さい方", () => {
    expect(vuLayout(200, 200)).toMatchObject({ pivotX: 100, pivotY: 180, radius: 92 });
    expect(vuLayout(400, 100).radius).toBe(78);
  });

  it("文字の大きさは半径の 1/9 で、8〜11 に収める", () => {
    expect(vuLayout(40, 40).fontSize).toBe(8);
    expect(vuLayout(2000, 2000).fontSize).toBe(11);
    expect(vuLayout(200, 200).fontSize).toBeCloseTo(92 / 9, 10);
  });

  it("弧の上の点：真上の針は根元の真上", () => {
    const layout = vuLayout(200, 200);
    const [x, y] = pointOnArc(layout, UP, layout.radius);
    expect(x).toBeCloseTo(layout.pivotX, 10);
    expect(y).toBeCloseTo(layout.pivotY - layout.radius, 10);
  });
});

describe("受信が途切れたときの針の戻り", () => {
  it("下端へ時定数 FALL_TAU で近づく。dt が 0 なら動かない", () => {
    expect(fallToFloor(0, 0)).toBe(0);
    expect(fallToFloor(0, FALL_TAU)).toBeCloseTo(SCALE_MIN_DB * (1 - Math.exp(-1)), 10);
    expect(fallToFloor(SCALE_MIN_DB, 1)).toBe(SCALE_MIN_DB);
  });

  it("分けて進めても、まとめて進めても同じ", () => {
    let split = 0;
    for (let i = 0; i < 10; i++) split = fallToFloor(split, 0.01);
    expect(split).toBeCloseTo(fallToFloor(0, 0.1), 10);
  });
});
