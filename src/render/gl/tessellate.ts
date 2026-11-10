// 図形を三角形に展開する（imple 4.6）。WebGL の線は1ピクセル固定なので、線は太さを持つ三角形の列にする。
// 帯・多角形・点・四角も三角形にする。WebGL に頼らない純粋関数で、頂点の書き出し先（MeshWriter）に書く。
//
// ふちのアンチエイリアス：頂点ごとに3つの値（u, v, w。デバイスピクセル）を持たせ、シェーダーで覆う割合を決める。
// - 塗り（帯・多角形・四角）：u = 0、v = FILL_EXTENT、w = 0（全部を覆う。ふちはマルチサンプルに任せる）
// - 線：u = 線の中心からの符号つきの距離、v = 太さの半分、w = 0。覆う割合 = clamp(v + 0.5 − |u|, 0, 1)
//   （形はふちより AA_MARGIN だけ外まで作り、そこで 0 になる）
// - 円い点：(u, v) = 中心からのずれ、w = 半径。覆う割合 = clamp(w + 0.5 − √(u² + v²), 0, 1)
// 継ぎ目は角（miter）で、角の長さが太さの MITER_LIMIT 倍を超える鋭い折れでは、Canvas 2D と同じく面取り（bevel）にする。
// 端は切りっぱなし（butt）。1デバイスピクセルより細い線は、1ピクセルの太さで、細さの分だけ薄くする（Canvas 2D の見え方に合わせる）

import type { Rgba } from "./color";

export interface MeshWriter {
  /** 頂点を足して番号を返す。色の不透明度には alpha を掛ける */
  vertex(x: number, y: number, color: Rgba, alpha: number, u: number, v: number, w: number): number;
  triangle(a: number, b: number, c: number): void;
}

/** 塗りの v（十分に大きい値：どこでも覆う割合が 1） */
export const FILL_EXTENT = 1e4;
/** 線と点の形を、ふちより外へ広げる幅（デバイスピクセル） */
export const AA_MARGIN = 1;
/** 角の長さの上限（太さの半分に対する倍率。Canvas 2D の miterLimit の既定 10 と同じ） */
export const MITER_LIMIT = 10;

const EPS = 1e-9;

/**
 * x, y の並びから、使える点（有限で、直前の点と重ならないもの）を取り出す。
 * index は、取り出した点ごとの元の点の番号（点ごとの値〔fades〕を引くのに使う）
 */
function cleanPoints(points: ArrayLike<number>, closed: boolean): { p: number[]; index: number[] } {
  const out: number[] = [];
  const index: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - x) < EPS && Math.abs(out[n - 1] - y) < EPS) continue;
    out.push(x, y);
    index.push(i / 2);
  }
  // 閉じた線で、終点が始点と重なっていれば落とす
  if (closed && out.length >= 4) {
    const n = out.length;
    if (Math.abs(out[n - 2] - out[0]) < EPS && Math.abs(out[n - 1] - out[1]) < EPS) {
      out.length = n - 2;
      index.length -= 1;
    }
  }
  return { p: out, index };
}

/** 色ごと透明（transparent。透明な黒）へ近づけた色。fade は 1 でそのまま、0 で透明（範囲の外は端に寄せ、有限でない値は 0） */
export function fadeColor(color: Rgba, fade: number): Rgba {
  const f = Number.isFinite(fade) ? Math.min(1, Math.max(0, fade)) : 0;
  return f === 1 ? color : [color[0] * f, color[1] * f, color[2] * f, color[3] * f];
}

/** 線の太さ（CSS ピクセル）から、デバイスピクセルでの太さの半分と、薄くする割合 */
export function lineCoverage(widthCss: number, pixelScale: number): { halfWidth: number; alpha: number } {
  const px = widthCss * pixelScale;
  if (px >= 1) return { halfWidth: px / 2, alpha: 1 };
  return { halfWidth: 0.5, alpha: Math.max(0, px) };
}

/**
 * 折れ線を三角形にする。points は x, y の並び（CSS ピクセル）、pixelScale は CSS ピクセルあたりのデバイスピクセル。
 * fades は点ごとに、色ごと透明へ近づける割合（fadeColor。点の間は頂点の色の補間でなめらかに移る）
 */
