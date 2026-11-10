import { describe, expect, it } from "vitest";
import { StreamImage } from "./stream_image";
import { recordingCanvas } from "./test_canvas";
import { recordingShapeSink, testDrawOutput } from "./test_shapes";

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

  it("テスト用の出し先は、図形を記録用の受け口へ、文字を渡した Canvas へ出す", () => {
    const rc = recordingCanvas();
    const out = testDrawOutput(rc.ctx);
    out.shapes.rects([0, 0, 1, 1], { color: "#fff" });
    out.text.fillText("A", 1, 2);
    expect(out.recording.shapes).toEqual([{ op: "rects", rects: [0, 0, 1, 1], style: { color: "#fff" } }]);
    expect(rc.texts.map((t) => t.text)).toEqual(["A"]);
  });
});
