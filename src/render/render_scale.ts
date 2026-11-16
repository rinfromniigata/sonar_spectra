// 描画の倍率（imple 4.6「描画の解像度」。v10）：論理ピクセル1つに、キャンバスの画素をいくつ割り当てるか。
// 倍率はここだけで決め、共有キャンバスの画素数（ShapeLayer）・枠の範囲（MeterGrid）・枠ごとの Canvas 2D の層
// （ModuleFrame）は、すべてこの倍率を使う（図形と文字の位置をそろえる。window.devicePixelRatio を直接読まない）。
// - "display"（画面どおり）：devicePixelRatio
// - "one"（等倍）：min(devicePixelRatio, 1)
// 設定はメーター画面が provide する。provide されていないとき（部品だけを組み立てたとき）は画面どおり。
// 開発用のモジュールギャラリーは対象外（画面どおりのまま）。

import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import { DEFAULT_RENDER_RESOLUTION, type RenderResolution } from "../config/types";

/** 今の画面の devicePixelRatio（読めなければ 1） */
export function currentDevicePixelRatio(): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** 描画の解像度と devicePixelRatio から、描画の倍率を求める */
export function renderScaleFor(resolution: RenderResolution, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return resolution === "one" ? Math.min(dpr, 1) : dpr;
}

/**
 * 画面どおりの大きさ（devicePixelRatio での画素数）を、描画の倍率での画素数にする。
 * 倍率が devicePixelRatio と同じなら、そのまま返す（画面どおりの描き方を変えない）
 */
export function scalePixels(devicePixels: number, devicePixelRatio: number, scale: number): number {
  if (scale === devicePixelRatio) return devicePixels;
  return Math.max(1, Math.round((devicePixels * scale) / devicePixelRatio));
}

export interface RenderScale {
  /** 描画の解像度（変わったら、キャンバスと層の大きさを合わせ直す） */
  readonly resolution: ComputedRef<RenderResolution>;
  /** 今の描画の倍率（呼んだときの devicePixelRatio で求める） */
  current(): number;
}

export const RENDER_SCALE_KEY: InjectionKey<RenderScale> = Symbol("render-scale");

function createRenderScale(resolution: () => RenderResolution): RenderScale {
  const ref = computed(resolution);
  return { resolution: ref, current: () => renderScaleFor(ref.value, currentDevicePixelRatio()) };
}

/** メーター画面の setup で呼ぶ。resolution はアプリ全体の設定 */
export function provideRenderScale(resolution: () => RenderResolution): RenderScale {
  const scale = createRenderScale(resolution);
  provide(RENDER_SCALE_KEY, scale);
  return scale;
}

/** provide された描画の倍率。なければ画面どおり */
export function useRenderScale(): RenderScale {
  return inject(RENDER_SCALE_KEY, null) ?? createRenderScale(() => DEFAULT_RENDER_RESOLUTION);
}
