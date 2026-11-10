import { describe, expect, it } from "vitest";
import { StreamImage } from "./stream_image";

const column = (value: number, height = 2) => new Array(height * 4).fill(value);

describe("StreamImage", () => {
  it("列を輪の位置に順に足し、読み始めの位置（いちばん古い列）は次に書く位置", () => {
    const image = new StreamImage(3, 2);
    expect(image.start).toBe(0);
    image.pushColumn(column(1));
    image.pushColumn(column(2));
    expect(image.written).toBe(2);
    expect(image.start).toBe(2);
    const first = image.takeUpdates();
    expect(first.reset).toBe(true);
    expect(first.columns.map((c) => [c.x, c.data[0]])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    image.pushColumn(column(3));
    image.pushColumn(column(4));
    // 1周したので、4 は位置 0 に書く。読み始めは位置 1
    expect(image.start).toBe(1);
    const second = image.takeUpdates();
    expect(second.reset).toBe(false);
    expect(second.columns.map((c) => [c.x, c.data[0]])).toEqual([
      [2, 3],
      [0, 4],
    ]);
    expect(image.takeUpdates().columns).toEqual([]);
  });

  it("受け取られる前に1周より多く足した列は、古いものを捨てる（上書きされるので送らない）", () => {
    const image = new StreamImage(2, 1);
    for (let i = 1; i <= 5; i++) image.pushColumn(column(i, 1));
    expect(image.takeUpdates().columns.map((c) => [c.x, c.data[0]])).toEqual([
      [1, 4],
      [0, 5],
    ]);
  });

  it("列の中身は写して持つ（元の配列を書き換えても変わらない）", () => {
    const image = new StreamImage(1, 1);
    const data = new Uint8Array([1, 2, 3, 4]);
    image.pushColumn(data);
    data[0] = 9;
    expect(Array.from(image.takeUpdates().columns[0].data)).toEqual([1, 2, 3, 4]);
  });

  it("clear は作り直しを求め、まだ送っていない列を捨てる。markLost は作り直しだけを求める", () => {
    const image = new StreamImage(2, 1);
    image.takeUpdates();
    image.pushColumn(column(1, 1));
    image.clear();
    expect(image.takeUpdates()).toEqual({ reset: true, columns: [] });
    image.pushColumn(column(2, 1));
    image.markLost();
    const updates = image.takeUpdates();
    expect(updates.reset).toBe(true);
    expect(updates.columns).toHaveLength(1);
  });

  it("大きさは正の整数、列の長さは高さ × 4", () => {
    expect(() => new StreamImage(0, 1)).toThrow(RangeError);
    expect(() => new StreamImage(1.5, 1)).toThrow(RangeError);
    expect(() => new StreamImage(2, 2).pushColumn([1, 2, 3])).toThrow(RangeError);
  });
});
