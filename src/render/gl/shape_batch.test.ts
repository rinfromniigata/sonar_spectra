import { describe, expect, it } from "vitest";
import { StreamImage } from "../../modules/stream_image";
import type { Gradient } from "../../modules/types";
import { createColorResolver } from "./color";
import { DISCARD_SINK, FLOATS_PER_VERTEX, ShapeBatch, type BatchCommand, type FrameCommands } from "./shape_batch";

const batch = () => new ShapeBatch(createColorResolver());
const frame = (): FrameCommands => ({ commands: [], trail: null });
const shapesCommand = (first: number, count: number, glow = 0, glowOnly = false) => ({ kind: "shapes", first, count, glow, glowOnly, gradient: null });
const label = (c: BatchCommand) =>
  c.kind === "shapes" ? `shapes:${c.first}+${c.count}@${c.glow}${c.glowOnly ? "(glowOnly)" : ""}${c.gradient ? "(gradient)" : ""}` : `image:${c.alpha}`;

const FADE: Gradient = {
  kind: "linear",
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 10,
  stops: [
    { offset: 0, color: "#ff0000" },
    { offset: 1, color: "transparent" },
  ],
};

describe("ShapeBatch", () => {
  it("図形を1つの頂点・番号の並びに積み、続けて描けるもの（同じ発光）は1つの命令にまとめる", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1.5, f);
    sink.rects([0, 0, 10, 10], { color: "#ff0000" });
    sink.polyline([0, 0, 10, 0], { color: "#00ff00", width: 1 });
    sink.band([0, 1], [0, 0], [1, 1], { color: "#0000ff", alpha: 0.5 });
    expect(f.commands).toEqual([shapesCommand(0, 18)]);
    expect(b.vertexCount).toBe(12);
    expect(b.indexCount).toBe(18);
  });

  it("発光の値が変わるところと、流れる画像のところで命令を区切る（呼んだ順を保つ）", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1, f);
    const stream = new StreamImage(4, 2);
    sink.rects([0, 0, 1, 1], { color: "#fff" });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 8 });
    sink.image(stream, { x: 0, y: 0, width: 4, height: 2 }, { alpha: 0.5 });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 8 });
    expect(f.commands.map(label)).toEqual(["shapes:0+6@0", "shapes:6+6@8", "image:0.5", "shapes:12+6@8"]);
  });

  it("発光だけの図形は、発光だけの命令にする（同じ発光でも図形を描く命令とはまとめない）。発光がなければ何も積まない", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1, f);
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 6, glowOnly: true });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 6, glowOnly: true });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 6 });
    sink.rects([0, 0, 1, 1], { color: "#fff", glowOnly: true });
    expect(f.commands.map(label)).toEqual(["shapes:0+12@6(glowOnly)", "shapes:12+6@6"]);
    expect(b.vertexCount).toBe(12);
  });

  it("色の移り変わりを持つ図形は1つずつの命令にし、頂点の色は白（不透明度だけ）にする", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1, f);
    sink.rects([0, 0, 1, 1], { color: "#fff" });
    sink.rects([0, 0, 1, 1], { color: FADE, alpha: 0.5, glow: 4 });
    sink.rects([0, 0, 1, 1], { color: FADE, alpha: 0.5, glow: 4 });
    sink.rects([0, 0, 1, 1], { color: "#fff", glow: 4 });
    expect(f.commands.map(label)).toEqual(["shapes:0+6@0", "shapes:6+6@4(gradient)", "shapes:12+6@4(gradient)", "shapes:18+6@4"]);
    const command = f.commands[1] as Extract<BatchCommand, { kind: "shapes" }>;
    expect(command.gradient?.kind).toBe(1);
    expect(Array.from(command.gradient!.colors.subarray(0, 8))).toEqual([1, 0, 0, 1, 0, 0, 0, 0]);
    // 2つ目の図形（頂点 4〜7）の色は白、不透明度は 0.5
    expect(Array.from(b.vertices.subarray(4 * FLOATS_PER_VERTEX + 2, 4 * FLOATS_PER_VERTEX + 6))).toEqual([1, 1, 1, 0.5]);
  });

  it("何も塗らない色の移り変わり（点がない・直線の2点が同じ）は、図形を積まない", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1, f);
    sink.rects([0, 0, 1, 1], { color: { ...FADE, stops: [] } });
    sink.rects([0, 0, 1, 1], { color: { ...FADE, y1: 0 } });
    expect(f.commands).toEqual([]);
    expect(b.vertexCount).toBe(0);
  });

  it("残光は枠の描くものに残す（色は RGBA、濃さは 0〜1 に収める）。図形の命令は足さない", () => {
    const b = batch();
    const f = frame();
    const sink = b.sink(1, f);
    sink.trail("#000000", 0.3);
    expect(f.trail).toEqual({ color: [0, 0, 0, 1], alpha: 0.3 });
    sink.trail("#ffffff", 2);
    expect(f.trail).toEqual({ color: [1, 1, 1, 1], alpha: 1 });
    expect(f.commands).toEqual([]);
  });

  it("線の点ごとの濃さ（fades）と、四角ごとの不透明度（alphas）を頂点の色に当てる", () => {
    const b = batch();
    const sink = b.sink(1, frame());
    sink.polyline([0, 0, 10, 0], { color: "#ff0000", width: 2 }, [0, 1]);
    // 始点の頂点は透明（色ごと 0）、終点の頂点はそのまま
    const color = (v: number) => Array.from(b.vertices.subarray(v * FLOATS_PER_VERTEX + 2, v * FLOATS_PER_VERTEX + 6));
    expect(color(0)).toEqual([0, 0, 0, 0]);
    expect(color(2)).toEqual([1, 0, 0, 1]);

    const r = batch();
    r.sink(1, frame()).rects([0, 0, 1, 1, 2, 0, 1, 1, 4, 0, 1, 1], { color: "#ffffff", alpha: 0.5 }, [1, 0.5, 0]);
    // 透明な3つ目は積まない
    expect(r.vertexCount).toBe(8);
    expect(r.vertices[5]).toBe(0.5);
    expect(r.vertices[4 * FLOATS_PER_VERTEX + 5]).toBe(0.25);
  });

  it("頂点は位置・色（不透明度を掛けたもの）・ふちのぼかしの順", () => {
    const b = batch();
    b.sink(1, frame()).rects([1, 2, 3, 4], { color: "rgb(255 0 0 / 0.5)", alpha: 0.5 });
    expect(Array.from(b.vertices.subarray(0, FLOATS_PER_VERTEX))).toEqual([1, 2, 1, 0, 0, 0.25, 0, 1e4, 0]);
  });

  it("枠ごとに別の命令の列を持ち、番号は通しで積む。何も描かない図形は命令を足さない", () => {
    const b = batch();
    const first = frame();
    const second = frame();
    b.sink(1, first).rects([0, 0, 1, 1], { color: "#fff" });
    const s2 = b.sink(1, second);
    s2.rects([0, 0, 0, 0], { color: "#fff" });
    s2.polyline([0, 0], { color: "#fff", width: 1 });
    s2.image(new StreamImage(1, 1), { x: 0, y: 0, width: 0, height: 1 });
    expect(second.commands).toEqual([]);
    s2.rects([0, 0, 1, 1], { color: "#fff" });
    expect(first.commands).toEqual([shapesCommand(0, 6)]);
    expect(second.commands).toEqual([shapesCommand(6, 6)]);
  });

  it("領域が足りなければ広げ、reset で空にする（確保した領域は使い回す）", () => {
    const b = batch();
    const sink = b.sink(1, frame());
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
      DISCARD_SINK.trail("#000", 0.5);
    }).not.toThrow();
  });
});
