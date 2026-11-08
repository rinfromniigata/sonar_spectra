// 入力源に関する Rust のコマンド（src-tauri/src/commands.rs）。

import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo } from "./source_status";

/** 入力源を今の選択のまま開き直す（S01c の「再試行」）。結果はイベント `source-status` で届く */
export function retrySource(): Promise<void> {
  return invoke("retry_source");
}

/** 選べる出力デバイスの一覧 */
export function listOutputDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("list_output_devices");
}
