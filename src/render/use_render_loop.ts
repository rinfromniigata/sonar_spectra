// 描画ループを画面に組み込む。メーター画面（T2-14）の setup で1度だけ呼び、子の ModuleFrame は
// provide されたループに自分を登録する。
// - テーマが変わったら Canvas 用の色を読み直す
// - 最小化されたら描画を止め、Rust に set_render_paused を送る（戻したら再開）
// - フレームレートの上限（アプリ全体の設定）は、描画ループが毎回読む（変えるとすぐ効く）
// - 有効なモジュールが変わったら、必要な解析だけを set_active_sections で伝える

import { onBeforeUnmount, onMounted, provide, watch, type InjectionKey } from "vue";
import type { Instance } from "../config/types";
import { moduleRegistry, type ModuleRegistry } from "../modules/registry";
import { readDocumentCanvasColors, watchCanvasColors, type CanvasColors } from "../theme/canvas_colors";
import { activeSections } from "./active_sections";
import { setActiveSections, setRenderPaused } from "./backend";
import { RenderLoop, type FrameSource } from "./render_loop";
import { watchMinimized } from "./window_state";

export const RENDER_LOOP_KEY: InjectionKey<RenderLoop> = Symbol("render-loop");

export interface RenderLoopOptions {
  source: FrameSource;
  /** 今の構成のインスタンス（変わったら必要な解析を伝え直す） */
  instances: () => readonly Instance[];
  /** フレームレートの上限（fps。アプリ全体の設定）。省略すると既定 */
  frameLimit?: () => number;
  registry?: ModuleRegistry;
}

export function provideRenderLoop(options: RenderLoopOptions): RenderLoop {
  const registry = options.registry ?? moduleRegistry;
  let colors: CanvasColors = readDocumentCanvasColors();
  const loop = new RenderLoop(options.source, () => colors, undefined, options.frameLimit);
  provide(RENDER_LOOP_KEY, loop);

  // 必要な解析：中身が変わったときだけ送る
  watch(
    () => activeSections(options.instances(), registry).join(","),
    (key) => {
      const ids = key === "" ? [] : key.split(",").map(Number);
      setActiveSections(ids).catch((error) => console.error(error));
    },
    { immediate: true },
  );

  let disposed = false;
  let stopColors: (() => void) | null = null;
  let stopMinimized: (() => void) | null = null;

  onMounted(() => {
    stopColors = watchCanvasColors((next) => {
      colors = next;
    });
    loop.start();
    watchMinimized((paused) => {
      loop.setPaused(paused);
      setRenderPaused(paused).catch((error) => console.error(error));
    })
      .then((stop) => {
        if (disposed) stop();
        else stopMinimized = stop;
      })
      .catch((error) => console.error(error));
  });

  onBeforeUnmount(() => {
    disposed = true;
    loop.stop();
    stopColors?.();
    stopMinimized?.();
  });

  return loop;
}
