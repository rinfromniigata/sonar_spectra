import { describe, expect, it } from "vitest";
import { ARC_STEP, arcPoints, dashedVerticalRects, ensureLength, gridRects } from "./shape_helpers";

const chunks = (values: Float32Array) => Array.from({ length: values.length / 4 }, (_, i) => Array.from(values.subarray(i * 4, i * 4 + 4)));

describe("gridRects", () => {
  it("内側の縦の線（x = round(width × i / nx)）と横の線を、太さ1の四角にする", () => {
    expect(chunks(gridRects(100, 30, 3, 2))).toEqual([
      [33, 0, 1, 30],
      [67, 0, 1, 30],
      [0, 15, 100, 1],
    ]);
  });

  it("分割が1以下なら、その向きの線はない", () => {
    expect(gridRects(100, 30, 1, 1)).toHaveLength(0);
  });
});

describe("dashedVerticalRects", () => {
  it("y = 0 から、on 引いて off 空ける。最後は高さで切る", () => {
    expect(chunks(dashedVerticalRects(10, 11, 2, 3))).toEqual([
      [10, 0, 1, 2],
      [10, 5, 1, 2],
      [10, 10, 1, 1],
    ]);
  });

  it("高さや長さが 0 以下なら何も作らない", () => {
    expect(dashedVerticalRects(0, 0, 2, 3)).toHaveLength(0);
    expect(dashedVerticalRects(0, 10, 0, 3)).toHaveLength(0);
  });
});

describe("ensureLength", () => {
  it("足りていればそのまま、足りなければ倍以上の長さで作り直す", () => {
    const a = new Float32Array(4);
    expect(ensureLength(a, 4)).toBe(a);
    expect(ensureLength(a, 5)).toHaveLength(8);
    expect(ensureLength(a, 20)).toHaveLength(20);
  });
});

describe("arcPoints", () => {
  const pairsOf = (values: Float32Array) => Array.from({ length: values.length / 2 }, (_, i) => [values[i * 2], values[i * 2 + 1]]);

  it("始点から終点まで、角度が増える向きに、区間の角度を上限以下にそろえて点を並べる（両端を含む）", () => {
    const points = pairsOf(arcPoints(10, 20, 5, 0, Math.PI / 2));
    expect(points).toHaveLength(Math.ceil(Math.PI / 2 / ARC_STEP) + 1);
    expect(points[0][0]).toBeCloseTo(15, 5);
    expect(points[0][1]).toBeCloseTo(20, 5);
    expect(points[points.length - 1][0]).toBeCloseTo(10, 5);
    expect(points[points.length - 1][1]).toBeCloseTo(25, 5);
    for (const [x, y] of points) expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(5, 4);
  });

  it("終点が始点より小さければ、Canvas 2D の arc と同じく時計回りに回って届く", () => {
    const points = pairsOf(arcPoints(0, 0, 1, Math.PI / 2, 0, Math.PI / 4));
    // π/2 → 2π（＝0）の 3π/2 を π/4 ずつ
    expect(points).toHaveLength(7);
    expect(points[1][0]).toBeCloseTo(Math.cos((3 * Math.PI) / 4), 5);
    expect(points[6][0]).toBeCloseTo(1, 5);
    expect(points[6][1]).toBeCloseTo(0, 5);
  });

  it("区間の角度を指定できる。長さ 0 の弧も2点（同じ点）にする", () => {
    expect(arcPoints(0, 0, 1, 0, 1, 0.25).length).toBe(2 * 5);
    expect(arcPoints(0, 0, 1, 1, 1).length).toBe(4);
  });
});
