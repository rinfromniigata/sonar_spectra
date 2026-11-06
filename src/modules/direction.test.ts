import { describe, expect, it } from "vitest";
import { applyTransform, directionTransform, logicalSize, quarterTurns } from "./direction";
import type { Direction } from "./options";

describe("quarterTurns", () => {
  it("既定の向きから時計回りに数える", () => {
    expect(quarterTurns("up", "up")).toBe(0);
    expect(quarterTurns("up", "right")).toBe(1);
    expect(quarterTurns("up", "down")).toBe(2);
    expect(quarterTurns("up", "left")).toBe(3);
    expect(quarterTurns("left", "up")).toBe(1);
    expect(quarterTurns("left", "right")).toBe(2);
    expect(quarterTurns("left", "down")).toBe(3);
  });

  it("方向のないモジュールは回さない", () => {
    expect(quarterTurns(null, "right")).toBe(0);
    expect(quarterTurns("up", null)).toBe(0);
  });
});

describe("logicalSize", () => {
  it("90°・270° では縦横が入れ替わる", () => {
    expect(logicalSize(300, 100, 0)).toEqual({ width: 300, height: 100 });
    expect(logicalSize(300, 100, 1)).toEqual({ width: 100, height: 300 });
    expect(logicalSize(300, 100, 2)).toEqual({ width: 300, height: 100 });
    expect(logicalSize(300, 100, 3)).toEqual({ width: 100, height: 300 });
  });
});

describe("directionTransform", () => {
  const W = 300;
  const H = 100;
  /** 既定の向きの「上」（-y）が、枠の上でどちら向きになるか */
  function upOnScreen(turns: 0 | 1 | 2 | 3): Direction {
    const m = directionTransform(turns, W, H, 1);
    const [x0, y0] = applyTransform(m, 50, 50);
    const [x1, y1] = applyTransform(m, 50, 40);
    const dx = Math.round(x1 - x0);
    const dy = Math.round(y1 - y0);
    if (dy < 0) return "up";
    if (dx > 0) return "right";
    if (dy > 0) return "down";
    return "left";
  }

  it("既定が上向きのモジュールを回すと、選んだ方向へ流れる", () => {
    for (const direction of ["up", "right", "down", "left"] as const) {
      expect(upOnScreen(quarterTurns("up", direction))).toBe(direction);
    }
  });

  it("描画の座標系の四隅が、枠の四隅にぴったり写る", () => {
    for (const turns of [0, 1, 2, 3] as const) {
      const m = directionTransform(turns, W, H, 1);
      const size = logicalSize(W, H, turns);
      const corners = [
        [0, 0],
        [size.width, 0],
        [0, size.height],
        [size.width, size.height],
      ].map(([x, y]) => applyTransform(m, x, y).map((v) => Math.round(v) + 0));
      expect(corners.map((p) => p.join(",")).sort()).toEqual(["0,0", "0,100", "300,0", "300,100"]);
    }
  });

  it("デバイスピクセル比をかける", () => {
    const m = directionTransform(1, W, H, 2);
    expect(applyTransform(m, 0, 0)).toEqual([600, 0]);
    expect(applyTransform(m, 100, 300)).toEqual([0, 200]);
  });
});
