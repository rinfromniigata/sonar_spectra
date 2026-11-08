// 設定のテーマを、文書の data-theme に反映する。
// - dark・light：data-theme にその値を付ける（tokens.css の明示指定）
// - system：data-theme を外す（tokens.css の prefers-color-scheme に任せるので、OS の切り替えに追従する）
// Canvas の色の読み直しは、data-theme の付け外しと OS の切り替えを見ている watchCanvasColors（canvas_colors.ts）が行う。

import { watch, type WatchHandle } from "vue";
import type { ConfigStore } from "../config/config_store";
import type { ThemeSetting } from "../config/types";

/** dataset を持つ要素（文書の <html>） */
export interface ThemeRoot {
  dataset: DOMStringMap;
}

export function applyTheme(setting: ThemeSetting, root: ThemeRoot = document.documentElement): void {
  if (setting === "system") delete root.dataset.theme;
  else root.dataset.theme = setting;
}

/**
 * 今の構成のテーマを、すぐに反映し、変わるたびに反映し直す。
 * マウントの前に呼ぶ（OS 設定がライトのとき、ダークで一瞬見えないように）。返すハンドルで止める
 */
export function bindTheme(config: ConfigStore, root: ThemeRoot = document.documentElement): WatchHandle {
  return watch(
    () => config.current.value.theme,
    (setting) => applyTheme(setting, root),
    { immediate: true, flush: "sync" },
  );
}
