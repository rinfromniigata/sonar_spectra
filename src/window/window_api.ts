// ウィンドウの操作（Tauri のウィンドウ API）への薄い入口。振る舞いは window_controller.ts にあり、
// そちらをテストするときはこの入口を差し替える。
// ボーダレスフルスクリーンはOSの種類で呼び分ける（imple 3.6）：
// - Windows とそれ以外：setFullscreen(true)（Windows では枠のない全画面になる）
// - macOS：setSimpleFullscreen(true)（新しい操作スペースを作らずに覆い、メニューバーと Dock を隠す。S09a）
// 必要な権限は src-tauri/capabilities/default.json（is-fullscreen・set-fullscreen・set-simple-fullscreen・set-always-on-top）。
// getCurrentWindow は呼ぶたびに取る（Tauri の外で開いたときに、組み立ての時点で例外にならず、各操作の失敗になるように）。

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Platform } from "../platform";

export interface WindowApi {
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  /** 大きさが変わるたびに handler を呼ぶ。返す関数で止める */
  onResized(handler: () => void): Promise<() => void>;
}

/** macOS の全画面で使う、Tauri のウィンドウの操作（テストでは代役に差し替える） */
export interface MacWindowOps {
  /** OS の全画面（新しい操作スペース。信号機の緑のボタンなどで入る）か */
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  setSimpleFullscreen(fullscreen: boolean): Promise<void>;
}

/**
 * macOS の全画面の扱い。Tauri は simple fullscreen の状態を返さない（isFullscreen は OS の全画面だけを見る）ため、
 * simple fullscreen に入ったかどうかはここで持つ。simple fullscreen はこのアプリの操作でしか出入りしない。
 * 信号機の緑のボタンで OS の全画面に入ったときも全画面として扱い、全画面のボタンではそちらを終える
 */
export function macFullscreen(ops: MacWindowOps): Pick<WindowApi, "isFullscreen" | "setFullscreen"> {
  let simple = false;
  return {
    isFullscreen: async () => simple || (await ops.isFullscreen()),
    setFullscreen: async (fullscreen) => {
      if (fullscreen) {
        // OS の全画面のあいだは simple fullscreen に入れない（Tauri も何もしない）
        if (simple || (await ops.isFullscreen())) return;
        await ops.setSimpleFullscreen(true);
        simple = true;
        return;
      }
      if (simple) {
        await ops.setSimpleFullscreen(false);
        simple = false;
        return;
      }
      if (await ops.isFullscreen()) await ops.setFullscreen(false);
    },
  };
}

export function tauriWindowApi(platform: Platform = "other"): WindowApi {
  const common = {
    setAlwaysOnTop: async (alwaysOnTop: boolean) => getCurrentWindow().setAlwaysOnTop(alwaysOnTop),
    onResized: async (handler: () => void) => getCurrentWindow().onResized(() => handler()),
  };
  if (platform === "macos") {
    return {
      ...macFullscreen({
        isFullscreen: async () => getCurrentWindow().isFullscreen(),
        setFullscreen: async (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
        setSimpleFullscreen: async (fullscreen) => getCurrentWindow().setSimpleFullscreen(fullscreen),
      }),
      ...common,
    };
  }
  return {
    isFullscreen: async () => getCurrentWindow().isFullscreen(),
    setFullscreen: async (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
    ...common,
  };
}
