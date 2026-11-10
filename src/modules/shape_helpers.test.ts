import { describe, expect, it } from "vitest";
import { dashedVerticalRects, ensureLength, gridRects } from "./shape_helpers";

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
