import { describe, expect, it } from "vitest";
import { TEXT_PAD, textGlowKey, textRaster, type TextExtent } from "./text_glow";

// 基準の点から左に 10、右に 30、上に 12、下に 4 の文字（幅 40）
const EXTENT: TextExtent = { width: 40, left: 10, right: 30, ascent: 12, descent: 4 };

describe("textRaster", () => {
  it("画像は文字の範囲に余白を足した大きさ（デバイスピクセル）で、基準の点を範囲の左上から left・ascent の位置に置く", () => {
    const raster = textRaster(EXTENT, 100, 50, 1)!;
    expect(raster).toMatchObject({ pixelWidth: 40 + TEXT_PAD * 2, pixelHeight: 16 + TEXT_PAD * 2, originX: TEXT_PAD + 10, originY: TEXT_PAD + 12 });
    // 置き場所の中で、基準の点が (100, 50) に来る
    expect(raster.dest.x + raster.originX).toBe(100);
    expect(raster.dest.y + raster.originY).toBe(50);
    expect(raster.dest).toMatchObject({ width: raster.pixelWidth, height: raster.pixelHeight });
  });

  it("DPR に合わせて画像を細かくし、置き場所は CSS ピクセルのまま。端数は切り上げる", () => {
    const raster = textRaster(EXTENT, 100, 50, 1.5)!;
    expect(raster.pixelWidth).toBe(Math.ceil(40 * 1.5) + TEXT_PAD * 2);
    expect(raster.pixelHeight).toBe(Math.ceil(16 * 1.5) + TEXT_PAD * 2);
    expect(raster.dest.width).toBeCloseTo(raster.pixelWidth / 1.5, 10);
    expect(raster.dest.x + raster.originX / 1.5).toBeCloseTo(100, 10);
    expect(raster.dest.y + raster.originY / 1.5).toBeCloseTo(50, 10);
  });

  it("maxWidth より広い文字は、fillText と同じく基準の点を中心に横に縮める（狭ければそのまま）", () => {
    const squeezed = textRaster(EXTENT, 100, 50, 1, 20)!;
    // 半分に縮む：左に 5、右に 15
    expect(squeezed.pixelWidth).toBe(20 + TEXT_PAD * 2);
    expect(squeezed.originX).toBe(TEXT_PAD + 5);
    expect(squeezed.pixelHeight).toBe(16 + TEXT_PAD * 2);
    expect(textRaster(EXTENT, 100, 50, 1, 80)!.pixelWidth).toBe(40 + TEXT_PAD * 2);
  });

  it("大きさのない文字（空・空白だけ）は null", () => {
    expect(textRaster({ width: 0, left: 0, right: 0, ascent: 0, descent: 0 }, 0, 0, 1)).toBeNull();
    expect(textRaster({ width: 5, left: 0, right: 0, ascent: 0, descent: 0 }, 0, 0, 1)).toBeNull();
  });
});

describe("textGlowKey", () => {
  const style = { font: "600 20px NUMERIC", align: "center", baseline: "middle", color: "#0ff", glow: 12 } as const;

  it("文字・書体・揃え方・幅の上限・色・DPR が同じなら同じ値。発光の値と不透明度は画像に関わらない", () => {
    expect(textGlowKey("Am", style, 1.5)).toBe(textGlowKey("Am", { ...style, glow: 4, alpha: 0.5 }, 1.5));
    for (const other of [
      textGlowKey("A", style, 1.5),
      textGlowKey("Am", { ...style, font: "20px NUMERIC" }, 1.5),
      textGlowKey("Am", { ...style, align: "left" }, 1.5),
      textGlowKey("Am", { ...style, maxWidth: 30 }, 1.5),
      textGlowKey("Am", { ...style, color: "#f00" }, 1.5),
      textGlowKey("Am", style, 2),
    ]) {
      expect(other).not.toBe(textGlowKey("Am", style, 1.5));
    }
  });
});
