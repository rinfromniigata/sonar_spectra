// 位相のモジュール定義。解析の位相（リサージュの点列・相関・周波数別の定位）を読み、
// リサージュ（線＋点描）か周波数別の定位（モーションブラー）で描く。
// インスタンスの設定に出す項目（表示方式・点描・モーションブラー）はここに記述する。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createStereoRenderer } from "./stereo_renderer";

export const stereoModule: ModuleDefinition<"stereo"> = {
  kind: "stereo",
  labelKey: "modules.phase",
  // 正方形に近い枠に向く。方向は持たない
  shape: "compact",
  baseDirection: null,
  flows: false,
  sections: [SectionId.Stereo],
  // imple 5.1 の既定値
  defaultOptions: { mode: "lissajous", dots: "both", blur: true },
  inspectorFields: [
    {
      type: "choice",
      key: "mode",
      labelKey: "instance.phase.mode",
      choices: [
        { value: "lissajous", labelKey: "instance.phase.mode_lissajous", noteKey: "instance.phase.mode_note_lissajous" },
        { value: "pan", labelKey: "instance.phase.mode_pan", noteKey: "instance.phase.mode_note_pan" },
      ],
    },
    // モーションブラーは周波数別の定位、点描はリサージュのときだけ出す（モックと同じ）
    {
      type: "switch",
      key: "blur",
      labelKey: "instance.phase.motion_blur",
      visibleWhen: { key: "mode", equals: "pan" },
    },
    {
      type: "choice",
      key: "dots",
      labelKey: "instance.phase.dots",
      choices: [
        { value: "none", labelKey: "instance.phase.dots_none" },
        { value: "size", labelKey: "instance.phase.dots_size" },
        { value: "bright", labelKey: "instance.phase.dots_bright" },
        { value: "both", labelKey: "instance.phase.dots_both" },
      ],
      visibleWhen: { key: "mode", equals: "lissajous" },
    },
  ],
  // 既定の構成：1つ目はリサージュ、2つ目は周波数別の定位で、自動整列の専用の位置（pan）に置く
  defaultInstances: [{ enabled: true }, { enabled: true, slot: "pan", options: { mode: "pan" } }],
  createRenderer: createStereoRenderer,
};
