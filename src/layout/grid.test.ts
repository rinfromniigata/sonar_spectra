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

describe("splitRect（全通り）", () => {
  it("12×8に収まるすべての大きさを、マス数以下のすべての数に分けられ、重ならず全体を覆い、続く2つは隣り合う", () => {
    // 数が多いので、食い違いを集めて最後に1度だけ確かめる。重なりと覆い方は、マスを塗って数える
    const failures: string[] = [];
    for (let cs = 1; cs <= 12; cs++) {
      for (let rs = 1; rs <= 8; rs++) {
        const rect = { c: 1, r: 1, cs, rs };
        for (const cellAspect of [0.5, 1, 2]) {
          if (splitRect(rect, cs * rs + 1, cellAspect) !== null) failures.push(`${cs}x${rs}: too many parts accepted`);
          for (let parts = 1; parts <= cs * rs; parts++) {
            const result = splitRect(rect, parts, cellAspect);
            const label = `${cs}x${rs} parts=${parts} aspect=${cellAspect}`;
            if (!result || result.length !== parts) {
              failures.push(`${label}: got ${result?.length ?? "null"}`);
              continue;
            }
            const paint = new Uint8Array(cs * rs);
            result.forEach((p, i) => {
              if (p.cs < 1 || p.rs < 1 || p.c < 1 || p.r < 1 || p.c + p.cs - 1 > cs || p.r + p.rs - 1 > rs) failures.push(`${label}: #${i} outside`);
              for (let y = p.r; y < p.r + p.rs; y++) for (let x = p.c; x < p.c + p.cs; x++) paint[(y - 1) * cs + (x - 1)]++;
              if (i > 0 && !adjacent(result[i - 1], p)) failures.push(`${label}: #${i - 1} and #${i} not adjacent`);
            });
            if (paint.some((v) => v !== 1)) failures.push(`${label}: overlap or gap`);
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
