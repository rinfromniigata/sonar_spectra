// スペクトログラムのモジュール定義。スペクトラムの履歴を、横が時間・縦が周波数の流れる画像で描く。
// 種類ごとの設定項目（流れる速さ）は、T6-2 でつなぐ。それまでは既定値で描く。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createGramRenderer } from "./gram_renderer";

export const gramModule: ModuleDefinition<"gram"> = {
  kind: "gram",
  labelKey: "modules.spectrogram",
  // 形を選ばない。残りの領域を埋める役（自動整列は、置くもののない領域をスペクトログラムに吸収させる）
  shape: "free",
  // 左へ流れる（新しい列が右端）
  baseDirection: "left",
  flows: true,
  // 受信側が、スペクトラムのセクションをスペクトログラムの履歴（histories.gram）に積む
  sections: [SectionId.Spectrum],
  defaultOptions: { speed: 1 },
  inspectorFields: [],
  defaultInstances: [{ enabled: true }],
  createRenderer: createGramRenderer,
};
