// ウィンドウを閉じるとき、閉じる前の後始末（間を置いている保存を済ませる、全画面を終える）を済ませてから閉じる。
// 終わらなくても閉じられるよう、待つのは FLUSH_TIMEOUT_MS まで。

import { getCurrentWindow } from "@tauri-apps/api/window";

export const FLUSH_TIMEOUT_MS = 1000;

/**
 * 返す関数で見張りをやめる。Tauri の外では getCurrentWindow が同期的に例外を投げるが、async にして、
 * 呼び出し側の .catch（失敗は記録だけする）に届くようにする
 */
export async function beforeClose(prepare: () => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    });
    try {
      await Promise.race([prepare().catch((error: unknown) => console.error(error)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  });
}