export function strokePolyline(
  writer: MeshWriter,
  points: ArrayLike<number>,
  widthCss: number,
  pixelScale: number,
  color: Rgba,
  alpha: number,
  closed = false,
  fades?: ArrayLike<number>,
): void {
  if (!(widthCss > 0) || !(pixelScale > 0)) return;
  const { p, index } = cleanPoints(points, closed);
  const n = p.length / 2;
  if (n < 2) return;
  const isClosed = closed && n >= 3;
  const { halfWidth, alpha: thin } = lineCoverage(widthCss, pixelScale);
  const a = alpha * thin;
  /** ふちのぼかしを含めた、中心からの広がり（デバイスピクセル・CSS ピクセル） */
  const extentPx = halfWidth + AA_MARGIN;
  const extent = extentPx / pixelScale;

  const segments = isClosed ? n : n - 1;
  // 区間ごとの向き（単位ベクトル）
  const dx = new Float64Array(segments);
  const dy = new Float64Array(segments);
  for (let s = 0; s < segments; s++) {
    const i0 = s;
    const i1 = (s + 1) % n;
    const vx = p[i1 * 2] - p[i0 * 2];
    const vy = p[i1 * 2 + 1] - p[i0 * 2 + 1];
    const len = Math.hypot(vx, vy);
    dx[s] = vx / len;
    dy[s] = vy / len;
  }

  // 点ごとの、入ってくる区間側と出ていく区間側の、左右の頂点
  const inL = new Int32Array(n);
  const inR = new Int32Array(n);
  const outL = new Int32Array(n);
  const outR = new Int32Array(n);
  /** 今の点の色（点ごとの fades を当てたもの） */
  let pointColor = color;
  const side = (x: number, y: number, nx: number, ny: number, scale: number, sign: 1 | -1) =>
    writer.vertex(x + sign * nx * extent * scale, y + sign * ny * extent * scale, pointColor, a, sign * extentPx, halfWidth, 0);

  for (let i = 0; i < n; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    pointColor = fades ? fadeColor(color, fades[index[i]]) : color;
    const prev = isClosed ? (i - 1 + n) % n : i - 1;
    const next = isClosed ? i : i < n - 1 ? i : -1;
    // 区間の左の法線（向きを左に 90° 回したもの。y が下向きの座標）
    if (prev < 0 || next < 0) {
      const s = prev < 0 ? next : prev;
      const nx = -dy[s];
      const ny = dx[s];
      inL[i] = outL[i] = side(x, y, nx, ny, 1, 1);
      inR[i] = outR[i] = side(x, y, nx, ny, 1, -1);
      continue;
    }
    const n0x = -dy[prev];
    const n0y = dx[prev];
    const n1x = -dy[next];
    const n1y = dx[next];
    const mx = n0x + n1x;
    const my = n0y + n1y;
    const mlen = Math.hypot(mx, my);
    const cosHalf = mlen / 2; // 2つの法線のなす角の半分の余弦
    if (mlen > EPS && 1 / cosHalf <= MITER_LIMIT) {
      // 角：二等分の向きに、太さの 1/cos(θ/2) 倍
      const ux = mx / mlen;
      const uy = my / mlen;
      const k = 1 / cosHalf;
      inL[i] = outL[i] = side(x, y, ux, uy, k, 1);
      inR[i] = outR[i] = side(x, y, ux, uy, k, -1);
      continue;
    }
    // 面取り：入ってくる区間と出ていく区間を、それぞれの法線で切りっぱなしにし、外側のすき間を三角形で埋める
    inL[i] = side(x, y, n0x, n0y, 1, 1);
    inR[i] = side(x, y, n0x, n0y, 1, -1);
    outL[i] = side(x, y, n1x, n1y, 1, 1);
    outR[i] = side(x, y, n1x, n1y, 1, -1);
    const center = writer.vertex(x, y, pointColor, a, 0, halfWidth, 0);
    // 左（+法線）へ曲がるとき、外側は右
    const cross = dx[prev] * dy[next] - dy[prev] * dx[next];
    if (cross > 0) writer.triangle(center, inR[i], outR[i]);
    else writer.triangle(center, inL[i], outL[i]);
  }

  for (let s = 0; s < segments; s++) {
    const i0 = s;
    const i1 = (s + 1) % n;
    writer.triangle(outL[i0], outR[i0], inL[i1]);
    writer.triangle(outR[i0], inR[i1], inL[i1]);
  }
}

/**
 * 塗りの帯：各位置 xs[i] で top[i]〜bottom[i] を塗り、隣とつなぐ。値が有限でない位置で帯を切る。
 * 隣どうしの間で top と bottom が入れ替わるところは、交わる点で2つの三角形に分ける
 * （Canvas 2D で上の線と下の線を1つのパスにして塗ったときと同じ形。重ねて塗る部分を作らない）
 */
export function fillBand(
  writer: MeshWriter,
  xs: ArrayLike<number>,
  top: ArrayLike<number>,
  bottom: ArrayLike<number>,
  color: Rgba,
  alpha: number,
): void {
  const n = Math.min(xs.length, top.length, bottom.length);
  const vertex = (x: number, y: number) => writer.vertex(x, y, color, alpha, 0, FILL_EXTENT, 0);
  let prevTop = -1;
  let prevBottom = -1;
  let px = 0;
  let pt = 0;
  let pb = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const t = top[i];
    const b = bottom[i];
    if (!Number.isFinite(x) || !Number.isFinite(t) || !Number.isFinite(b)) {
      prevTop = -1;
      continue;
    }
    const vt = vertex(x, t);
    const vb = vertex(x, b);
    if (prevTop >= 0) {
      const d0 = pt - pb;
      const d1 = t - b;
      if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
        // 交わる点で、左右の三角形に分ける
        const u = d0 / (d0 - d1);
        const cross = vertex(px + (x - px) * u, pt + (t - pt) * u);
        writer.triangle(prevTop, cross, prevBottom);
        writer.triangle(cross, vt, vb);
      } else {
        writer.triangle(prevTop, vt, vb);
        writer.triangle(prevTop, vb, prevBottom);
      }
    }
    prevTop = vt;
    prevBottom = vb;
    px = x;
    pt = t;
    pb = b;
  }
}

