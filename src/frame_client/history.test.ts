import { describe, expect, it } from "vitest";
import { RowHistory } from "./history";

const rows = (h: RowHistory) => Array.from({ length: h.length }, (_, i) => Array.from(h.row(i)));

describe("RowHistory", () => {
  it("古い順に並び、満杯になったら最も古い行を捨てる", () => {
    const h = new RowHistory(2, 3);
    h.push([1, 10]);
    h.push([2, 20]);
    expect(rows(h)).toEqual([
      [1, 10],
      [2, 20],
    ]);
    h.push([3, 30]);
    h.push([4, 40]);
    expect(h.length).toBe(3);
    expect(rows(h)).toEqual([
      [2, 20],
      [3, 30],
      [4, 40],
    ]);
    expect(Array.from(h.latest()!)).toEqual([4, 40]);
    expect(h.total).toBe(4);
  });

  it("幅を超える分は捨て、足りない分は0にする", () => {
    const h = new RowHistory(3, 2);
    h.push([1, 2, 3, 4]);
    h.push([5]);
    expect(rows(h)).toEqual([
      [1, 2, 3],
      [5, 0, 0],
    ]);
  });

  it("clear で空になるが、累計は戻さない", () => {
    const h = new RowHistory(1, 2);
    h.push([1]);
    h.push([2]);
    h.clear();
    expect(h.length).toBe(0);
    expect(h.latest()).toBeNull();
    expect(h.total).toBe(2);
    h.push([3]);
    expect(rows(h)).toEqual([[3]]);
  });

  it("範囲外の行と、大きさ0の作成を受け付けない", () => {
    const h = new RowHistory(1, 2);
    expect(() => h.row(0)).toThrow(RangeError);
    expect(() => new RowHistory(0, 1)).toThrow(RangeError);
    expect(() => new RowHistory(1, 0)).toThrow(RangeError);
  });
});
