// 発光の計算（imple 4.6・T9-1 の推奨案 (a)）。WebGL に頼らない純粋な部分で、単体テストで調べる。
//
// 描き方（gl_glow.ts）：発光する図形を等倍のフレームバッファに1回だけ描き、それを縮小し、分離型のガウスでぼかし、
// 拡大して枠に敷く。そのあとに図形そのものを等倍で重ねる。1回の描画の発光は、枠に敷く前にまとめて用意する
// （発光ごとに、図形のある範囲にぼかしの届く幅を足した範囲だけを、作業用の画像に詰めて描く。glowRegion・packShelves。
// 描く先を切り替える回数と、読み書きする画素を減らす。T15-1）。
// 広がりは shadowBlur と同じにそろえる（移行前の glow_layer の実測による）：発光の値 b は、デバイスピクセルで
// 標準偏差 b/2 のぼかし。縮小した画像の上では標準偏差 b/2 × 縮小率。縮小率は、ぼかしが大きいほど小さくできる
// （縮小した画像の上での標準偏差が 1.5〜3ピクセル程度になるように）。

/** ぼかしの半径（縮小した画像のピクセル）の上限。シェーダーの重みの並びの長さ（MAX_GLOW_RADIUS + 1）と同じ */
export const MAX_GLOW_RADIUS = 32;

/** 縮小の割り算の値（2 か 4） */
export type GlowFactor = 2 | 4;

/** 縮小率：発光 12 までは 1/2、それより大きいと 1/4 */
export function glowScale(glow: number): number {
  return glow > 12 ? 0.25 : 0.5;
}

/** 縮小した画像の上での、ぼかしの標準偏差（px） */
export function glowDeviation(glow: number): number {
  return (glow / 2) * glowScale(glow);
}

/**
 * ガウスの重み（中心から 0, 1, …, 半径 のピクセル）。半径は 3σ を切り上げた値（MAX_GLOW_RADIUS まで）。
 * 両側を足して 1 になるように正規化する（w[0] + 2 × (w[1] + … + w[半径]) = 1）
 */
export function gaussianWeights(sigma: number): Float32Array {
  if (!(sigma > 0)) return new Float32Array([1]);
  const radius = Math.min(MAX_GLOW_RADIUS, Math.ceil(sigma * 3));
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    raw.push(w);
    sum += i === 0 ? w : 2 * w;
  }
  return new Float32Array(raw.map((w) => w / sum));
}

/** 枠1つ分の発光の段取り */
export interface GlowPlan {
  factor: GlowFactor;
  /** 縮小した画像の上での標準偏差（px） */
  deviation: number;
  /** ガウスの重み（gaussianWeights） */
  weights: Float32Array;
  /** 枠の大きさ（デバイスピクセル） */
  width: number;
  height: number;
  /** 縮小した画像で、枠を覆う大きさ（端数は切り上げ） */
  smallWidth: number;
  smallHeight: number;
}

/** 発光の段取り。発光が 0 以下、または枠の大きさがないときは null（ぼかしを飛ばし、図形だけを描く） */
export function glowPlan(glow: number, width: number, height: number): GlowPlan | null {
  if (!(glow > 0) || width <= 0 || height <= 0) return null;
  const scale = glowScale(glow);
  const deviation = glowDeviation(glow);
  return {
    factor: scale === 0.25 ? 4 : 2,
    deviation,
    weights: gaussianWeights(deviation),
    width,
    height,
    smallWidth: Math.ceil(width * scale),
    smallHeight: Math.ceil(height * scale),
  };
}

/** 縮小した画像を枠に拡大して敷くときの、テクスチャ座標 */
export interface GlowSampling {
  /** 枠の左下 (0, 0) 〜 右上 (1, 1) に掛けて、テクスチャ座標にする倍率 */
  uvScale: [number, number];
  /** 倍率を掛けたあとに足す値（縮小した画像の置き場所の左下） */
  uvOffset: [number, number];
  /** 読む位置を、縮小した画像の枠の範囲の内側（端のピクセルの中心まで）に留める：最小 x, y と最大 x, y */
  clamp: [number, number, number, number];
}

