// レベルメーターのモジュール定義。解析のレベル（ピーク）を読み、L・R の2本のバーで描く。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createLevelRenderer } from "./level_renderer";

export const levelModule: ModuleDefinition<"level"> = {
  kind: "level",
  labelKey: "modules.level",
  // 細長い枠に向く。バーは上へ伸び、縦長の画面では自動整列が右向きに倒す
  shape: "long",
  baseDirection: "up",
  flows: false,
  sections: [SectionId.Level],
  defaultOptions: {},
  inspectorFields: [],
  defaultInstances: [{ enabled: true }],
  createRenderer: createLevelRenderer,
};
