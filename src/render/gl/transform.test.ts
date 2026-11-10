import { describe, expect, it } from "vitest";
import { applyTransform, directionTransform, logicalSize } from "../../modules/direction";
import { applyMat3, frameClipMatrix } from "./transform";

const W = 300;
const H = 120;

/** 枠の座標（CSS ピクセル、回した後）をクリップ座標に */
const toClip = (x: number, y: number, boxW: number, boxH: number): [number, number] => [(2 * x) / boxW - 1, 1 - (2 * y) / boxH];

describe("frameClipMatrix", () => {
  it("回さないとき、左上が (-1, 1)、右下が (1, -1)、中心が (0, 0)", () => {
    const m = frameClipMatrix(0, W, H);
    expect(applyMat3(m, 0, 0)).toEqual([-1, 1]);
    const [x, y] = applyMat3(m, W, H);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(-1, 6);
    for (const v of applyMat3(m, W / 2, H / 2)) expect(v).toBeCloseTo(0, 6);
  });

  it("どの向きでも、文字の層（Canvas 2D の行列）と同じ位置に写す", () => {
    for (const turns of [0, 1, 2, 3] as const) {
      // 描画の座標系の大きさは W × H。枠（回した後）の大きさ
      const box = logicalSize(W, H, turns);
      const m = frameClipMatrix(turns, W, H);
      const canvas = directionTransform(turns, box.width, box.height, 1);
      for (const [x, y] of [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
        [37, 81],
      ] as const) {
        const [bx, by] = applyTransform(canvas, x, y);
        const [ex, ey] = toClip(bx, by, box.width, box.height);
        const [cx, cy] = applyMat3(m, x, y);
        expect(cx).toBeCloseTo(ex, 6);
        expect(cy).toBeCloseTo(ey, 6);
      }
    }
  });

  it("90° 回すと、既定の向きの左上は枠の右上に来る（Canvas 2D の回し方と同じ）", () => {
    const [x, y] = applyMat3(frameClipMatrix(1, W, H), 0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
    const [x3, y3] = applyMat3(frameClipMatrix(3, W, H), 0, 0);
    expect(x3).toBeCloseTo(-1, 6);
    expect(y3).toBeCloseTo(-1, 6);
  });

  it("大きさ 0 でも数が壊れない", () => {
    expect(Array.from(frameClipMatrix(0, 0, 0)).every(Number.isFinite)).toBe(true);
  });
});