/**
 * 縮小した画像（テクスチャの大きさ textureWidth × textureHeight の (originX, originY) に、plan.smallWidth × smallHeight で
 * 置いたもの）を、枠に拡大して敷くときのテクスチャ座標。枠のデバイスピクセル x は、縮小した画像の x / factor に当たる
 * （割り切れない大きさでも、同じ倍率で拡大する。端数の分は枠の外に出て、切り抜きで落ちる）。
 * 置いたものが枠の一部（縮小した画像で (offsetX, offsetY) から。glowRegion）のときは、その分だけ読む位置を戻す
 */
export function glowSampling(
  plan: GlowPlan,
  textureWidth: number,
  textureHeight: number,
  originX = 0,
  originY = 0,
  offsetX = 0,
  offsetY = 0,
): GlowSampling {
  return {
    uvScale: [plan.width / plan.factor / textureWidth, plan.height / plan.factor / textureHeight],
    uvOffset: [(originX - offsetX) / textureWidth, (originY - offsetY) / textureHeight],
    clamp: [
      (originX + 0.5) / textureWidth,
      (originY + 0.5) / textureHeight,
      (originX + plan.smallWidth - 0.5) / textureWidth,
      (originY + plan.smallHeight - 0.5) / textureHeight,
    ],
  };
}

/** 画像の上の範囲（ピクセル。WebGL の座標で、y は下から） */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** クリップ座標（-1〜1）の上の範囲 */
export interface ClipBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 発光の図形のふちの、ならしの分の余白（デバイスピクセル） */
const PAINT_MARGIN = 2;

/**
 * 発光を用意する範囲（T15-1）：枠の中で、発光する図形がある範囲（clip。クリップ座標）に、ぼかしが届く幅を足したもの。
 * 枠の左下を原点とするデバイスピクセル（WebGL の座標）で、左下は縮小の割り算の値（factor）の倍数にそろえる
 * （縮小するピクセルの組が、枠全体を縮小したときと同じになる）。枠の外は切る。
 * ぼかしの半径（縮小した画像で r ピクセル）より外は、枠全体で計算しても 0 になるので、この範囲だけで計算しても結果は同じ。
 * 図形が枠の外にしかなければ null
 */
export function glowRegion(clip: ClipBounds, plan: GlowPlan): PixelRect | null {
  const radius = Math.min(plan.weights.length - 1, MAX_GLOW_RADIUS);
  const margin = (radius + 1) * plan.factor + PAINT_MARGIN;
  const f = plan.factor;
  const x0 = Math.max(0, Math.floor((((clip.minX + 1) / 2) * plan.width - margin) / f) * f);
  const y0 = Math.max(0, Math.floor((((clip.minY + 1) / 2) * plan.height - margin) / f) * f);
  const x1 = Math.min(plan.width, Math.ceil((((clip.maxX + 1) / 2) * plan.width + margin) / f) * f);
  const y1 = Math.min(plan.height, Math.ceil((((clip.maxY + 1) / 2) * plan.height + margin) / f) * f);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * 画像の上の置き場所（棚詰め）。幅 width の画像に、大きさの並びを左下から右へ詰め、入らなければ上の段へ移る。
 * 段が maxHeight を超えるときは、次のページ（page。別の回に描く）の左下から詰める。width より広いものは、その幅の段を作る
 * （呼び出し側が画像の幅を広げる）。返すのは、置き場所と、使った幅と、いちばん高いページの高さと、ページの数
 */
export function packShelves(
  sizes: readonly { width: number; height: number }[],
  width: number,
  maxHeight = Infinity,
): { origins: { x: number; y: number; page: number }[]; width: number; height: number; pages: number } {
  let x = 0;
  let y = 0;
  let shelf = 0;
  let page = 0;
  let used = 0;
  let height = 0;
  const origins = sizes.map((size) => {
    if (x > 0 && x + size.width > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    if (y > 0 && y + size.height > maxHeight) {
      page++;
      y = 0;
      x = 0;
      shelf = 0;
    }
    const origin = { x, y, page };
    x += size.width;
    shelf = Math.max(shelf, size.height);
    used = Math.max(used, x);
    height = Math.max(height, y + shelf);
    return origin;
  });
  return { origins, width: used, height, pages: sizes.length > 0 ? page + 1 : 0 };
}
