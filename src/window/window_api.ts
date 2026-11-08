// ウィンドウの操作（Tauri のウィンドウ API）への薄い入口。振る舞いは window_controller.ts にあり、
// そちらをテストするときはこの入口を差し替える。
// ボーダレスフルスクリーンは setFullscreen(true)（Windows では枠のない全画面になる）。
// 必要な権限は src-tauri/capabilities/default.json（is-fullscreen・set-fullscreen・set-always-on-top）。
// getCurrentWindow は呼ぶたびに取る（Tauri の外で開いたときに、組み立ての時点で例外にならず、各操作の失敗になるように）。

import { getCurrentWindow } from "@tauri-apps/api/window";

export interface WindowApi {
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  /** 大きさが変わるたびに handler を呼ぶ。返す関数で止める */
  onResized(handler: () => void): Promise<() => void>;
}

export function tauriWindowApi(): WindowApi {
  return {
    isFullscreen: async () => getCurrentWindow().isFullscreen(),
    setFullscreen: async (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
    setAlwaysOnTop: async (alwaysOnTop) => getCurrentWindow().setAlwaysOnTop(alwaysOnTop),
    onResized: async (handler) => getCurrentWindow().onResized(() => handler()),
  };
}
