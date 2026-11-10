import { describe, expect, it } from "vitest";
import { StreamImage } from "../../modules/stream_image";
import { createColorResolver } from "./color";
import { DISCARD_SINK, FLOATS_PER_VERTEX, ShapeBatch, type BatchCommand } from "./shape_batch";

const batch = () => new ShapeBatch(createColorResolver());

describe("ShapeBatch", () => {
  it("図形を1つの頂点・番号の並びに積み、続けて描けるもの（同じ発光）は1つの命令にまとめる", () => {
    const b = batch();
    const commands: BatchCommand[] = [];
    const sink = b.sink(1.5, commands);
    sink.rects([0, 0, 10, 10], { color: "#ff0000" });
    sink.polyline([0, 0, 10, 0], { color: "#00ff00", width: 1 });
    sink.band([0, 1], [0, 0], [1, 1], { color: "#0000ff", alpha: 0.5 });
    expect(commands).toEqual([{ kind: "shapes", first: 0, count: 18, glow: 0 }]);
    expect(b.vertexCount).toBe(12);
    expect(b.indexCount).toBe(18);
  });

  it("発光の値が変わるところと、流れる画像のところで命令を区切る（呼んだ順を保つ）", () => {
    const b = batch();
    const commands: BatchCommand[] = [];
    const sink = b.sink(1, commands);
    const stream = new StreamImage(4, 2);
    sink.rects([0, 0, 1, 1], { color: "#fff" });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 8 });
    sink.image(stream, { x: 0, y: 0, width: 4, height: 2 }, { alpha: 0.5 });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 8 });
    expect(commands.map((c) => (c.kind === "shapes" ? `shapes:${c.first}+${c.count}@${c.glow}` : `image:${c.alpha}`))).toEqual([
      "shapes:0+6@0",
      "shapes:6+6@8",
      "image:0.5",
      "shapes:12+6@8",
    ]);
  });

  it("頂点は位置・色（不透明度を掛けたもの）・ふちのぼかしの順", () => {
    const b = batch();
    b.sink(1, []).rects([1, 2, 3, 4], { color: "rgb(255 0 0 / 0.5)", alpha: 0.5 });
    expect(Array.from(b.vertices.subarray(0, FLOATS_PER_VERTEX))).toEqual([1, 2, 1, 0, 0, 0.25, 0, 1e4, 0]);
  });

  it("枠ごとに別の命令の列を持ち、番号は通しで積む。何も描かない図形は命令を足さない", () => {
    const b = batch();
    const first: BatchCommand[] = [];
    const second: BatchCommand[] = [];
    b.sink(1, first).rects([0, 0, 1, 1], { color: "#fff" });
    const s2 = b.sink(1, second);
    s2.rects([0, 0, 0, 0], { color: "#fff" });
    s2.polyline([0, 0], { color: "#fff", width: 1 });
    s2.image(new StreamImage(1, 1), { x: 0, y: 0, width: 0, height: 1 });
    expect(second).toEqual([]);
    s2.rects([0, 0, 1, 1], { color: "#fff" });
    expect(first).toEqual([{ kind: "shapes", first: 0, count: 6, glow: 0 }]);
    expect(second).toEqual([{ kind: "shapes", first: 6, count: 6, glow: 0 }]);
  });

  it("領域が足りなければ広げ、reset で空にする（確保した領域は使い回す）", () => {
    const b = batch();
    const sink = b.sink(1, []);
    const rects = new Float32Array(4 * 3000).fill(1);
    sink.rects(rects, { color: "#fff" });
    expect(b.vertexCount).toBe(12000);
    expect(b.indexCount).toBe(18000);
    expect(b.vertices.length).toBeGreaterThanOrEqual(12000 * FLOATS_PER_VERTEX);
    const capacity = b.vertices.length;
    b.reset();
    expect(b.vertexCount).toBe(0);
    expect(b.indexCount).toBe(0);
    expect(b.vertices.length).toBe(capacity);
  });

  it("何もしない受け口は、呼んでも何も起きない", () => {
    expect(() => {
      DISCARD_SINK.polyline([0, 0, 1, 1], { color: "#fff", width: 1 });
      DISCARD_SINK.image(new StreamImage(1, 1), { x: 0, y: 0, width: 1, height: 1 });
    }).not.toThrow();
  });
});
