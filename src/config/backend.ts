// 保存に関する Rust のコマンド（src-tauri/src/commands.rs）。

import { invoke } from "@tauri-apps/api/core";
import type { PersistedState } from "./types";

/**
 * 保存された状態を読む。null なら、初めての起動か、読めないファイルを退避したあと（既定の状態で起動する）。
 * 古い schema は Rust が移行してから返す。ファイルが読めない（権限など）ときは失敗する
 */
export function loadState(): Promise<PersistedState | null> {
  return invoke<PersistedState | null>("load_state");
}

/** 状態を保存する。Rust は一時ファイルに書いてから置き換え、決まりに合わない状態は書かずに失敗を返す */
export function saveState(state: PersistedState): Promise<void> {
  return invoke("save_state", { state });
}
