// 単体テスト用：記録用の ShapeSink（受け取った図形をそのまま並べる。imple 4.8）。
// モジュールは作業用の配列を使い回すので、受け取った並びと見た目は写して残す。

import type { StreamImage } from "./stream_image";
import type { DrawOutput, FillStyle, Rect, ShapeSink, StrokeStyle, TextGlowStyle } from "./types";

export type RecordedShape =
  | { op: "polyline"; points: number[]; style: StrokeStyle; fades?: number[] }
  | { op: "band"; xs: number[]; top: number[]; bottom: number[]; style: FillStyle }
  | { op: "polygon"; points: number[]; style: FillStyle; center?: [number, number] }
  | { op: "points"; points: number[]; radius: number | number[]; style: FillStyle; alphas?: number[] }
  | { op: "rects"; rects: number[]; style: FillStyle; alphas?: number[] }
  | { op: "image"; stream: StreamImage; dest: Rect; alpha: number }
  | { op: "trail"; color: string; alpha: number }
  | { op: "textGlow"; text: string; x: number; y: number; style: TextGlowStyle };

export interface RecordingShapeSink {
  sink: ShapeSink;
  shapes: RecordedShape[];
  clear(): void;
}

export function recordingShapeSink(): RecordingShapeSink {
  const shapes: RecordedShape[] = [];
  const copy = (values: ArrayLike<number>) => Array.from(values);
  const sink: ShapeSink = {
    polyline: (points, style, fades) =>
      shapes.push({ op: "polyline", points: copy(points), style: { ...style }, ...(fades ? { fades: copy(fades) } : {}) }),
    band: (xs, top, bottom, style) => shapes.push({ op: "band", xs: copy(xs), top: copy(top), bottom: copy(bottom), style: { ...style } }),
    polygon: (points, style, center) =>
      shapes.push({ op: "polygon", points: copy(points), style: { ...style }, ...(center ? { center: [center[0], center[1]] } : {}) }),
    points: (points, radius, style, alphas) =>
      shapes.push({
        op: "points",
        points: copy(points),
        radius: typeof radius === "number" ? radius : copy(radius),
        style: { ...style },
        ...(alphas ? { alphas: copy(alphas) } : {}),
      }),
    rects: (rects, style, alphas) =>
      shapes.push({ op: "rects", rects: copy(rects), style: { ...style }, ...(alphas ? { alphas: copy(alphas) } : {}) }),
    image: (stream, dest, style) => shapes.push({ op: "image", stream, dest: { ...dest }, alpha: style?.alpha ?? 1 }),
    trail: (color, alpha) => shapes.push({ op: "trail", color, alpha }),
    textGlow: (text, x, y, style) => shapes.push({ op: "textGlow", text, x, y, style: { ...style } }),
  };
  return { sink, shapes, clear: () => (shapes.length = 0) };
}

/** テスト用の出し先：図形は記録用の受け口へ、文字は渡した Canvas（テスト用の Canvas）へ */
export function testDrawOutput(text: CanvasRenderingContext2D, recording: RecordingShapeSink = recordingShapeSink()): DrawOutput & { recording: RecordingShapeSink } {
  return { shapes: recording.sink, text, recording };
}

/** 記録した四角（x, y, 幅, 高さ の並び）を、1つずつに分ける。alpha は style.alpha と四角ごとの不透明度を掛けたもの */
export function splitRects(shape: Extract<RecordedShape, { op: "rects" }>): { x: number; y: number; width: number; height: number; alpha: number }[] {
  const out: { x: number; y: number; width: number; height: number; alpha: number }[] = [];
  for (let i = 0, k = 0; i + 3 < shape.rects.length; i += 4, k++) {
    const alpha = (shape.style.alpha ?? 1) * (shape.alphas ? shape.alphas[k] : 1);
    out.push({ x: shape.rects[i], y: shape.rects[i + 1], width: shape.rects[i + 2], height: shape.rects[i + 3], alpha });
  }
  return out;
}

/** 記録した点の並び（x, y を交互）を、[x, y] の組にする */
export function pairs(points: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i], points[i + 1]]);
  return out;
}
