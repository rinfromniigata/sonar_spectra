import { describe, expect, it } from "vitest";
import { createGlowLayer, type GlowPaint } from "./glow_layer";
import { recordingBuffers, recordingCanvas } from "./test_canvas";

// 縮小率と標準偏差（glowScale・glowDeviation）は render/gl/glow.test.ts で確かめる

describe("createGlowLayer", () => {
  function setup(width = 200, height = 80, dpr = 1.5) {
    const target = recordingCanvas();
    const buffers = recordingBuffers();
    const layer = createGlowLayer(buffers.createBuffer);
    layer.resize(width, height, dpr);
    const calls: { pass: string; ctx: CanvasRenderingContext2D }[] = [];
    const paint: GlowPaint = (ctx, pass) => {
      calls.push({ pass, ctx });
      ctx.fillStyle = "MAIN";
      ctx.fillRect(10, 10, 20, 20);
    };
    return { target, buffers, layer, calls, paint };
  }

  it("縮小した画像に形を描いてぼかし、画面に拡大して敷いてから、形をそのまま描く", () => {
    const { target, buffers, layer, calls, paint } = setup();
    layer.draw(target.ctx, 10, paint);

    // 形用とぼかし用の2枚（200×80 × DPR 1.5 × 1/2）
    expect(buffers.created.map((b) => [b.width, b.height])).toEqual([
      [150, 60],
      [150, 60],
    ]);
    const [shapes, blurred] = buffers.created;
    expect(calls.map((c) => c.pass)).toEqual(["glow", "sharp"]);
    expect(calls[0].ctx).toBe(shapes.rc.ctx);
    expect(calls[1].ctx).toBe(target.ctx);
    // 形用の画像：消してから、描画の座標系 × DPR × 縮小率で描く
    expect(shapes.rc.transforms).toEqual([
      [1, 0, 0, 1, 0, 0],
      [0.75, 0, 0, 0.75, 0, 0],
    ]);
    expect(shapes.rc.shapes).toHaveLength(1);
    // ぼかし用の画像：標準偏差 2.5px でぼかして写し、filter は戻す
    expect(blurred.rc.images).toEqual([{ image: { width: 150, height: 60 }, args: [0, 0], filter: "blur(2.5px)" }]);
    expect((blurred.rc.ctx as unknown as { filter: string }).filter).toBe("none");
    // 画面：描画の座標系いっぱいに敷き、そのあとに形
    expect(target.images.map((i) => i.args)).toEqual([[0, 0, 200, 80]]);
    expect(target.shapes).toHaveLength(1);
  });

  it("2回目からは画像を使い回す。大きさが変わったら作り直し、同じ大きさなら作り直さない", () => {
    const { target, buffers, layer, paint } = setup();
    layer.draw(target.ctx, 10, paint);
    layer.draw(target.ctx, 8, paint);
    expect(buffers.created).toHaveLength(2);
    // 縮小率の違う発光（24 は 1/4）には別の2枚
    layer.draw(target.ctx, 24, paint);
    expect(buffers.created.map((b) => [b.width, b.height])).toEqual([
      [150, 60],
      [150, 60],
      [75, 30],
      [75, 30],
    ]);
    layer.resize(200, 80, 1.5);
    layer.draw(target.ctx, 10, paint);
    expect(buffers.created).toHaveLength(4);
    layer.resize(100, 80, 1.5);
    layer.draw(target.ctx, 10, paint);
    expect(buffers.created).toHaveLength(6);
    expect(buffers.created[4].width).toBe(75);
  });

  it("割り切れない大きさでは、縮小した画像の端数の分も含めて、同じ倍率で拡大して敷く", () => {
    const { target, layer, paint } = setup(101, 50, 1);
    layer.draw(target.ctx, 10, paint);
    // 101 × 1/2 → 51px の画像を、51 / (1 × 1/2) = 102 の幅で敷く（描画の座標系とずれない）
    expect(target.images[0].args).toEqual([0, 0, 102, 50]);
  });

  it("発光が 0 以下、または大きさがまだないときは、形をそのまま描くだけ", () => {
    const { target, buffers, layer, calls, paint } = setup();
    layer.draw(target.ctx, 0, paint);
    expect(calls.map((c) => c.pass)).toEqual(["sharp"]);
    expect(buffers.created).toHaveLength(0);

    const fresh = createGlowLayer(buffers.createBuffer);
    fresh.draw(target.ctx, 10, paint);
    expect(buffers.created).toHaveLength(0);
    expect(target.images).toHaveLength(0);
  });
});
