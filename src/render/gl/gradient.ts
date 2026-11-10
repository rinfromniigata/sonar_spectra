// 色の移り変わり（imple 4.6）：モジュールが FillStyle.color に渡した Gradient を、シェーダーに渡す数値にする（純粋関数）。
// シェーダーは、描画の座標系の位置から offset の位置 t を求め、点と点の間を、不透明度で掛けない値のまま直線で移す
// （Canvas 2D の仕様と同じ。transparent（透明な黒）へは黒くなりながら消える）。端より外は端の色。
// gradientParameter・gradientColorAt はシェーダーと同じ式で、テストで確かめるのに使う。

import { MAX_GRADIENT_STOPS, type Gradient } from "../../modules/types";
import type { Rgba } from "./color";

export interface ResolvedGradient {
  /** 1 = 直線、2 = 円（中心が同じ2つの円） */
  kind: 1 | 2;
  /** 直線：x0, y0, x1, y1／円：中心 x, y, r0, r1 */
  geometry: Float32Array;
  /** 点の数（1〜MAX_GRADIENT_STOPS） */
  count: number;
  /** 点の位置（0〜1、小さい順。count より後ろは使わない） */
  offsets: Float32Array;
  /** 点の色（RGBA を4つずつ。不透明度で掛けない値） */
  colors: Float32Array;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 色の移り変わりを数値にする。何も塗らないもの（点がない、直線の2点が同じ、2つの円の半径が同じ）は null
 * （Canvas 2D でも何も塗らない）。点は offset の順に並べ（同じ offset は渡した順）、先頭から MAX_GRADIENT_STOPS 個を使う
 */
export function resolveGradient(gradient: Gradient, resolveColor: (text: string) => Rgba): ResolvedGradient | null {
  const stops = gradient.stops
    .map((stop, index) => ({ offset: Number.isFinite(stop.offset) ? clamp01(stop.offset) : 0, color: stop.color, index }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index)
    .slice(0, MAX_GRADIENT_STOPS);
  if (stops.length === 0) return null;
  let geometry: Float32Array;
  let kind: 1 | 2;
  if (gradient.kind === "linear") {
    const { x0, y0, x1, y1 } = gradient;
    if (![x0, y0, x1, y1].every(Number.isFinite) || (x0 === x1 && y0 === y1)) return null;
    kind = 1;
    geometry = Float32Array.of(x0, y0, x1, y1);
  } else {
    const { x, y, r0, r1 } = gradient;
    if (![x, y, r0, r1].every(Number.isFinite) || r0 < 0 || r1 < 0 || r0 === r1) return null;
    kind = 2;
    geometry = Float32Array.of(x, y, r0, r1);
  }
  const offsets = new Float32Array(MAX_GRADIENT_STOPS);
  const colors = new Float32Array(MAX_GRADIENT_STOPS * 4);
  stops.forEach((stop, i) => {
    offsets[i] = stop.offset;
    colors.set(resolveColor(stop.color), i * 4);
  });
  return { kind, geometry, count: stops.length, offsets, colors };
}

/** 位置 (x, y)（描画の座標系）の offset の位置 t（シェーダーと同じ式。端で切らない） */
export function gradientParameter(g: ResolvedGradient, x: number, y: number): number {
  const [a, b, c, d] = g.geometry;
  if (g.kind === 1) {
    const dx = c - a;
    const dy = d - b;
    return ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy);
  }
  return (Math.hypot(x - a, y - b) - c) / (d - c);
}

/** offset の位置 t の色（RGBA、不透明度で掛けない値。シェーダーと同じ式） */
export function gradientColorAt(g: ResolvedGradient, t: number): Rgba {
  const color = (i: number): Rgba => [g.colors[i * 4], g.colors[i * 4 + 1], g.colors[i * 4 + 2], g.colors[i * 4 + 3]];
  if (t <= g.offsets[0]) return color(0);
  for (let i = 1; i < g.count; i++) {
    const o0 = g.offsets[i - 1];
    const o1 = g.offsets[i];
    if (t <= o1) {
      if (!(o1 > o0)) return color(i);
      const u = (t - o0) / (o1 - o0);
      const c0 = color(i - 1);
      const c1 = color(i);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u, c0[3] + (c1[3] - c0[3]) * u];
    }
  }
  return color(g.count - 1);
}
