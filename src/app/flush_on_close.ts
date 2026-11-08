// ウィンドウを閉じるとき、間を置いている保存を済ませてから閉じる。
// 保存が終わらなくても閉じられるよう、待つのは FLUSH_TIMEOUT_MS まで。

import { getCurrentWindow } from "@tauri-apps/api/window";

export const FLUSH_TIMEOUT_MS = 1000;

/** 返す関数で見張りをやめる */
export function flushOnClose(flush: () => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    });
    try {
      await Promise.race([flush().catch((error: unknown) => console.error(error)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  });
}
