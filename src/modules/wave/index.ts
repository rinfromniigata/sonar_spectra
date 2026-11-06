// 波形のモジュール定義。左に音量の履歴、右に今の波形を描く。
// 種類ごとの設定項目（インスタンスの設定に出す欄）は、T6-2 でつなぐ。それまでは既定値で描く。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createWaveRenderer } from "./wave_renderer";

export const waveModule: ModuleDefinition<"wave"> = {
  kind: "wave",
  labelKey: "modules.waveform",
  shape: "long",
  // 履歴が左へ流れる
  baseDirection: "left",
  flows: true,
  sections: [SectionId.Waveform],
  // imple 5.1 の既定値
  defaultOptions: { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 },
  inspectorFields: [],
  defaultInstances: [{ enabled: true }],
  createRenderer: createWaveRenderer,
};
