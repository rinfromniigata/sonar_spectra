// LOUD（ラウドネス）のモジュール定義。解析のラウドネス（近似）とピークを読み、数値と下端のバーで描く。
// 設定項目はない。値は規格に沿った測定ではなく近似（SPEC 3節「既知の制限」）。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createLoudRenderer } from "./loud_renderer";

export const loudModule: ModuleDefinition<"loud"> = {
  kind: "loud",
  labelKey: "modules.loudness",
  // 正方形に近い枠に向く。方向は持たない
  shape: "compact",
  baseDirection: null,
  flows: false,
  sections: [SectionId.Loudness],
  defaultOptions: {},
  inspectorFields: [],
  defaultInstances: [{ enabled: true }],
  createRenderer: createLoudRenderer,
};
