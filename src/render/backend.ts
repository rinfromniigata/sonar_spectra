// 描画ループから Rust へ送るコマンド（src-tauri/src/commands.rs）。

import { invoke } from "@tauri-apps/api/core";

/** 解析と送出を止める・再開する（ウィンドウの最小化）。取得は Rust 側で続く */
export function setRenderPaused(paused: boolean): Promise<void> {
  return invoke("set_render_paused", { paused });
}

/** 有効にする解析のセクションIDを伝える */
export function setActiveSections(ids: readonly number[]): Promise<void> {
  return invoke("set_active_sections", { ids });
}
