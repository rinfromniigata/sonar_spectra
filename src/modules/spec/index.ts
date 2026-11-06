// スペクトラムのモジュール定義。解析のスペクトラム（対数の帯域ごとの振幅）を読み、
// 線＋塗り（既定）・バー・鏡写し・円形で描く。種類ごとの設定項目（インスタンスの設定に出す欄）は、T6-2 でつなぐ。
// それまでは既定値で描く。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createSpecRenderer } from "./spec_renderer";

export const specModule: ModuleDefinition<"spec"> = {
  kind: "spec",
  labelKey: "modules.spectrum",
  // 横長の枠に向く。強さは上へ伸び、流れる方向は上下左右から選べる
  shape: "long",
  baseDirection: "up",
  // 時間で流れるものではないので、流れる速さの設定は持たない
  flows: false,
  sections: [SectionId.Spectrum],
  // imple 5.1 の既定値
  defaultOptions: { mode: "fill", ghost: true },
  inspectorFields: [],
  defaultInstances: [{ enabled: true }],
  createRenderer: createSpecRenderer,
};
