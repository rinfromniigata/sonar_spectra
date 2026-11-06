import { describe, expect, it } from "vitest";
import {
  DB_FLOOR,
  PEAK_FALL_DB_PER_SECOND,
  TICK_DB,
  barLeft,
  levelLayout,
  toDb,
  updatePeakHold,
  yOfDb,
} from "./level_math";

describe("toDb", () => {
  it("線形の振幅を dB にし、0 dB を上限・下限を DB_FLOOR にそろえる", () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(toDb(0.1)).toBeCloseTo(-20, 6);
    expect(toDb(2)).toBe(0);
    expect(toDb(0)).toBe(DB_FLOOR);
    expect(toDb(1e-9)).toBe(DB_FLOOR);
    expect(toDb(Number.NaN)).toBe(DB_FLOOR);
  });
});

describe("updatePeakHold", () => {
  it("上がるときは即座に、下がるときは一定の速さで下がる", () => {
    expect(updatePeakHold(-30, -10, 0.016)).toBe(-10);
    expect(updatePeakHold(-10, DB_FLOOR, 1)).toBeCloseTo(-10 - PEAK_FALL_DB_PER_SECOND, 6);
    // 約60回/秒で1フレームあたり 0.35 dB（モックと同じ）
    expect(updatePeakHold(-10, DB_FLOOR, 1 / 60)).toBeCloseTo(-10.35, 6);
  });

  it("下限より下がらない。経過時間が負でも上がらない", () => {
    expect(updatePeakHold(-59.9, DB_FLOOR, 10)).toBe(DB_FLOOR);
    expect(updatePeakHold(-20, DB_FLOOR, -5)).toBe(-20);
  });
});

describe("levelLayout", () => {
  it("モックの余白（上22・下18）とバーの位置を、枠の大きさから決める", () => {
    const layout = levelLayout(100, 300);
    expect(layout.top).toBe(22);
    expect(layout.bottom).toBe(282);
    expect(layout.span).toBe(260);
    expect(layout.barX).toBe(50);
    expect(layout.barWidth).toBe(8);
    expect(layout.gap).toBe(5);
    expect(layout.tickFontSize).toBe(10);
    expect(barLeft(layout, 0)).toBe(50);
    expect(barLeft(layout, 1)).toBe(63);
  });

  it("狭い枠では、バーと数字に下限をかける", () => {
    const layout = levelLayout(20, 100);
    expect(layout.barWidth).toBe(2);
    expect(layout.gap).toBe(2);
    expect(layout.tickFontSize).toBe(8);
  });

  it("dB の位置：0 dB が上端、下限が下端、目盛りは上から下へ", () => {
    const layout = levelLayout(100, 300);
    expect(yOfDb(layout, 0)).toBe(layout.top);
    expect(yOfDb(layout, DB_FLOOR)).toBe(layout.bottom);
    const ys = TICK_DB.map((db) => yOfDb(layout, db));
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
});
