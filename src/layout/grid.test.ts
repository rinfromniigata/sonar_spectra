import { describe, expect, it } from "vitest";
import { adjacent, cellCount, insideGrid, overlaps, splitRect, unionIfRect } from "./grid";

describe("格子の長方形", () => {
  it("重なりと、辺の接触を見分ける（角だけの接触は数えない）", () => {
    const a = { c: 1, r: 1, cs: 2, rs: 2 };
    expect(overlaps(a, { c: 2, r: 2, cs: 2, rs: 2 })).toBe(true);
    expect(overlaps(a, { c: 3, r: 1, cs: 1, rs: 1 })).toBe(false);
    expect(adjacent(a, { c: 3, r: 2, cs: 1, rs: 3 })).toBe(true);
    expect(adjacent(a, { c: 3, r: 3, cs: 1, rs: 1 })).toBe(false);
  });

  it("合わせて長方形になるときだけ合わせる", () => {
    expect(unionIfRect({ c: 1, r: 1, cs: 2, rs: 3 }, { c: 3, r: 1, cs: 4, rs: 3 })).toEqual({ c: 1, r: 1, cs: 6, rs: 3 });
    expect(unionIfRect({ c: 2, r: 4, cs: 3, rs: 1 }, { c: 2, r: 1, cs: 3, rs: 3 })).toEqual({ c: 2, r: 1, cs: 3, rs: 4 });
    expect(unionIfRect({ c: 1, r: 1, cs: 2, rs: 3 }, { c: 3, r: 1, cs: 4, rs: 2 })).toBeNull();
  });

  it("格子の外を見分ける", () => {
    expect(insideGrid({ c: 1, r: 1, cs: 12, rs: 8 })).toBe(true);
    expect(insideGrid({ c: 12, r: 1, cs: 2, rs: 1 })).toBe(false);
    expect(insideGrid({ c: 1, r: 1, cs: 0, rs: 1 })).toBe(false);
  });
});

describe("splitRect", () => {
  it("見た目の長辺に沿って、できるだけ均等に分ける", () => {
    // 横に長い（1マスが正方形）：横に3つ
    expect(splitRect({ c: 3, r: 2, cs: 10, rs: 4 }, 3, 1)).toEqual([
      { c: 3, r: 2, cs: 4, rs: 4 },
      { c: 7, r: 2, cs: 3, rs: 4 },
      { c: 10, r: 2, cs: 3, rs: 4 },
    ]);
    // マス数は横が多くても、1マスが縦長なら見た目は縦に長い：縦に分ける
    expect(splitRect({ c: 1, r: 1, cs: 4, rs: 4 }, 2, 0.5)).toEqual([
      { c: 1, r: 1, cs: 4, rs: 2 },
      { c: 1, r: 3, cs: 4, rs: 2 },
    ]);
  });

  it("長辺のマスが足りなければ短辺に沿って、それでも足りなければ縦横に分ける", () => {
    expect(splitRect({ c: 1, r: 1, cs: 1, rs: 3 }, 3, 10)).toEqual([
      { c: 1, r: 1, cs: 1, rs: 1 },
      { c: 1, r: 2, cs: 1, rs: 1 },
      { c: 1, r: 3, cs: 1, rs: 1 },
    ]);
    const parts = splitRect({ c: 1, r: 1, cs: 2, rs: 2 }, 4, 1)!;
    expect(parts).toHaveLength(4);
    expect(parts.reduce((sum, p) => sum + cellCount(p), 0)).toBe(4);
  });

  it("マスが足りなければ null", () => {
    expect(splitRect({ c: 1, r: 1, cs: 1, rs: 2 }, 3, 1)).toBeNull();
    expect(splitRect({ c: 1, r: 1, cs: 1, rs: 1 }, 1, 1)).toEqual([{ c: 1, r: 1, cs: 1, rs: 1 }]);
  });
});
