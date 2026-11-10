// 図形のまとめ（imple 4.6）：1回の描画で、全モジュールの図形を1つの頂点の並びと1つの番号の並びに積む。
// モジュールが ShapeSink に出した図形は、その場で三角形に展開して積み、枠ごとに「描く命令」の列を残す。
// 命令は、続けて描ける図形（同じ発光の値）を1つにまとめ、流れる画像のところで区切る。
// 描画の層は、積んだものを1回だけ GPU に送り、枠ごとに命令の範囲を描く（1つのモジュールは数回の描画命令で済む）。
// WebGL に頼らないので、展開と命令のまとめ方を単体テストで調べられる。

import type { StreamImage } from "../../modules/stream_image";
import type { FillStyle, Rect, ShapeSink } from "../../modules/types";
import type { Rgba } from "./color";
import { fillBand, fillPoints, fillPolygon, fillRects, strokePolyline, type MeshWriter } from "./tessellate";

/** 頂点1つの値の数：位置 x, y／色 r, g, b, a／ふちのぼかし u, v, w */
export const FLOATS_PER_VERTEX = 9;

export type BatchCommand =
  /** 番号の並びの first から count 個（三角形）を描く。glow は発光の値（発光は T9-6） */
  | { kind: "shapes"; first: number; count: number; glow: number }
  | { kind: "image"; stream: StreamImage; dest: Rect; alpha: number };

/** 何もしない受け口（描画の層がないとき・使えないとき） */
export const DISCARD_SINK: ShapeSink = {
  polyline: () => {},
  band: () => {},
  polygon: () => {},
  points: () => {},
  rects: () => {},
  image: () => {},
};

const INITIAL_VERTICES = 4096;
const INITIAL_INDICES = 8192;

export class ShapeBatch implements MeshWriter {
  vertices = new Float32Array(INITIAL_VERTICES * FLOATS_PER_VERTEX);
  indices = new Uint32Array(INITIAL_INDICES);
  vertexCount = 0;
  indexCount = 0;

  constructor(private readonly resolveColor: (text: string) => Rgba) {}

  /** 1回の描画の初めに空にする（確保した領域は使い回す） */
  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  vertex(x: number, y: number, color: Rgba, alpha: number, u: number, v: number, w: number): number {
    if ((this.vertexCount + 1) * FLOATS_PER_VERTEX > this.vertices.length) {
      const next = new Float32Array(this.vertices.length * 2);
      next.set(this.vertices);
      this.vertices = next;
    }
    const o = this.vertexCount * FLOATS_PER_VERTEX;
    const f = this.vertices;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = color[0];
    f[o + 3] = color[1];
    f[o + 4] = color[2];
    f[o + 5] = color[3] * alpha;
    f[o + 6] = u;
    f[o + 7] = v;
    f[o + 8] = w;
    return this.vertexCount++;
  }

  triangle(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > this.indices.length) {
      const next = new Uint32Array(this.indices.length * 2);
      next.set(this.indices);
      this.indices = next;
    }
    this.indices[this.indexCount++] = a;
    this.indices[this.indexCount++] = b;
    this.indices[this.indexCount++] = c;
  }

  /**
   * 枠1つ分の受け口。出した図形をこのまとめに積み、commands に描く順の命令を足す。
   * pixelScale は CSS ピクセルあたりのデバイスピクセル（線と点のふちのぼかしの幅を決める）
   */
  sink(pixelScale: number, commands: BatchCommand[]): ShapeSink {
    const shapes = (style: FillStyle, write: (color: Rgba, alpha: number) => void) => {
      const first = this.indexCount;
      write(this.resolveColor(style.color), style.alpha ?? 1);
      const count = this.indexCount - first;
      if (count === 0) return;
      const glow = Math.max(0, style.glow ?? 0);
      const last = commands[commands.length - 1];
      if (last && last.kind === "shapes" && last.glow === glow && last.first + last.count === first) {
        last.count += count;
      } else {
        commands.push({ kind: "shapes", first, count, glow });
      }
    };
    return {
      polyline: (points, style) =>
        shapes(style, (color, alpha) => strokePolyline(this, points, style.width, pixelScale, color, alpha, style.closed ?? false)),
      band: (xs, top, bottom, style) => shapes(style, (color, alpha) => fillBand(this, xs, top, bottom, color, alpha)),
      polygon: (points, style) => shapes(style, (color, alpha) => fillPolygon(this, points, color, alpha)),
      points: (points, radius, style, alphas) =>
        shapes(style, (color, alpha) => fillPoints(this, points, radius, pixelScale, color, alpha, alphas)),
      rects: (rects, style) => shapes(style, (color, alpha) => fillRects(this, rects, color, alpha)),
      image: (stream, dest, style) => {
        if (dest.width > 0 && dest.height > 0) commands.push({ kind: "image", stream, dest: { ...dest }, alpha: style?.alpha ?? 1 });
      },
    };
  }
}
