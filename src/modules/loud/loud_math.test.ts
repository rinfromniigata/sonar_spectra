import { describe, expect, it } from "vitest";
import { LOUDNESS_FLOOR_DB } from "../../frame_client";
import {
  BAR_COUNT,
  HOT_LOUDNESS_DB,
  NEGATIVE_INFINITY_TEXT,
  REFRESH_SECONDS,
  ReadingThrottle,
  barHot,
  barLevel,
  barLit,
  formatDb,
  isHot,
  loudLayout,
  type LoudReading,
} from "./loud_math";

describe("formatDb", () => {
  it("小数1桁で、負の値は数学用のマイナス記号（モックと同じ）", () => {
    expect(formatDb(-9.8)).toBe("−9.8");
    expect(formatDb(-23.44)).toBe("−23.4");
    expect(formatDb(-23.46)).toBe("−23.5");
    expect(formatDb(3)).toBe("3.0");
  });

  it("0 に丸まる値は「0.0」で、マイナスを付けない", () => {
    expect(formatDb(-0.04)).toBe("0.0");
    expect(formatDb(0)).toBe("0.0");
    expect(formatDb(-0.06)).toBe("−0.1");
  });

  it("計算できない値（床・それ以下・NaN・無限）は「−∞」", () => {
    expect(NEGATIVE_INFINITY_TEXT).toBe("−∞");
    expect(formatDb(LOUDNESS_FLOOR_DB)).toBe(NEGATIVE_INFINITY_TEXT);
    expect(formatDb(-200)).toBe(NEGATIVE_INFINITY_TEXT);
    expect(formatDb(Number.NaN)).toBe(NEGATIVE_INFINITY_TEXT);
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe(NEGATIVE_INFINITY_TEXT);
    expect(formatDb(-119.9)).not.toBe(NEGATIVE_INFINITY_TEXT);
  });
});

describe("バー", () => {
  it("−30 dB で空、0 dB でいっぱい。その間は比例し、範囲の外は収める。計算できない値は空", () => {
    expect(barLevel(-30)).toBe(0);
    expect(barLevel(-15)).toBeCloseTo(0.5, 9);
    expect(barLevel(0)).toBe(1);
    expect(barLevel(6)).toBe(1);
    expect(barLevel(-50)).toBe(0);
    expect(barLevel(LOUDNESS_FLOOR_DB)).toBe(0);
    expect(barLevel(Number.NaN)).toBe(0);
  });

  it("点灯：割合に届いていない本数だけ。半分なら24本のうち左の12本", () => {
    const lit = Array.from({ length: BAR_COUNT }, (_, i) => barLit(i, 0.5));
    expect(lit.filter(Boolean)).toHaveLength(12);
    expect(lit.slice(0, 12).every(Boolean)).toBe(true);
    expect(Array.from({ length: BAR_COUNT }, (_, i) => barLit(i, 1)).every(Boolean)).toBe(true);
    expect(Array.from({ length: BAR_COUNT }, (_, i) => barLit(i, 0)).some(Boolean)).toBe(false);
  });

  it("強調色の範囲は、上の2割（20〜23本目）", () => {
    const hot = Array.from({ length: BAR_COUNT }, (_, i) => i).filter(barHot);
    expect(hot).toEqual([20, 21, 22, 23]);
  });
});

describe("isHot", () => {
  it("ショートタームが −8.6 dB を超えたとき（ちょうどは含まない）。計算できない値は含まない", () => {
    expect(isHot(HOT_LOUDNESS_DB)).toBe(false);
    expect(isHot(HOT_LOUDNESS_DB + 0.1)).toBe(true);
    expect(isHot(-20)).toBe(false);
    expect(isHot(LOUDNESS_FLOOR_DB)).toBe(false);
    expect(isHot(Number.NaN)).toBe(false);
  });
});

describe("ReadingThrottle（数値の更新を間引く）", () => {
  const reading = (shortTerm: number): LoudReading => ({ shortTerm, momentary: shortTerm, peak: shortTerm });

  it("最初はそのまま。以降は 0.25 秒たまるまで、前の値を出し続ける", () => {
    const throttle = new ReadingThrottle();
    expect(throttle.update(reading(-20), 1 / 60)).toEqual(reading(-20));
    expect(throttle.update(reading(-10), 0.1)).toEqual(reading(-20));
    expect(throttle.update(reading(-9), 0.1)).toEqual(reading(-20));
    // 0.3 秒たった：新しい値に替わり、数え直す
    expect(throttle.update(reading(-8), 0.1)).toEqual(reading(-8));
    expect(throttle.update(reading(-7), 0.1)).toEqual(reading(-8));
  });

  it("ちょうど更新の間隔で替わる。経過が負でも戻らない", () => {
    const throttle = new ReadingThrottle();
    throttle.update(reading(-20), 0);
    expect(throttle.update(reading(-10), REFRESH_SECONDS - 0.01)).toEqual(reading(-20));
    expect(throttle.update(reading(-10), 0.01)).toEqual(reading(-10));
    expect(throttle.update(reading(-5), -5)).toEqual(reading(-10));
  });

  it("reset すると、次の1回は新しい値をそのまま出す", () => {
    const throttle = new ReadingThrottle();
    throttle.update(reading(-20), 0);
    throttle.reset();
    expect(throttle.update(reading(-10), 0)).toEqual(reading(-10));
  });
});

describe("loudLayout", () => {
  it("文字の大きさは枠の幅に比例し、範囲に収まる（単位 7〜13、数値 12〜72、ピーク 7〜11）", () => {
    const mid = loudLayout(100, 100);
    expect(mid.unit.size).toBeCloseTo(9, 9);
    expect(mid.value.size).toBeCloseTo(26, 9);
    expect(mid.sub.size).toBeCloseTo(8, 9);

    const wide = loudLayout(1000, 400);
    expect([wide.unit.size, wide.value.size, wide.sub.size]).toEqual([13, 72, 11]);
    const narrow = loudLayout(20, 100);
    expect([narrow.unit.size, narrow.value.size, narrow.sub.size]).toEqual([7, 12, 7]);
  });

  it("単位・数値・ピークを、上からこの順に中央に縦に積む。文字の下に10の余白を残す", () => {
    const layout = loudLayout(200, 120);
    expect(layout.centerX).toBe(100);
    expect(layout.unit.y).toBeLessThan(layout.value.y);
    expect(layout.value.y).toBeLessThan(layout.sub.y);
    // 積んだ全体の中心は、下の余白を除いた領域の中心
    const top = layout.unit.y - layout.unit.size * 0.65;
    const bottom = layout.sub.y + layout.sub.size * 0.65;
    expect((top + bottom) / 2).toBeCloseTo((120 - 10) / 2, 6);
    expect(layout.maxWidth).toBe(196);
  });

  it("バー：下端から8の位置に、高さ4、幅は枠を24等分", () => {
    const { bars } = loudLayout(240, 100);
    expect(bars).toEqual({ top: 92, height: 4, barWidth: 10 });
  });
});
