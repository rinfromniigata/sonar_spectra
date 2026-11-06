// 位相のモジュール定義。解析の位相（リサージュの点列・相関・周波数別の定位）を読み、
// リサージュ（線＋点描）か周波数別の定位（モーションブラー）で描く。
// 種類ごとの設定項目（インスタンスの設定に出す欄）は、T6-2 でつなぐ。それまでは既定値で描く。

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
  inspectorFields: [],
  // 既定の構成：1つ目はリサージュ、2つ目は周波数別の定位で、自動整列の専用の位置（pan）に置く
  defaultInstances: [{ enabled: true }, { enabled: true, slot: "pan", options: { mode: "pan" } }],
  createRenderer: createStereoRenderer,
};
