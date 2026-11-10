import { describe, expect, it } from "vitest";
import { POLYLINE_CHUNK, deviceSnapX, drawGridLines, fillBetween, strokePolyline } from "./canvas_helpers";
import { joinRuns, recordingCanvas } from "./test_canvas";

/** 行列を読める Canvas の代わり（getTransform だけ足す） */
function withTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
  const canvas = recordingCanvas();
  (canvas.ctx as unknown as { getTransform: () => object }).getTransform = () => ({ a, b, c, d, e, f });
  return canvas;
}

describe("drawGridLines", () => {
  it("内側の線を、太さ1の四角で塗る（縦は nx−1 本、横は ny−1 本）", () => {
    const canvas = recordingCanvas();
    drawGridLines(canvas.ctx, 100, 60, 4, 3, "GRID");
    expect(canvas.shapes.every((s) => s.op === "fillRect" && s.style === "GRID")).toBe(true);
    expect(canvas.shapes.map((s) => s.points)).toEqual([
      [[25, 0], [26, 60]],
      [[50, 0], [51, 60]],
      [[75, 0], [76, 60]],
      [[0, 20], [100, 21]],
      [[0, 40], [100, 41]],
    ]);
  });
});

describe("strokePolyline", () => {
  it(`${POLYLINE_CHUNK} 区間ずつの線に分け、隣どうしは端の点を共有する`, () => {
    const canvas = recordingCanvas();
    const n = 20;
    strokePolyline(canvas.ctx, n, (i) => i * 10, (i) => i * i);
    const strokes = canvas.shapes;
    expect(strokes.map((s) => s.points.length)).toEqual([9, 9, 4]);
    for (let k = 1; k < strokes.length; k++) {
      expect(strokes[k].points[0]).toEqual(strokes[k - 1].points[strokes[k - 1].points.length - 1]);
    }
    // つなぐと元の折れ線になる
    const [joined] = joinRuns(strokes);
    expect(joined.points).toEqual(Array.from({ length: n }, (_, i) => [i * 10, i * i]));
  });

  it("点が1つ以下なら何も描かない。ちょうど1区間分なら1本", () => {
    const canvas = recordingCanvas();
    strokePolyline(canvas.ctx, 1, () => 0, () => 0);
    expect(canvas.shapes).toHaveLength(0);
    strokePolyline(canvas.ctx, POLYLINE_CHUNK + 1, (i) => i, () => 0);
    expect(canvas.shapes).toHaveLength(1);
  });
});

describe("deviceSnapX", () => {
  it("行列を読めない Canvas では丸めない", () => {
    const snap = deviceSnapX(recordingCanvas().ctx);
    expect(snap(3.3)).toBe(3.3);
  });

  it("x 軸が写るデバイスの軸（回していなければ横、90° 回していれば縦）で、整数のピクセルに丸める", () => {
    const plain = deviceSnapX(withTransform(1.5, 0, 0, 1.5, 0, 0).ctx);
    expect(plain(8.8) * 1.5).toBeCloseTo(13, 9);
    // 90° 回した座標系：x は デバイスの y = 1.5x + 0.1 に写る
    const turned = deviceSnapX(withTransform(0, 1.5, -1.5, 0, 200, 0.1).ctx);
    expect(turned(8.8) * 1.5 + 0.1).toBeCloseTo(13, 9);
    // 180° 回した座標系：x は デバイスの x = −1.5x + 300.25 に写る
    const flipped = deviceSnapX(withTransform(-1.5, 0, 0, -1.5, 300.25, 90).ctx);
    expect(-1.5 * flipped(8.8) + 300.25).toBeCloseTo(287, 9);
  });
});

describe("fillBetween", () => {
  const x = (i: number) => i * 10;
  const top = (i: number) => i;
  const bottom = () => 100;

  it(`${POLYLINE_CHUNK} 区間ずつの縦の帯に分け、境目の点を両側で共有する（つなぐと元の塗りになる）`, () => {
    const canvas = recordingCanvas();
    fillBetween(canvas.ctx, 20, x, top, bottom);
    expect(canvas.shapes).toHaveLength(3);
    expect(canvas.shapes.every((s) => s.op === "fill")).toBe(true);
    // 最初の帯：左上から上の線を右へ、境目（点 8）で下りて、下の線を左へ
    expect(canvas.shapes[0].points).toEqual([
      ...Array.from({ length: 9 }, (_, i) => [x(i), top(i)]),
      [80, 100],
      ...Array.from({ length: 7 }, (_, i) => [x(7 - i), 100]),
      [0, 100],
    ]);
    expect(canvas.shapes[1].points[0]).toEqual([80, 8]);
    const [joined] = joinRuns(canvas.shapes);
    expect(joined.points).toEqual([...Array.from({ length: 20 }, (_, i) => [x(i), top(i)]), ...Array.from({ length: 20 }, (_, i) => [x(19 - i), 100])]);
  });

  it("境目をデバイスピクセルに丸め、その位置の高さは隣の点との間を直線で補う", () => {
    const canvas = withTransform(1.5, 0, 0, 1.5, 0, 0);
    const xs = (i: number) => i * 1.1;
    fillBetween(canvas.ctx, 12, xs, (i) => i * 2, () => 50);
    expect(canvas.shapes).toHaveLength(2);
    const [first, second] = canvas.shapes;
    // 点 8（x=8.8）はデバイスで 13.2 → 13 に丸め、x=8.666… は点 7（7.7）と点 8 の間
    const bx = 13 / 1.5;
    const by = 14 + ((bx - 7.7) / 1.1) * 2;
    const half = first.points.length / 2;
    expect(first.points[half - 1][0]).toBeCloseTo(bx, 9);
    expect(first.points[half - 1][1]).toBeCloseTo(by, 9);
    expect(first.points[half]).toEqual([first.points[half - 1][0], 50]);
    // 最初の帯は点 7 まで、次の帯は境目から始まって点 8 を含む
    expect(first.points.slice(0, half - 1).map((p) => p[0])).toEqual(Array.from({ length: 8 }, (_, i) => xs(i)));
    expect(second.points[0][0]).toBeCloseTo(bx, 9);
    expect(second.points[1][0]).toBeCloseTo(xs(8), 9);
  });

  it("上の線が下の線より下にあっても（交差しても）、そのまま帯にする。点が2つ未満なら何も塗らない", () => {
    const canvas = recordingCanvas();
    fillBetween(canvas.ctx, 3, x, (i) => (i === 1 ? 80 : 20), () => 50);
    expect(canvas.shapes).toHaveLength(1);
    expect(canvas.shapes[0].points[1]).toEqual([10, 80]);
    canvas.clear();
    fillBetween(canvas.ctx, 1, x, top, bottom);
    expect(canvas.shapes).toHaveLength(0);
  });
});
