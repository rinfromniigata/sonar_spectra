// VU メーターのモジュール定義。解析の VU（L・R の針の位置）を読み、針式のメーターで描く。
// 設定項目はない。機能はレベルメーターと同じなので、初期状態では無効（既定の配置・自動整列には入らない）。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createVuRenderer } from "./vu_renderer";

export const vuModule: ModuleDefinition<"vu"> = {
  kind: "vu",
  labelKey: "modules.vu",
  // 正方形に近い枠に向く。方向は持たない
  shape: "compact",
  baseDirection: null,
  flows: false,
  sections: [SectionId.Vu],
  defaultOptions: {},
  inspectorFields: [],
  defaultInstances: [{ enabled: false }],
  createRenderer: createVuRenderer,
};
