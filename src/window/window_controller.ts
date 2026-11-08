// ウィンドウの扱い：ボーダレスフルスクリーン、常に最前面、起動時の全画面。
// - 全画面のボタン（タイトル帯）：toggleFullscreen。押したあと、実際のウィンドウの状態を読み直して runtime.fullscreen
//   （ボタンのアイコンと読み上げの名前）に映す。OS の操作で全画面が変わったときも、大きさの変化で読み直す
// - 常に最前面：設定の display.alwaysOnTop を、起動時と変わるたびにウィンドウへ反映する
// - 起動時の全画面：設定の display.startFullscreen が真なら、起動時に1度だけ全画面にする
//   （ウィンドウの位置・大きさは tauri-plugin-window-state が記憶する。全画面の状態は記憶しない。src-tauri/src/lib.rs）
// - 閉じる前：全画面なら全画面を終えてから閉じる。全画面のままだと、プラグインが全画面のときの位置・大きさを
//   記憶してしまい、次の起動で、普通のウィンドウが画面いっぱいの大きさで出るため

import { watch, type WatchHandle } from "vue";
import type { RuntimeStore } from "../app/runtime_store";
import type { ConfigStore } from "../config/config_store";
import type { WindowApi } from "./window_api";

/** 全画面を終えたあと、ウィンドウの大きさと位置の変化がプラグインに届くのを待つ上限（ミリ秒） */
export const LEAVE_FULLSCREEN_SETTLE_MS = 400;

export interface WindowController {
  /** 起動時に1度呼ぶ：実際の状態を読み、常に最前面を反映し、起動時の全画面なら全画面にする */
  start(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  /** ウィンドウを閉じる前に呼ぶ：全画面なら終えて、位置・大きさが落ち着くのを待つ */
  leaveFullscreenForClose(): Promise<void>;
  /** 見張り（大きさの変化・設定の変化）をやめる */
  dispose(): void;
}

export interface WindowControllerOptions {
  api: WindowApi;
  config: Pick<ConfigStore, "current">;
  runtime: Pick<RuntimeStore, "fullscreen">;
  onError?: (error: unknown) => void;
  settleMs?: number;
}

export function createWindowController(options: WindowControllerOptions): WindowController {
  const { api, config, runtime } = options;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const settleMs = options.settleMs ?? LEAVE_FULLSCREEN_SETTLE_MS;
  let stopResized: (() => void) | null = null;
  let stopAlwaysOnTop: WatchHandle | null = null;
  let disposed = false;

  /** 実際のウィンドウの状態を読み、runtime.fullscreen に映す。読めなければ fallback（なければ今のまま） */
  async function refresh(fallback?: boolean): Promise<void> {
    try {
      runtime.fullscreen.value = await api.isFullscreen();
    } catch (error) {
      onError(error);
      if (fallback !== undefined) runtime.fullscreen.value = fallback;
    }
  }

  async function setFullscreen(target: boolean): Promise<void> {
    try {
      await api.setFullscreen(target);
    } catch (error) {
      onError(error);
    }
    await refresh();
  }

  async function start(): Promise<void> {
    stopAlwaysOnTop = watch(
      () => config.current.value.display.alwaysOnTop,
      (alwaysOnTop) => {
        api.setAlwaysOnTop(alwaysOnTop).catch(onError);
      },
      { immediate: true },
    );
    try {
      const stop = await api.onResized(() => void refresh());
      if (disposed) stop();
      else stopResized = stop;
    } catch (error) {
      onError(error);
    }
    await refresh();
    if (config.current.value.display.startFullscreen && !runtime.fullscreen.value) await setFullscreen(true);
  }

  async function toggleFullscreen(): Promise<void> {
    await setFullscreen(!runtime.fullscreen.value);
  }

  async function leaveFullscreenForClose(): Promise<void> {
    await refresh();
    if (!runtime.fullscreen.value) return;
    // 大きさが変わった合図（プラグインが位置・大きさを記録し直す合図でもある）を待つ。来なくても上限で進む
    let resolveResized: () => void = () => {};
    const resized = new Promise<void>((resolve) => {
      resolveResized = resolve;
    });
    const stop = await api.onResized(resolveResized).catch((error: unknown) => {
      onError(error);
      return () => {};
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await setFullscreen(false);
      await Promise.race([
        resized,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, settleMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      stop();
    }
  }

  return {
    start,
    toggleFullscreen,
    leaveFullscreenForClose,
    dispose() {
      disposed = true;
      stopResized?.();
      stopResized = null;
      stopAlwaysOnTop?.stop();
      stopAlwaysOnTop = null;
    },
  };
}