/** 塗りの多角形：center（省略は点の平均）を中心に扇形に分ける（中心から見て星形の形に限る） */
export function fillPolygon(
  writer: MeshWriter,
  points: ArrayLike<number>,
  color: Rgba,
  alpha: number,
  center?: readonly [number, number],
): void {
  const { p } = cleanPoints(points, true);
  const n = p.length / 2;
  if (n < 3) return;
  let cx = 0;
  let cy = 0;
  if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
    [cx, cy] = center;
  } else {
    for (let i = 0; i < n; i++) {
      cx += p[i * 2] / n;
      cy += p[i * 2 + 1] / n;
    }
  }
  const middle = writer.vertex(cx, cy, color, alpha, 0, FILL_EXTENT, 0);
  const first = writer.vertex(p[0], p[1], color, alpha, 0, FILL_EXTENT, 0);
  let prev = first;
  for (let i = 1; i < n; i++) {
    const v = writer.vertex(p[i * 2], p[i * 2 + 1], color, alpha, 0, FILL_EXTENT, 0);
    writer.triangle(middle, prev, v);
    prev = v;
  }
  writer.triangle(middle, prev, first);
}

/** 四角：x, y, 幅, 高さ の並び。alphas は四角ごとの不透明度（alpha に掛ける）。幅か高さが 0 以下・透明なものは描かない */
export function fillRects(writer: MeshWriter, rects: ArrayLike<number>, color: Rgba, alpha: number, alphas?: ArrayLike<number>): void {
  for (let i = 0, k = 0; i + 3 < rects.length; i += 4, k++) {
    const x = rects[i];
    const y = rects[i + 1];
    const w = rects[i + 2];
    const h = rects[i + 3];
    const o = alpha * (alphas ? alphas[k] : 1);
    if (!(w > 0 && h > 0) || !(o > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const a = writer.vertex(x, y, color, o, 0, FILL_EXTENT, 0);
    const b = writer.vertex(x + w, y, color, o, 0, FILL_EXTENT, 0);
    const c = writer.vertex(x + w, y + h, color, o, 0, FILL_EXTENT, 0);
    const d = writer.vertex(x, y + h, color, o, 0, FILL_EXTENT, 0);
    writer.triangle(a, b, c);
    writer.triangle(a, c, d);
  }
}

/** 円い点：x, y の並び。radius は全部に同じ値か点ごとの並び（CSS ピクセル）。alphas は点ごとの不透明度 */
export function fillPoints(
  writer: MeshWriter,
  points: ArrayLike<number>,
  radius: number | ArrayLike<number>,
  pixelScale: number,
  color: Rgba,
  alpha: number,
  alphas?: ArrayLike<number>,
): void {
  if (!(pixelScale > 0)) return;
  for (let i = 0, k = 0; i + 1 < points.length; i += 2, k++) {
    const x = points[i];
    const y = points[i + 1];
    const r = typeof radius === "number" ? radius : radius[k];
    const a = alpha * (alphas ? alphas[k] : 1);
    if (!(r > 0) || !(a > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rPx = r * pixelScale;
    const ePx = rPx + AA_MARGIN;
    const e = ePx / pixelScale;
    const v0 = writer.vertex(x - e, y - e, color, a, -ePx, -ePx, rPx);
    const v1 = writer.vertex(x + e, y - e, color, a, ePx, -ePx, rPx);
    const v2 = writer.vertex(x + e, y + e, color, a, ePx, ePx, rPx);
    const v3 = writer.vertex(x - e, y + e, color, a, -ePx, ePx, rPx);
    writer.triangle(v0, v1, v2);
    writer.triangle(v0, v2, v3);
  }
}

/** 覆う割合（シェーダーと同じ式。テストで、展開した値が意図どおりかを確かめるのに使う） */
export function coverage(u: number, v: number, w: number): number {
  const c = w > 0 ? w + 0.5 - Math.hypot(u, v) : v + 0.5 - Math.abs(u);
  return Math.min(1, Math.max(0, c));
}

/**
 * 流れる画像の四角：dest（CSS ピクセル）に、x, y, s, t の並びを4つ（左上・右上・右下・左下）。
 * s は読み始めの位置（start / width）から1周、t は上が 0
 */
export function imageQuad(dest: { x: number; y: number; width: number; height: number }, start: number, width: number): Float32Array {
  const s0 = start / width;
  const s1 = s0 + 1;
  const { x, y } = dest;
  const r = x + dest.width;
  const b = y + dest.height;
  return new Float32Array([x, y, s0, 0, r, y, s1, 0, r, b, s1, 1, x, b, s0, 1]);
}
