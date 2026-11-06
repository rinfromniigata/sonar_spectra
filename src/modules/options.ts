// モジュールの種類と、種類ごとのインスタンスの設定（options）の型。
// 既定値は各モジュールの定義（ModuleDefinition.defaultOptions）が持つ（imple 5.1）。

/** モジュールの種類（並びは、既定のインスタンスと一覧の並び。モックの ORDER と同じ） */
export const MODULE_KINDS = ["level", "wave", "spec", "stereo", "gram", "loud", "vu", "chroma", "centroid"] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/** 推奨の形 */
export type Shape = "long" | "compact" | "free";

/** 流れる方向 */
export type Direction = "up" | "right" | "down" | "left";

export interface WaveOptions {
  channel: "stereo" | "mono";
  showNow: boolean;
  /** 履歴と今の波形の境目（流れの先から数えた履歴の割合、%） */
  split: number;
  histColor: "solid" | "bands";
  speed: number;
}

export interface SpecOptions {
  mode: "fill" | "bars" | "mirror" | "radial";
  ghost: boolean;
}

export interface StereoOptions {
  mode: "lissajous" | "pan";
  dots: "none" | "size" | "bright" | "both";
  blur: boolean;
}

export interface SpeedOptions {
  speed: number;
}

/** 設定のないモジュール */
export type NoOptions = Record<string, never>;

/** 種類ごとの設定 */
export interface ModuleOptions {
  level: NoOptions;
  wave: WaveOptions;
  spec: SpecOptions;
  stereo: StereoOptions;
  gram: SpeedOptions;
  loud: NoOptions;
  vu: NoOptions;
  chroma: NoOptions;
  centroid: SpeedOptions;
}
