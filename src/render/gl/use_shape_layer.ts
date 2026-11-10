// 描画の層を画面に組み込む。メーターの格子（MeterGrid）の setup で呼び、格子の後ろに敷いた共有キャンバスで描画の層を始め、
// 描画ループ（provideRenderLoop）に段として加える。子の ModuleFrame は provide された受け口から、自分の枠の ShapeSink を得る。
// 状態（使える・失った・作れない）は ref で見せる（ModuleFrame は地を透明にするか、MeterGrid は描画を開始できない表示を出すか）。

import { inject, onBeforeUnmount, onMounted, provide, shallowRef, type InjectionKey, type Ref } from "vue";
import type { Geometry, ShapeSink } from "../../modules/types";
import type { RenderLoop } from "../render_loop";
import { RENDER_LOOP_KEY } from "../use_render_loop";
import type { DeviceRect } from "./frame_rects";
import { DISCARD_SINK } from "./shape_batch";
import { ShapeLayer, type ShapeLayerStatus } from "./shape_layer";

export interface ShapeLayerHandle {
  readonly status: Readonly<Ref<ShapeLayerStatus>>;
  /**
   * 枠1つ分の受け口（描画ループの1回の中で、描くときに呼ぶ）。opacity は枠の図形の不透明度
   * （レイアウト編集中に薄くする。重なった図形をまとめて薄くする）
   */
  sink(id: string, geometry: Geometry, opacity?: number): ShapeSink;
}

export const SHAPE_LAYER_KEY: InjectionKey<ShapeLayerHandle> = Symbol("shape-layer");

export interface ShapeLayerSetup {
  /** 共有キャンバス（マウント後に入る） */
  canvas: Readonly<Ref<HTMLCanvasElement | null>>;
  /** 今の枠の範囲（枠のインスタンスID → 共有キャンバスのデバイスピクセル） */
  frames: () => ReadonlyMap<string, DeviceRect>;
  /** 描画ループ（省略すると、親が provide したものを使う。同じコンポーネントで provide したときに渡す） */
  loop?: RenderLoop;
}

export function provideShapeLayer(setup: ShapeLayerSetup): ShapeLayerHandle {
  const loop = setup.loop ?? inject(RENDER_LOOP_KEY, null);
  const status = shallowRef<ShapeLayerStatus>("pending");
  let layer: ShapeLayer | null = null;
  let removeLayer: (() => void) | null = null;

  const handle: ShapeLayerHandle = {
    status,
    sink: (id, geometry, opacity) => layer?.sink(id, geometry, opacity) ?? DISCARD_SINK,
  };
  provide(SHAPE_LAYER_KEY, handle);

  onMounted(() => {
    const canvas = setup.canvas.value;
    // 描画ループがない（部品だけを組み立てたとき）は始めない
    if (!canvas || !loop) return;
    layer = new ShapeLayer({
      canvas,
      frames: setup.frames,
      onStatus: (next) => {
        status.value = next;
      },
    });
    layer.start();
    removeLayer = loop.addLayer(layer);
  });

  onBeforeUnmount(() => {
    removeLayer?.();
    layer?.dispose();
    layer = null;
  });

  return handle;
}
