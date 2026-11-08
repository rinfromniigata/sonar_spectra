// 構成と保存の型（imple 5.1）。保存の形は Rust の settings_store（src-tauri/src/settings_store/model.rs）と同じ。

import type { Direction, ModuleKind, ModuleOptions } from "../modules/options";

/** 12×8 の格子の位置（1始まり。モックと同じ） */
export interface GridRect {
  c: number;
  r: number;
  cs: number;
  rs: number;
}

/** 種類 K のインスタンス */
export interface InstanceOf<K extends ModuleKind> {
  id: string;
  kind: K;
  enabled: boolean;
  /** 自動配置中は null */
  rect: GridRect | null;
  /** 既定の配置で専用の位置を持つもの */
  slot?: "pan";
  direction: Direction | null;
  /** "preset.a" など、または自分で作った配色のID */
  paletteId: string;
  /** 初版は既定の1系統だけ */
  sourceId: "default";
  options: ModuleOptions[K];
}

/** 種類を問わないインスタンス */
export type Instance = { [K in ModuleKind]: InstanceOf<K> }[ModuleKind];

/** 自分で作った配色（ダーク用の値） */
export interface Palette {
  id: string;
  name: string;
  main: string;
  sub: string;
  accent: string;
}

export type LayoutMode = "auto" | "manual";
export type ThemeSetting = "dark" | "light" | "system";

export interface DisplaySettings {
  scanline: boolean;
  alwaysOnTop: boolean;
  startFullscreen: boolean;
}

/** 構成（配置・モジュールの設定・自分で作った配色・表示の設定） */
export interface Config {
  layout: { mode: LayoutMode; instances: Instance[] };
  customPalettes: Palette[];
  theme: ThemeSetting;
  display: DisplaySettings;
}

/** 保存済みの構成 */
export interface SavedConfig extends Config {
  id: string;
  name: string;
  /** ISO 8601 */
  savedAt: string;
}

/** state.json の形式の版 */
export const STATE_SCHEMA = 1;

/** state.json の中身 */
export interface PersistedState {
  schema: typeof STATE_SCHEMA;
  /** 今表示している構成（作業中の写し） */
  current: Config;
  /** 使用中の保存済み構成 */
  activeConfigId: string;
  /** 保存後に変更があるか（S02 の「保存後に変更あり」） */
  dirty: boolean;
  savedConfigs: SavedConfig[];
  /** 入力源。構成には含めない。deviceId が null なら既定の出力デバイス */
  source: { deviceId: string | null };
}
