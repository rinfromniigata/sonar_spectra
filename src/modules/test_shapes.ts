// 単体テスト用：記録用の ShapeSink（受け取った図形をそのまま並べる。imple 4.8）。
// モジュールは作業用の配列を使い回すので、受け取った並びと見た目は写して残す。

import type { StreamImage } from "./stream_image";
import type { DrawOutput, FillStyle, Rect, ShapeSink, StrokeStyle } from "./types";

export type RecordedShape =
  | { op: "polyline"; points: number[]; style: StrokeStyle }
  | { op: "band"; xs: number[]; top: number[]; bottom: number[]; style: FillStyle }
  | { op: "polygon"; points: number[]; style: FillStyle }
  | { op: "points"; points: number[]; radius: number | number[]; style: FillStyle; alphas?: number[] }
  | { op: "rects"; rects: number[]; style: FillStyle }
  | { op: "image"; stream: StreamImage; dest: Rect; alpha: number };

export interface RecordingShapeSink {
  sink: ShapeSink;
  shapes: RecordedShape[];
  clear(): void;
}

export function recordingShapeSink(): RecordingShapeSink {
  const shapes: RecordedShape[] = [];
  const copy = (values: ArrayLike<number>) => Array.from(values);
  const sink: ShapeSink = {
    polyline: (points, style) => shapes.push({ op: "polyline", points: copy(points), style: { ...style } }),
    band: (xs, top, bottom, style) => shapes.push({ op: "band", xs: copy(xs), top: copy(top), bottom: copy(bottom), style: { ...style } }),
    polygon: (points, style) => shapes.push({ op: "polygon", points: copy(points), style: { ...style } }),
    points: (points, radius, style, alphas) =>
      shapes.push({
        op: "points",
        points: copy(points),
        radius: typeof radius === "number" ? radius : copy(radius),
        style: { ...style },
        ...(alphas ? { alphas: copy(alphas) } : {}),
      }),
    rects: (rects, style) => shapes.push({ op: "rects", rects: copy(rects), style: { ...style } }),
    image: (stream, dest, style) => shapes.push({ op: "image", stream, dest: { ...dest }, alpha: style?.alpha ?? 1 }),
  };
  return { sink, shapes, clear: () => (shapes.length = 0) };
}

/** テスト用の出し先：図形は記録用の受け口へ、文字は渡した Canvas（テスト用の Canvas）へ */
export function testDrawOutput(text: CanvasRenderingContext2D, recording: RecordingShapeSink = recordingShapeSink()): DrawOutput & { recording: RecordingShapeSink } {
  return { shapes: recording.sink, text, recording };
}
