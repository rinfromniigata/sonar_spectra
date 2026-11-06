// ウィンドウの最小化を見張る。Tauri のウィンドウの大きさが変わるたびに isMinimized で確かめ、
// あわせて WebView の visibilitychange も見る（どちらかが止める合図になれば止める）。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { PauseTracker } from "./pause_tracker";

/** 止めるべきかが変わるたびに `onChange` を呼ぶ（最初に1回、今の状態で呼ぶ）。返す関数で見張りをやめる */
export async function watchMinimized(onChange: (paused: boolean) => void): Promise<() => void> {
  const tracker = new PauseTracker(onChange);
  const win = getCurrentWindow();

  const onVisibility = () => tracker.setHidden(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();

  const refresh = async () => {
    try {
      tracker.setMinimized(await win.isMinimized());
    } catch {
      // 確かめられないときは止めない（描画が止まったままになるのを避ける）
      tracker.setMinimized(false);
    }
  };
  const unlistenResized = await win.onResized(() => void refresh());
  await refresh();

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    unlistenResized();
  };
}
