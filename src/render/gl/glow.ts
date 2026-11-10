// 発光の計算（imple 4.6・T9-1 の推奨案 (a)）。WebGL に頼らない純粋な部分で、単体テストで調べる。
//
// 描き方（gl_glow.ts）：発光する図形を等倍のフレームバッファに1回だけ描き、それを縮小し、分離型のガウスでぼかし、
// 拡大して枠に敷く。そのあとに図形そのものを等倍で重ねる。
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
  /** 読む位置を、縮小した画像の枠の範囲の内側（端のピクセルの中心まで）に留める：最小 x, y と最大 x, y */
  clamp: [number, number, number, number];
}

/**
 * 縮小した画像（テクスチャの大きさ textureWidth × textureHeight の左下に、plan.smallWidth × smallHeight で置いたもの）を、
 * 枠に拡大して敷くときのテクスチャ座標。枠のデバイスピクセル x は、縮小した画像の x / factor に当たる
 * （割り切れない大きさでも、同じ倍率で拡大する。端数の分は枠の外に出て、切り抜きで落ちる）
 */
export function glowSampling(plan: GlowPlan, textureWidth: number, textureHeight: number): GlowSampling {
  return {
    uvScale: [plan.width / plan.factor / textureWidth, plan.height / plan.factor / textureHeight],
    clamp: [0.5 / textureWidth, 0.5 / textureHeight, (plan.smallWidth - 0.5) / textureWidth, (plan.smallHeight - 0.5) / textureHeight],
  };
}

/** フレームバッファ（とその画像）の作り方。WebGL の部分を差し替えてテストできるようにする */
export interface GlowTargetFactory<T> {
  create(width: number, height: number): T | null;
  destroy(target: T): void;
}

/**
 * 発光に使うフレームバッファの組。共有キャンバスの大きさで作り、全部の枠で使い回す（枠ごとに左下の範囲だけを使う）。
 * - 等倍の1枚：発光する図形を描く
 * - 縮小した2枚（縮小率ごと）：縮小した画像と、横・縦のぼかしの行き来
 * 使うときに作り、キャンバスの大きさが変わったときだけ作り直す
 */
export class GlowTargets<T> {
  private width = 0;
  private height = 0;
  private fullTarget: T | null = null;
  private readonly scaledTargets = new Map<GlowFactor, [T, T]>();

  constructor(private readonly factory: GlowTargetFactory<T>) {}

  /** キャンバスの大きさ（デバイスピクセル）。変わったら作ってあるものを捨てる */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.release();
    this.width = width;
    this.height = height;
  }

  /** 等倍の1枚。作れなければ null */
  full(): T | null {
    if (this.width <= 0 || this.height <= 0) return null;
    this.fullTarget ??= this.factory.create(this.width, this.height);
    return this.fullTarget;
  }

  /** 縮小した2枚。作れなければ null */
  scaled(factor: GlowFactor): [T, T] | null {
    if (this.width <= 0 || this.height <= 0) return null;
    let pair = this.scaledTargets.get(factor);
    if (!pair) {
      const w = Math.ceil(this.width / factor);
      const h = Math.ceil(this.height / factor);
      const a = this.factory.create(w, h);
      const b = a ? this.factory.create(w, h) : null;
      if (!a || !b) {
        if (a) this.factory.destroy(a);
        return null;
      }
      pair = [a, b];
      this.scaledTargets.set(factor, pair);
    }
    return pair;
  }

  /** 作ってあるものを捨てる（次に使うときに作り直す） */
  release(): void {
    if (this.fullTarget) this.factory.destroy(this.fullTarget);
    this.fullTarget = null;
    for (const [a, b] of this.scaledTargets.values()) {
      this.factory.destroy(a);
      this.factory.destroy(b);
    }
    this.scaledTargets.clear();
  }
}
