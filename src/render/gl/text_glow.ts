// 文字の発光（ShapeSink.textGlow）の計算。文字そのものは文字の層（Canvas 2D）に描き、描画の層は発光だけを敷く。
// 文字を画像にする（Canvas 2D で発光の色で描く）→ テクスチャにして、発光の命令（gl_glow）の図形の代わりに描く。
// ここは WebGL に頼らない部分（文字の画像の大きさと置き場所）で、単体テストで調べる。

import type { Rect, TextGlowStyle } from "../../modules/types";

/** 文字の画像のまわりの余白（デバイスピクセル。ふちのならしの分） */
export const TEXT_PAD = 2;

/** measureText の結果のうち使うもの（actualBoundingBox は、textAlign・textBaseline で決まる基準の点からの距離） */
export interface TextExtent {
  width: number;
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

/** 文字の画像の作り方 */
export interface TextRaster {
  /** 画像の大きさ（デバイスピクセル） */
  pixelWidth: number;
  pixelHeight: number;
  /** 画像の上で、文字の基準の点を置く位置（デバイスピクセル） */
  originX: number;
  originY: number;
  /** 画像を置く場所（描画の座標系。CSS ピクセル） */
  dest: Rect;
}

/**
 * 基準の点 (x, y) に描く文字の画像の大きさと置き場所。maxWidth より広い文字は、fillText と同じく基準の点を中心に横に縮める。
 * 大きさのない文字（空・空白だけ）は null
 */
export function textRaster(extent: TextExtent, x: number, y: number, pixelScale: number, maxWidth?: number): TextRaster | null {
  const squeeze = maxWidth !== undefined && maxWidth > 0 && extent.width > maxWidth ? maxWidth / extent.width : 1;
  const left = extent.left * squeeze;
  const right = extent.right * squeeze;
  const inkWidth = (left + right) * pixelScale;
  const inkHeight = (extent.ascent + extent.descent) * pixelScale;
  if (!(inkWidth > 0 && inkHeight > 0 && pixelScale > 0)) return null;
  const pixelWidth = Math.ceil(inkWidth) + TEXT_PAD * 2;
  const pixelHeight = Math.ceil(inkHeight) + TEXT_PAD * 2;
  const originX = TEXT_PAD + left * pixelScale;
  const originY = TEXT_PAD + extent.ascent * pixelScale;
  return {
    pixelWidth,
    pixelHeight,
    originX,
    originY,
    dest: { x: x - originX / pixelScale, y: y - originY / pixelScale, width: pixelWidth / pixelScale, height: pixelHeight / pixelScale },
  };
}

/** 文字の画像を見分ける値（同じなら同じ画像を使い回す） */
export function textGlowKey(text: string, style: TextGlowStyle, pixelScale: number): string {
  return [text, style.font, style.align, style.baseline, style.maxWidth ?? "", style.color, pixelScale].join("\u0000");
}

/** 文字を発光の色で描いた画像（Canvas 2D）。作れなければ null */
export interface RasterizedText {
  canvas: HTMLCanvasElement;
  dest: Rect;
}

/** 文字を、文字の層と同じ font・揃え方で、発光の色で画像に描く（ブラウザの Canvas 2D を使う） */
export function rasterizeText(canvas: HTMLCanvasElement, text: string, style: TextGlowStyle, x: number, y: number, pixelScale: number): RasterizedText | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = style.font;
  ctx.textAlign = style.align;
  ctx.textBaseline = style.baseline;
  const m = ctx.measureText(text);
  const raster = textRaster(
    { width: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent },
    x,
    y,
    pixelScale,
    style.maxWidth,
  );
  if (!raster) return null;
  // 大きさを変えると状態が戻るので、変えたあとで設定し直す
  canvas.width = raster.pixelWidth;
  canvas.height = raster.pixelHeight;
  ctx.setTransform(pixelScale, 0, 0, pixelScale, raster.originX, raster.originY);
  ctx.font = style.font;
  ctx.textAlign = style.align;
  ctx.textBaseline = style.baseline;
  ctx.fillStyle = style.color;
  if (style.maxWidth !== undefined) ctx.fillText(text, 0, 0, style.maxWidth);
  else ctx.fillText(text, 0, 0);
  return { canvas, dest: raster.dest };
}
