import { describe, expect, it } from "vitest";
import { StreamImage } from "./stream_image";
import { recordingCanvas } from "./test_canvas";
import { pairs, recordingShapeSink, splitRects, testDrawOutput } from "./test_shapes";

describe("recordingShapeSink", () => {
  it("受け取った図形を順に並べ、並びと見た目は写して残す（作業用の配列を使い回しても変わらない）", () => {
    const { sink, shapes, clear } = recordingShapeSink();
    const points = new Float32Array([0, 1, 2, 3]);
    const style = { color: "#fff", width: 1.5, glow: 4 };
    sink.polyline(points, style);
    points[0] = 9;
    style.width = 3;
    sink.points([1, 2], [3], { color: "#000" }, [0.5]);
    sink.points([1, 2], 2, { color: "#000" });
    const stream = new StreamImage(2, 2);
    sink.image(stream, { x: 0, y: 0, width: 2, height: 2 });
    expect(shapes).toEqual([
      { op: "polyline", points: [0, 1, 2, 3], style: { color: "#fff", width: 1.5, glow: 4 } },
      { op: "points", points: [1, 2], radius: [3], style: { color: "#000" }, alphas: [0.5] },
      { op: "points", points: [1, 2], radius: 2, style: { color: "#000" } },
      { op: "image", stream, dest: { x: 0, y: 0, width: 2, height: 2 }, alpha: 1 },
    ]);
    clear();
    expect(shapes).toHaveLength(0);
  });

  it("点ごとの濃さ・多角形の中心・四角ごとの不透明度・残光も写して残す", () => {
    const { sink, shapes } = recordingShapeSink();
    const fades = new Float32Array([0, 1]);
    sink.polyline([0, 0, 1, 0], { color: "#fff", width: 1 }, fades);
    fades[0] = 0.5;
    sink.polygon([0, 0, 1, 0, 0, 1], { color: "#fff" }, [0.2, 0.3]);
    sink.rects([0, 0, 1, 1], { color: "#fff", alpha: 0.5 }, [0.4]);
    sink.trail("#000", 0.3);
    expect(shapes).toEqual([
      { op: "polyline", points: [0, 0, 1, 0], style: { color: "#fff", width: 1 }, fades: [0, 1] },
      { op: "polygon", points: [0, 0, 1, 0, 0, 1], style: { color: "#fff" }, center: [0.2, 0.3] },
      { op: "rects", rects: [0, 0, 1, 1], style: { color: "#fff", alpha: 0.5 }, alphas: [0.4] },
      { op: "trail", color: "#000", alpha: 0.3 },
    ]);
  });

  it("splitRects は四角を1つずつに分け、不透明度は style.alpha と四角ごとの値を掛ける。pairs は点を組にする", () => {
    expect(splitRects({ op: "rects", rects: [1, 2, 3, 4, 5, 6, 7, 8], style: { color: "#fff", alpha: 0.5 }, alphas: [1, 0.5] })).toEqual([
      { x: 1, y: 2, width: 3, height: 4, alpha: 0.5 },
      { x: 5, y: 6, width: 7, height: 8, alpha: 0.25 },
    ]);
    expect(pairs([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("テスト用の出し先は、図形を記録用の受け口へ、文字を渡した Canvas へ出す", () => {
    const rc = recordingCanvas();
    const out = testDrawOutput(rc.ctx);
    out.shapes.rects([0, 0, 1, 1], { color: "#fff" });
    out.text.fillText("A", 1, 2);
    expect(out.recording.shapes).toEqual([{ op: "rects", rects: [0, 0, 1, 1], style: { color: "#fff" } }]);
    expect(rc.texts.map((t) => t.text)).toEqual(["A"]);
  });
});
